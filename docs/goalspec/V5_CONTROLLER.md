# V5 local prediction subsystem

V5 is additive. The v4 controller, feature vectors, session and recorded results remain separate. No executor language-model weights are loaded or fine-tuned by this subsystem.

## Runtime

`GoalSpecSessionV5` shares a `SpeculationContext` between its local ranker and the optional remote uncovered-read fallback. It contains the current public frame, request revision, grounded goal hypotheses, full retrieved historical episode prefixes and resulting observations, argument provenance, transition statistics, confusion records and compatible workflow records. Local retrieval runs without a remote candidate call. Historical entity values remain examples and cannot authorize or bind a current invocation.

The candidate graph has a separate `nativeCandidateGraphV5` export capped at128. The original export retains its32-candidate limit and ordering. Current graph proposals and compatible workflow bindings are generated from a goal-neutral frame, so neutral versus conditional ranking can share the same pool. Completed identical reads are removed. The controller jointly normalizes candidate scores with `NO_READ` and `READ_UNCOVERED`; the latter records a missing useful read in the bounded proposal universe.

The portable linear model computes a neutral logit plus a goal residual multiplied by independently calibrated goal agreement. There are120 neutral features and72 goal features, with identical TypeScript/Python hashing. The neutral profile includes active historical observations/provenance/statistics. Candidate prior, hop and pattern metadata do not acquire unsupported learned meaning. Scheduler policy still enforces actual hops, binding validity and authorization.

Goal corrections require current request revision, scope and visible user-source references. A valid source reference establishes provenance, not semantic correctness. Without independent teacher agreement calibration the normal correction is exactly zero. An explicit experimental weight can exercise the residual in development diagnostics; it is labeled uncalibrated. Literal-request proxies cannot silently inherit calibration measured on inferred goals.

At most three ranked proposals reach admission. Deterministic eligibility and expected reuse utility are separate decisions. Utility is `candidateProbability * toolMs - validationMs - schedulingMs - predictionMs - contentionMs - contextMs`; there is no additional learned readiness or useful-within-two gate. No causal evidence-exposure benefit is inferred from imitation labels. Optional actor evidence still requires scheduler freshness validation and its separate512-token allowance.

The optional uncovered fallback is disabled unless configured. It requires an empty or uncovered-dominant pool and a declared opportunity greater than conservative remote-predictor overhead, with at most four calls. Its callback receives the same complete context. Returned arguments require current source proof and eligibility. Changed frames, invalidation and shutdown fence late predictions, and close drains the managed work. Sub-millisecond native reads provide no justification for an extra remote prediction call.

Actor context is independently configured as `none`, `literal` or experimental `hypotheses`; all use `actorContextMode='current-only'`. The default goal role is speculation. Literal obligations come from the separately maintained source ledger, not model guesses about completion or authorization.

## Frozen development artifacts

The local dataset is `research/goalspec/runs/local-controller-v5-dataset-20260916-b`. It contains239 public Base prefixes drawn only from previously permitted v4 training families; every confirmation cohort is excluded. Its166 fitting prefixes span11 observed families,53 selection prefixes span4 families, and20 temperature-calibration prefixes span2 families. Declared family partitions also contain families without eligible observed runs; the report distinguishes them.

`local-controller-v5-trained-20260916/controller.json` is the actual CPU-trained artifact. Its content hash is `83268825f8ddae3945eb670c2d2821c63c1388fcc2fd13eb067a79224d7d4092`. The neutral model selected epoch12 of120; the literal-request proxy residual selected epoch1 and provided no selection-fold gain. Accordingly semantic reliability is unavailable and the normal goal correction stays zero. Temperature calibration is distinct from architecture/epoch selection.

Every exported TypeScript feature vector was checked against Python during training and again by tests. `local-controller-v5-replay-20260916` retains239 prefixes across seven controls,1673 score rows, same-pool rankings, per-family results and separate first32-versus128 candidate coverage. Memory removal is a frozen-model ablation, not a retrained baseline. The experimental next-read oracle uses future action names only as an explicitly labeled diagnostic; it is not an oracle annotation of requested intent and never enters training.

These are reused development prefixes. Cross-entropy estimates are not true conditional entropy, calibration results are not held-out results, and replay provides neither native task success nor measured live latency.

## Teacher extension and new experience

