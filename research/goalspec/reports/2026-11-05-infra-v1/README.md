# GoalSpec infrastructure v1 implementation report

Date: 2026-11-05. Starting repository revision:
`2e1a78c268dccfbca29dc4400671c9682651147d`.

## Actual measurements

| Measurement | Result | Interpretation |
| --- | --- | --- |
| Historical public checkpoints exported | 375 | 215 training, 160 development; no fresh held-out claim |
| Annotation pilot | 100 checkpoints, 20 pending human audits | Inputs prepared; new teacher labels not generated |
| Runtime experience memory | 24 runs, 191 episodes, 12 fitting families | Frozen, original scopes and provenance retained |
| Eligible next-read decisions in symbolic replay | 62 across 8 development families | Historical GPT-5.4 actor traces |
| Exact next-invocation Top-1 | 25/62, 40.32% | Unconditioned symbolic baseline |
| Exact next-invocation Top-3 | 30/62, 48.39% | Tool and complete arguments match |
| Candidate coverage | 30/62, 48.39% | Correct invocation absent in 32/62 cases |
| Tool-name Top-1 | 27/62, 43.55% | Weaker criterion than exact invocation |
| Family-macro exact Top-1 | 41.65%, 95% interval [26.63%, 59.79%] | Family bootstrap, 2,000 samples |

The current actionable prediction bottleneck is candidate coverage. Ranking or
a larger predictor alone cannot recover an invocation that is absent from its
candidate pool. New runtime code combines current grounded candidates with
compiled symbolic workflows; its Qwen prediction quality is not yet measured.

Three actual HTTPS reads of pinned PASTE repository documents passed content-hash
verification. Observed read times were 649.02, 37.47 and 26.76 ms. Exact local
receipt validation took 1.97, 0.97 and 1.35 ms with zero additional HTTP queries.
This is a three-sample adapter profile with connection/cache variability. No
actor ran, so these observations establish neither task success nor live speedup.

Teacher compilation preflight accepted all 100 pilot inputs, with a maximum
6,611 input tokens under the 8,192-token cap and no omitted source values. Its
maximum 100-request reservation is $3.584 with the specified output cap, inside
the $5 annotation slice. No such requests were dispatched.

## Reproducible local artifacts

All paths below are relative to `research/goalspec/runs/` and remain excluded from
Git because they contain raw research trajectories and contextual memory.

| Artifact | Path / identity |
| --- | --- |
| Dataset and annotation inputs | `infra-v1-historical-pilot-20261105/` |
| Dataset bundle hash | `19da36cd57a351f566e637c23cc61a61ab28395dd1211c3be58d9524f809cb3a` |
| Runtime memory | `infra-v1-runtime-memory-20261105/runtime/artifact.json` |
| Runtime memory hash | `00860bc6bef1b03fe7f2e61edf8f2940d05d47896365e3757572118bbbdb0db1` |
| Symbolic replay | `infra-v1-symbolic-replay-20261105/report.json` |
| Frozen HTTP corpus | `infra-document-corpus-20261105.json` |
| HTTP adapter profile | `infra-http-profile-20261105/profile.json` |

The importer checked original cohort/export hashes and reconstructed public native
transcripts. It retained failed runs and the original family partition. Independent
outcomes and future-action labels are separate from model-facing public input.

## Verification

| Check | Result |
| --- | --- |
| Existing TypeScript core | 280 passed, 2 optional prerequisite skips |
| Existing v5 suite | 49 passed |
| New infrastructure suite | 86 passed, 1 optional database skip |
| Research Python | 514 passed, 5 skips |
| Deployment lifecycle/control | 21 passed |
| Deployment configuration | 10 services passed static validation; containers not started |
| Schema generation and TypeScript | Passed |
| New Python module lint | Passed scoped Ruff |
| Repository-wide Ruff | 74 pre-existing violations remain; full CI is not claimed green |

Python skips comprise two unavailable historical-data checks and three tests of
legacy Torch controllers; Torch is not installed in this local research environment.
The optional database test skips in the default Node invocation but passed in the
separate disposable-database run below. The final infrastructure suite counts and
log digests are recorded in `verification.json` alongside this report.

New deterministic tests cover local tokenizer/SSE protocol, actual tool IDs,
malformed arguments, bounded context, memory/source isolation, goal attenuation,
asynchronous prediction, exact promotion, cancellation, mutation barriers,
immutable HTTP evidence, telemetry export/aggregation, teacher budget closure,
native gateway continuity, and Derya authorization.

A new disposable PostgreSQL 17 cluster was created on loopback port 5447. Both
the existing independent-connection freshness suite and the new Derya adapter's
database integration passed. The cluster was stopped afterward; historical and
production databases were not used.

The three-arm document integration test passes with identical actor input hashes,
observations and transcript hashes. These are deterministic scripted tests, not
paid model task-accuracy benchmarks. Static Compose/lifecycle tests do not count
as a running GPU/Grafana deployment.

Local validation uses installed Node 22.16.0 and the frozen research environment's
Python 3.12.14; deployment control tests use system Python 3.13.5. Deployment targets
Node 22.23.4 and Python 3.12.16. The distinction
is recorded; a pinned GPU deployment still needs its actual smoke receipts.

## Not measured

No fresh Qwen actor task score, inferred-goal improvement, live native pass1,
two-trial consistency, live latency benefit, or superiority over PASTE/Salesforce
is claimed. No model weights, Docker images, or GPU resources were downloaded or
provisioned. New paid expenditure is zero; previous study reservations are intact.

Conditional goal rankings currently share the neutral predictor's calibration
mapping. Independent conditional calibration and its effect on admission remain
unmeasured. Relevant evidence hooks support semantic refresh; the runtime also
automatically refreshes changed or missing hypothesis/constraint source paths and
rejects late predictions grounded in superseded values.

Execution is waiting for secure GPU/API configuration and human label review.
The code includes preflight, download, serving, labeling, prediction, calibration
interfaces, native/document runner and reporting commands. Follow the
[runtime guide](../../../../docs/goalspec/INFRA_V1.md) for concrete commands and
the deployment guide for rental/export/watchdog gates.
