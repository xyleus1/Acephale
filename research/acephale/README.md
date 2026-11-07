# Acephale research tools

Python owns trajectory preparation, family splits, annotations, calibration,
native benchmark state and private evaluation. The shared TypeScript runtime
owns goal-conditioned prediction, speculative scheduling and exact-call promotion.
Actor weights remain fixed. See [methods](../../docs/METHODS.md),
[the runbook](../../docs/RUNBOOK.md) and [current state](../../docs/STATE.md).

## Install and verify

From this directory, with the locked Python version available:

```text
uv sync --python 3.12.14 --frozen --group dev --extra analysis
uv run --frozen --extra analysis pytest
uv run --frozen ruff check src tests
uv run --frozen python -m acephale.infra_cli --help
```

Use a new `--basetemp` directory if the default temporary location is restricted.
Python 3.12.14 is the local/CI unit-test runtime. It does not replace the pinned
Python 3.12.16 observed deployment requirement.
Native benchmark dependencies belong to a separate pinned environment described
by `benchmarks.lock.json`; they are not installed implicitly by the commands above.
Set `PYTHONPATH` to this checkout's `research/acephale/src` when using that external
interpreter. Optional model/observability dependencies do not establish live
serving or telemetry readiness.

## Main modules

| Modules | Responsibility |
| --- | --- |
| `infra_prepare_native`, `infra_native_runner`, `infra_native_profile` | Frozen native tasks, authenticated step gateway and measured component profiles |
| `infra_import_fresh`, `infra_data` | Closed-cohort imports, public prefixes, private labels and family partitions |
| `infra_calibration`, `infra_admission` | Training-only marginal calibration, independent goal audit and deployment-bound admission evidence |
| `infra_evaluation`, `live_design` | Paired trial completeness, fixed candidate panels, clustered statistics and budgeted heldout design |
| `patterns`, `binding`, `schemas` | Bounded pattern mining, symbolic arguments and shared validation fixtures |

Use `python -m acephale.infra_cli COMMAND --help` for exact arguments. Every output
directory must be new; failed and undispatched trials remain in the declared
cohort. Secrets and the original budget journal live outside source control.

Past reports are preserved only in the original checkout and Git history. No
historical dataset, controller checkpoint or result is accepted merely because
it was renamed. Require explicit license, split, provenance and compatibility
review before reuse. Synthetic tests and mocked native parity do not constitute
task-accuracy or live-latency results.
