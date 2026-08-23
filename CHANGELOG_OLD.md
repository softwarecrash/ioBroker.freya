# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The Admin pattern table now shows relationships while they are still learning, with
  confidence, matches/opportunities, distinct learning days, and explanations instead
  of remaining empty until a suggestion becomes eligible.
- Bounded runtime counters expose learning relationships, open trigger windows, and
  retained learning examples for direct local observation.
- A bounded, read-only seven-day history backfill now feeds explicitly learn-enabled
  states into the same Pattern Engine before live observation starts. It excludes
  foreign commands and confirmations, never dispatches actions, and deduplicates
  persisted examples across restarts.
- Direct, transformation-free aliases can use the history of a type-compatible source
  state while permissions, live observations, suggestions, and actions remain keyed to
  the user-selected alias.

### Fixed

- Corrected JSON Config table, responsive layout, and button-color schema violations
  reported by the local ioBroker repository checker.
- Synchronized newly introduced Admin translation keys across every declared locale;
  reviewed German text remains localized and untranslated values safely fall back to
  English.
- Context providers now honor Learn permission as well as Observe permission before a
  state value can influence pattern conditions.
- Historical `0`/`1` and exact `true`/`false` representations are normalized only for
  metadata-declared Boolean states before replay, matching live ioBroker Boolean values.

### Security

- Re-audited the release dependency tree and package contents: production dependencies
  report no known vulnerabilities, no secret-like files are packaged, and the only
  foreign-state write remains inside the Action Executor boundary. Remaining audit
  findings are confined to upstream development/test tooling and are not shipped.

## [0.10.0] - 2026-08-21

### Added

- Behaviorally distinct autonomy paths: level 2 creates expiring, persistent one-shot
  proposals for Admin approval, while level 3 dispatches matching approved live triggers
  automatically through the same Safety Engine and exactly-once claim.
- Pending-action Admin table, approve/reject controls, bounded action counters, restart
  interruption handling, and last-moment target-value deduplication.
- Shared trigger-condition matching that re-evaluates same-room illuminance during both
  live dispatch and final action validation.
- An actionable local Admin pattern view with bounded pattern rows, target/trigger,
  confidence and evidence details, explicit approve/disable controls, and confirmed
  one-shot execution through the existing safety boundary.
- Schema-versioned, atomically replaced persistence for bounded learning evidence,
  suggestions, and explicit approval/disabled states, with validated backup recovery.
- Independent presence-on/light-on and presence-off/light-off learning, including safe
  propagation of boolean off actions into suggestions.
- Semantic same-room illuminance bands as explainable candidate features without
  hardcoded state IDs.
- Room diagnostics integrated into the Admin state-policy table with resolved room names,
  warning symbols, and an explicit Automatic/Room/Global scope synchronized with
  per-object custom settings.
- Generic command/device-confirmation attribution that excludes Freya and foreign
  command effects from behavioral learning, recognizes probable device-local reversals,
  and accepts short-lived per-event user/automation intent from local bridges.

### Changed

- Corrected the implementation plan so summary-only pattern UI, one-shot approval,
  automatic level-3 dispatch, and end-to-end production verification remain open.
- Replaced the free-form autonomy-level number input with a descriptive four-level
  dropdown while preserving the numeric configuration values.
- Renamed the project, npm package, adapter namespace, data folder, Admin assets, and
  documentation from SmartBrain/`smartbrain` to Freya/`freya` before the first public
  release.
- Arrival events without a light transition remain negative evidence and cannot be
  misinterpreted as an instruction to switch a light off.
- Suggest permission now applies only to the proposed action target; learned trigger
  and context states no longer need Suggest permission to contribute to a suggestion.

### Fixed

- Room and function assignments on parent folders now propagate reliably to deeply
  nested alias states by loading state metadata, ancestors, and enums explicitly.

## [0.9.1] - 2026-08-20

### Added

- Weblate-compatible JSON Config translations for all eleven supported ioBroker
  languages, while retaining reviewed German texts.
- English installation guidance, a security reporting policy, detailed local/external
  data-handling documentation, and an npm-package content smoke test.
- A dedicated CI package-smoke job in addition to the Node 22/24/26 Linux, Windows, and
  macOS adapter-test matrix.

### Changed

- Dependabot checks now run weekly at staggered times with a larger queue. Verified
  testing-action-check v2 and fetch-metadata v3 upgrades are integrated.
- The package smoke job uses the current Node 24-based checkout and setup-node actions.
- Dependabot auto-merge eligibility now covers npm and GitHub Actions patch/minor
  updates; major updates remain manual and TypeScript 7 is intentionally rejected after
  its CI failure.
