# Lambda host bootstrap

This is the previously exercised Linux bootstrap, moved into the repository so
each experiment can bind it to its own committed source. It does not rent a GPU,
reserve money, create a watchdog, or assert provider readiness.

The controller first reserves and launches a lease, pins the SSH host key, and
records its actual provider receipt. It also collects the Windows orchestrator
inventory from the same clean source commit. Stage those two receipts beside
`bootstrap.py`, `bootstrap.sh`, `serving-qualification.mjs`, and
`images.pinned.json` on the newly rented host.

Pass a new JSON configuration to `bash bootstrap.sh CONFIG`:

- `schemaVersion`: `2`.
- `sourceCommit`: the exact committed revision running on the orchestrator.
- `leaseId`, `setupDeadline`, and `hardDeadline`: copied from the funded lease.
- `hardwareProfile`: `a100-40gb-v1`.
- `providerReceipt` and `orchestratorInventory`: receipt filenames in this directory.
- `operatorFiles`: a mapping of the four staged operator filenames to their SHA-256 hashes.

Configuration validation runs before host setup. Bootstrap checks these same
operator bytes against the cloned commit, then verifies pinned models, image
digests, isolated networks, actual model calls, protocol continuation, binary
logprobs, database identity and telemetry. Setup is bounded by the lease's
30-minute setup limit; the provider deadline must stay within eight hours.
The independently managed watchdog remains responsible for termination.

The image lock retains the previously observed image identities. It is an input
to verification, not evidence that a new host has passed. Each pulled image must
match both its digest and image ID, and every requested tag must still match
the selected source's `versions.json`.

Download the resulting readiness archive and receipt, then use
`verify_export.py` with the expected lease ID and source commit. Readiness may
be asserted only after this local verification and the actual qualification
checks pass. Failed bootstrap evidence is also exported and retained.
