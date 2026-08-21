# Freya Architecture

## Status and scope

This document defines the architecture before implementation. The MVP is intentionally
narrow: learn explainable boolean trigger-to-light-action patterns and produce
suggestions. It does not attempt general AI home control.

The non-negotiable invariant is:

> No code path may call `setForeignState()` unless the target has explicit
> `control: true` permission and the central Safety Engine has approved that exact
> action immediately before execution.

## Read-only environment findings

Snapshot date: 2026-08-20. The inspection did not alter objects, states, adapter
configuration, or history data.

- Linux x64, Node.js 22.23.1, npm 10.9.8.
- ioBroker js-controller 7.2.2 using JSONL object and state databases.
- ioBroker Admin 7.8.23 supports JSON Config and JSON-based adapter tabs.
- 12,879 live objects, including 11,606 states.
- 9,652 states declare `read: true`; 3,382 declare `write: true`.
- State metadata is heterogeneous: 2,229 states have no role and many use generic
  roles such as `value` or `state`.
- Five room enums (68 memberships) and 16 function enums (73 memberships) exist.
- InfluxDB adapter 4.0.2 is active; 47 states are configured for `influxdb.0`.
- Stale `history.0` custom metadata exists for two states, but no active History
  adapter instance was found. Provider availability must therefore be checked from
  live instance objects, not inferred from `common.custom` alone.

Only aggregate findings are recorded because this is a public repository. State IDs,
device names, room names, addresses, credentials, and values must never be committed.

## Architecture decisions

### Adapter foundation

Phase 1 will use the current `@iobroker/create-adapter` TypeScript template, a daemon
adapter based on `@iobroker/adapter-core`, and JSON Config for initial settings. The
backend will be split into small modules under `src/`; `main.ts` will only assemble
dependencies and manage lifecycle.

The minimum Node.js version will be selected from the current generated template and
ioBroker repository policy, then tested on every declared version in CI. It will not be
hard-coded merely to the development host's Node.js 22 version.

### Component boundaries

```text
ioBroker object/state APIs
          |
          v
  Semantic Discovery -----> Permission Registry
          |                         |
          v                         v
  Observation Engine -----> Context Engine
          |                         |
          +----------+--------------+
                     v
               Pattern Engine <----- HistoryProvider
                     |
                     v
               Decision Engine <---- optional LLMProvider
                     |
                     v
                Safety Engine
                     |
                     v
               Action Executor
                     |
                     v
               Feedback Engine
                     |
                     +-----> Pattern Engine
```

Planned source boundaries:

```text
src/
  discovery/       semantic classification and enum resolution
  observation/     subscriptions, normalization, bounded context snapshots
  history/         provider contract and ioBroker getHistory providers
  patterns/        candidates, statistics, confidence, lifecycle
  decision/        suggestion and execution eligibility decisions
  safety/          permissions, autonomy, ranges, cooldowns, blocks
  actions/         the only production write boundary
  feedback/        explicit and best-effort implicit feedback
  llm/             disabled/rules provider first; optional providers later
  persistence/     versioned snapshots, journal, migration, compaction
  services/        orchestration and adapter-facing ports
  types/           shared domain contracts
```

Domain engines depend on interfaces, never on a concrete ioBroker adapter instance,
InfluxDB implementation, filesystem implementation, or LLM client. ioBroker-specific
code is kept at the outer boundary.

### Observation model

An observation contains the state transition and a compact context captured at event
time:

```ts
interface Observation {
    timestamp: number;
    stateId: string;
    previousValue: unknown;
    value: unknown;
    ack?: boolean;
    source?: string;
    context: {
        hour: number;
        minute: number;
        weekday: number;
        weekend: boolean;
        room?: string;
        function?: string;
        role?: string;
        relatedStates?: Record<string, unknown>;
    };
}
```

The Observation Engine is event-based. It subscribes only to approved state IDs,
deduplicates unchanged values, keeps bounded in-memory windows, and passes compact
events downstream. Raw changes are not persisted indefinitely.

### Semantic discovery

Classification combines `common.name`, `role`, `type`, `unit`, `read`, `write`,
selected non-secret `native` hints, channel/device ancestry, and memberships in
`enum.rooms.*` and `enum.functions.*`.

