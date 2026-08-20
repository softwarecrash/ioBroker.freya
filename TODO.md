# SmartBrain Implementation Plan

Last updated: 2026-08-20

## Global guardrails

- [x] Verify GitHub read/write access and perform an authenticated push.
- [x] Work in a dedicated project checkout outside `/opt/iobroker`.
- [x] Keep production ioBroker inspection read-only.
- [x] Install the Phase 1 package locally and verify `smartbrain.0` at autonomy level 0.
- [ ] Never commit state IDs, room/device names, addresses, values, credentials, or raw
      ioBroker exports.
- [ ] After every completed milestone: test, push to GitHub, build a local package,
      install/upload it, then verify SmartBrain-owned states and logs.
- [ ] Keep installation default at autonomy level 0 and `control: false` for every
      discovered state.
- [ ] Test every safety rule before implementing production action execution.

## Phase 0 — analysis and architecture

- [x] Inspect Node.js, npm, architecture, js-controller, and database backends.
- [x] Inventory installed adapter metadata without reading secrets.
- [x] Aggregate object/state types, roles, enums, and writable/readable flags.
- [x] Identify active and stale history metadata.
- [x] Review local adapter structures.
- [x] Review current official adapter creator, adapter-core, JSON Config, publication,
      persistence, and history guidance.
- [x] Define module boundaries, data flow, permissions, safety, persistence, history,
      feedback, and LLM boundaries in `ARCHITECTURE.md`.
- [x] Record and resolve the repository naming mismatch before publication.
- [x] Review Phase 0 documentation and push the completed milestone.

## Phase 1 — TypeScript adapter skeleton

- [x] Generate the current official TypeScript daemon skeleton in a temporary folder.
- [x] Review generated files before merging them into this non-empty repository.
- [x] Set package metadata, supported Node versions, data folder, and JSON Config.
- [x] Add only bounded status states owned by SmartBrain.
- [x] Implement clean `ready`, `unload`, and dependency assembly lifecycle.
- [x] Default to autonomy level 0 with no foreign-state subscriptions or writes.
- [x] Add package, unit, integration, build, lint, and CI tests.
- [x] Run the integration test in isolated CI; local execution correctly refuses to
      interfere with the running production js-controller.
- [x] Update documentation and changelog; commit and push.

## Phase 2 — semantic discovery and permissions

- [x] Define semantic state, evidence, confidence-quality, and permission types.
- [x] Read objects, ancestors, rooms, functions, roles, units, and capabilities.
- [x] Implement conservative classifier with `unknown` fallback.
- [x] Define semantic environment mapping keys, candidate evidence, source quality,
      priorities, manual pinning, and fallback provenance.
- [x] Discover multiple environment candidates from role, name, unit, enums, and
      room/function assignments without hard-coded adapter state IDs.
- [x] Add deny-by-default sensitive-device classification.
- [x] Persist user corrections separately from discovered metadata.
- [x] Implement permission registry and validation invariants.
- [x] Add paginated/bounded Devices/States API and initial Admin UI.
- [x] Test with anonymized fixtures; do not copy production objects.
- [x] Update documentation and changelog; commit, push, deploy locally, and verify.

## Phase 3 — observation

- [ ] Subscribe only to explicitly observed states.
- [ ] Normalize state changes into `Observation` records.
- [ ] Define `ContextProvider`, `ContextRequest`, `ContextSnapshot`, provenance, quality,
      timeout, and partial-failure contracts.
- [ ] Implement `TimeContextProvider`.
- [ ] Evaluate a lightweight maintained local solar library for license, size, accuracy,
      Node versions, ARM/x64, and maintenance.
- [ ] Implement `SunContextProvider` with manual coordinate override, ioBroker system
      coordinate fallback, sunrise/sunset, elevation, azimuth, phases, and relative time.
- [ ] Implement `EnvironmentContextProvider`, `WeatherContextProvider`,
      `PresenceContextProvider`, and bounded `DeviceContextProvider` ports.
- [ ] Compose a context snapshot at the timestamp of each relevant observation.
- [ ] Add previous value, provider context, enum context, role, source, and bounded
      related context.
