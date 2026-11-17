# GitHub Actions cleanup backend

This prospective backend reuses the unchanged `lambda_gpu_watchdog` state,
ownership, deadline, provider and termination functions. It cannot launch.
Two explicit jobs share GitHub's control plane; they are not independent regions.

Provision a dedicated private repository. The only workflow trigger is
`workflow_dispatch`. Use explicit `watchdog_a` and `watchdog_b` jobs with
`timeout-minutes: 350`, no push/PR/scheduled trigger, matrix fail-fast or
concurrency cancellation. Review the actual workflow bytes before deployment.
Pin its private commit/hash and all five worker-source hashes in the binding.

Each pair owns one immutable session and exact funded lease. `leaseIdentity`
contains leaseId, expectedName, planHash, reservedAt, setupDeadline and deadline.
`leasePolicy` is empty for ordinary leases, or the exact purpose and designated
recoveryControllerId for a ten-minute canary. Existing leases are not rewritten.
Use new `owner-state-<suffix>`, `watchdog-a-<suffix>` and `watchdog-b-<suffix>`
branches, suffix being the first twelve UUID characters without hyphens. Keep
earlier branches. State is `control/owner-state.json`; separate controller ACKs
are `control/ack.json`. An immutable signed `control/claim.json` prevents another
job from acting through that branch.

Actual API run/attempt/job/runner/start values determine controller lifetime.
Lease expiry must precede job start +330 minutes by at least300 seconds. Cleanup
continues until at most start +345 minutes, inside the350-minute job timeout.

```text
python github_gpu_watchdog.py --binding SIGNED_BINDING.json --controller-id CONTROLLER_ID --output NEW_LOCAL_EVIDENCE_DIRECTORY
```

The worker reads `ACEPHALE_WATCHDOG_HMAC_KEY` (canonical base64 of32 private
random bytes), `LAMBDA_API_KEY` and `GITHUB_TOKEN` from process environment only.
The job token needs contents write and Actions read. It is repository scoped;
assigned-branch restrictions are code guards, not claimed platform ACLs. Do not
run untrusted PR code or persist credentials in Git, arguments or artifacts.

`owner_record(binding,state,sequence,key,previous)` signs exact state and advances
the previous sequence. `GitHubStore.cas` requires the previous Git blob SHA.
The owner must retain normal current financial/ownership checks and actual
write/readback, without re-dating old observations. IDs, deadlines and canary
policy cannot change; readiness/status cannot roll back.

Owner publication targets30 seconds, worker polls20, and every newly observed
sequence forces an ACK. Without a new sequence, observed ACK refresh is40 seconds.
Nominal content writes for one active pair are about360/hour plus rare evidence.
Account for additional fence pairs separately. Respect actual rate limits; Retry-After
and reset defer GitHub requests without suspending exact cached-state cleanup.
These are nominal rates, not latency guarantees.

Startup pauses the parent after fresh publication. Both jobs must ACK that
exact signed record/hash/sequence before single-publisher handoff. Steady ACKs
may reference a locally known previous sequence. ACK age is at most60 seconds;
owner expiry remains120. Cleanup-only ACKs cannot establish health.

The new `control.watchdog_enrollments` branch checks signed binding/ACKs, fresh
actual API observation, distinct jobs/runners, current source/lease, remaining
job lifetime and prior actual canary recovery for that exact backend version.
It is prelaunch admission. Active phases must use the ready-dependent setup/hard
deadline rule, not this prelaunch helper. Existing AWS admission is unchanged.
Historical canary recovery and current research-job readiness are distinct.
A request alone is not recovery: exact termination acknowledgment and later
provider absence are required. Local tests never qualify live deployment.

Missing, malformed, unauthorized, rate-limited or unavailable reads preserve
only the last authenticated cleanup authority. They cannot renew heartbeat or
extend deadlines. Cleanup continues if evidence writes fail, retaining signed
local evidence for artifact export. Ambiguous ACK writes resynchronize only
after checking same actual job and signed sequence.

An unresolved old lease needs a separately typed
`acephale-github-unresolved-launch-fence-v1` receipt and signed backendMigration.
This retains the exact prior row/hash, AWS IDs, financial binding and holds,
and requires fresh actual absent-name observations from two qualified jobs.
Absence is not relabeled termination. Original AWS history remains intact.

A separate private fence repository may reuse actual canary qualification only
through a signed `acephale-github-qualification-transfer-v1` receipt. It binds
both repository identities, the destination assignment, exact public source and
workflow bytes, and hashes of both original recovery proofs. Fresh destination
API/job/provider observations remain mandatory. The new jobs are never described
as having performed those historical recoveries. An expired predecessor keeps
its original signed owner state; it does not need renewed owner publication.

GitHub documents the six-hour hosted-job ceiling in [Actions limits](https://docs.github.com/en/actions/reference/limits),
conditional previous-blob updates in the [Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents),
and actual runner/start identity in the [jobs API](https://docs.github.com/en/rest/actions/workflow-jobs).
Simultaneous runner/control-plane loss remains a shared failure mode. Financial
caps, holds, native allocations and model/data/scoring are unchanged.
