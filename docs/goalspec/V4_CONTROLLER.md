# Local GoalSpec v4 controller

The controller is a small CPU model with a direct TypeScript forward pass. The
actor remains unchanged. Its learned outputs rank possible reads and predict
READ versus NO_READ. They never authorize a tool or establish freshness.

V4 retrieves frozen workflow patterns and uses weights trained on historical
experience. The older episodic transition/confusion prompt is inactive in the
v4 GoalSpec path because v4 makes no remote candidate-model call. The Salesforce
paper-based baseline still invokes that episodic retrieval path. Accordingly,
v4 provides workflow memory and experience-trained ranking, with full episodic
runtime retrieval remaining an architectural limitation. These are different
memory mechanisms and should be reported separately.

The selected artifact is
`research/goalspec/runs/local-controller-v4-trained-20260916-b/controller.json`,
content hash `f89c20b480f9b76ea0aa1308b389f268127e67cb379b815f0fb63ea793f718fb`.
The artifact declares `goalFeaturePolicy: public-request-only`. Inferred goals
remain visible to the actor, but their feature slots are neutral because the
unprefetched Base training tapes contain no inferred-goal supervision. Goal
agreement and controller imitation accuracy are separate measures.

## Data and labels

The immutable dataset is
`research/goalspec/runs/local-controller-v4-dataset-20260916-c`. It contains 92
Base runs, 643 public decision boundaries and 5,648 typed current-source
candidates. Each boundary also has a NO_READ sentinel, giving 6,291 rows.
The source manifest records 113 input hashes and six compiler/binder hashes.
Family identifiers are split before traces or labels are read: 24 training,
eight model-selection and eight temperature-calibration families. These are
historical v1, v2 and v3 development records, not a fresh test cohort.

Inputs contain only the current public prefix. The actual next action and the
next two public actor decisions supply imitation labels after candidate
construction. Future identifiers are never inserted into the candidate pool.
The pool contains the exact next action at 199/258 read boundaries, 77.13%.
Server eligibility supplies the readiness label. An observed future use is not
a causal usefulness label. The exposure head is masked because these tapes have
no randomized expose/withhold intervention.

The shared feature profile has 24 bounded numeric slots and 192 signed FNV-1a
hash buckets. JSON Schema generates the TypeScript contracts. Every training row
is checked against Python's independent feature implementation. Exported
PyTorch probabilities also match the pure TypeScript implementation.

Training/runtime consistency checks exclude the reserved `server_policy` source
from learned source counts and serialized-length features. The policy remains
present for actor context and server enforcement. Every training candidate had
prior 0.86, hop one and no pattern ID. Those three feature slots therefore retain
their observed training constants for every candidate; NO_READ sentinel slots
remain zero. This prevents unseen metadata from changing scores without
supporting training examples. Real hop limits, authorization and workflow
dependencies remain enforced separately by the runtime and scheduler. Neither
this normalization nor policy-source normalization changes the trained weights
or any historical training vector.

## Training and selection

Training used PyTorch 2.7.1 CPU with two threads and seed 43117. It compared a
logistic model with a 32/16 hidden-unit MLP, then forked three fine-tuning
variants from the same MLP base. One variant adds a pairwise ranking loss. This
is local supervised ranking, not language-model DPO or hosted fine-tuning.
Greedy weight averaging admits a checkpoint only if selection-fold masked
cross-entropy improves without reducing exact-argument ranking accuracy.

The first retained experiment overfit. A second experiment used selection-fold
early stopping. Logistic was selected with masked cross-entropy 0.25967 versus
0.27254 for the best MLP. The fine-tuning variants did not improve the retained
MLP base, and soup additions were rejected. The model-soup experiment therefore
does not establish a soup benefit. Both experiment directories and all saved
checkpoints remain available.

On the eight selection families the selected model ranked the exact next
arguments first at 37/65 read boundaries, 56.92%, with pool coverage 54/65,
83.08%. READ classification was 91/143, 63.64%. The separate calibration fold
had 21/34 exact-argument matches and 78/108 correct READ decisions. Calibration
fold results are fitted diagnostics. They are not held-out task-success scores.

The native inference benchmark measured 643 boundaries, including pools of 32
candidates: mean 1.286 ms, p95 5.088 ms and maximum 14.036 ms. The p95 target of
10 ms passed. This measures the local controller only, not end-to-end live
latency. The offline timer includes `LocalController.decide`, its feature
extraction and ranking, but excludes candidate graph generation, workflow
retrieval and decision-state construction. Runtime `controller_scores_elapsed_ms`
telemetry has a narrower scope: it also excludes schema validation and final
ranking. End-to-end trial latency remains the primary live comparison.

