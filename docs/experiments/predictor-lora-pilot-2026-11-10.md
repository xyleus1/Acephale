# Predictor LoRA pilot, 2026-11-10

R3 completed the base collection and frozen data preparation. A3 sequence03 completed one real smoke
optimizer step and development evaluation, then failed adapter reload parity
during export. Neither main seed started. There is no qualified trained-predictor
comparison, goal-conditioned result, held-out score or live speedup measurement.

Acephale keeps the actor fixed and trains an auxiliary predictor to score whether
each currently bound read invocation occurs in the next authoritative tool batch.
Candidate generation and authorization still determine which calls are available
for speculative execution. This experiment trains candidate-hit prediction,
without goal labels; it does not change the actor's weights or available tools.
Binary hit events can have multiple positives. The model emits bits
autoregressively: each token probability is conditional on earlier decoded bits,
not an independently estimated marginal. Reported binary log loss scores these
conditional probabilities against per-candidate labels, not full-action entropy.

## Verified base collection

This is a **custom tau-compatible engineering pilot**, not an official full
tau-bench score. R3 contains six preassigned families, two tasks per family and
one base trial per task. Fitting, calibration and development each have two
families and four trials. No held-out trial or paired treatment comparison ran.

| Measurement | Observed result |
| --- | ---: |
| Declared trials retained | 12/12 |
| Mixed fitting/calibration/development native successes | 9/12 (75%) |
| Development-only native successes | 1/4 (25%) |
| Evaluated native failures | 1 |
| Actor `incomplete_response` outcomes, native reward unknown | 2 |
| Logical tool calls / physically executed tool calls | 77 / 77 |
| Speculative tool calls | 0 |
| Mean live latency including actor/user drain | 53.897 s, n=12 |
| Mean latency including evaluation | 56.874 s, n=12 |
| Evaluation-inclusive observed p90 | 98.135 s, n=12 |
| Hosted simulator/judge usage subtotal | $0.080866 |

The two incomplete responses remain failures in both applicable denominators.
No finish reason was retained, so their causes are unknown; an output-cap failure
is not established. The mixed 75% result is not a held-out score. Constraint checks are separate from native
reward: one trial has a known violation, three have known zero violations and
eight are unknown. Missing assertions do not establish policy compliance.
Hosted cost is usage-derived, not invoice-reconciled; GPU charges remain separate.
The small latency sample does not establish a tail-latency improvement.

## Frozen data and prediction coverage

The 150 public checkpoints yield 120 compiled examples: 34 weight-fitting,
46 calibration and 40 development, with zero test examples. One checkpoint is
rejected for mandatory context exceeding the budget. The remaining 29 empty
candidate windows are inferred from complete export counts, not individually
recorded empty-window events. Weight-fitting examples contain only nine positive
and 167 negative candidate labels. These are candidate bits, not 176 trajectories.

The frozen development panel covers at least one exact next invocation at 9 of
19 eligible-read checkpoints (47.37%). This is candidate-pool coverage, not ranking
accuracy or native success. A ranker cannot recover a correct call absent from
its panel; improving coverage requires a separately declared candidate-generation
change. Known-outcome workflow memory contains two fitting trials from one family.
Both sparse positive labels and limited memory diversity constrain this pilot.

Base fixed-panel replay retains all 150 rows: 145 completed and five failed.
Three failures correctly refuse a shortened fixed panel, one exceeds mandatory
context and one rejects the generated binary answer. The exact decoder subreason
was not recorded. Four failures have no model dispatch. Selected-candidate replay
separately retains 148 completed and two failed rows. Replay timing is not live
agent latency, and these results do not compare trained weights.

## Training declaration and retained failures

The fixed actor is `Qwen/Qwen3.5-9B` at
`c202236235762e1c871ad0ccb60c8ee5ba337b9a`. The predictor base is
`Qwen/Qwen3.5-0.8B` at `2fc06364715b967f1860aea9cf38778875588b17`.
The declared BF16 LoRA recipe uses rank 16, alpha 32, dropout 0.05, learning rate
1e-4, weight decay 0.01, gradient clip 1, warmup ratio 0.03, microbatch 1,
accumulation 16, maximum length 8,192 and output 1,024. It runs three epochs with
a 500-step ceiling and seeds 17 and 29, using completion-only cross-entropy.
Calibration families never enter weight fitting; development does not fit calibration.