- [ ] Add deduplication, queue limits, cache limits, and debug-only raw event logging.
- [ ] Keep production behavior read-only.
- [ ] Test event ordering, deletion/null events, overload, and shutdown.
- [ ] Update documentation and changelog; commit and push.

## Phase 4 — history

- [ ] Implement `HistoryProvider` and `NoneHistoryProvider`.
- [ ] Implement generic ioBroker `getHistory` request/response normalization.
- [ ] Detect alive providers using instance capabilities.
- [ ] Prioritize `influxdb.0`; keep SQL and History adapters pluggable.
- [ ] Add timeouts, cancellation, ordering, deduplication, and hard result limits.
- [ ] Run read-only provider tests against a safe, selected production state only after
      local mocked tests pass.
- [ ] Update documentation and changelog; commit and push.

## Phase 5 — explainable light-pattern learning

- [ ] Define bounded candidate key and pattern lifecycle.
- [ ] Correlate boolean triggers with boolean light actions in a time window.
- [ ] Expose provider-agnostic candidate features for time, weekday/weekend, room,
      brightness, presence, solar elevation, and time relative to sunrise/sunset.
- [ ] Add deterministic feature selection based on held-out predictive improvement,
      minimum branch support, redundancy pruning, and a documented complexity penalty.
- [ ] Prefer the smallest explainable condition set within a defined quality tolerance;
      never attach every available context field to a pattern.
- [ ] Compare fixed clock windows with seasonal sunrise/sunset-relative windows.
- [ ] Implement pure deterministic confidence components and explanations.
- [ ] Require minimum opportunities, matches, repeatability, and recency.
- [ ] Add candidate aging, merging, limits, and pruning.
- [ ] Test positive, negative, sparse, stale, and random datasets.
- [ ] Update documentation and changelog; commit and push.

## Phase 6 — suggestions and approval

- [ ] Generate rules-only human-readable suggestions.
- [ ] Add candidate/approved/disabled lifecycle actions.
- [ ] Build Patterns and Activity views.
- [ ] Ensure approval cannot grant state control or raise autonomy.
- [ ] Add bounded activity storage and audit records.
- [ ] Test all transitions and invalid commands.
- [ ] Update documentation and changelog; commit and push.

## Phase 7 — controlled actions

- [ ] Implement typed Safety Engine decisions and reason codes.
- [ ] Validate existence, writability, permissions, autonomy, pattern status,
      confidence, cooldown, blocks, value type/range, expiry, and context freshness.
- [ ] Implement Action Executor as the only foreign-state write boundary.
- [ ] Add correlation IDs, complete audit records, and last-moment revalidation.
- [ ] Test writes only through mocks or SmartBrain-owned test states.
- [ ] Enable level 3 only for explicitly approved/trusted patterns.
- [ ] Update documentation and changelog; commit and push.

## Phase 8 — optional LLM providers

- [ ] Implement strict provider and response contracts.
- [ ] Keep Disabled/Rules Only as default.
- [ ] Add Ollama, OpenAI, then OpenAI-compatible providers as separate adapters.
- [ ] Add allow-listed compact context and data-disclosure preview.
- [ ] Store secrets only in protected native configuration; redact all logs.
- [ ] Prove malformed or adversarial LLM responses cannot reach Action Executor.
- [ ] Update documentation and changelog; commit and push.

## Phase 9 — feedback learning

- [ ] Persist complete SmartBrain action records and correlation IDs.
- [ ] Implement explicit feedback.
- [ ] Implement conservative implicit feedback with `unknown` attribution.
- [ ] Apply bounded feedback adjustment to deterministic confidence.
- [ ] Test overrides, ambiguous sources, unrelated changes, and timing windows.
- [ ] Update documentation and changelog; commit and push.

## Before public release

- [x] Rename the GitHub repository to the canonical `ioBroker.smartbrain` spelling.
- [x] Select and add the MIT license.
- [ ] Complete ioBroker repository checker and adapter-checker requirements.
- [ ] Security/privacy review and dependency audit.
- [ ] Multi-platform CI and installation tests.
- [ ] English end-user configuration and privacy documentation.
