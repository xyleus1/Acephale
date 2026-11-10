# Acephale handoff

Updated 2026-11-10. Work only in this standalone research checkout. Read
[methods](METHODS.md), [runbook](RUNBOOK.md), [state](STATE.md) and
[decisions](DECISIONS.md) before continuing.

Current execution receipts are maintained outside the checkout. Both real
cleanup canaries completed, the research A100 passed its hardware preflight,
and both pinned model snapshots downloaded. The Node split guard now matches
Python's Lambda identity and provenance checks. Do not infer completed serving,
training or native evaluation from these milestones; inspect the latest private
lease and qualification receipts before continuing or launching another host.

The active question is whether source-grounded goals improve a PASTE-inspired
read prefetcher over an otherwise identical neutral-memory prefetcher. Actor
weights, messages, tools and task limits stay fixed. This is infrastructure
research; no live performance advantage has been established.

The latest authorized extension fine-tunes only the pinned 0.8B predictor with
LoRA, retaining the fixed actor. See the [training guide](../research/acephale/training/README.md)
and [Lambda lifecycle](../infra/acephale-infra-v1/LAMBDA_CONTROL.md). Runtime
binary-hit ranking, disjoint fitting/calibration families, production-compiled
examples and immutable merged identities are implemented. A reviewed goal
annotation is still required before goal-labelled fitting; the prepared human
review packet is pending. Candidate-only training requires real closed traces.

The latest local implementation checks passed: Node 217 plus two database
skips, Python 304 with the installed native environment and no skips, deployment
141, contract/type checks and lint with zero errors. See STATE for the initial
Python failures and repairs. No real GPU training or performance result follows
from these tests. Keep actual subsequent deployment/training receipts separate.

The TypeScript core and service live under `src/lib/acephale` and
`services/acephale-runtime`; Python/native evaluation is `research/acephale`.
Serving and research database definitions are `infra/acephale-infra-v1`.
Entrypoints are `npm run check`, `npm test`, `acephale:infra`,
`acephale:infra-native`, `acephale:infra-predict` and `acephale:infra-annotate`.

The [main-branch CI run](https://github.com/xyleus1/Acephale/actions/runs/42357269977)
passed for `d510c1bbc139e09fe9e40ed1145daead87fbfb18`: Node 210 passed with no skips,
Python 275 passed with two platform/environment skips, and deployment 124 passed.
Typecheck, ESLint, Ruff and CLI help succeeded. Real disposable PostgreSQL/pgvector
publication, scoped retrieval, immutable guards and read-only/bound-value tests
passed. Production database readiness and publication are still outstanding.

Preserve the local repair history: initial Python 276 passed and one ESM fixture
import failed, followed by all six native-profile tests passing after the fix.
Both Python CI skips were covered locally: the native fixture in that rerun and
the Windows sharing test in the initial passing set. Local ESLint recorded zero
errors and 27 explicit-any warnings. See STATE for exact separate run counts and
retained logs; do not collapse these into an invented zero-skip Python run.

Preserve the external original budget journal and credentials in secure operator
configuration. No paid execution or provisioning follows automatically from local
checks. The remaining sequence is actual serving/database readiness, fresh shadow
collection, annotation audit, frozen memory/calibration/profiling, paired
development and budgeted heldout trials. Consult STATE for evidence limits.

Historical artifact bytes and reports remain in the original checkout/history.
Do not rename/reseal them as current data or import them without provenance review.