Each classification includes evidence and a confidence/quality flag. Missing or
conflicting metadata produces `unknown`, never an assumed actuator. Automatic
classification does not grant `control`; the user must explicitly grant it.

### Context provider system

Context is not embedded as special-case logic in the Pattern Engine. A dedicated
Context Engine composes snapshots from independent providers:

```ts
interface ContextProvider<TContext extends object> {
    readonly id: string;
    isAvailable(): Promise<boolean>;
    getContext(request: ContextRequest): Promise<Partial<TContext>>;
}

interface ContextSnapshot {
    timestamp: number;
    time: {
        hour: number;
        minute: number;
        weekday: number;
        isWeekend: boolean;
    };
    sun?: {
        elevation?: number;
        azimuth?: number;
        phase?: 'dawn' | 'day' | 'dusk' | 'night';
        minutesSinceSunrise?: number;
        minutesUntilSunset?: number;
    };
    environment?: {
        outsideTemperature?: number;
        outsideIlluminance?: number;
        humidity?: number;
        cloudCover?: number;
        precipitation?: boolean;
        windSpeed?: number;
    };
    presence?: {
        home?: boolean;
        personsHome?: number;
    };
    states?: Record<string, unknown>;
}
```

Initial provider boundaries are:

- `TimeContextProvider`: local clock, weekday, weekend, and time buckets.
- `SunContextProvider`: sunrise, sunset, elevation, azimuth, phase, and relative
  sunrise/sunset offsets calculated locally from coordinates and timestamp.
- `EnvironmentContextProvider`: normalized semantic environment measurements.
- `WeatherContextProvider`: optional weather-adapter values behind a provider port.
- `PresenceContextProvider`: conservative aggregate presence with unknown values when
  evidence is insufficient.
- `DeviceContextProvider`: a bounded allow-list of relevant state values.

Snapshots are created at the timestamp of a relevant observation. Providers have
timeouts and independent failure handling; an unavailable optional provider produces
missing fields, not fabricated defaults and not a failed observation.

`SunContextProvider` first checks a user-approved manual latitude/longitude override,
then ioBroker's configured system coordinates. Coordinates and timestamps are passed
to a lightweight maintained local solar-position library; no cloud request is needed.
Library selection requires a maintenance, license, size, accuracy, Node/ARM, and
dependency review before Phase 3. Exact sunrise/sunset instants, solar elevation and
azimuth, minutes relative to sunrise/sunset, and dawn/day/dusk/night phases are
normalized into the snapshot.

Environment inputs use semantic mapping keys rather than adapter-specific IDs:

```text
environment.outsideTemperature
environment.outsideIlluminance
environment.humidity
environment.cloudCover
environment.precipitation
environment.windSpeed
```

Discovery ranks multiple candidates using role, localized name tokens, unit,
readability, enum room/function membership, source class, freshness, and quality. A
mapping stores all candidates, evidence, explicit priority, and the selected source.
Users can correct and pin mappings. A typical illuminance priority is physical outdoor
sensor, then weather-adapter measurement, then an explicitly labelled solar-position
fallback. Fallback estimates remain tagged with provenance and lower quality; they are
never presented as measured values.

The Pattern Engine receives a generic snapshot and feature descriptors, never provider
implementations. Context fields do not automatically become pattern conditions.
Candidate selection must demonstrate out-of-sample predictive improvement over the
simpler pattern, meet minimum support per branch, and overcome a documented complexity
penalty. Redundant or correlated features are pruned and the smallest explainable
feature set wins within a defined tolerance. This prevents irrelevant attributes such
as outside temperature from entering a light pattern merely because they were
available.

Time features include absolute clock buckets, minutes relative to sunrise/sunset, and
solar elevation thresholds. The learner may therefore prefer a seasonal rule such as
`-20..+15 minutes from sunset` or `solar elevation < -2°` when it predicts materially
better than a fixed `18:30..19:00` window.

### Permission model

Permissions are explicit per state:

```ts
interface StatePermissions {
    observe: boolean;
    learn: boolean;
    suggest: boolean;
    control: boolean;
}
```

Implications are enforced during validation: `control` cannot bypass `suggest`, and a
state excluded from observation cannot silently enter learning context. All discovered
states default to `control: false`. Sensitive classes such as locks, doors, alarms,
security systems, and access control are deny-by-default and require additional policy
support before they can ever become controllable.

### History providers

The Pattern Engine uses only this port:

