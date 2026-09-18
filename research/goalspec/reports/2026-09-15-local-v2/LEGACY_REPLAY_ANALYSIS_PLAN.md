# Full v2 replay analysis on the previously observed v1 checkpoints

This plan reuses all 213 original v1 checkpoints and 109 unchanged teacher references. The checkpoint request IDs have the new `v2-full-replay:` namespace. This is **development evidence for v2**, even though the unchanged analysis CLI names the original trace partition `--heldout`. No newly generated v2 confirmation task enters this replay.

Run these two offline commands from the repository root after the fresh prediction and grade phases finish. They make no provider calls. All output directories are new; the original v1 reports and failed predictions remain preserved.

```powershell
research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/evaluate_v1.py requested-goals --queue research/goalspec/runs/local-v2-legacy-replay-20260915/queue.jsonl --predictions research/goalspec/runs/local-v2-legacy-replay-20260915/predictions --annotations research/goalspec/runs/local-v2-legacy-replay-20260915/annotations --grades research/goalspec/runs/local-v2-legacy-replay-20260915/grades --output research/goalspec/reports/2026-09-15-local-v2/legacy-requested-analysis
research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/evaluate_v1.py prediction --training research/goalspec/runs/local-training-export-v1-20260915/trajectories.jsonl --heldout research/goalspec/runs/local-heldout-export-v1-20260915/trajectories.jsonl --goal-cache research/goalspec/runs/local-v2-legacy-replay-20260915/predictions/frozen-goals.jsonl --requested-goal-report research/goalspec/reports/2026-09-15-local-v2/legacy-requested-analysis/summary.json --output research/goalspec/reports/2026-09-15-local-v2/legacy-prediction-analysis
```

The second command automatically evaluates all seven frozen local conditions and all seven identical-candidate-pool controls. No extra flag or separate control command is needed.

| Condition | Role |
| --- | --- |
| `stateless` | Visible-request/tool-description baseline |
| `local_paste` | Local PASTE-style baseline |
| `paste_memory` | Local PASTE-style baseline with training-only memory |
| `goalspec_no_memory` | Goal-conditioned prediction without memory |
| `goalspec` | Goal-conditioned prediction with memory |
| `oracle_goals` | Oracle endpoint-label diagnostic |
| `shuffled_goals` | Shuffled goal control |

Each corresponding `__same_pool` condition shares the same current-source-bound candidate pool at a checkpoint, formed from every compatible training branch before the target is scored. Only ranking changes. Tool probability is split uniformly across bindings for that tool; this does not assess a learned within-tool argument ranker.

The report must retain:

- Predictor validity and failure counts across all 213 checkpoints, plus requested-goal Top-1/Top-3 scores and teacher coverage.
- Tool Top-1/Top-3 and joint tool-plus-complete-arguments Top-1/Top-3, with all scored decisions in the denominator.
- Mean tool NLL and full-action NLL in nats, with unbound or unresolved probability mass retained and a `1e-12` scoring floor.
- Paired NLL differences versus `local_paste`, with the existing 2,000-draw, seed-42 family-cluster bootstrap intervals. Positive differences mean lower loss than the baseline. Differences are predictive cross-entropy estimates, not direct measurements of conditional entropy.
- Endpoint-goal scores separately from requested-goal teacher scores, including how many endpoint matches are the unknown category.
- Main and identical-pool results separately. Candidate matches are prediction accuracy, not executed speculation hits; this replay has no live tool execution or live latency result.

For the v1-to-v2 comparison, join by original checkpoint identity using [checkpoint-map.jsonl](../../runs/local-v2-legacy-replay-20260915/checkpoint-map.jsonl), and by `(trajectoryId, seq, condition, rankingControl)` for detailed prediction rows. Require identical visible-input hashes and targets. The original 212/213 prediction failures remain observed failures; they are never relabeled as successful inferred-goal estimates. Baseline conditions independent of the goal cache should retain their original scores, providing an additional consistency check.

The planned commands, expected conditions, immutable input hashes, prior analysis references, and output paths are recorded in [legacy-replay-analysis-plan.json](legacy-replay-analysis-plan.json). The plan contains no new measured result. After execution, cite the generated summary and source manifests alongside this v2 development-only scope note.
