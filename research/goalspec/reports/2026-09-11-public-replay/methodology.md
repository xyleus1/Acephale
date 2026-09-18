# Public trajectory replay: frozen methodology

This is a diagnostic evaluation of next-action prediction on published, real agent trajectories. It is the first empirical stage of GoalSpec, before speculative execution. The protocol and defaults below were selected before prediction metrics were inspected. Development and test partitions use the same frozen configuration; this run does not tune on development results and then reuse test results for further selection.

The benchmark identity is `tau3-public-replay`. This distinction preserves the recorded benchmark versions and the limitations of reconstructed public context. It does not claim a new live run of the current native benchmark.

## Sources and provenance

The corpus contains four trials for each of 375 tasks, giving 1,500 trajectories. Three domains use Sierra's published GPT-5.2 submission; banking uses Sierra's published GPT-5.6-sol submission. Each published trajectory is replayed unchanged across predictor conditions. Different actors across domains prevent interpreting pooled results as a comparison of actor model capabilities.

| Domain | Published trajectories | Recorded actor source revision | Tasks | Trials |
| --- | --- | --- | ---: | ---: |
| Airline | [GPT-5.2, February 26 submission](https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/gpt-5-2_sierra_2026-02-26/trajectories/gpt-5.2_high_airline_gpt-5.2_4trials.json) | `7324fb57cb6819e77937c79964db916f5b068e31` | 50 | 200 |
| Retail | [GPT-5.2, February 26 submission](https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/gpt-5-2_sierra_2026-02-26/trajectories/gpt-5.2_high_retail_gpt-5.2_4trials.json) | `7324fb57cb6819e77937c79964db916f5b068e31` | 114 | 456 |
| Telecom | [GPT-5.2, February 26 submission](https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/gpt-5-2_sierra_2026-02-26/trajectories/gpt-5.2_high_telecom_gpt-5.2_4trials.json) | `c60471675690a1f26cdb8419dbb7ed2142f149d1` | 114 | 456 |
| Banking knowledge | [GPT-5.6-sol, August 4 submission](https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/gpt-5-6-sol_sierra_2026-08-04/trajectories/banking_knowledge_results.json) | `fc0055dc4e0a316c3f83133267fbd6faaa770992` | 97 | 388 |

The source files are identified by these SHA256 digests, in the same domain order:

```text
airline  308a133d880def1326ea60a2e0a946e0992c2f9e54b8e4711c2947f24b26c9fb
retail   76ad0d0a0c9b7f96cd07e8ab7efda68a266ef6d9fda74620abdad57de64e0449
telecom  8c33f26a3032182d39a12511db9d45a2cbd9aa5c33d99a462cc23c836eb95176
banking  614cdc47ae910fb97936c839e59cf43ec087f9c3c548af395159ea751759c292
```

Official submission metadata reports evaluator version `1.0.1`. The metadata contains later evaluation and regrading notes, so a submission directory's date is not a guarantee of the current files' evaluation date. The importer preserves native rewards and termination reasons without independently regrading them. Source and submission hashes are retained in each trajectory's provenance and the report manifest.

The releases omit their exact actor tool definitions. Public catalogs and agent scaffolding are reconstructed from [the official source at `2174a603f6d014ef94473ffa95957f6ce27100db`](https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db), using source definitions independently of future actor actions. Recorded policies and visible messages are preserved. Observed calls are audited against the reconstructed schemas; schema compatibility cannot establish historical prompt or catalog equivalence. Telecom and banking recorded revisions resolve publicly; the recorded airline/retail revision did not resolve in the source audit. No recorded revision is silently replaced with the reconstruction revision.

A [separate source-equivalence audit](native-catalog-source-audit.json) compares the public historical files against the reconstruction checkout after normalizing line endings. All 13 banking catalog-related source files match. Ten of 11 telecom files match; only `environment.py` differs, while the tool representation, toolkit, agent instructions, and domain tools match. The audit preserves source URLs and both raw and normalized hashes. This narrows the reconstruction uncertainty for those domains without proving an identical serialized actor catalog or dependency environment. The public-release benchmark identity and native-gate restriction remain unchanged.

The local run root is `runs/public-pilot-20260911/`. Its `sources/{domain}-source-audit.json`, catalog files, endpoint audit files, `public-cohort-manifest.json`, and `split.json` identify the exact inputs. Raw trace files remain local artifacts. The result manifest records hashes for reproduction without placing full conversations in the repository.

## Endpoint labels and independent task families