The annotation input export contains exact public frames and `groupId`, `frameHash`, `prefixHash`, family/split and request-revision hashes. The teacher join requires the complete closed annotation cohort and exact hashes. Predicted goals, blind requested-goal annotations and independent agreement are separate records. Missing calls and explicit unknown goals remain masked for residual fitting; disagreement remains label0 and is never reinterpreted as factual falsity.

The optional teacher fitter freezes neutral weights and requires the joined goals to use that neutral model's exact dataset hash. It uses family-disjoint residual fitting, residual selection and semantic-agreement calibration; reliability folds are assigned before annotations. A prespecified single Laplace-smoothed reliability bin is used for the small pilot, and action cross-entropy fits temperature separately. The artifact records neutral fitting families separately from residual fitting, residual selection and reliability-calibration families. The neutral model may already have seen action labels in a goal-calibration family, so those families are not fully unseen. The report flags fewer than20 completed calibration rows and always describes the estimate as a small pilot with correlated prefixes. This estimates conservative annotation agreement, not semantic truth or execution benefit. No teacher fit should be dispatched before the annotation cohort closes.

The teacher join also accepts the explicit never-dispatched continuation protocol. It verifies the original closed input hashes and provider event chain, retains the original annotation bytes, checks every ordinal, and refuses to replace a previously attempted row. Rows with incomplete model calls remain in the declared cohort and are masked during fitting. Only rows proven to have no physical provider attempt can acquire a continuation result.

`goalspec-build-memory-v5.ts` accepts an explicit hashed build plan. It imports only closed Base training exports, excludes fresh calibration families before reading their traces, and admits prior v1-training examples only when also permitted by the historical training manifest. V5 memory never includes development or confirmation runs. Source files are hashed before and after export. Public observations and binding provenance remain complete; unverified native outcomes are excluded and counted. Fresh Base trajectories have no speculative prediction misses, so confusion labels are not fabricated. The legacy memory profile and its existing hashes are unchanged.

`goalspec-controller-v5-fresh-dataset.ts` accepts a separate hashed plan for one complete40-slot fresh Base training cohort, the permitted historical dataset and a frozen v5 memory artifact. Before reading outcome labels, it assigns the16 fresh learning families to12 fitting and4 selection families by a fixed hash; the four fixture calibration families remain calibration only. Every family has two variants. Public feature construction precedes next-action labeling. Private instructions, reference actions, final database fields and completion grades never become model inputs. Censored slots remain recorded as exclusions rather than being replaced.

The original239 public frame, group and prefix identities remain unchanged for existing teacher joins. Only the separately declared memory retrieval view uses the new snapshot; original scope and authorization fields are preserved. Retrieval is restricted to actual historical fitting families plus the12 fresh fitting families, excluding the current family. The new neutral artifact records families with observed fitting rows, not empty declared families. For a memory build, include the four new selection families in its explicit `heldoutFamilies` list as well as all other excluded families. The runtime should also use the neutral artifact's `trainingFamilies` as its memory allowlist.

The fresh training profile refits neutral weights from permitted old and new public prefixes. Its goal residual is zero and its goal labels are masked until an exact independent annotation join; it never invents teacher agreement for new trajectories. The original executed Python training source is preserved with its verified hash under `local-controller-v5-training-source-20260916` before adding the fresh profile. Existing weights and reports remain unchanged.

## Commands

```powershell
node --import tsx scripts/goalspec-controller-v5-dataset.ts NEW_DATASET_DIR
research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/train_controller_v5.py DATASET_DIR NEW_MODEL_DIR
node --import tsx scripts/goalspec-controller-v5-replay.ts DATASET_DIR CONTROLLER_JSON NEW_REPLAY_DIR
node --import tsx scripts/goalspec-controller-v5-teacher-join.ts DATASET_DIR CLOSED_ANNOTATIONS_DIR NEW_JOIN_DIR
research/goalspec/.venv/Scripts/python.exe research/goalspec/scripts/train_controller_v5_teacher.py BASE_CONTROLLER_JSON JOIN_DIR NEW_MODEL_DIR
node --import tsx scripts/goalspec-build-memory-v5.ts HASHED_BUILD_PLAN_JSON NEW_MEMORY_DIR
node --import tsx scripts/goalspec-controller-v5-fresh-dataset.ts HASHED_FRESH_PLAN_JSON NEW_DATASET_DIR
```

Outputs must be new paths; previous artifacts are never overwritten. The initial dataset builder has an explicit historical-source allowlist. Fresh source collection and experiment orchestration remain separate responsibilities.
