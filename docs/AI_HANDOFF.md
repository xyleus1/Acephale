# Acephale handoff

Updated 2026-11-10. Work only in this standalone research checkout. Read
[methods](METHODS.md), [runbook](RUNBOOK.md), [state](STATE.md) and
[decisions](DECISIONS.md) before continuing.

The explicit one-step CUDA smoke now disables warmup and records mode plus the
effective recipe. Its prior 0.03 warmup rounded to one step, so the only optimizer
step used learning rate zero despite nonzero gradients. The actual failed
checkpoint had unchanged adapter bytes. Full seed-17/29 fitting retains the
declared 0.03 warmup and every original recipe value. All changed-adapter and
frozen-base assertions remain mandatory; failed runs retain computed hashes or
null when unavailable. A new qualified trainer source/image and explicit recovery
declaration are required before another GPU attempt; frozen runtime and earlier
artifacts are not relabelled by this fix.

Native stop diagnostics now retain only a classified split-guard reason and
finite heartbeat age/limit. The three-second freshness ceiling is unchanged.
Remote OTLP rejection or SDK shutdown failure marks the export receipt incomplete
without replacing the original runtime failure or aborted result. Local recording
and publication failures remain fatal. Accepted counters describe observed
collector responses, not durable backend storage; historical cohorts are unchanged.

The actual trainer CPU probe also reproduced a missing C compiler in Triton's
driver build. The trainer now pins GCC, development headers and their complete
32-package added dependency closure, with that file bound into image receipts.
A disposable exact-base-image probe compiled and imported a Python C extension;
this does not establish GPU training. Build a new observed trainer image before
using this change. Model and Python dependency pins remain unchanged.

The split-host guard accepts an optional owner stop event. A detached local
supervisor may own the guard thread and native child together, then stop and
join the guard through its existing SSH drain and degraded final publication.
This changes no health deadline or admission check. A daemon-killed cohort must
remain interrupted; absent closure cannot be replaced by a successful receipt.

Trainer launches now create writable per-run home and cache directories beneath
the retained output mount. `launch.json` binds their explicit environment and
the host launcher's source hash. This repairs the observed host-UID `HOME=/`
problem without granting root or network access. It does not establish CUDA
training readiness or provide a missing C compiler; inspect actual image
prerequisites and perform the real smoke before optimizer-result claims.

Latest native result: the original 12-slot cohort is closed and aborted after two
successes. A Windows metrics-file replacement error prevented subsequent actor
requests. Ten infrastructure-censored errors remain in its denominator; only two
native rewards were actually evaluated. Do not import this cohort for training
or report its short failed-slot timings as a gain. The metrics publication fix
has passed actual Windows lock tests. A separately declared full recovery cohort
must use new committed source, inventory, guard and original-journal reservations.

Optional `ALL_WITH_NL_ASSERTIONS` uses the pinned upstream evaluator while keeping
the original reward basis. It can audit existing airline assertions; retail's
empty assertions remain unknown. Private assertion text never enters actor or
training inputs. Current training is candidate-only, with zero optimizer steps
at this checkpoint. Consult the private operator handoff for live resources.

Latest checkpoint: the second GPU lease passed actual qualification and its
235-file export was independently verified. Source was `ae71b86`. The lease
was marked ready and its existing cleanup controllers remain authoritative.
Consult the private operator handoff for the live lease, heartbeat and hard
deadline; never infer that a host is still active from this document.

No native task or optimizer step ran at this checkpoint. The prepared 12-task
base collection stopped before dispatch because fresh SSH handshakes exceeded
the split guard's 2.5-second observation budget. The guard/tunnel were drained.
Preserve those failed observations and original prepared inputs. A new committed
transport fix, observed inventory and preparation are required before collection.
Do not weaken freshness checks or reuse the previous healthy status.

Two independent audits also found a base-versus-trained calibration-family
mismatch and insufficient independent APIGen goal families. Keep candidate-only
training separate from goal supervision, compare every weight variant with
identical prompts/candidate order/calibration families, and retain both seeds.

The following entries preserve earlier execution history:

Current execution receipts are maintained outside the checkout. Both real
cleanup canaries completed, the research A100 passed its hardware preflight,
and both pinned model snapshots downloaded. The Node split guard now matches
Python's Lambda identity and provenance checks. Do not infer completed serving,
training or native evaluation from these milestones; inspect the latest private
lease and qualification receipts before continuing or launching another host.

The first research lease has now terminated after its setup deadline. Protocol,
concurrent-inference and telemetry checks passed and their bytes were exported,
but final deployment inventory failed on an incorrect CUDA metadata expectation.
There are still zero native trials and zero optimizer steps for this execution.
Do not reuse its readiness status, host identity or reservation as a new lease.
An evidence-backed metadata correction and repeatable startup are being prepared;
keep image/model pins and the original budget journal unchanged.

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

The persistent split guard's local catalog requests now share the remaining
2.5-second observation deadline, instead of an undocumented 0.5-second sublimit.
The 3-second consumer freshness bound, nonce checks and confirmed drain before
reconnect are unchanged. Failed observations publish only a fixed stage name and
elapsed/remaining/budget milliseconds, never exception messages. A new deployment
inventory and read-only guard soak must qualify this source before paid trials.
