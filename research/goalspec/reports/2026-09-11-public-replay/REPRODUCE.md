# Reproduce the published-trajectory pilot

Run commands from `research/goalspec`. The examples use new output directories,
leaving the measured `runs/public-pilot-20260911` artifacts intact. Python 3.12 and
the pinned native benchmark environment are required; follow the
[native setup instructions](../../README.md#capture-native-tau3-data) first.

## Verify software and reconstruct the input cohort

```sh
python -m uv sync --frozen --group dev
python -m uv run ruff check src tests scripts
python -m uv run pytest
python -m uv run python scripts/public_replay.py --native-root .benchmarks/tau3 --output runs/public-reproduction
python -m uv run goalspec fit runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts
```

The acquisition script downloads hash-pinned official published files, preserves
native rewards, reconstructs catalogs independently and applies the frozen
semantic-annotation/family rules. It retains telecom in the full corpus but
excludes it from the prediction corpus before fitting. This does not run new
benchmark actors. The benchmark and source revisions must match the report;
updating a dependency or source is a new experiment.

The measured source digest is recorded in [software.json](software.json).
Bundles validate exact source and training hashes. Do not bypass a mismatch by
editing a manifest. Refit with the changed source and identify the new result.

## Capture goals and replay fixed actors

The following model commands require an already authenticated compatible Codex
CLI. Each sends one public request to `gpt-5.6-sol`, reasoning effort `high`, with
tool access disabled. They use model inference and can consume account usage.
Re-capture is stochastic; exact replay of the measured classifier instead uses
the preserved capture files and their bound backend configurations.

```sh
python -m uv run goalspec classify-initial runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts runs/public-reproduction/classifier-development --model gpt-5.6-sol --workers 4
python -m uv run goalspec classify-initial runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts runs/public-reproduction/classifier-test --model gpt-5.6-sol --workers 4 --partition test
python -m uv run goalspec replay runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts runs/public-reproduction/development-lexical --bootstrap-samples 2000
python -m uv run goalspec replay runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts runs/public-reproduction/development-llm --bootstrap-samples 2000 --goal-config runs/public-reproduction/classifier-development/backend.json
python -m uv run goalspec replay runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts runs/public-reproduction/test-lexical --bootstrap-samples 2000 --partition test
python -m uv run goalspec replay runs/public-reproduction/prediction-corpus.jsonl runs/public-reproduction/split.json runs/public-reproduction/artifacts runs/public-reproduction/test-llm --bootstrap-samples 2000 --partition test --goal-config runs/public-reproduction/classifier-test/backend.json
```

Run replays serially on machines with limited memory. The measured host had 8 GB
RAM; fitting was accelerated by the verified bounded cache, but dynamic lexical
replay still has appreciable CPU cost. Cached LLM replay performs no new model
calls. Its initial/dynamic-named arms intentionally share the initial posterior.

For exact captured-posterior reproduction in another directory, preserve the
capture JSON bytes and SHA256. Create a separate backend config pointing to the
new capture location; do not rewrite the archived original. Catalog/model/public
input hashes must still match. The archived evidence mapping records original
paths explicitly. Regenerating a classifier response is a new model measurement.

## Produce verified reports

```sh
python -m uv run python scripts/public_results.py --cohort runs/public-reproduction --run lexical-development=runs/public-reproduction/development-lexical --run llm-development=runs/public-reproduction/development-llm --run lexical-test=runs/public-reproduction/test-lexical --run llm-test=runs/public-reproduction/test-llm --output runs/public-reproduction/report-data
python -m uv run --extra analysis python scripts/plot_public_results.py runs/public-reproduction/test-llm runs/public-reproduction/report-figures
python -m uv run goalspec report runs/public-reproduction/test-llm runs/public-reproduction/report-llm-test
```

Reports reject incomplete runs, changed bound files and inconsistent paired
metrics. The source corpus is publicly reacquirable. Exact prediction logs and
CLI prompt/event files are retained locally and identified by hash; they are not
all included in the small-evidence package. The exported per-call loss
table supports independent reanalysis of the plotted LLM and oracle comparisons.

Additional audit and evidence exports, after the above commands complete:

```sh
python -m uv run python scripts/classifier_usage.py --cohort runs/public-reproduction --bundle runs/public-reproduction/artifacts --output runs/public-reproduction/report-audits
python -m uv run python scripts/audit_candidate_union.py --run runs/public-reproduction/development-lexical --output runs/public-reproduction/report-audits/development-lexical-candidate-union-audit.json
python -m uv run python scripts/audit_candidate_union.py --run runs/public-reproduction/test-lexical --output runs/public-reproduction/report-audits/test-lexical-candidate-union-audit.json
python -m uv run python scripts/audit_candidate_union.py --run runs/public-reproduction/test-llm --output runs/public-reproduction/report-audits/test-llm-candidate-union-audit.json
python -m uv run python scripts/archive_public_evidence.py --cohort runs/public-reproduction --bundle runs/public-reproduction/artifacts --run lexical-development=runs/public-reproduction/development-lexical --run llm-development=runs/public-reproduction/development-llm --run lexical-test=runs/public-reproduction/test-lexical --run llm-test=runs/public-reproduction/test-llm --output runs/public-reproduction/report-evidence
```

Expected scientific gate: `insufficient_evidence`, with
`scheduler_allowed=false`, because this public reconstructed cohort does not meet
the native reviewed-label evidence contract. A successful software command must
not be interpreted as a passed scientific hypothesis.

To check the delivered report package's file hashes from `research/goalspec`:

```sh
python -c "import hashlib,json; from pathlib import Path; p=Path('reports/2026-09-11-public-replay'); m=json.loads((p/'artifact-manifest.json').read_text()); assert all(hashlib.sha256((p/n).read_bytes()).hexdigest()==v['sha256'] for n,v in m['files'].items()); print('Report file hashes verified')"
```
