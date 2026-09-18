# User simulator completion guidance probe

The [six fixed cases](../../runs/local-v2-user-stop-probe-20260915/cases.jsonl) produced **6/6 expected marker decisions**, with **six completed responses, zero failures, $0.002799 known usage, and zero unknown provider attempts**. The [result report](../../runs/local-v2-user-stop-probe-20260915/results/report.json) and [full returned responses](../../runs/local-v2-user-stop-probe-20260915/results/results.jsonl) are preserved. This is a development prompt check, not a native cohort or heldout evaluation, and it does not change the original 24 outcomes.

The four archived pending-work turns now explicitly confirm or request proceeding without a terminal marker. Both completed-task controls thank the assistant and emit `###STOP###`. None emits a transfer or out-of-scope marker. All six cases were selected before dispatch using the [fixed manifest](../../runs/local-v2-user-stop-probe-20260915/manifest.json); the four failure cases were deliberately selected after the prior failures were observed, so this diagnostic is not an unbiased estimate of general simulator reliability.

The four pending-work cases are the first four premature-stop failures in native design order: suffixes `0011-085570d010b1`, `0012-edccac56851d`, `0017-1ce332c4caa4`, and `0018-cf1aed9cce54`. Controls are the first successful completed conversation in each domain: `0000-695ee8fa9f3b` and `0013-6e294418e7bf`.

[prepare_user_stop_probe.py](prepare_user_stop_probe.py) uses the pinned native `UserSimulator` policy and `state.flip_roles()` on the conversation immediately before the archived final user response. The target response is retained as evidence but excluded from model input. Actor tool exchanges are excluded from the user-visible history, matching the native user worker. Private scenario instructions remain only in the simulator's policy. The exact new guidance is produced by `native_live.build_user_policy`, then included once in each final policy.

[run_user_stop_probe.ts](run_user_stop_probe.ts) verifies the case and source hashes, uses the native user payload and token guard, and supports a no-provider validation mode:

```powershell
node --import tsx research/goalspec/reports/2026-09-15-local-v2/run_user_stop_probe.ts validate research/goalspec/runs/local-v2-user-stop-probe-20260915/cases.jsonl
```

Validation passed for all six cases, with native boundary token counts `[1135, 915, 1225, 1172, 1076, 1415]`, below the 8,064-token guard. No provider was called during preparation or validation. The runner uses pinned `gpt-4.1-mini-2025-04-14`, a 1,024-token output cap, zero retries, and concurrency one. It requires the existing shared budget journal and allocates to development; the six maximum request reservations sum to **$0.029496**.

The coordinator's guarded dispatch command is:

```powershell
node --import tsx research/goalspec/reports/2026-09-15-local-v2/run_user_stop_probe.ts run research/goalspec/runs/local-v2-user-stop-probe-20260915/cases.jsonl research/goalspec/runs/local-evaluation-20260914 research/goalspec/runs/local-v2-user-stop-probe-20260915/results
```

The runner records returned full responses, usage events, stop markers, failures, and expected-marker agreement. Pending-work cases expect no terminal marker; completed controls expect `###STOP###`. Marker agreement is not native grading and does not establish that a continuation would complete the task. Failed requests remain in the denominator, and no case is retried or replaced.