`native-terminal-semantics-v1` builds offline labels from native evaluator task definitions, not from the realized actor action sequence, success, or failure. Explicit domain mappings translate reference writes into normalized business completion predicates. Read-only lookups and setup actions do not define the endpoint. Telecom labels use the evaluator's terminal environment assertions, allowing different repair paths to share an endpoint. Independent effects commute; repeated effects collapse; contradictory writes to the same object and terminal field retain the final value. Composite endpoints retain multiple business effects.

| Domain | Tasks with a supported endpoint | Tasks without one | Inferred request families | Prediction split |
| --- | ---: | ---: | ---: | --- |
| Airline | 27 / 50 | 23 | 50 | Included |
| Retail | 107 / 114 | 7 | 103 | Included |
| Telecom | 114 / 114 | 0 | 3 | Excluded before fitting |
| Banking knowledge | 95 / 97 | 2 | 93 | Included |
| Total | 343 / 375 | 32 | 249 | 1,044 trajectories included |

Annotation status is `automatic_semantic_proxy_requires_review`. These are deterministic semantic proxies, not independently human-annotated gold goals. Unsupported operations and exclusively informational or refusal endpoints remain explicitly unlabeled. This particularly limits airline coverage. The mappings do not exhaustively represent natural-language evaluator assertions, all policy constraints, object cardinalities, numeric targets, or secondary state changes. They can merge distinct requests or fragment semantically related ones. Any future reviewed ontology requires a new version and a new evaluation; the current labels are not revised in response to results.

The oracle condition receives the offline proxy endpoint, so it is a proxy-oracle diagnostic rather than a ground-truth-goal upper bound. Unlabeled tasks remain in prediction scoring and actor outcome reporting. Goals absent from successful training data map to `__unknown__`, which falls back to the unconditioned predictor. They are reported separately from tasks with no supported label. Goal accuracy is only defined where an offline label exists.

Split groups use explicit template IDs when available. Otherwise they join exact or near-duplicate normalized user-scenario requests, masking instance identifiers and using token-sequence similarity at least `0.92`. This grouping happens offline and is never sent to the predictor. It does not group by goal ID or by customer ID. The latter would incorrectly join telecom tasks that reuse customers, while grouping by goal ID would prevent evaluation of new requests with a known endpoint. These inferred families are a conservative duplicate-control heuristic, not verified semantic template identities.

Telecom collapses to three repeated request families, below the existing minimum of five independent families per domain. Its 456 trajectories are excluded from prediction fitting and scoring before looking at results. Dividing those near-duplicate families to manufacture independent partitions would weaken the evaluation. All 1,500 trajectories remain in descriptive actor outcome reporting.

The other 1,044 trajectories are split by family within domain with seed `42` and fractions `0.6/0.2/0.2`. Hash ordering determines the assignment. Every task's four trials and every linked family stay together. The resulting partition sizes are 616 training, 204 development, and 224 test trajectories. The goal catalog uses successful training trajectories with supported endpoints and deduplicates identical initial-context examples. The unconditioned pattern pool also includes successful training trajectories without endpoint labels; goal-conditioned patterns use the labeled subset. Held-out failures and infrastructure errors are retained for the observable prediction steps they contain; a trajectory with no tool request contributes no invented prediction example.

## Predictors and frozen configuration

