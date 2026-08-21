# SmartBrain for ioBroker

SmartBrain is a local-first, self-learning ioBroker adapter. It observes explicitly
selected states, discovers repeatable home-automation patterns, and turns them into
explainable suggestions. Automatic actions are a later, opt-in capability protected
by explicit per-state permissions and a central safety engine.

The project has completed the planned implementation phases and is undergoing
**pre-release hardening**. The TypeScript daemon
scans ioBroker object metadata, classifies supported state semantics, ranks environment
sources, synchronizes explicit state policies, and subscribes only to states with an
explicit `observe` permission. Each relevant change becomes a bounded, in-memory
observation with its event-time context snapshot. An optional bounded history provider
can read only those same states. Learning is disabled by default and, when enabled,
uses only states with an explicit `learn` permission. `suggest` applies only to the
proposed action target; learned trigger and context states do not need it. Optional
execution is disabled by default and passes through a deny-by-default safety boundary.

## Design goals

- Core learning works without an LLM, cloud service, GPU, Python, or external database.
- Installation defaults to autonomy level 0 (observe only).
- Existing ioBroker objects and states are treated as read-only during development.
- Every learned confidence value is deterministic and traceable to observations.
- An optional LLM may explain or evaluate a proposal, but can never authorize or
  execute an action.
- The adapter remains useful on resource-constrained ioBroker hosts.

## First end-to-end target

The MVP learns simple light behavior:

