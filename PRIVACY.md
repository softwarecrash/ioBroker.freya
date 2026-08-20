# Privacy information

SmartBrain is local-first. It has no telemetry, advertising, or analytics service. Its
rules-only default does not make external network requests.

## Data processed locally

Depending on the permissions and features enabled by the user, SmartBrain processes:

- ioBroker object metadata and enum assignments used for semantic and room discovery;
- values and timestamps of explicitly observed states;
- selected context such as time, solar position, environment, presence, and device state;
- bounded history results requested from a selected local ioBroker history provider;
- learned pattern evidence, approvals, activity, action attempts, and feedback;
- configuration containing selected state IDs, semantic mappings, optional coordinates,
  endpoint settings, and an optional encrypted API key.

Observation, suggestion, pattern, and activity working sets are bounded in memory and are
lost when the adapter restarts. Up to 1,000 action records are stored in
`actions.v1.json` in the ioBroker instance data directory. These records can include the
target state ID, requested value, timestamp, result, and feedback. The previous file is
retained temporarily as `actions.v1.json.bak` for recovery.

## Optional external LLM providers

External transmission happens only after an ioBroker Admin explicitly calls
`analyzePattern` while OpenAI or an OpenAI-compatible provider is configured. The
`previewLlmDisclosure` command shows the allow-listed payload and destination first.
The payload is limited to aggregate evidence and selected semantic context. It excludes
state IDs, room names, raw device values, person data, prior explanations, and API keys.

OpenAI requests use the Responses API with storage disabled. OpenAI-compatible endpoints
are user-selected and therefore governed by that endpoint operator's privacy terms.
Ollama is restricted to the local loopback interface.

## Control and deletion

Users control processing through per-state Observe, Learn, Suggest, and Control
permissions, the learning and history switches, the LLM provider, and the autonomy
level. Set the provider to Rules Only or Disabled to prevent external LLM calls.

To remove persisted action history, stop the instance and delete `actions.v1.json` and
its `.bak` file from that instance's ioBroker data directory. Removing the adapter
instance removes its configuration objects; check the ioBroker host's backup policy for
copies retained outside SmartBrain.