- Repository metadata links follow the actual default branch and release news retention
  is bounded to seven versions.

### Security

- The production dependency audit is clean. Release-package validation rejects source,
  test, workflow, and common secret-file names.
- External LLM disclosure, local persistence, deletion, permissions, and the single
  controlled foreign-state write boundary are documented for end users and reporters.

## [0.9.0] - 2026-08-20

### Added

- Bounded schema-versioned local action repository containing request/completion data,
  correlation IDs, results, safety reasons, and feedback, with serialized writes,
  flushed temporary files, atomic replacement, backup recovery, and schema-0 migration.
- Admin-only explicit positive/negative/neutral feedback, paginated Admin-only action
  records, aggregate feedback APIs/states, and a configurable attribution window.
- Conservative implicit attribution for same-target opposing changes, including
  explicit `unknown` outcomes for ambiguous sources and neutral expiry.
- Persisted positive/negative totals feed the existing deterministic confidence
  component with its ±0.15 bound; neutral and unknown feedback have no effect.

### Security

- Action execution now fails closed before inspection or writing when the durable
  request record cannot be stored. Invalid persisted schemas are never trusted.
- Explicit feedback is accepted only from ioBroker Admin. Implicit feedback never calls
  an ambiguous source a user and never correlates unrelated target changes.

## [0.8.0] - 2026-08-20

### Added

- Strict advisory provider and response contracts with local Rules Only and Disabled
  modes, loopback-only Ollama, OpenAI Responses, and HTTPS/loopback
  OpenAI-compatible providers.
- Exact allow-listed disclosure previews, bounded transport response/timeout handling,
  shutdown cancellation, and Admin-only on-demand analysis.
- Protected and encrypted native API-key configuration plus effective provider,
  external-disclosure, and last-result states.

### Security

- LLM payloads exclude state IDs, names, room names, raw values, person data, prior
  explanations, and secrets. External providers are never called automatically.
- Responses accept exactly summary, risk level, and bounded concerns. Any executable,
  approval, target, or value field invalidates the whole response, and the LLM module
  has no dependency on the Action Executor.

## [0.7.0] - 2026-08-20

### Added

- Pure, typed Safety Engine with stable deny reason codes for autonomy, approval,
  eligibility, confidence, current conditions, permissions, object metadata, value
  constraints, deny-list, cooldown, expiry, and context freshness.
- A single production foreign-state write boundary, per-target cooldowns, correlation
  IDs, bounded action auditing, and Admin-only `executePattern`/`getActionAudit` APIs.
- Action confidence, cooldown, explicit blocked-target settings, and adapter-owned
  action status counters.

### Security

- Installation remains at autonomy 0. Execution requires level 3 plus an eligible,
  approved pattern and explicit effective Control permission.
- Target, value, approval, confidence, permissions, object metadata, and current pattern
  conditions are not trusted from the caller and are revalidated immediately before a
  write. Missing runtime context fails closed.
- Action tests write only through mocks; no production device states are used.

## [0.6.0] - 2026-08-20

### Added

- Rules-only suggestions containing trigger/action references, conditions, evidence,
  action window, aggregate confidence, and individual confidence components.
- Candidate, approved, and disabled lifecycle transitions with deterministic validation.
- Bounded suggestion paging, newest-first activity auditing, summary states, and
  Patterns/Activity configuration views.
- Read-only message APIs for suggestion summaries, suggestion pages, and activity pages.

### Security

- Suggestions require explicit `suggest` permission on both participating states.
- Lifecycle mutations are accepted only from an ioBroker Admin instance; approval
  cannot alter state permissions, raise autonomy above 0, or execute an action.

## [0.5.1] - 2026-08-20

### Fixed

- Replace the complete central policy array instead of deep-merging it, allowing
  duplicate policy cleanup to converge without a controller restart loop.
- Abort asynchronous startup and adapter-owned status writes cleanly when ioBroker
  requests termination, preventing closed-database promise rejections.

## [0.5.0] - 2026-08-20

### Added

- Bounded boolean trigger-to-light learning for explicitly permitted states sharing a
  room, with a two-minute action window and no device writes.
- Provider-neutral context features for time, weekend, room, illuminance, temperature,
  presence, solar elevation, and sunrise/sunset-relative offsets.
- Deterministic held-out feature selection with minimum branch support, solar/clock
  redundancy pruning, and a 0.01 complexity penalty per condition.
- Traceable confidence components, minimum sample/match/repeatability thresholds,
  bounded candidate/example storage, stale-record pruning, and read-only pattern APIs.
- Tests covering predictive, irrelevant, seasonal, sparse, random, disabled,
  cross-room, and stale learning cases.

### Security

