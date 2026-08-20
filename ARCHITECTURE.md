# SmartBrain Architecture

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
    status: "learning" | "candidate" | "approved" | "trusted" | "disabled";
}
```

Confidence will be a pure, unit-tested function. The initial formula will combine:

1. a smoothed match rate, so tiny samples cannot yield 100%;
2. a sample-maturity factor capped at a documented observation count;
3. a bounded feedback adjustment;
4. a decay/staleness factor.

Every component and threshold is stored with the pattern explanation. Candidate
promotion requires both a minimum opportunity count and a minimum confidence. No LLM
output participates in this calculation.

### Decision and suggestion flow

The Decision Engine converts eligible candidates into deterministic suggestions. A
rules-only explanation includes the trigger, conditions, match count, opportunity
count, time window, and confidence components. Approval changes pattern lifecycle but
does not itself grant state control permission or raise autonomy.

### Autonomy and safety

Supported levels are:

- 0: observe only (installation default)
- 1: learn and generate suggestions
- 2: explicit approval required for each proposed action
- 3: execute only explicitly approved/trusted patterns

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

### Action attribution and feedback

Each SmartBrain action receives a correlation ID and is recorded before and after the
write. ioBroker's state `from`, `ack`, timestamps, and the correlation window help
classify subsequent changes. These signals cannot reliably distinguish every user,
script, adapter, and external device action. Ambiguous events remain `unknown`; they
must not be described as certain user feedback.

An opposing change shortly after a correlated SmartBrain action is candidate negative
feedback. Lack of an opposing change becomes neutral or weak positive evidence only
after a configurable window. Explicit user feedback always remains distinct.

### Persistence

MVP persistence uses the ioBroker instance data directory returned by
`getAbsoluteInstanceDataDir(adapter)`. `io-package.json` will declare
`common.dataFolder: "smartbrain.%INSTANCE%"` so normal ioBroker backups include it.

The first implementation uses schema-versioned JSON snapshots plus a bounded JSONL
activity journal:

- write a temporary file, flush, then atomically rename;
- validate every loaded document and keep a previous known-good snapshot;
- cap and compact journals;
- serialize writes through one persistence queue;
- expose migrations by schema version.

This avoids native SQLite installation and cross-platform/ARM risks in the MVP. A later
storage implementation may replace it behind the same repository interfaces if data
volume demonstrates the need.

### ioBroker states

Only bounded integration/status states will be exposed, for example:

```text
smartbrain.0.info.connection
smartbrain.0.info.status
smartbrain.0.learning.enabled
smartbrain.0.learning.observedStateCount
smartbrain.0.patterns.candidateCount
smartbrain.0.patterns.approvedCount
smartbrain.0.suggestions.latest
smartbrain.0.actions.lastResult
smartbrain.0.feedback.pendingCount
smartbrain.0.ai.status
```

Internal observations and patterns remain in persistence; SmartBrain will not create a
state object per event or pattern. Secrets are stored only in protected adapter native
configuration, never in ordinary states or logs.

### Optional LLM layer

`DisabledRulesProvider` is the default. Later providers receive compact, allow-listed,
structured context. Responses must validate against a strict schema and may reference
only supplied pattern and action IDs. LLM output is advisory and always precedes the
Decision and Safety Engines. No cloud request occurs without explicit configuration.

### Admin UI

Phase 1 uses JSON Config for safe bootstrap settings. Overview, Devices/States,
Patterns, Activity, and AI views will be added incrementally. Admin 7.8.23 on the
development host can support a JSON-defined adapter tab, but UI architecture must
remain compatible with the adapter's declared minimum Admin version.

### Resource limits

All queues, caches, context relations, analysis batches, history ranges, activity
records, and provider responses have configurable hard limits. Overload drops or
coalesces low-value observations with metrics and debug logging; it never creates an
unbounded queue. History analysis is batched and scheduled, not continuously replayed.

### Testing strategy

- Pure unit tests: permissions, confidence, transitions, range/type checks, autonomy,
  LLM validation, feedback classification, and history normalization.
- Adapter tests: package files, startup/shutdown, state creation, and subscriptions via
  `@iobroker/testing`.
- Safety contract tests: deny-by-default, last-moment revalidation, no write on any
  failed check, and Action Executor as the single write boundary.
- CI: build, lint, package tests, and unit tests on supported Node.js versions.
- Production installation: read-only inspection only until controlled-action phases
  are complete; writes are tested with mocks or SmartBrain-owned test states.

## Deliberate deviations and open decisions

- SQLite is deferred until measured data volume justifies it; portable atomic JSON is
  safer for the first publishable baseline.
- The active GitHub repository is misspelled `ioBorker.smartbrain`. ioBroker publication
  convention expects `ioBroker.smartbrain`; owner approval is required to rename it.
- No concrete LLM SDK is selected in the MVP skeleton, avoiding unnecessary network and
  dependency surface.
- Exact confidence thresholds remain configuration decisions for Phase 5, after the
  pure formula and representative fixtures exist.