Temperature adjustment uses the designated calibration families; the initial
READ, usefulness and readiness thresholds remain 0.5. A readiness label records
whether the server policy admits the candidate at its public checkpoint. Live
candidates already pass that server check. Multiplying the next-action and
learned-readiness scores in the latency estimate is therefore a conservative
heuristic, not a validated joint probability or a measurement of milliseconds
saved. Calibration metrics measure agreement with labels; measured tool costs
and independently established exposure benefit are separate inputs. The
next-two-boundary head predicts observed use, while the causal exposure head
remains unavailable. Offline Top-1/Top-3 rankings also precede live READ,
usefulness, readiness and positive-utility admission gates.

## Reproduction

Run commands from the repository root. Output directories must be new.

```powershell
node --import tsx scripts/goalspec-controller-generate.ts --check
node --import tsx scripts/goalspec-controller-dataset.ts NEW_DATASET_DIRECTORY
& research/goalspec/.venv/Scripts/python.exe -B research/goalspec/scripts/train_controller_v4.py NEW_DATASET_DIRECTORY/dataset.jsonl NEW_TRAINING_DIRECTORY
node --import tsx --test scripts/goalspec-controller.test.ts
& research/goalspec/.venv/Scripts/python.exe -m pytest research/goalspec/tests/test_controller_v4.py -q
```

The dedicated dependency pin is `research/goalspec/requirements-controller-v4.txt`.
No GPU, AWS, remote predictor or paid request is used for training/inference.
The existing original $500 budget is unaffected by these offline experiments.

The 172-checkpoint comparison in
`research/goalspec/runs/local-controller-v4-replay-20260916` uses identical
candidate pools for the prior, selected logistic, best MLP and soup. It reports
proposal and policy-ready pools separately, includes family membership and
family-clustered paired intervals, and retains the original v3 results as a
different-pool historical reference. Most of those v3 families occur in this
controller's training data, so that replay is a development diagnostic.

An auxiliary action-kind artifact lives in
`research/goalspec/runs/local-controller-v4-action-kind-20260916`. It exposes
read, message, write and compute probabilities with their label counts. STOP
is null because no explicit public actor-stop labels exist. Five human-transfer
boundaries have unaudited role labels and remain unavailable. Compute has only
three training examples and no independent selection/calibration examples.
Selection accuracy is 72/141, 51.06%, and the model does not correctly identify
any selection-fold writes. This auxiliary head is a diagnostic, not a replacement
for the binary execution gate. Its output explicitly states that probabilities
are conditional on classes observed in training.

## Derya server configuration

The existing Derya server composition loads model files lazily for an authorized
operator who can view the whole office. Configure the existing application
database and OpenAI credentials securely. The budget directory must point to the
existing shared ledger, and must match `GOALSPEC_BUDGET_DIRECTORY` when that is
also declared. From the repository root, these optional model paths select the
tested artifacts:

```powershell
$env:GOALSPEC_DERYA_BUDGET_DIRECTORY = "research/goalspec/runs/local-evaluation-20260914"
$env:GOALSPEC_DERYA_CONTROLLER_FILE = "research/goalspec/runs/local-controller-v4-trained-20260916-b/controller.json"
$env:GOALSPEC_DERYA_ACTION_KIND_FILE = "research/goalspec/runs/local-controller-v4-action-kind-20260916/action-kind.json"
```

`GOALSPEC_DERYA_ACTION_KIND_FILE` is optional and independent of the main
controller. It adds `controller_action_kind` telemetry only. It does not change
the binary execution gate, authorization, task execution or evidence exposure.
Without the main controller file, goal updates and auxiliary telemetry can run,
but speculative admissions abstain with `controller_artifact_unavailable`.
Invalid explicitly configured JSON, hashes, matrix shapes or training
lineage fail initialization before the budget is opened. Initialization records
artifact hashes, not weights or credentials. Changing either configured path
requires a server restart; loaded artifacts are not hot-reloaded.

The environment version defaults to `derya-goalspec-v1` and can be pinned with
`GOALSPEC_DERYA_ENVIRONMENT_VERSION`. Verified business memory can be supplied
through `GOALSPEC_DERYA_SNAPSHOT_FILE`; research corpus memory is not accepted as
Derya business evidence. The selected controller was trained on retail and
airline tapes, so Derya performance still requires its own measurements.

Derya defaults to no eager predictor wait. Its initial utility estimate has
`toolMs`, `validationMs`, `predictionMs`, `contentionMs`, `contextMs` and
`measuredExposureBenefitMs` all set to zero, with `schedulingMs` set to one.
Consequently, unmeasured reads receive no positive speculative admission credit.
There is no assumed 1,000 ms actor-round saving. A trusted programmatic
`configureDeryaGoalSpec` configuration can provide measured `utilityEstimate`
values; chat content and the auxiliary classifier cannot change them. Full-query
freshness validation remains real database work and must be included in those
measurements. The main artifact's exposure head is untrained and returns null,
so it provides no learned exposure-benefit credit.

Primary method references: [PyTorch CPU installation](https://pytorch.org/get-started/locally/)
and [Model soups](https://proceedings.mlr.press/v162/wortsman22a.html).
