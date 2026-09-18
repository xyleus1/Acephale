# GoalSpec v1-v5 GitHub checkout

This checkout publishes the existing TypeScript runtime, Derya adapters, Python
research implementation, deterministic tests, schemas, trained controller weights,
benchmark report summaries and archival helper source. V6 is not implemented.

Start with the [v5 implementation](V5_IMPLEMENTATION.md) and
[closed v5 results](../../research/goalspec/reports/2026-09-16-v5-local/README.md).
V5 remains experimental and opt-in. The selected live configuration disabled
goal-conditioned ranking and started zero speculative reads; those results do not
establish an overall accuracy or latency improvement.

## Included model artifacts

The exact controller files referenced by the v4 and v5 configurations are included
at their original paths under `research/goalspec/runs/`. A narrow publication
allowlist includes these weights and their CPU/TypeScript parity fixtures; the rest
of that directory remains ignored. No model is retrained for this publication.

## Local checks

From the repository root:

```sh
npm ci
npm run goalspec:check
npm run test:goalspec
npm run test:goalspec-v5
```

Python dependencies and reproduction commands are described in
[the research README](../../research/goalspec/README.md) and
[local reproduction guide](LOCAL_REPRODUCTION.md). Tests requiring external native
benchmark checkouts, optional databases, or historical trace artifacts report their
missing prerequisites separately from the deterministic contract tests.

Publication verification passed schema/type checks, the staged Node core suite
(280 passed, two optional prerequisite skips), v5 (49 passed), and Python
(472 passed, 13 optional prerequisite skips). Python lint is a known remaining
failure: Ruff reports 74 existing violations (E702 23, E701 15, I001 13, B905 11,
E731 seven, F401 five). The CI lint gate remains enabled. This publication does
not claim a green lint or CI result; unrelated source reformatting is deferred.

## Artifacts retained locally

Raw episodes, annotations, downloaded datasets, episodic memory observations,
database exports, provider accounting ledgers and large ZIP archives are not part
of this Git commit. Report links into those excluded directories refer to the
preserved local evaluation artifacts. A Git checkout alone does not reconstruct
the full frozen evaluation repository or reproduce historical paid runs.

Helper source under `outputs/goalspec-v4-tools`, `outputs/goalspec-v5-tools` and
`outputs/goalspec-benchmarks-tools` is included because existing analysis and archive
commands import it. Their generated outputs and caches remain local.

Publication does not launch infrastructure, run paid evaluations, apply database
migrations, enable GoalSpec in production, or alter the original frozen archives.
