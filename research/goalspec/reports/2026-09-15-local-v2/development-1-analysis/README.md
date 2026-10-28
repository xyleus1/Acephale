# GoalSpec local v2 study

Custom tau-compatible pilot with separate development rounds and at most one confirmation cohort.

The earlier development protocol smoke produced 12/12 valid predictions and 8/12 teacher-scored complete-request matches. That score preceded the latest identity-preservation prompt fix. No post-fix prediction score is supplied.

Every declared outcome, including failures, stays in its own stage. V1 scores are historical context, not a paired causal comparison on these new tasks. Development and confirmation stages are never pooled. No improvement claim is inferred from protocol validity.

## development-1

| Arm | Success / n | Success % [family CI] | Native mean ms (n) | Total mean s (n) | Drain mean s (n) | Known usage USD | Unknown cost trials |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| base | 0/8 | 0.00 [0.00, 0.00] | 5372.242 (8) | 5.401 (8) | 0.029 (8) | 0.010841 | 0 |
| neutral_memory_prefetch | 0/8 | 0.00 [0.00, 0.00] | 24.332 (8) | 0.056 (8) | 0.032 (8) | 0.000000 | 0 |
| goalspec | 0/8 | 0.00 [0.00, 0.00] | 10766.883 (8) | 10.799 (8) | 0.032 (8) | 0.013314 | 0 |

Native time ends before managed-worker drain. Total time includes that drain. Sample counts include failed trials with recorded times. Per-trial sums overlap under concurrency and are not phase wall time. Known usage is a lower bound when costs remain unresolved, and is not invoice reconciled.

| Comparison | Success gain pp [family CI] | Native time saved ms [CI] | Total time saved s [CI] |
| --- | --- | --- | --- |
| neutral_memory_prefetch versus base | 0.000 [0.00, 0.00] (n=8) | 5347.910 [-11.59, 10707.41] (n=8) | 5.345 [-0.02, 10.71] (n=8) |
| goalspec versus base | 0.000 [0.00, 0.00] (n=8) | -5394.640 [-21487.86, 10698.58] (n=8) | -5.398 [-21.49, 10.70] (n=8) |
| goalspec versus neutral_memory_prefetch | 0.000 [0.00, 0.00] (n=8) | -10742.550 [-21480.36, -4.74] (n=8) | -10.742 [-21.47, -0.01] (n=8) |

| Arm | Physical reads (n) | Speculative reads | Exact-call promotions | Unmatched reads | Scheduler rejections | Drain failures | Valid / observed goal contexts | Nonunknown contexts | Failed / settled cycles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 0 (8) | 0 | 0 | 0 | 0 | 0 | N/A | N/A | N/A |
| neutral_memory_prefetch | 0 (8) | 0 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0/0 |
| goalspec | 0 (8) | 0 | 0 | 0 | 0 | 0 | 2/2 | 0 | 2/2 |

Physical reads exclude mutations and lease checks; unavailable transcript/counter reconciliations stay unmeasured. Exact-call promotions are a lower bound on usefulness; unmatched reads are an upper bound on waste. Goal validity establishes structure and current-source references only. Cycle-completed events include failed cycles. Scheduler rejection reasons, candidate admission rejections, and predictor contract rejections are separate JSON diagnostics.

### Task diagnostic panels

These per-trial diagnostics support development decisions. They do not replace the complete cohort comparison above. User-message excerpts and final replies are capped at 1,200 characters here; full text and tool arguments remain in summary.json.

<details><summary>airline:v2_retime_and_name / variant 0 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 42537.274 ms. Total: 42.560 s. Drain: 0.023 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0000-232e70c787d9.json).

Public user messages:

> Hello! I would like to make some changes to one of my reservations, G116192901A. Can you assist me with that?

Final assistant reply:

> {"message":"Yes. To help modify reservation G116192901A, please provide your user ID and tell me what you want to change: flights, cabin class, checked bags, or passenger information."}

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_retime_and_name / variant 0 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 14.069 ms. Total: 0.034 s. Drain: 0.020 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0001-90d77ca612e0.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_retime_and_name / variant 0 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 17.266 ms. Total: 0.043 s. Drain: 0.025 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0002-4ccf06d7aeb0.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_retime_and_name / variant 1 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 43401.773 ms. Total: 43.420 s. Drain: 0.018 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0003-0276cefb527e.json).

Public user messages:

