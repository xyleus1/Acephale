# Acephale

[![Research tests](https://github.com/xyleus1/Acephale/actions/workflows/acephale-tests.yml/badge.svg)](https://github.com/xyleus1/Acephale/actions/workflows/acephale-tests.yml)

23 November 2026 · [Methods](paper/manuscript.tex) · [Reproduction](paper/README.md)

**Paper:** [Goal-conditioned speculative reads under exact-source constraints](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-paper.pdf) · [Editable source](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-source.zip) · [Curated results](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-data.zip)

Acephale studies whether goals inferred from an agent's visible trace help predict
its next read-only tool call. A frozen actor continues its task while a separate
predictor uses workflow memory and current source bindings to propose useful
reads. A speculative result is reused only when the actor requests the exact
invocation and authorization and freshness checks pass.

The primary comparison keeps actor weights, prompts, tools and task limits fixed.
Goal conditioning changes prediction and scheduling. The implementation draws on
PASTE and Speculate with Memory; it is not a verified reproduction of their full
serving systems or reported benchmarks.

## Results

The current study ran **160 development trials, trained two native predictor heads,
and completed 44 matched baseline generations and a 98-checkpoint sensitivity replay**.
Failed and unavailable outcomes remain in their original denominators.

| Native predictor | Top-1 / 28 covered reads | Recall@3 / 28 covered reads |
|---|---:|---:|
| Symbolic proposal order | 24/28 | 27/28 |
| Frozen-backbone head | 22/28 | 28/28 |
| Rank-8 LoRA head | 19/28 | 28/28 |

These are development-selected prediction results, not held-out task-success
scores. The full native panel contains 136 prefixes, 52 eligible reads and 28
covered windows. The matched generative comparison is restricted to its available
subset; it retains the other 68 prefixes as unavailable.

The **primary live comparison is unavailable**. None of the three speculative
arms consumed a prefetched read. Calibration candidate coverage was 0/86 exact-read
checkpoints. Forty of 49 development error rows also recorded a cleanup connection
failure and an undrained trial state. A shorter failed run is not a speedup.

The unchanged development gate therefore prevented the conditional 400-trial
held-out phase and its quality evaluation. These results do not establish a live
latency or task-quality benefit. The checkpoint-29 sensitivity uses its restored
historical serving correction while checkpoint 17 used the stock runtime, so it
does not isolate a training-seed effect.

The [earlier 132-trial native pilot](paper/corrective-study-20261122/README.md)
remains separate and unchanged. It is a custom tau-compatible pilot, not an
official full-benchmark score. See the [paper guide](paper/README.md) for the
complete comparisons, original failure counts and source provenance.

## Installation

Use the versions pinned in
[`versions.json`](infra/acephale-infra-v1/versions.json). From the repository root:

```bash
npm ci --ignore-scripts
npm run check
npm test
```

Python research checks run from `research/acephale`:

```bash
uv sync --python 3.12.14 --frozen --group dev --extra analysis
uv run --frozen --extra analysis pytest
```

These commands check the repository; they do not start GPU serving or paid
evaluation. Live deployments retain their independently pinned environments.

## Use the research tools

The [runbook](docs/RUNBOOK.md) covers collection, memory, calibration and evaluation.
The [paper guide](paper/README.md) explains how to rebuild the PDF and figures from
the published numerical artifacts without model calls. Its release manifest
distinguishes public projections from their immutable source hashes.

## Repository guide

- `src/lib/acephale/`: contracts, binding, workflow memory and scheduling.
- `services/acephale-runtime/`: model ports, environment adapters and telemetry.
- `research/acephale/`: data preparation, native environments and analysis.
- `infra/acephale-infra-v1/`: pinned serving and deployment configuration.
- `paper/`: editable paper, figures, numerical tables and reproduction instructions.

## Citation and source terms

The paper includes versioned references for the methods and datasets used.
Source datasets and model weights retain their original terms. This publication
does not change the repository's licensing or redistribute model weights.

Maintained at [xyleus1/Acephale](https://github.com/xyleus1/Acephale).
