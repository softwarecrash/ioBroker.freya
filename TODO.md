# Freya Implementation Plan

Last updated: 2026-08-21

## Global guardrails

- [x] Verify GitHub read/write access and perform an authenticated push.
- [x] Work in a dedicated project checkout outside `/opt/iobroker`.
- [x] Keep production ioBroker inspection read-only.
- [x] Install the Phase 1 package locally and verify `freya.0` at autonomy level 0.
- [x] Never commit state IDs, room/device names, addresses, values, credentials, or raw
      ioBroker exports.
- [ ] After every completed milestone: test, push to GitHub, build a local package,
      install/upload it, then verify Freya-owned states and logs.
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
- [x] Add only bounded status states owned by Freya.
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

- [x] Subscribe only to explicitly observed states.
- [x] Normalize state changes into `Observation` records.
- [x] Define `ContextProvider`, `ContextRequest`, `ContextSnapshot`, provenance, quality,
      timeout, and partial-failure contracts.
- [x] Implement `TimeContextProvider`.
- [x] Evaluate a lightweight maintained local solar library for license, size, accuracy,
      Node versions, ARM/x64, and maintenance.
- [x] Implement `SunContextProvider` with manual coordinate override, ioBroker system
      coordinate fallback, sunrise/sunset, elevation, azimuth, phases, and relative time.
- [x] Implement `EnvironmentContextProvider`, `WeatherContextProvider`,
      `PresenceContextProvider`, and bounded `DeviceContextProvider` ports.
- [x] Compose a context snapshot at the timestamp of each relevant observation.
- [x] Add previous value, provider context, enum context, role, source, and bounded
      related context.
- [x] Add deduplication, queue limits, cache limits, and metadata-only debug logging.
- [x] Keep production behavior read-only.
- [x] Test event ordering, deletion/null events, overload, and shutdown.
- [x] Update documentation and changelog; commit and push.

## Phase 4 — history

- [x] Implement `HistoryProvider` and `NoneHistoryProvider`.
- [x] Implement generic ioBroker `getHistory` request/response normalization.
- [x] Detect alive providers using instance capabilities.
- [x] Prioritize `influxdb.0`; keep SQL and History adapters pluggable.
- [x] Add timeouts, cancellation, ordering, deduplication, and hard result limits.
- [x] Replay a bounded seven-day historical window into the Pattern Engine at startup,
      without dispatching actions or duplicating persisted examples.
- [x] Run read-only provider tests against a safe, selected production state only after
      local mocked tests pass.
- [x] Update documentation and changelog; commit and push.

## Phase 5 — explainable light-pattern learning

- [x] Define bounded candidate key and pattern lifecycle.
- [x] Correlate boolean triggers with boolean light actions in a time window.
- [x] Expose provider-agnostic candidate features for time, weekday/weekend, room,
      brightness, presence, solar elevation, and time relative to sunrise/sunset.
- [x] Add deterministic feature selection based on held-out predictive improvement,
      minimum branch support, redundancy pruning, and a documented complexity penalty.
- [x] Prefer the smallest explainable condition set within a defined quality tolerance;
      never attach every available context field to a pattern.
- [x] Compare fixed clock windows with seasonal sunrise/sunset-relative windows.
- [x] Implement pure deterministic confidence components and explanations.
- [x] Require minimum opportunities, matches, repeatability, and recency.
- [x] Add candidate aging, merging, limits, and pruning.
- [x] Test positive, negative, sparse, stale, and random datasets.
- [x] Update documentation and changelog; commit and push.

## Phase 6 — suggestions and approval

- [x] Generate rules-only human-readable suggestions.
- [x] Add candidate/approved/disabled lifecycle actions.
- [x] Build an actionable Patterns view with inspect, approve, disable, one-shot
      approval, and execution results.
- [x] Ensure approval cannot grant state control or raise autonomy.
- [x] Add bounded activity storage and audit records.
- [x] Test all transitions and invalid commands.
- [x] Update documentation and changelog; commit and push.

## Phase 7 — controlled actions

- [x] Implement typed Safety Engine decisions and reason codes.
- [x] Validate existence, writability, permissions, autonomy, pattern status,
      confidence, cooldown, blocks, value type/range, expiry, and context freshness.
- [x] Implement Action Executor as the only foreign-state write boundary.
- [x] Add correlation IDs, complete audit records, and last-moment revalidation.
- [x] Test writes only through mocks or Freya-owned test states.
- [x] Reject automatic writes below level 3; allow level 2 only for an exactly-once
      Admin-approved proposal and require explicitly approved patterns.
- [x] Implement level 2 pending-action creation, expiry, one-shot approval, rejection,
      and exactly-once execution.
- [x] Connect eligible approved patterns to live trigger observations at level 3 through
      the same persisted claim and Safety Engine boundary.
- [x] Add restart-safe persistence for learned examples, suggestions, approvals,
      pending actions, and execution deduplication.
- [ ] Run an end-to-end production test with the explicitly configured kitchen
      presence, illuminance, and light aliases before marking controlled actions done.
- [x] Update documentation and changelog; commit and push.

## Phase 8 — optional LLM providers

- [x] Implement strict provider and response contracts.
- [x] Keep Disabled/Rules Only as default.
- [x] Add Ollama, OpenAI, then OpenAI-compatible providers as separate adapters.
- [x] Add allow-listed compact context and data-disclosure preview.
- [x] Store secrets only in protected native configuration; redact all logs.
- [x] Prove malformed or adversarial LLM responses cannot reach Action Executor.
- [x] Update documentation and changelog; commit and push.

## Phase 9 — feedback learning

- [x] Persist complete Freya action records and correlation IDs.
- [x] Implement explicit feedback.
- [x] Implement conservative implicit feedback with `unknown` attribution.
- [x] Apply bounded feedback adjustment to deterministic confidence.
- [x] Test overrides, ambiguous sources, unrelated changes, and timing windows.
- [x] Update documentation and changelog; commit and push.

## Phase 10 — end-to-end product completion

- [x] Make autonomy levels behaviorally distinct and document their interaction with
      Learn, Suggest, Control, and pattern approval.
- [x] Persist and restore learning state without restoring expired trigger windows.
- [x] Expose actionable pattern and pending-action tables in JSON Config.
- [x] Show pre-candidate learning progress, evidence days, open trigger windows, and
      retained examples in Admin and bounded runtime states.
- [x] Publish bounded diagnostics for pending actions, automatic executions, denied
      executions, and persistence health.
- [ ] Verify restart recovery, duplicate suppression, cooldown behavior, feedback
      attribution, and source attribution in the running local installation.
- [ ] Re-run the complete local quality gate, package, install, inspect logs, and push.

## Before public release

- [x] Rename the GitHub repository to the canonical `ioBroker.freya` spelling.
- [x] Select and add the MIT license.
- [ ] Complete ioBroker repository checker and adapter-checker requirements.
- [x] Security/privacy review and production dependency audit.
- [ ] Multi-platform CI and installation tests.
- [x] English end-user configuration and privacy documentation.
