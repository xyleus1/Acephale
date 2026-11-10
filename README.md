# Acephale

Acephale is a standalone study of **goal-conditioned tool prefetching inspired by
PASTE**. It collects agent traces, builds frozen workflow and episodic memory,
infers source-grounded goals from the current public context, and predicts which
read-only tool invocations the agent will need. An admitted read runs while the
actor is generating. Its result is reused only if the actor requests the exact
invocation and freshness and authorization checks pass.

The experiment changes tool-calling infrastructure. Actor weights, prompts, tool
catalog and task limits stay fixed across the primary comparison arms. Goal
conditioning affects the predictor and scheduler. It does not train the actor
or guarantee improvements in task accuracy, logical tool-call count or latency.

- [Methods and experimental controls](docs/METHODS.md)
- [Collection, memory, calibration and evaluation commands](docs/RUNBOOK.md)
- [Current verification, execution gates and limitations](docs/STATE.md)
- [Research Python package](research/acephale/README.md)
- [Scoped predictor LoRA training](research/acephale/training/README.md)
- [Pinned serving and deployment configuration](infra/acephale-infra-v1/README.md)

## Local checks

Use the versions pinned in
[`versions.json`](infra/acephale-infra-v1/versions.json). From the repository root:

```text
npm ci --ignore-scripts
npm run check
npm test
```

Python research checks run from `research/acephale`:

```text
uv sync --python 3.12.14 --frozen --group dev --extra analysis
uv run --frozen --extra analysis pytest
```

These checks are separate from GPU serving, database integration and paid model
evaluation. Configure credentials and the existing external study budget through
the execution environment. Never create a replacement budget to repeat a run.
Python 3.12.14 is the local/CI unit-test interpreter; observed live deployment
continues to require its independently pinned runtime, including Python 3.12.16.

## Study structure

| Component | Location |
| --- | --- |
| Contracts, binding, workflow memory and scheduler | `src/lib/acephale` |
| Local model ports, native/document adapters and telemetry | `services/acephale-runtime` |
| Data preparation, native environments, private evaluation and statistics | `research/acephale` |
| Reproducible commands and offline tests | `scripts` |
| Pinned GPU serving, research database and observability | `infra/acephale-infra-v1` |

The primary comparison is base actor, neutral-memory prefetch and goal-conditioned
memory prefetch on paired tasks/seeds. No new live accuracy or latency gain has
been established for this standalone checkout. Earlier reports remain unchanged
in the original checkout and Git history; they are neither current results nor
automatically eligible training data. The implementation is paper-based research,
not a verified reproduction of every PASTE or Salesforce serving component.
