# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to use [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- History access is message-based and read-only; SmartBrain does not connect directly
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
- Per-object SmartBrain custom settings synchronized with the central state-policy
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

- Discovery reads object metadata only and excludes SmartBrain-owned states; it does
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
- Canonical `ioBroker.smartbrain` repository metadata and a paired GitHub/local
  development deployment workflow.

### Security

- Established deny-by-default control permissions and autonomy level 0 as foundational
  invariants.
- Prohibited production state writes and publication of home-specific metadata during
  the analysis phase.
- Phase 1 runtime forcibly keeps autonomy at level 0, learning disabled, and history
  disconnected; it has no foreign-state subscription or write path.
