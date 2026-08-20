# SmartBrain for ioBroker

SmartBrain is a local-first, self-learning ioBroker adapter. It observes explicitly
selected states, discovers repeatable home-automation patterns, and turns them into
explainable suggestions. Automatic actions are a later, opt-in capability protected
by explicit per-state permissions and a central safety engine.

The project is currently in **Phase 5 (read-only pattern learning)**. The TypeScript daemon
scans ioBroker object metadata, classifies supported state semantics, ranks environment
sources, synchronizes explicit state policies, and subscribes only to states with an
explicit `observe` permission. Each relevant change becomes a bounded, in-memory
observation with its event-time context snapshot. An optional bounded history provider
can read only those same states. Learning is disabled by default and, when enabled,
uses only states with an explicit `learn` permission. It never executes actions.

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

## Safety status

No foreign production state value is changed by this project. Phase 5 enforces autonomy
level 0, keeps learning and history disabled by default, and uses
deny-by-default state permissions even if unsupported persisted settings request
otherwise. Lock and alarm states cannot receive control permission. Until the
controlled-actions phase is implemented and tested, SmartBrain remains read-only by
design.

## Semantic discovery

Discovery uses `common.role`, translated names, units, value type, ancestors, native
type hints, and room/function enums. It deliberately stores no state values or raw
object exports. Ambiguous metadata remains `unknown`; user corrections and permissions
are kept separately in adapter configuration. Environment mappings support multiple
ranked candidates and manual pinning without hard-coded adapter state IDs.

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
within two minutes. Only states carrying both `observe` and `learn` permission enter
the learner. Candidate examples, pending windows, and pattern count are hard-bounded
and stale records are removed.

Context is not copied wholesale into a rule. Time, weekend, room, illuminance,
temperature, presence, solar elevation, and sunrise/sunset-relative buckets compete in
a deterministic held-out test. A condition needs minimum support and predictive
improvement; redundant clock and solar conditions cannot be combined. Each additional
condition costs 0.01 quality points, favoring the smallest useful explanation.
Candidates require at least eight selected opportunities, five matches, observations
on three different days, and confidence of 0.58; any added context condition also
requires held-out improvement. Confidence
exposes smoothed match rate, sample maturity, repeatability, feedback adjustment, and
recency. `getPatternSummary` and bounded `getPatterns` provide read-only inspection.
Pattern memory is intentionally volatile until the schema-versioned persistence phase.

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

### 0.5.1 (2026-08-20)

- Fixed repeated restarts when duplicate central policies had to be normalized.
- Made asynchronous startup terminate cleanly without closed-database errors.

Older details are available in [CHANGELOG.md](CHANGELOG.md).

## License

Copyright (c) 2026 softwarecrash

This project is licensed under the MIT License.