```text
boolean trigger (presence/motion/event)
  + room, time, weekday, optional brightness/presence context
  -> boolean light action within a bounded time window
  -> explainable suggestion
  -> explicit approval
  -> safety validation
  -> optional action
  -> feedback
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and [TODO.md](TODO.md) for the
implementation plan.

## Installation and initial configuration

SmartBrain requires Node.js 22 or newer and a current ioBroker controller/Admin. A new
instance starts disabled for automation: autonomy level 0, learning off, history off,
Rules Only LLM, and no state permissions.

1. Open **Devices / States** in the instance configuration, add a state, and grant only
   the permissions needed. The same policy is available from the object's gear menu
   under custom settings; both views synchronize through the instance configuration.
2. Correct the semantic type or room assignment only when discovery is ambiguous.
3. Optionally choose an installed History, SQL, or InfluxDB instance and configure
   semantic environment source priorities.
4. Enable learning after reviewing the observed-state list. A proposed action still
   requires Suggest permission on its target state and explicit approval.
5. Keep autonomy at 0 while validating learned patterns. Controlled execution is an
   advanced, explicit level-3 opt-in and additionally requires Control permission.

Latitude and longitude come from the ioBroker system configuration unless both manual
overrides are provided. Sunrise, sunset, solar elevation, and solar azimuth are computed
locally; no weather or cloud service is required for solar context.

## Safety status

Installation remains at autonomy level 0, with learning and history disabled and all
state permissions denied by default. A controlled action is possible only at level 3,
through an explicit ioBroker Admin request, for a currently eligible and approved
pattern whose target has the complete permission chain including `control`. Immediately
before the only foreign-state write boundary, SmartBrain re-reads the object and context
and validates confidence, conditions, target type/writability/value constraints,
deny-list, cooldown, request expiry, and context freshness. Lock and alarm states cannot
receive control permission. Tests exercise only mocks; local deployment stays at level 0.

## Semantic discovery

Discovery uses `common.role`, translated names, units, value type, ancestors, native
type hints, and room/function enums. It deliberately stores no state values or raw
object exports. Ambiguous metadata remains `unknown`; user corrections and permissions
are kept separately in adapter configuration. Environment mappings support multiple
ranked candidates and manual pinning without hard-coded adapter state IDs.

Room and function enums assigned to a parent folder or device are inherited by nested
states. This includes deeply structured alias paths such as
`alias.0.Kitchen.light.ceiling.power` when `alias.0.Kitchen` is assigned to a room.
Configured states also expose a read-only room diagnostic in Admin. A state can be
marked `Automatic`, `Room related`, or `Global`; only unresolved or explicitly
room-related learning states warn when no room is available. Global states remain valid
whole-home/context inputs and are excluded from same-room action correlations.

The adapter message API provides `getDiscoverySummary` and `getDiscoveredStates`.
State pages are capped at 100 entries and support a text query.

## Read-only observations

Only states enabled through the central policy table or the synchronized custom object
settings are subscribed. Unchanged events are deduplicated and normalized in order;
the queue and retained observation cache are both bounded. Context reads are restricted
to the same allow-list. Observation status is available under `smartbrain.0.observation`,
and bounded pages are available through `getObservationSummary` and `getObservations`.
The cache is intentionally volatile in this phase.

## Read-only history

History is disabled by default. When `Automatic` is explicitly selected, SmartBrain
detects enabled and alive ioBroker instances that advertise the standard `getHistory`
message and prefers InfluxDB, then SQL, then History. Per-state custom history metadata
alone is not considered proof that a provider is available.

The configuration retrieves its choices dynamically from the running SmartBrain
instance. Alongside `Disabled` and `Automatic`, every installed adapter instance with
the capability is listed directly; unavailable instances carry an `offline` marker.

Queries are restricted to explicitly observed states, seven days, 1,000 results, two
concurrent requests, and a five-second provider timeout. Provider responses are treated
as untrusted input: values are validated and bounded, duplicates removed, and results
sorted before use. `getHistoryStatus` and `getStateHistory` expose the bounded API.

## Explainable pattern learning

When learning is explicitly enabled, SmartBrain correlates rising boolean motion,
presence, contact, or switch events with a boolean light turning on in the same room
within two minutes. For presence states it also learns absence-to-light-off independently.
An arrival without a light change remains negative evidence, never an inferred off action.
Only states carrying both `observe` and `learn` permission enter the learner. Candidate
examples, pending windows, and pattern count are hard-bounded and stale records are removed.

Context is not copied wholesale into a rule. Time, weekend, room, semantic same-room
illuminance, outside illuminance, temperature, presence, solar elevation, and
sunrise/sunset-relative buckets compete in
a deterministic held-out test. A condition needs minimum support and predictive
improvement; redundant clock and solar conditions cannot be combined. Each additional
condition costs 0.01 quality points, favoring the smallest useful explanation.
Candidates require at least eight selected opportunities, five matches, observations
on three different days, and confidence of 0.58; any added context condition also
requires held-out improvement. Confidence
exposes smoothed match rate, sample maturity, repeatability, feedback adjustment, and
recency. `getPatternSummary` and bounded `getPatterns` provide read-only inspection.
Pattern memory is intentionally volatile until the schema-versioned persistence phase.

## Suggestions, approval, and activity

Eligible candidates become deterministic suggestions containing the trigger, target,
conditions, two-minute action window, match/opportunity counts, confidence, and every
confidence component. Candidate creation, withdrawal, accepted status changes, and
rejected commands enter a newest-first audit store capped at 500 records.

`Learn` authorizes a state to contribute observations, triggers, or context to pattern
learning. `Suggest` is deliberately target-only: a presence or illuminance sensor can
influence a light rule with Learn enabled even when Suggest is disabled on the sensor.

`getSuggestionSummary`, paginated `getSuggestions`, and paginated `getActivity` expose
read-only views. `setPatternStatus` supports `candidate`, `approved`, and `disabled`
transitions, but accepts mutations only from an ioBroker Admin adapter instance. An
approval changes no state permission, does not raise autonomy, and cannot execute a
device action. Approved or disabled entries whose evidence disappears remain visible
but are marked ineligible. Suggestion and activity storage is currently volatile.

## Controlled actions

`executePattern` accepts only a 16-character pattern ID from an ioBroker Admin adapter
instance. It does not accept a target, value, permission, confidence, or approval flag
from the caller: these values are resolved from trusted runtime state. The executor
revalidates all mutable inputs immediately before writing and fails closed when context
or object lookup is unavailable. `getActionAudit` exposes the bounded newest-first audit;
summary states are available below `smartbrain.0.actions`. Cooldowns remain volatile;
complete action and feedback records are persisted locally while the operational audit
view stays bounded in memory.

## Optional LLM advisory

`Rules Only` is the local, network-free default; `Disabled` is also available. Ollama
is restricted to the loopback interface. OpenAI uses the Responses endpoint with
`store: false` and a strict JSON schema; an OpenAI-compatible provider uses HTTPS (or
loopback HTTP) and the corresponding structured response format. Model names are
always explicit and SmartBrain does not silently substitute one. See the official
[OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)
and [Ollama structured output documentation](https://docs.ollama.com/capabilities/structured-outputs).

External calls happen only through the Admin-only `analyzePattern` command. Beforehand,
`previewLlmDisclosure` shows the exact allow-listed payload and destination origin.
The payload contains aggregate evidence and selected semantic context features, but no
state IDs, room names, raw values, person data, or API key. Keys are declared both
protected and encrypted native configuration. Responses are size/time bounded and
must contain exactly a short summary, risk level, and bounded concerns. Extra fields,
including targets, values, approval, or execution instructions, invalidate the entire
response. The LLM layer has no dependency on or route into the Action Executor.

## Persistent action feedback

Before the single foreign-state write boundary may run, SmartBrain atomically persists
a schema-versioned `requested` action record in its ioBroker instance data directory.
If this fails, execution fails closed. Completion, correlation ID, pattern, target,
expected value, safety reasons, error code, and feedback are retained in a bounded
1,000-record file with a flushed temporary file, atomic rename, previous-file backup,
schema-0 migration, and strict validation on load. `getActionRecords` is paginated and
Admin-only; `getFeedbackSummary` exposes aggregate counters.

`submitFeedback` accepts explicit positive, negative, or neutral feedback only from an
ioBroker Admin instance. Explicit feedback supersedes an earlier implicit result.
Implicit attribution considers only the newest executed SmartBrain action for the same
target inside the configured window. An opposite Admin change is conservatively
negative, an opposite change from another source remains `unknown`, unrelated or equal
changes are ignored, and expiry without an opposite change becomes neutral. Only
positive and negative outcomes affect confidence, using the existing deterministic
±0.15 cap; neutral and unknown outcomes have zero confidence effect.

## Development

```bash
npm install
npm run check
npm test
npm run lint
npm run build
```

The integration test requires an isolated host without another running js-controller.
It is intended for CI and must not be run by stopping a production ioBroker instance.

Security reports and the data-handling details are documented in
[SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Development references

The project follows the current official ioBroker guidance:

- [ioBroker adapter creator](https://github.com/ioBroker/create-adapter)
- [ioBroker example adapters](https://github.com/ioBroker/ioBroker.example)
- [ioBroker adapter core](https://github.com/ioBroker/adapter-core)
- [ioBroker JSON Config](https://github.com/ioBroker/json-config)
- [ioBroker adapter publication requirements](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterpublish.md)

## Local development deployment

Milestones are built and tested in this checkout, pushed to GitHub, and then installed
into the existing ioBroker host from the local project path. A disabled instance is
created when needed and is enabled only after its effective configuration has been
verified as autonomy level 0. Admin assets are uploaded after changes so they are
visible in the local Admin UI.

## Changelog

### 0.10.0 (2026-08-21)

- Added independent presence-on/light-on and presence-off/light-off learning.
- Added semantic same-room illuminance as an explainable feature selected only when it
  improves held-out predictive quality.

Older release history is available in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## License

Copyright (c) 2026 softwarecrash

This project is licensed under the MIT License.