- Learning remains disabled by default, requires explicit `observe` and `learn`
  permissions, stays in memory, and cannot perform foreign-state writes.

## [0.4.1] - 2026-08-20

### Added

- Dynamic History provider selection listing installed `getHistory`-capable instances.
- Online providers are directly selectable; installed disabled or offline instances
  remain visible with an `offline` marker.

## [0.4.0] - 2026-08-20

### Added

- Provider-neutral `HistoryProvider` contract and safe `NoneHistoryProvider` default.
- Generic ioBroker `getHistory` transport with live enabled/capability/alive detection.
- Automatic provider selection prioritizing InfluxDB, SQL, then History while keeping
  explicit instance IDs pluggable.
- Bounded history status/query APIs and adapter-owned provider/query status states.
- Response validation, deterministic ordering, deduplication, cancellation, timeouts,
  concurrency limits, range limits, and hard result limits.

### Security

- History remains disabled by default and can read only states carrying an explicit
  `observe` permission.
- History access is message-based and read-only; Freya does not connect directly
  to provider databases or write foreign states.

## [0.3.0] - 2026-08-20

### Added

- Permission-gated foreign-state subscriptions and normalized, ordered observations.
- Event-time snapshots from time, sun, environment, weather, presence, and bounded
  related-device context providers.
- Observation paging/summary message APIs and adapter-owned subscription, retention,
  drop, and last-timestamp status states.
- Tests for event ordering and previous values, null versus deletion, queue overload,
  retention, shutdown, allow-listed reads, and bounded string values.

### Security

- Observation and context reads are restricted to states with an explicit `observe`
  permission; the default empty policy set creates no foreign-state subscriptions.
- Queues, caches, related states, metadata, source strings, and string values are
  bounded, while foreign writes, history access, learning, and actions remain disabled.

## [0.2.0] - 2026-08-20

### Added

- Provider-neutral context snapshots with provenance, confidence, timeouts, and
  independent optional-provider failures.
- Time, Sun, Environment, Weather, Presence, and bounded Device context providers.
- Local sunrise, sunset, elevation, azimuth, phase, and relative-time calculation using
  ioBroker system coordinates or an optional manual override.
- Per-object Freya custom settings synchronized with the central state-policy
  table using last-edit timestamps.
- A pinned local ioBroker repository-checker release gate and guarded npm-only
  Dependabot patch/minor auto-merge workflow.

### Security

- Existing Dependabot major-update pull requests remain manual; GitHub Actions updates
  and all major dependency changes are excluded from automatic merging.
- State-value providers are bounded and not activated until observation permissions
  are wired; the running adapter remains free of foreign-state reads and writes.

## [0.1.0] - 2026-08-20

### Added

- Bounded, metadata-only discovery of ioBroker states, ancestors, roles, units, rooms,
  functions, capabilities, and selected non-secret native type hints.
- Conservative semantic classification with confidence evidence and an `unknown`
  fallback.
- Ranked semantic environment mappings with multiple candidates, manual priorities,
  and pinning without adapter-specific IDs.
- Paginated discovery message API, aggregate discovery states, and JSON Config views.
- Deny-by-default per-state permissions with dependency validation and hard control
  denial for locks, alarms, unknown semantics, and non-writable states.
- Unit tests for classification, mappings, object normalization, discovery paging,
  permissions, and status publication.

### Security

- Discovery reads object metadata only and excludes Freya-owned states; it does
  not read foreign values, subscribe to changes, access history, or execute actions.

## [0.0.1] - 2026-08-20

### Added

- Initial repository bootstrap and authenticated GitHub workflow.
- Read-only environment analysis with anonymized aggregate findings.
- Architecture for discovery, observation, history, patterns, decisions, safety,
  actions, feedback, persistence, and optional LLM providers.
- Provider-based context architecture for time, sun, environment, weather, presence,
  and bounded device state snapshots.
- Explainable context feature selection with complexity control and seasonal
  sunrise/sunset-relative pattern support.
- Iterative MVP implementation plan and production-safety guardrails.
- TypeScript daemon skeleton generated from `@iobroker/create-adapter` 3.1.5 conventions.
- JSON Config settings, adapter-owned status states, modular lifecycle service, tests,
  lint/build configuration, and multi-platform GitHub Actions workflow.
- Canonical `ioBroker.freya` repository metadata and a paired GitHub/local
  development deployment workflow.

### Security

- Established deny-by-default control permissions and autonomy level 0 as foundational
  invariants.
- Prohibited production state writes and publication of home-specific metadata during
  the analysis phase.
- Phase 1 runtime forcibly keeps autonomy at level 0, learning disabled, and history
  disconnected; it has no foreign-state subscription or write path.
