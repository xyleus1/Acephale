# Post hoc inventory: seed17 opportunity generation06

This is a descriptive audit of retained public tool requests, not a new experiment, scientific metric or revised failure classification.

The generation06 cohort contains 20 declared profile checkpoints: eight retain status completed, and 12 retain actor_did_not_request_profiled_read. The 40 earlier startup-failure rows are separate retained cohorts and are excluded from this denominator.

**All 12 failed rows contain exactly one tool request in each of the baseline and concurrent actor responses. In every one, the requested tool differs from the profiled candidate.** None of these 12 is an empty-tool-call case or a same-tool/argument-only mismatch.

| Profiled candidate tool | Tool requested in both responses | Failed rows |
|---|---|---:|
| get_user_details | get_reservation_details | 9 |
| search_direct_flight | get_reservation_details | 1 |
| search_direct_flight | get_user_details | 2 |

Baseline and concurrent requests have identical tool names and arguments within each failed row; generated call IDs differ. The same semantic agreement is observed in the eight completed rows. This is a statement about candidate alignment at the retained checkpoint. It does not establish that the actor behaved incorrectly, that a customer task failed, that the requested alternative would succeed, or that either execution condition caused the mismatch.

The public fields supporting the inventory are candidate.invocation.tool and candidate.invocation.arguments, compared with actor_baseline.result.tool_calls and actor_concurrent.result.tool_calls. All 20 raw rows also set actorToolsExecuted=false, including the eight completed rows; that flag must not be interpreted as absence of an actor tool request.

The frozen producer at /srv/acephale/workspaces/operator/science-source/scripts/acephale-infra-native-profile.ts:194-196 requires a matching tool and argument hash in both responses, plus the configured nonmutating filter. The broader original error label is preserved. No new classification is substituted into the study artifacts.

The original aggregator /srv/acephale/workspaces/operator/science-source/research/acephale/src/acephale/infra_admission.py:172-173 requires at least ten completed measured checkpoints. Eight is below that unchanged gate; this cohort therefore yields no accepted opportunity estimate. This audit did not run the aggregator, compute latency/speedup statistics, make model calls, or change any criterion.

Exact per-row IDs, tool arguments, original labels, raw-file SHA256s and versioned S3 references are retained in:
/srv/acephale/workspaces/operator/opportunity-gen06-posthoc-01/posthoc-inventory.json
SHA256 7ee1d4b8a7bdb2a0e296779f98ebde963f38e49573b182a6a33d8290944c1717

Core sources:
- Generation06 result: SHA25663a713b4df5844a2df542412832db10e62aaf221c1531e5e0ba440b93c00f28c, S3 version9.wUgEr_ma9.Wang3.d7nxOEx3h6MA.c.
- measurements.json: SHA25641d8f3de2b114220b3789ddee28a43069582acd2cc67982ac22aa8ff16a7b6ed, S3 version3JDILUXzZGLvWsI7.bZqOwXcQrWp4Fsa.
- profile-plan.json: SHA25648bfbc499fface20ceadd519f56124ee16e6d43c1fcc73b4191e10c765eaf109, S3 versionYgPIv3zT4PnMoiFDt58i7uFUBps80cQF.
- Original profile producer: SHA2561b9c41de96261e4900136644b9a1c5ca90e6e82ad525e83b9bf3d19b96caf564.
- Original aggregator: SHA256b6367cf0291286acecfd75a82ce9b0fef02e1b78b29bd7bf8a73d8d0a2f3f804.

Suggested wording: A post hoc inspection of retained public responses found that all 12 profile failures requested a different tool from the selected profiling candidate in both paired responses. Their tool names and arguments agreed across the pair. This describes candidate alignment at those checkpoints, not task correctness, and the eight completed rows did not meet the frozen minimum of ten for opportunity aggregation.
