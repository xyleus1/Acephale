# Native execution and budget recovery

The local research service runs the pinned provider models, frozen PostgreSQL
repository and three native comparison arms. Python owns native state, simulation
and independent evaluation; Node owns the shared runtime and model dispatch.
See [local reproduction](../../docs/goalspec/LOCAL_REPRODUCTION.md) for the actual
phase commands, database, artifacts and separate Derya configuration. The fixture
bootstrap remains available for tests and is never a paid research arm.

Run `npm run goalspec:service -- <trusted-bootstrap-module> <artifact-directory>`
with `GOALSPEC_GATEWAY_URL` and `GOALSPEC_GATEWAY_TOKEN` supplied securely in the
process environment. The native phase runner generates these automatically and
uses `services/goalspec-runtime/research-bootstrap.ts`. The trusted module exports
`build(context)`, receives the
shared gateway, durable ledger and event recorder, and returns registered workers
plus a total decision limit. The host drains workers before releasing budget
ownership. SIGINT/SIGTERM and a 24-hour lifetime limit request shutdown.

## Native operations

Every `/read` carries a UUID `operationId` and a server-registered `runId`.
Python retains the identity, invocation fingerprint and terminal state. A duplicate
ID never executes twice; different arguments for the same ID are rejected.
`/operation` with `cancel: true` discards a result, but a running callback continues
to report `running` until it physically returns. Cancelling an unknown ID creates
a tombstone that prevents a delayed original POST from executing.

Node reconciles transport failures and aborts without releasing the scheduler's
physical slot. A gateway outage intentionally leaves shutdown and duplicate
execution blocked. Restore access to the same gateway to drain it. Do not replace
its registry in a live Python process while callbacks remain running. A process
restart must be coordinated with termination of every old worker and registration
of new runs. Cross-host failover is not implemented.

The registry retains at most 4,096 identities for the gateway lifetime and rejects
new work at capacity. Tombstones are never evicted. Each snapshot adapter retains
at most 64 unexpired freshness leases. Their lifetime is at most 120 seconds,
measured by Python's monotonic clock. The speculative tool execution deadline is
separately five seconds. Reads, polling and validation are distinct protocol
operations; HTTP cancellation is never a confirmed tool cancellation.

`NativeSnapshotEnvironment` supports only the pinned retail and airline in-memory
toolkits. Supply this wrapper to the native orchestrator and register it in the
gateway's `reads` map. It constructs fresh toolkits from copied database values,
checks read-only metadata and rejects snapshot state changes. Native authoritative
calls invalidate leases. Full database hashes also detect out-of-band changes.
`consume` accepts an actual native ToolCall and a matching current one-shot lease;
it preserves native content, error status and the real call ID.

The worker transfers refreshed leases separately from the actor message to
`ExternalGoalSpecAgent`. Python stages only leases matching actual calls and
revalidates at native consumption. Mixed batches invalidate staged evidence.
Refresh rotates a one-shot token without extending its original expiry. Failed
consumption falls back to native execution. The Node scheduler's
`useful` event means a result was staged; final usefulness must be counted from
Python's `promotion_events` with status `consumed`, excluding stale fallbacks.

## Spending ledger

One `DurableBudget` owns all provider dispatch for its ledger file. Its exclusive
`.lock` file prevents competing local owners. New reservations and settlements
append version 2 hash-chained records containing only changed entries in `changes`.
Each append is fsynced before the in-memory ledger advances. Recovery streams the
journal, accepts historical complete snapshots in `entries`, applies newer deltas,
and verifies the sequence, hash chain and every reconstructed state. Existing
version 1 history remains intact. Streaming and deltas reduce memory and journal
growth; validating growing ledger states still adds recovery work.

The complete paired cohort is reserved atomically before dispatch. `reserveMany`
validates the proposed cohort and persists one change, so failure cannot leave a
partially reserved experiment. Each provider request then reserves its maximum
cost under its trial, including output allowance, before it is sent. Unresolved
requests retain their maximum. Recorded costs use provider usage and pinned
pricing; they are estimates until reconciled with an invoice. Actual usage above
the reserved maximum remains recorded and halts further dispatch across
allocations. The $500 ceiling and allocation limits remain in force locally.

Close workers and finish billing reconciliation before calling `close()`. Normal
close releases ownership. A process crash leaves the lock in place deliberately.
Before removing a crash lock, verify that the recorded process and every dispatcher
using that journal have terminated. Archive the journal and lock, then remove only
the verified stale lock. Never reclaim ownership based on lock age.

A torn or invalid journal prevents dispatch. Recover against provider billing
records while retaining the maximum cost of unresolved requests. Do not truncate
an invalid record and resume automatically. Linux directory entries are fsynced;
the local Windows tests establish process-restart recovery, not power-loss
durability. Power-loss durability has not been established for this deployment.
Shared network filesystems and multi-host ownership are unsupported.

After the owner closes, `scripts/goalspec-budget-report.ts` can reopen and validate
the journal and report known usage charges separately from unresolved caps.
`scripts/goalspec-export-repository.ts` exports the research tables in one read-only
transaction. The Python Parquet exporter verifies round trips and can archive the
closed raw budget journal without interpreting or rewriting either record format.

## Checks

From the repository root, run `npm run test:goalspec` and `npm run goalspec:check`.
From `research/goalspec`, run pytest with a fresh explicit `--basetemp` directory
when Windows denies access to its default temporary directory.
From `research/goalspec/.benchmarks/tau3`, run
`.venv/Scripts/python.exe ../../scripts/native_snapshot_parity.py` on Windows
or `.venv/bin/python ../../scripts/native_snapshot_parity.py` on Linux.
These use no model calls and do not measure task-success improvements.

For service-to-native promotion parity, run `../../scripts/native_service_parity.py`
in the native environment with a new output directory argument. It launches the
real Node host with the deterministic fixture bootstrap, verifies one native
consumption in each domain and preserves observations/state/termination/reward.
The artifact directory contains the durable spending journal and hash-chained
service events. No provider calls are made by this fixture.
