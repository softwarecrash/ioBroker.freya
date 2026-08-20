# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project intends to use [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Security

- Established deny-by-default control permissions and autonomy level 0 as foundational
  invariants.
- Prohibited production state writes and publication of home-specific metadata during
  the analysis phase.
- Phase 1 runtime forcibly keeps autonomy at level 0, learning disabled, and history
  disconnected; it has no foreign-state subscription or write path.
