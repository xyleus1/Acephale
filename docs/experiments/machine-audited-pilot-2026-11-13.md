# Machine-audited exploratory pilot

Declared November 13, 2026, before either complete predictor fit and before any
paired three-arm outcome. The base collection and a partial untrained prediction
replay already existed. This is a prospective amendment for the remaining run,
not a claim that the whole study was preregistered without prior observations.

The user requested autonomous completion. The original 20-case human annotation
review remains pending. An explicit `machine_audited_exploratory` protocol permits
an exploratory run without representing automated judgments as human reviews.
The original `human_reviewed` mode remains the default and cannot accept a
machine audit.

The audit keeps the same 20 checkpoint IDs selected before annotation. It uses
the corrected annotation hashes, their full visible public prefixes, and a
separate critic prompt/request to `gpt-5.4-2026-03-05`. The critic and annotation
teacher share model weights; separate requests do not establish model-family
independence. A separate assistant audit supplies additional inspection and is
also labeled automated. No future actions, private task state or evaluator
outcomes may enter either audit.

Critic requests and targeted teacher revisions allow 32,768 input tokens and
4,096 output tokens to retain the full public history and critique. This does
not change the smaller predictor context budget. Revisions select only cases
flagged by the retained audits, preserve every other fitting label, and require
a new source-bound review. Rechecking corrected cases is a quality gate, not an
unbiased estimate of annotation quality on unseen cases.

The first actual critic accepted 17/20 cases and reported six unsupported
bindings; its failed receipt remains unchanged. Inspection found a genuine
unsupported delivery-status claim and rubric errors in two other cases: the
critic treated completed parts of a joint request as unrequested, and treated
missing execution consent as withdrawal of the desired outcome. The subsequent
critic rubric explicitly separates requested outcomes, achieved state and
execution permission. This rubric revision is recorded before re-review, so
acceptance changes cannot be attributed solely to annotation corrections.

All 20 cases require recorded judgments, at least 18 acceptable annotations and
zero unsupported bindings. Uncertain cases are not acceptable. Requests,
responses, failures, actual usage and source references are retained. Original
annotations and the original pending human-review packet remain immutable.
The audit receipt binds its selected IDs, packet, annotation bytes, reviewer,
prompt, requests and responses. It never transfers review to changed labels.

Dataset, training, reliability and live manifests carry the review protocol,
audit hash, zero human reviews and 20 machine reviews. Machine reliability is
admitted only by a matching explicit experiment declaration. Reports must state
the shared-teacher limitation and cannot claim human-validated semantic accuracy.
Independent native completion checks remain separate from annotation agreement.

This amendment does not change the actor, candidate eligibility, tool authority,
family split, fitting population, optimizer, two seeds, acceptance thresholds or
live task schedule. It does not authorize dropping failures or choosing the best
seed. The same 372 fitting checkpoints and 1,116 multitask rows remain required.

The updated replay retains parsed model responses and token probabilities before
output validation, alongside bounded failure diagnostics. These envelopes exclude
transport headers and credentials; they are not raw HTTP captures. Replay receipts
bind the complete response file. This implementation changes the compiler identity.
The earlier untrained replay stays a diagnostic artifact; a new complete untrained
replay under the amended source supplies the matched weight comparison. Replay
timing remains separate from live task latency.
