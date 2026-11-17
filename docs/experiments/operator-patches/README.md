# Evaluation operator repairs

## Prepared S3 transport retries

[`20261116-heartbeat-sdk-retry.patch`](20261116-heartbeat-sdk-retry.patch) changes
one Config call to [standard SDK retries](https://docs.aws.amazon.com/boto3/latest/guide/retries.html)
with three total attempts. Connect/read timeouts remain three seconds. The public
publisher, outer retry policy, ownership checks and watchdog are unchanged.

Thirteen cases use the actual owner SDK, signing and transport-retry code with
intercepted HTTP responses. They cover both controllers, GET recovery, identical
PUT bodies after uncertain commits, exhaustion, authentication errors and
authority/deadline rejection. These tests do not claim live retry execution or
repair of every streaming-body failure. The
[byte verification manifest](20261116-sdk-retry.json) records the original and
repaired helper hashes; applying the patch reproduced the reviewed bytes exactly.

## Serving file argument and heartbeat acknowledgement

[`20261116-serving-path.patch`](20261116-serving-path.patch) converts the module
filename to `Path` before passing it to the existing strict file hasher. The
original code failed before serving SSH or model execution. Seven local cases
exercise the actual preparer and transport entry against the retained export,
with remote effects intercepted.

[`20261116-heartbeat-ack.patch`](20261116-heartbeat-ack.patch) separates a timely
child heartbeat's arrival from its subsequent verification. Arrival remains
bounded by the original 90 seconds. Both parent and child derive acknowledgement
expiry from the child's heartbeat plus 60 seconds, clamped to original host
deadlines. The patch retains actual two-controller readbacks and all record,
ownership and cancellation checks. Seventeen cases pass; operation timing is
simulated from the retained arrival/cancellation scenario, not measured S3 latency.

The [verification manifest](20261116-repairs.json) records original and repaired
file hashes. Both patches were applied to fresh copies with
`git -c core.autocrlf=false apply`; every resulting byte hash matches the reviewed
file. These operational fixes do not change model weights, scoring or numerical
tolerances, and their tests are not benchmark results.

## Dataset envelope

[`20261116-dataset-envelope.patch`](20261116-dataset-envelope.patch) is the exact
change to the study's `prepare_evaluated_main_v2.py` helper. It is published as an
operator patch because the surrounding run configuration contains private local
paths and credential-loader locations. The patch contains no credential values.

The extractor retains `inventory.json` beside five dataset payloads. The old
producer froze only the payloads, so the strict export host rejected the sixth
file before model execution. The repair verifies the previously approved archive,
binds its exact inventory hash and requires complete six-file coverage. It neither
uploads a replacement inventory nor relaxes the consumer's integrity checks.

| File identity | SHA-256 |
| --- | --- |
| Original helper | `5a925da4a4a39462d7f94f77288f2c3313030b68acacdb22ea4c9fadc0817c71` |
| Repaired helper | `70dbbdd8a3607c674bf92220d949db8eddc4edfeaa24d038b0162fe90e5cb7d8` |
| Approved dataset inventory | `cb3b015151bc74ac7e52a4c621d452306aa0d87ebc7e6d73c47217bb01a656cb` |

Applying the patch with `git -c core.autocrlf=false apply` to the original helper
reproduced the repaired bytes exactly; automatic CRLF conversion must be disabled
when checking these byte identities.
Eight independent regressions used the real retained archive, extractor and
producer with the exact strict-host completeness loop: the original defect was
reproduced, the repaired binding passed, and six tampering cases were rejected.
The existing 60 export tests also passed. Historical authorization times are
explicit test fixtures, not evidence of current cloud authority.

This is a packaging repair. GPU export, vLLM qualification and benchmark results
remain separate gates; these tests establish no accuracy or latency improvement.