> Hello! I would like to move my reservation G145928797A to a later flight, HAT1459287972 on May 21, 2024. I want to keep the economy class and one bag, and I am okay with paying the $40 difference using my Visa card. Also, could you correct the passenger surname from Chen to Cheng while keeping the first name Mira and the date of birth as June 12, 1988? Please note that reservation G145928797B should remain unchanged.

Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_retime_and_name / variant 1 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 21.519 ms. Total: 0.043 s. Drain: 0.021 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0004-c986537a7c4f.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_retime_and_name / variant 1 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 47.663 ms. Total: 0.110 s. Drain: 0.062 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0005-4138f4123c08.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_two_reservation_cabin_changes / variant 0 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 42833.980 ms. Total: 42.855 s. Drain: 0.021 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0006-17c1bc7fe569.json).

Public user messages:

> Hello! I have a couple of requests regarding my flight reservations. Could you assist me with moving one of my reservations to a different flight and upgrading another one?

Final assistant reply:

> {"message":"Yes. I can help with both requests. Please provide your user id and the reservation id for each reservation. For the reservation you want to move to a different flight, also share the new flight details you want if you know them. For the reservation you want to upgrade, tell me which cabin class you want."}

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_two_reservation_cabin_changes / variant 0 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 14.080 ms. Total: 0.033 s. Drain: 0.019 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0007-6302441e6cd1.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_two_reservation_cabin_changes / variant 0 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 33.972 ms. Total: 0.083 s. Drain: 0.049 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0008-93e85c73c1b9.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_two_reservation_cabin_changes / variant 1 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 31.195 ms. Total: 0.095 s. Drain: 0.063 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0009-70098f7a2a48.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_two_reservation_cabin_changes / variant 1 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 20.775 ms. Total: 0.055 s. Drain: 0.034 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0010-7ce9cd989dc7.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>airline:v2_two_reservation_cabin_changes / variant 1 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 20.832 ms. Total: 0.047 s. Drain: 0.026 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0011-8dbe6571bb86.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_payment_and_default_scope / variant 0 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 25.974 ms. Total: 0.064 s. Drain: 0.038 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0012-02a1d07517c7.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_payment_and_default_scope / variant 0 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 34.916 ms. Total: 0.064 s. Drain: 0.029 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0013-e9601944a030.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_payment_and_default_scope / variant 0 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 17.129 ms. Total: 0.036 s. Drain: 0.019 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0014-335c305165a0.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_payment_and_default_scope / variant 1 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 25.159 ms. Total: 0.059 s. Drain: 0.034 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0015-d2bb8bf9d3be.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_payment_and_default_scope / variant 1 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 17.203 ms. Total: 0.044 s. Drain: 0.026 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0016-c10b51997e4d.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_payment_and_default_scope / variant 1 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 17.962 ms. Total: 0.049 s. Drain: 0.031 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0017-e72f49976e11.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_subset_return_and_cancel / variant 0 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 15.645 ms. Total: 0.039 s. Drain: 0.023 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0018-2ccc3fc6e0af.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_subset_return_and_cancel / variant 0 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 22.427 ms. Total: 0.045 s. Drain: 0.023 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0019-f9170edce972.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_subset_return_and_cancel / variant 0 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 74.370 ms. Total: 0.108 s. Drain: 0.033 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0020-1eb307d3761a.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_subset_return_and_cancel / variant 1 / trial 0 / goalspec: failure</summary>

Termination: `execution_error`. Native: 15.709 ms. Total: 0.050 s. Drain: 0.034 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0021-784754162e52.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_subset_return_and_cancel / variant 1 / trial 0 / base: failure</summary>

Termination: `execution_error`. Native: 26.440 ms. Total: 0.060 s. Drain: 0.033 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0022-25a1e2ab7db5.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

<details><summary>retail:v2_subset_return_and_cancel / variant 1 / trial 0 / neutral_memory_prefetch: failure</summary>

Termination: `execution_error`. Native: 20.330 ms. Total: 0.059 s. Drain: 0.039 s. Physical reads: 0. [native record](../../../runs/local-v2-development-1-20260915/v2-df424bd6f3-development-1-0023-d7715d29be9f.json).

Public user messages:


Final assistant reply:

> Hi! How can I help you today?

Tool sequence: 

Independent verdict: `{"stateMatch": false, "communicationMatch": true, "constraintViolations": 0, "violations": []}`

</details>

Intervals reuse evaluation_v1.py: 2,000 default percentile bootstrap draws of complete families within domains, equal domain and family weights. These exploratory 95% intervals are unadjusted for multiple comparisons; small family counts limit inference.