Earlier native attempts remain separate: the original cohort is 2/12, interrupted
R1 is 8/12 with two unknown native outcomes, and R2 is 1/12. They are retained
infrastructure/debugging attempts, not a model-improvement series. Interrupted or
aborted cohorts remain ineligible for fitting. R3 does not replace their failures.

A2 training was infrastructure-censored when adding a training window invalidated
the controller's financial metadata binding and watchdogs terminated the host.
Actual optimizer progress is **unknown**, not verified zero. No partial checkpoint
is reused. A3's first smoke then recorded one optimizer step at learning rate zero:
rounding the 0.03 warmup ratio up to one step prevented an adapter update. Its full
22-file failed outcome, optimizer checkpoint and TensorBoard data were exported
and independently verified; 33 reproducible cache files have explicit omission hashes.

The separately declared recovery uses trainer source `83bddc7`: only the explicit
one-step smoke disables warmup. The main fitting recipe, seeds 17/29 and frozen R3
inputs remain unchanged; the 34 fitting examples imply nine optimizer steps per
main seed. It resumes no checkpoint and adds no native cohort or selective seed
retry. The same training lease ends at 2026-11-11 01:03:46 UTC, with no new window or
extra training time. The following outcomes distinguish optimizer progress from
successful export and serving qualification.

The next sequence failed before model loading because the unprivileged process
could not read the public training dependency lockfile. Its seven-file failed
outcome and drain proof were exported and verified. The traceback and source
order establish zero optimizer steps for that sequence; this does not change the
unknown A2 progress. A third sequence was explicitly declared against image05,
derived from the exact previous image with one public-permission layer. All 45
copied public-file byte hashes, dependency pins, code and main recipe match the
parent. The actual UID1000 implementation/compiler check passed. The three
optional standalone teacher-forced evaluations were omitted before dispatch to
preserve the existing window for both primary seeds; Trainer's final development
evaluation and the planned primary replay comparisons remain unchanged.

Sequence03 completed one real smoke optimizer step with one finite-gradient
check. Its sealed training receipt records changed adapter hashes and identical
frozen-base hashes, followed by a completed evaluation on the 40 development
examples. Teacher-forced completion loss was 0.324169 and mean token accuracy
0.883753. These are smoke diagnostics without a matching baseline, not task
accuracy or evidence of improved prediction. Training receipt elapsed time was
223.434 s and peak reported GPU allocation was 4,979,086,336 bytes.

The subsequent adapter **reload parity check failed before merging**. The smoke
stage and sequence therefore failed despite the completed optimizer receipt.
No main seed-17 or seed-29 fit began, no merged predictor passed qualification
and no trained-weight replay or calibration ran. The original reload tolerance
remained enforced. The numerical cause is not yet established; a possible
training-versus-reload forward precision difference requires a separate test.
Missing trained rows are not replaced with base predictions or selected retries.

The complete failed sequence was exported and independently verified: 32 files
including actual adapter weights, optimizer state, tokenizer, TensorBoard,
receipts and logs. Thirty-three reproducible cache files have individual omission
hashes. The archive is 113,653,003 bytes with SHA-256
`ea939c1a0e04aeeb3e5262259c60597cd3e4e7ee3caf25a8af2e8bcd21738fde`.
The completed optimizer receipt hash is
`bb6bdd857700ea094c6a7c8b1576ebfbe689b73ae6bb524681f3b9530e09e768`;
this does not convert the failed export stage into a successful smoke.

| Declared comparison | Base | Main seed 17 | Main seed 29 |
| --- | --- | --- | --- |
| Fixed-panel replay, completed / declared | 145 / 150 | Not run | Not run |
| Selected-candidate replay, completed / declared | 148 / 150 | Not run | Not run |
| Calibration from reserved calibration families | Completed | Not run | Not run |
| Qualified trained predictor export | Not applicable | Not produced | Not produced |
| Paired prediction-quality differences | Unavailable | Unavailable | Unavailable |
| Paired live task-success or latency changes | Not measured | Not measured | Not measured |

