# SmartBrain for ioBroker

SmartBrain is a local-first, self-learning ioBroker adapter. It observes explicitly
selected states, discovers repeatable home-automation patterns, and turns them into
explainable suggestions. Automatic actions are a later, opt-in capability protected
by explicit per-state permissions and a central safety engine.

The project is currently in **Phase 1 (read-only adapter skeleton)**. The TypeScript
daemon builds and exposes only bounded, adapter-owned status states. It does not
subscribe to foreign states, access history, learn patterns, or execute actions.

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

No production state has been changed by this project. Phase 1 enforces autonomy level
0, learning disabled, and no history provider at runtime, even if unsupported persisted
settings request otherwise. Until the controlled-actions phase is implemented and
tested, SmartBrain remains read-only by design.

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