The workflow predictor is an independent PASTE-style implementation, inspired by the paper's pattern mining and symbolic argument dependencies. It is not the authors' serving stack or a verified reproduction of their published baseline. The experiment isolates endpoint conditioning within this shared implementation. [PASTE paper, version 3](https://arxiv.org/abs/2603.18897v3).

| Component | Frozen setting |
| --- | --- |
| Pattern context | PrefixSpan structural subsequences; maximum length 3; history window 12 |
| Support | At least 2 independent task families; repeated trials do not create independent support |
| Probability smoothing | 0.5 |
| Argument inference | Shared deterministic symbolic binder; validated training mappings with independent-family support |
| Lexical goal backend | Existing lexical model, including initial and dynamic posterior conditions |
| LLM goal backend | `gpt-5.6-sol`, reasoning effort `high`, initial posterior only |
| LLM calibration | Temperature 1.0, no fitted calibration |
| CLI capture | Version `0.153.4`; one request per subprocess; four concurrent workers |
| Paired uncertainty | 2,000 domain-stratified family bootstrap replicates; seed 42; 95% interval |

Before held-out scoring, an unfinished fit was replaced with a fit-local reference-map cache to make training practical. The cache retains mappings only for argument roots and subtrees that the unchanged learner can query, with a 32 MiB map budget and an 8 MiB wanted-value budget; overflow restores uncached behavior. A [separate engineering profile](cache-profile.json) verifies byte-identical complete pattern pools against the frozen uncached implementation on 12 long training trajectories. Its timing describes offline fitting only, not agent latency or prediction quality. Scientific settings and the frozen cohort were unchanged.

Each predictor receives the same safe trajectory prefix, shared structural context, available tool catalog, and argument binder. Predictions are scored against the same withheld actual next call. Immediately preceding assistant prose that may announce an upcoming call is withheld at the decision boundary. Calls in one native parallel batch share a single pre-batch prefix; sibling calls and results cannot inform each other.

Conditions are unconditioned PASTE-style prediction, proxy oracle, inferred initial goal, inferred dynamic goal where supported, and shuffled controls for oracle, initial, and dynamic goals. Shuffling permutes donor tasks within domain and keeps their repeated trials coupled. It tests task-specific endpoint information while preserving the marginal label or posterior distribution. The cached LLM backend freezes its initial posterior throughout replay; its `goalspec` and `goalspec_initial` conditions therefore coincide and do not constitute two independent results. The lexical backend separately evaluates posterior updates from later public observations.

LLM classification uses an existing authenticated CLI without reading, copying, or exporting credentials. Each invocation starts an ephemeral session in a fresh temporary directory, ignores user configuration, disables web search and tool features, and requests schema-constrained JSON. The subprocess receives only one request's initial public observations, policy, reconstructed tool catalog, and training-derived goal signatures. It receives no hidden user scenario, evaluator criteria, label, task identifier, future tool result, repository content, or other request. A tool event, incomplete output, unexpected goal ID, or invalid probability distribution invalidates the capture. Exact prompts, outputs, model/version, usage, and artifact hashes are recorded. This is a classifier call, not a benchmark actor rerun.

## Estimands and interpretation limits

The primary quantity is held-out next-tool negative log likelihood in natural-log units. It estimates cross-entropy under each bounded predictor, not the true conditional Shannon entropy of the environment. We report the paired change from the unconditioned predictor and its interval. Tool likelihood uses a probability floor of `1e-12`. Within each domain, steps are averaged within trials, trials within tasks, and tasks equally; domains receive equal weight. The bootstrap resamples whole request families, preserving correlated steps and trials.

Lower model-distribution entropy alone is not evidence for the hypothesis: a more confident incorrect predictor can have lower entropy. Likewise, an inferred goal computed from the full available context adds no new information in the unrestricted information-theoretic sense. It may improve prediction by providing a useful representation for a bounded workflow model. Oracle conditioning assesses endpoint predictability for this implementation and annotation scheme, with its training support and fallback limitations.

Secondary diagnostics include tool Top-1/Top-3, exact tool-plus-argument matches, initial goal Top-1/Top-3, unknown-goal coverage, and breakdowns by domain, depth, and confidence. Micro step diagnostics are labeled separately from the primary macro estimator. Native actor success and pass^k describe the published actor, with pass^k meaning success across all k trials. Native infrastructure exclusions and a conservative full-cohort denominator are reported explicitly. Scored failures are not silently removed, and unresolved outcomes are not invented.

The exploratory figure script fixes depth bins at 0-4, 5-9, 10-14, 15-19, 20-29, and 30 onward; maximum initial-goal probabilities use width-0.2 bins with 1.0 included in the final bin. Confidence includes the unknown-goal class. Both inferred and proxy-oracle advantages use those same inferred-confidence bins. Plots average paired call losses within each domain and bin, display observed bins only, and include no confidence interval. They do not substitute for the primary family-cluster analysis or establish a causal effect of confidence.

No speculative tools execute during replay. Prediction matches are not executed speculation hits, and no latency savings, useful/wasted execution ratio, throughput improvement, or changed actor task success can be inferred. Missing native tool timing stays null. Classifier capture time is measured overhead for this experiment, not a serving-system speedup. Public reconstructed-context evidence cannot authorize the native scheduler gate even if prediction thresholds are met.

The full proposed comparison remains unfinished: Salesforce-memory conditions, GoalSpec plus memory, the opportunistic scheduler, and live actor guidance are not evaluated here. ToolSandbox, PlanBench-XL, BFCL V4, GTA-2, DeepResearchBench, SWE-bench, and ScholarQA have not been run. The strongest conclusion available from this stage concerns the value, or lack of value, of endpoint conditioning for fixed public trajectories under the stated label and context limitations.