The auxiliary smoke uses seed 17 but is not the declared nine-step main seed-17
fit. Its development token accuracy cannot fill either missing main-seed column.

The next engineering step is to reproduce the reload mismatch with the exact
adapter, base revision, probe inputs and execution precision. Preserve the failed
checkpoint and check execution-mode parity before changing any tolerance. A
fresh bounded run must then pass smoke, both main fits, export and serving
qualification before the predeclared comparisons can produce trained results.

The next data experiment should expand fitting and development family diversity
and increase the number of positive read examples. Candidate generation should
then be evaluated separately on the ten uncovered development read checkpoints;
changing that pool requires a new frozen comparison. Context-budget failures and
malformed binary output need explicit failure-rate reporting. Goal-conditioned
training requires reviewed public-prefix goal labels and its own declaration.
Only a subsequent paired live trial can measure task success and end-to-end
latency changes; predictor replay cannot establish either.

## Reproduction identities and reporting

| Component | Immutable identity |
| --- | --- |
| Frozen serving/runtime/compiler source | `2d89765a24ab9b6243a5c0bf5c0636f6a902c874` |
| Isolated recovery trainer source | `83bddc7e46cb1594dfc2d5232e1ced0278dde78b` |
| Corrected controller source | `98fcb93865476df8f4a8c294bef2683a9ff103c3` |
| Separate reporting source | `f86252517a98b1a2140d638ed919ad5389c9c0f5` |
| Native report bundle | `d6f0bce291b7a47301758141a0b5903f759a209a63754bdaa9d8ee541dda10b1` |
| Training dataset | `85d557daad546988c08a2f7dc68ccac7940346ff846bf70f386a1c81c1abd8d6` |
| Dataset manifest | `df8b7a859d55990715db4c292efed32b3bb0f2189a41439d4ca5c3c77f0c6194` |
| Fixed-panel prediction JSONL SHA-256 | `e374489048f0637938895ef2ac073b03009ab05a8b98be219f8b81ebafbd10ce` |
| Sequence03 recovery comparison plan | `c37fb3f470f5426dbc42847c0e1e692cd54571a4c87f93a0fccd21fac3ff5b1b` |
| Actual image05 | `sha256:fa5ed9bd09aace5219a5bd9048b74b427fd55e9f9e137ecdc55f8d2dd659006f` |
| Complete failed sequence03 inventory | `cbe0b454d291b933ba014ecc585ab01476e5777c79019df0f3f2ee9146bb644d` |

The operator-held artifact bundle is required to reproduce these measurements;
raw tasks, candidate bindings and private outcomes are not distributed here.
Verify bundle manifests and file hashes before use. Follow the
[training guide](../../research/acephale/training/README.md) and
[runbook](../RUNBOOK.md) for pinned dependencies and execution prerequisites.
The reporting revision narrowly admits proven pre-dispatch context failures while
retaining their full panel and failed denominator. It does not reseal old inputs.

After both trained replays exist, the following reporting-only command compares
all three weights. Run from the pinned reporting checkout with its locked Python
environment. Variables identify approved immutable inputs and a new output path;
this command is not evidence that either trained replay currently exists.

```bash
python -m acephale.infra_cli compare-predictor-replays \
  --bundle "$NATIVE_BUNDLE" --partitions "$APPROVED_PARTITIONS" \
  --memory "$FROZEN_MEMORY" \
  --prediction "base_binary=$BASE_FIXED_PANEL" \
  --prediction "lora_seed17=$SEED17_FIXED_PANEL" \
  --prediction "lora_seed29=$SEED29_FIXED_PANEL" \
  --output "$NEW_COMPARISON_OUTPUT"
```

[Integration CI](https://github.com/xyleus1/Acephale/actions/runs/42935491634)
passed for `b7ab0fe53b180f9fcff5599694c5dd03d463303e`: Node 237 passed with two
Windows-specific skips, Python 391 passed with six platform/private-fixture/native
environment/opt-in Docker skips, and deployment 167 passed. Types, ESLint and Ruff passed.
These software checks do not establish training completion or performance gains.
The separate Linux permission-fixture invocation stopped before Docker execution
because that research environment lacked pytest; it is unexecuted, not passed.
