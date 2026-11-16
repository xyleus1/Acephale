# Evaluation operator repair

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
