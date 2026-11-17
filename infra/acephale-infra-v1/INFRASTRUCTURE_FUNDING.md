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
frozen base ceilings: $0 preparation, $0 training-library collection, $65
development, $238 held-out and $0 replay, totaling $303. Development covers
36 trials at $1.25 ($45), plus four goal-grading batches capped at $5 each ($20).
The grader charges development. The remaining workflow needs no preparation,
training-library or replay API calls. Admission counts all
current root reservations at actual cost if settled, otherwise at their full
maximum, then the proposed GPU reservation, then the future $303. This must fit
under $935 excluding contingency and $1,000 overall. Each planned API allocation
must also fit its unchanged base allocation. This is a prospective initial-run
projection, not a general runtime reconciliation check. The bridge's
`inspect` operation also checks this projection; it is not a heartbeat or runtime
health endpoint. Existing owner heartbeat and provider watchdog paths do not
call it. The plan is conservative and may deny a later session after evaluation
has progressed. If it fails, review the
remaining stage caps explicitly; do not reduce unknown holds or bypass the gate.

The initial $600 proposal failed against existing reservations before any
funding sidecar was created. The revised projection retains $385.349380 already
spent or reserved, adds the proposed $20.696 GPU reservation and $303 for the
remaining stages: $709.045380 against the frozen $935 non-contingency ceiling.
The $238 held-out allowance fits the observed $238.116096 remaining allocation.
Keep the earlier failed request as evidence; this revision releases no hold and
does not amend the base policy or effective infrastructure ceilings above.

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


## Bounded evaluation infrastructure extension

A second append-only funding sidecar adds $15 compute and $5 associated charges.
It retains the first funding authority, all reservations and unknown outcomes,
and the frozen v3 API policy and $65 contingency. The infrastructure reader sees
$320 ($240 compute, $80 associated); the frozen API reader still sees its original
$1,000 policy and must retain the same $303 API projection. The new authority
permits one additional evaluation-only lease, at most six hours and $1.99/hour.
Optimizer authorization is rejected. An actual invoice is still required to
release prior reservations; termination alone does not reconcile money.

Use the existing funding writer with request `version: 2` after the original
authority is present and all identified work is closed. This creates
`budget.jsonl.infrastructure-funding-v2.json` with parent content/file hashes; it
does not edit either ledger or either earlier policy/funding file. Provider
launch still requires independent source, auth, capacity, price, and shutdown
checks. A new closed-run baseline cannot authorize a second new lease.
