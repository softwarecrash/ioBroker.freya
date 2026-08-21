# Security policy

## Supported versions

Freya is not yet a stable release. Security fixes are applied to the latest
published pre-release line only.

## Reporting a vulnerability

Please do not disclose a vulnerability in a public issue. Send a concise report to
`44615614+softwarecrash@users.noreply.github.com` with the affected version,
reproduction steps, impact, and any suggested mitigation. Do not include real smart-home
state values, credentials, or a complete ioBroker object export.

You should receive an acknowledgement within seven days. A fix and coordinated
disclosure timeline will be agreed after the report is reproduced. Non-sensitive bugs
may be filed in the public GitHub issue tracker.

## Security model

- Installation defaults to autonomy level 0 and all per-state permissions off.
- Learning, suggestions, history reads, external LLM calls, and controlled actions are
  separately opt-in.
- Only ioBroker Admin may approve patterns, request analysis, submit feedback, or request
  execution.
- Every device write passes the central deny-by-default safety engine immediately before
  the single foreign-state write boundary.
- API keys are protected and encrypted native configuration values and are never logged
  or included in an LLM disclosure.
