# Development round 2: outcomes and failure diagnosis

All **24 declared trials** remain in the [stage analysis](development-2-analysis/README.md): base succeeded on **5/8**, neutral memory prefetch on **6/8**, and GoalSpec on **6/8**. There were no recorded constraint violations. These are development observations over four families, with two instances per family and one trial per instance and arm. Round 2 reuses round 1's four family compositions with fresh values and seeds; the rounds do not provide eight independent families. Confirmation families remain separate.

| Arm | Success | Family CI | Mean native ms (n=8) | Mean total s (n=8) | Mean drain s (n=8) | Known usage USD | Unknown-cost trials |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Base | 5/8 | [0.25, 1.00] | 25,887.962575 | 26.012888 | 0.124922 | 0.391425 | 0 |
| Neutral memory prefetch | 6/8 | [0.50, 1.00] | 37,872.894913 | 37.975803 | 0.102904 | 0.582876 | 1 |
| GoalSpec | 6/8 | [0.50, 1.00] | 38,291.384625 | 38.319658 | 0.028270 | 0.601599 | 0 |

GoalSpec's success difference versus base was +0.125, with family bootstrap CI [-0.50, 0.75]; versus neutral it was 0.00, CI [-0.50, 0.50]. Its mean total duration exceeded base by 12.306770 seconds, CI [-2.896326, 27.509866], and neutral by 0.343856 seconds, CI [-14.870359, 15.558071]. These duration differences are treatment minus baseline; the machine-readable analysis expresses the opposite sign so positive values favor the treatment. All intervals use the unchanged v1 family-cluster calculation: equal domain and family weights, 2,000 draws, seed 42. They are exploratory and unadjusted for multiple comparisons. The observations do not establish a GoalSpec success or latency improvement.

All actor/user worker drains succeeded. Whole service wall time was **316.444081 seconds**, with a final service drain of **0.583046 seconds**. Native time ends at trial termination before worker drain; total time adds that drain. Durations include failed trials. The first three orchestrations started during Node service boot and ledger reconstruction, so those trials include startup wait. The three parallel paired blocks begin at design indexes 0, 3, and 6, with two GoalSpec trials and one neutral trial. Startup overhead therefore differs across arms. No observed time was subtracted or rewritten. Overlapping trial-duration sums are not phase wall time.

The provider event log establishes **$1.575900 known usage**. The native summary's $1.514077 is the sum of fully measured trial rows and excludes the whole unknown-cost trial, including **$0.061823** of its observed priced responses. That known partial amount is included here, while the trial's full charge remains unknown. These are configured usage prices, not invoice-reconciled amounts. Cost contrasts involving neutral use seven complete pairs; they do not impute the missing full charge.

Six of the seven failures share a concrete trace pattern: the actor summarized the requested actions and asked for confirmation; the simulated user confirmed and appended `###STOP###`; the native simulator terminated before the actor executed any requested write. Each has `user_stop`, `stateMatch=false`, `communicationMatch=true`, and zero reported constraint violations. They remain primary failures, and no counterfactual successful outcome is assigned.

| Run suffix | Arm | Family / variant | Requested change that remained unexecuted |
| --- | --- | --- | --- |
| `0011-085570d010b1` | Base | Two reservation cabin changes / 1 | Retime one reservation and upgrade the other |
| `0012-edccac56851d` | GoalSpec | Payment and default scope / 0 | Change order payment and default address while preserving order shipping |
| `0017-1ce332c4caa4` | GoalSpec | Payment and default scope / 1 | Change order payment and default address while preserving order shipping |
| `0018-cf1aed9cce54` | Base | Subset return and cancel / 0 | Return the named item, keep the other item, and cancel a separate order |
| `0022-15308d507db7` | Base | Subset return and cancel / 1 | Return the named item, keep the other item, and cancel a separate order |
| `0023-eb5d1f00ec38` | Neutral | Subset return and cancel / 1 | Return the named item and cancel a separate order |

The seventh failure was neutral run `0006-a12de0d70ed8`, two reservation cabin changes / variant 0. After confirmation, the actor called `update_reservation_flights` for reservation A, but no corresponding update for reservation B appears. The next actor `model_attempt_failed` event records generic `Error`, 371 ms latency, a retained reservation, and null status, request ID, code, and cause code. The native exception is `RuntimeError`. These records establish an actor model-attempt failure and unresolved charge; they do not establish its underlying transport, provider, or local cause. State matching failed and communication matching passed, with zero constraint violations.

The frozen error formatter retains `error.name` and `request_id`; these can omit the SDK's error subclass and camelCase `requestID` metadata. Generic `Error` and a null request ID therefore provide limited diagnosis. The cause cannot be recovered from the saved fields, and the charge remains unresolved. Better future error metadata would improve diagnosis without changing this task outcome.

The two failed GoalSpec runs had compound goals covering order payment, default address, and preservation of existing order shipping. Their actor confirmation summaries also retained those actions and the no-apartment requirement. One intermediate adopted goal in run `0017-1ce332c4caa4` omitted the literal no-apartment constraint, although its first and later goal responses included it. The later response restored this detail after the user repeated it. This is a semantic omission in an otherwise structurally valid goal, but the observed termination happened on user confirmation before any write; it does not demonstrate that the omission caused the failure.

| Diagnostic | Base | Neutral | GoalSpec |
| --- | ---: | ---: | ---: |
| Physical authoritative reads | 28 | 15 | 27 |
| Physical speculative reads | 0 | 35 | 18 |
| Total physical reads | 28 | 50 | 45 |
| Exact-call useful promotions | 0 | 13 | 1 |
| Unmatched speculative calls | 0 | 22 | 17 |
| Scheduler rejections (duplicate) | 0 | 4 | 1 |
| Native freshness lease checks | 0 | 21 | 3 |
| Physical revalidation calls | 0 | 0 | 0 |
| Saved valid actor goal contexts | N/A | 70/70 | 67/67 |
| Nonunknown actor goal contexts | N/A | 0/70 | 33/67 |
| Goal model responses | 0 | 0 | 27 |
| Prediction cycles started / settled / failed | N/A | 70 / 70 / 0 | 63 / 63 / 0 |

All eight GoalSpec runs had at least one nonunknown actor goal context. No goal or candidate prediction-rejection event was recorded. Goal validity means canonical shape, finite normalized mass, and resolvable source references in the same frame; it is not a teacher semantic score. Settled cycles include failures by definition, so the explicit zero failed-cycle count is necessary. Candidate admission rejections are separate from scheduler rejections: neutral had 158 `invalid_low_confidence_or_already_observed` and four with no admission reason; GoalSpec had 83 and one respectively. They are not pooled with predictor or scheduler failures.

Read counts exclude writes. Exact-call promotions provide a lower bound on useful speculation; unmatched calls provide an upper bound on waste. GoalSpec's lower exact-call reuse in this cohort is a diagnostic observation, not proof that a particular goal or filtering decision caused the difference. The full per-trial public task messages, actor tool sequence, timing, and independent verdict remain in [summary.json](development-2-analysis/summary.json). Selected failure and goal events, source hashes, and explicit classification criteria are retained in [diagnostic evidence](development-2-diagnosis-evidence.json). Raw outcomes and provider events were not modified.
