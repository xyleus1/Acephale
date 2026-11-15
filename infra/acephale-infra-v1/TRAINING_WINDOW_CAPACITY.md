# One additional fitting window

This operator amendment adds exactly one four-hour fitting window. It changes
the cumulative v3 fitting allowance from 28,800 to 43,200 seconds. The v3 policy
file itself stays unchanged. Its 900 additional smoke seconds and 14,400-second
maximum per fitting window remain unchanged. Historical smoke in the v3 baseline
is retained separately: 900 old plus 900 v3 smoke seconds is not a new allowance.

This engineering capacity neither increases financial authority nor reserves
another host. GPU-hour limits, current financial supplements, protected API
headroom, unresolved holds, ownership checks and provider deadlines remain
independent admission gates. Failed or unused windows are never shortened or
removed to recover capacity.

The sole operator snapshots the current original slice into a new private history
file with `control.training_window_history(ledger, control.sha256(slice_path))`.
Every prior known lease must be terminated; unresolved `launch_unknown` entries
with no observed instance ID remain funded and fenced. Later legitimate resolution
of such an unknown does not erase its original reservation.

After recording the user's authorization, run:

```text
python infra/acephale-infra-v1/control.py record-training-window-capacity-addendum --ledger ORIGINAL_SLICE --authorization-reason AUTHORIZED_REASON --operational-history NEW_HISTORY_JSON
```

The command creates `ORIGINAL_SLICE.training-window-capacity-v1.json` exclusively.
It binds the original slice, unchanged v3 policy/amendment bytes, complete history,
new operator source and exact finite capacity contract. It opens the existing
budget inspection path, which may refresh normal locks/checkpoints, but does not
reserve or settle financial entries. Original slice and policy bytes are preserved.

Before quote-associated reservations or provider launch, declare the complete
remaining training footprint in a new private request:

```json
{"version":1,"windows":[{"name":"profile-and-main","kind":"fit","seconds":14400}]}
```

```text
python infra/acephale-infra-v1/control.py training-window-headroom --ledger ORIGINAL_SLICE --request REQUEST_JSON
```

This read-only gate shares `_training_window_admission` with actual training
lease creation. Its receipt binds the request hash and current slice SHA, reports
used/requested/remaining seconds by kind, and asserts no provider or financial
reservation. A successful snapshot does not reserve capacity; the sole owner must
recheck before provisioning and retain the actual footprint with run provenance.

New training windows and their receipts carry
`trainingWindowCapacityAddendumHash`. Trainer receipts remain version/profile 3
with the unchanged exact `budgetPolicy`, policy hash and amendment hash. Do not
add capacity fields to frozen native manifest budget bindings. Provider receipts
expose the separate `trainingWindowCapacityAuthorization`.

All operator readers, including heartbeat and cleanup, must use the new source
and retain the installed sidecar. `_read_budget_amendment` authenticates the
capacity on every cumulative check. Old operator source intentionally rejects
windows exceeding its old authority; the frozen 5a model trainer accepts the
unchanged per-window contract and preserves the additional provenance field.

Package `training-window-capacity-v1.json` beside `control.py`; it is included
in `controller_source_files()` and source-amendment hashes. Retain the new sidecar
as a separate exported operator artifact. Do not replace older controllers,
policy files, original failed outputs or source identities.
