# Infrastructure funding supplement

This optional operator authority adds $100 to infrastructure only. It gives the
infrastructure owner effective ceilings of $1,100 total, $300 infrastructure,
$225 compute and $75 associated costs. The original v3 policy and amendment stay
byte-identical. All other allocation ceilings, the $65 contingency, previous
reservations, unknown launches, training windows and model contracts remain.
This changes effective financial ceilings. It is separate from the older
GPU-hour capacity addendum, which changed only its engineering allowance.

The frozen `5a36a8b` native and annotation readers do not understand this
supplement. They recover the original journal even when its infrastructure
balance exceeds $200, because recovery validates entry shapes and parent links;
new reservations check the requested allocation and aggregate base ceiling.
They continue to enforce $1,000 total and $935 excluding contingency. Their
native manifests must retain the original v3 budget hashes and $200 infrastructure
field. They cannot spend the extra infrastructure authority. Do not change those
manifest fields while claiming the original policy identity.

Only `DurableBudget(..., { infrastructureOwner: true })` loads the supplement.
The infrastructure bridge and budget report use this explicit option. Other
owners retain the stricter base policy, including those running newer code.
The bridge exposes both base-policy hashes and `infrastructureFundingSupplementHash`.
Provider receipts identify the separate financial authority. Frozen training
leases remain v3 and carry the funding hash inside their actual study reservation.

Before the initial continuation GPU reservation, a fixed remaining API plan must fit under the
frozen base ceilings: $65 preparation, $0 training-library collection, $120
development, $350 held-out and $65 replay, totaling $600. Admission counts all
current root reservations at actual cost if settled, otherwise at their full
maximum, then the proposed GPU reservation, then the future $600. This must fit
under $935 excluding contingency and $1,000 overall. Each planned API allocation
must also fit its unchanged base allocation. This is a prospective initial-run
projection, not a general runtime reconciliation check. Even a small completed
development charge prevents reserving the full future $120 again. The bridge's
`inspect` operation also checks this projection; it is not a heartbeat or runtime
health endpoint. Existing owner heartbeat and provider watchdog paths do not
call it. The plan is conservative and may deny a later session after evaluation
has progressed. If it fails, review the
remaining stage caps explicitly; do not reduce unknown holds or bypass the gate.

The sole operator first closes provider-confirmed terminated work and verifies
the retained unknown-launch fences. Use a clean, separately committed operator
checkout containing this implementation; keep the frozen model/training source.
Write a private request with `ledgerPath`, `slicePath`, `authorizedAt` and `reason`,
then run:

```text
node --import tsx scripts/acephale-infrastructure-funding.ts REQUEST.json
```

The writer locks the existing slice and journal, validates their original v3
binding and creates `JOURNAL.infrastructure-funding-v1.json` exclusively. It
preserves journal, slice and policy bytes. Closed leases and unknown launches
without an observed instance ID are eligible; active leases are not. The
ordinary infrastructure `prepare-lease` path then rechecks actual journal
headroom before appending a reservation and before provider launch. No process
other than the existing operator may activate this authority or launch resources.

This supplement performs no settlement. Lambda documents weekly invoices, billed
minute increments and sales tax. Termination observations do not establish an
invoice-confirmed final charge. Keep all holds until a separate audited
reconciliation uses actual invoice evidence. See the primary
[billing overview](https://docs.lambda.com/public-cloud/billing/) and
[invoice history instructions](https://docs.lambda.com/public-cloud/manage-billing/).
