# SmartBrain for ioBroker

SmartBrain is a local-first, self-learning ioBroker adapter. It observes explicitly
selected states, discovers repeatable home-automation patterns, and turns them into
explainable suggestions. Automatic actions are a later, opt-in capability protected
by explicit per-state permissions and a central safety engine.

The project is currently in **Phase 2 (read-only semantic discovery)**. The TypeScript
daemon scans ioBroker object metadata, classifies supported state semantics, ranks
environment sources, and exposes only bounded aggregate status plus a paginated
message API. It does not read state values, subscribe to foreign states, access
history, learn patterns, or execute actions.

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

No foreign production state is changed by this project. Phase 2 enforces autonomy
level 0, learning disabled, no history provider, and deny-by-default state permissions,
even if unsupported persisted settings request otherwise. Lock and alarm states cannot
receive control permission. Until the controlled-actions phase is implemented and
tested, SmartBrain remains read-only by design.

## Semantic discovery

Discovery uses `common.role`, translated names, units, value type, ancestors, native
type hints, and room/function enums. It deliberately stores no state values or raw
object exports. Ambiguous metadata remains `unknown`; user corrections and permissions
are kept separately in adapter configuration. Environment mappings support multiple
ranked candidates and manual pinning without hard-coded adapter state IDs.

The adapter message API provides `getDiscoverySummary` and `getDiscoveredStates`.
State pages are capped at 100 entries and support a text query.

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

## License

A license will be selected and added with the generated adapter skeleton in Phase 1.