```ts
interface HistoryProvider {
    readonly id: string;
    isAvailable(): Promise<boolean>;
    getHistory(stateId: string, start: number, end: number): Promise<HistoryEntry[]>;
}
```

Providers will include `NoneHistoryProvider` and a generic ioBroker message provider
that calls `sendToAsync(instance, "getHistory", ...)`. Specific InfluxDB, SQL, and
History providers normalize their result into one internal format and apply query
limits, timeouts, ordering, value validation, and cancellation. The installed
`influxdb.0` instance is the Phase 4 priority; direct Influx queries are not used by the
Pattern Engine.

Availability requires a present and alive instance whose metadata advertises the
supported history message. Per-state `common.custom` data alone is insufficient.

### Pattern model and deterministic confidence

The first learner correlates a boolean trigger transition with a boolean light action
inside a configurable time window. Candidate keys are deliberately coarse and bounded:
trigger, action, resulting value, room, weekday/weekend bucket, time bucket, and
optional brightness/presence bucket.

```ts
interface LearnedPattern {
    id: string;
    trigger: PatternTrigger;
    conditions: PatternCondition[];
    expectedAction: PatternAction;
    opportunities: number;
    matches: number;
    positiveFeedback: number;
    negativeFeedback: number;
    confidence: number;
    firstSeen: number;
    lastSeen: number;
    status: 'learning' | 'candidate' | 'approved' | 'trusted' | 'disabled';
}
```

Confidence will be a pure, unit-tested function. The initial formula will combine:

1. a smoothed match rate, so tiny samples cannot yield 100%;
2. a sample-maturity factor capped at a documented observation count;
3. a bounded feedback adjustment;
4. a decay/staleness factor.

Every component and threshold is stored with the pattern explanation. Candidate
promotion requires both a minimum opportunity count and a minimum confidence. Context
conditions are admitted only through the provider-agnostic feature-selection rules
above. No LLM output participates in this calculation.

### Decision and suggestion flow

The Decision Engine converts eligible candidates into deterministic suggestions. A
rules-only explanation includes the trigger, conditions, match count, opportunity
count, time window, and confidence components. Approval changes pattern lifecycle but
does not itself grant state control permission or raise autonomy.

### Autonomy and safety

Supported levels are:

- 0: observe only (installation default)
- 1: learn and generate suggestions
- 2: matching approved patterns create expiring action proposals; ioBroker Admin must
  approve each exact proposal once
- 3: matching approved patterns are submitted automatically to the same Safety Engine

Immediately before an action, the Safety Engine validates a frozen action request:

1. target object still exists and is a state;
2. `common.write === true`;
3. permission registry still says `control === true`;
4. autonomy level permits the action;
5. pattern status and deterministic confidence permit it;
6. target is not blocked and cooldown is clear;
7. value type, enum values, and numeric min/max are valid;
8. request has not expired and its context has not become stale.

Safety returns a typed allow/deny result with reason codes. The Action Executor accepts
only an approved result and is the sole module allowed to call `setForeignStateAsync`.
It rechecks the target identifier and records the outcome. Tests will assert that no
other production module contains a foreign-state write.

Pending actions are persisted before they can be claimed. A level-2 Admin approval and a
level-3 automatic dispatch use distinct authorization types. Any `executing` record found
after restart becomes denied with `execution_interrupted`; it is never replayed.

### Action attribution and feedback

Each Freya action receives a correlation ID and is recorded before and after the
write. ioBroker's state `from`, `ack`, timestamps, and the correlation window help
classify subsequent changes. These signals cannot reliably distinguish every user,
script, adapter, and external device action. Ambiguous events remain `unknown`; they
must not be described as certain user feedback.

An opposing change shortly after a correlated Freya action is candidate negative
feedback. Lack of an opposing change becomes neutral or weak positive evidence only
after a configurable window. Explicit user feedback always remains distinct.

### Persistence

MVP persistence uses the ioBroker instance data directory returned by
`getAbsoluteInstanceDataDir(adapter)`. `io-package.json` will declare
`common.dataFolder: "freya.%INSTANCE%"` so normal ioBroker backups include it.

The action/feedback implementation uses a bounded schema-versioned JSON snapshot:

- serialize every mutation, write a mode-0600 temporary file, flush, then atomically rename;
- validate every loaded document, migrate schema 0, and recover the previous known-good backup;
- cap retained complete action records at 1,000;
- serialize writes through one persistence queue;
- expose migrations by schema version.

This avoids native SQLite installation and cross-platform/ARM risks. A later
storage implementation may replace it behind the same repository interfaces if data
volume demonstrates the need.

### ioBroker states

Only bounded integration/status states will be exposed, for example:

```text
freya.0.info.connection
freya.0.info.status
freya.0.learning.enabled
freya.0.learning.observedStateCount
freya.0.patterns.candidateCount
freya.0.patterns.learningCount
freya.0.patterns.pendingOpportunityCount
freya.0.patterns.retainedExampleCount
freya.0.patterns.approvedCount
freya.0.history.learningStatus
freya.0.history.learningEventCount
freya.0.suggestions.latest
freya.0.actions.lastResult
freya.0.feedback.pendingCount
freya.0.ai.status
```

Internal observations and patterns remain in persistence; Freya will not create a
state object per event or pattern. Secrets are stored only in protected adapter native
configuration, never in ordinary states or logs.

### Optional LLM layer

`RulesOnlyLlmProvider` is the local default and `DisabledLlmProvider` is available.
Optional providers are loopback-only Ollama, OpenAI Responses, and an HTTPS or loopback
OpenAI-compatible endpoint. They receive a compact allow-listed disclosure containing
only aggregate evidence and semantic condition values, never state IDs, room names,
raw values, person data, prior explanations, or secrets. The exact payload and endpoint
origin are previewable before transmission.

Responses validate against a closed schema containing only `summary`, `riskLevel`, and
bounded `concerns`. Extra keys invalidate the complete response. The LLM modules import
neither the Action Executor nor its request types; advisory output cannot authorize,
target, parameterize, or execute an action. External calls occur only through an
explicit Admin command, have time and response-size bounds, are cancelled on shutdown,
and never occur merely because a provider is configured. API keys use ioBroker's
protected and encrypted native configuration and are absent from states, previews,
payloads, and logs.

### Admin UI

Freya uses JSON Config for Overview, Devices/States, environment mappings, Patterns,
Activity, feedback, and optional advisory-provider settings. The Patterns view exposes
learning progress and separates persistent pattern approval from short-lived level-2
action approval. Admin 7.8.23 on the development host supports the JSON-defined tab;
the UI remains compatible with the adapter's declared minimum Admin version.

### Resource limits

All queues, caches, context relations, analysis batches, history ranges, activity
records, and provider responses have configurable hard limits. Overload drops or
coalesces low-value observations with metrics and debug logging; it never creates an
unbounded queue. History analysis is batched and scheduled, not continuously replayed.
The startup history batch is restricted to a seven-day window, 25 explicitly
learn-enabled states, 1,000 entries per state, two concurrent reads, and 10,000 merged
changes. It feeds only the Pattern Engine before live subscriptions start. Historical
events never enter action dispatch, the first value per state is a baseline, and
persisted example timestamps make repeated startup backfills idempotent.
Direct aliases with no read/write expression may resolve to a type-compatible source
state inside `HistoryService`; the permission gate remains keyed by the selected alias.
The source ID is neither made controllable nor used by live observation/action paths.

### Testing strategy

- Pure unit tests: permissions, confidence, transitions, range/type checks, autonomy,
  LLM validation, feedback classification, and history normalization.
- Adapter tests: package files, startup/shutdown, state creation, and subscriptions via
  `@iobroker/testing`.
- Safety contract tests: deny-by-default, last-moment revalidation, no write on any
  failed check, and Action Executor as the single write boundary.
- CI: build, lint, package tests, and unit tests on supported Node.js versions.
- Production installation: read-only inspection only until controlled-action phases
  are complete; writes are tested with mocks or Freya-owned test states.

## Deliberate deviations and open decisions

- SQLite is deferred until measured data volume justifies it; portable atomic JSON is
  safer for the first publishable baseline.
- GitHub and the local ioBroker development installation are updated together after a
  milestone passes its tests. Installation is followed by metadata upload and an
  explicit instance/configuration verification before enabling the instance.
- No concrete LLM SDK is selected in the MVP skeleton, avoiding unnecessary network and
  dependency surface.
- Exact confidence thresholds remain configuration decisions for Phase 5, after the
  pure formula and representative fixtures exist.
