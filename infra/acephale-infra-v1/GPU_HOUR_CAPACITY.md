# Prospective GPU-hour capacity

This operator addendum changes one engineering reservation allowance from 64 to
128 cumulative GPU hours. The approved v3 financial policy stays byte-identical:
$1,000 total, $200 infrastructure, $150 compute, $50 associated charges, eight
hours per session, and the existing fitting/smoke windows. A capacity addendum
does not guarantee that a financially admissible session remains.

The sole original journal owner prepares a private history file using
`control.gpu_hour_capacity_history(ledger, control.sha256(slice_path))` from the
actual original slice. It includes every lease, overhead and training window.
All prior work must be terminated, except explicitly retained `launch_unknown`
attempts with no observed instance ID. Such attempts remain unknown, fully
reserved, and subject to the existing fresh independent-fence admission.

Then the authorized operator runs:

```text
python infra/acephale-infra-v1/control.py record-gpu-hour-capacity-addendum \
  --ledger ORIGINAL_SLICE \
  --authorization-reason "The user's explicit instruction authorizing necessary continuation" \
  --operational-history PRIVATE_HISTORY_JSON
```

The controller locks the slice, verifies the exact history and unchanged v3
amendment, inspects the original journal without writing it, and creates
`ORIGINAL_SLICE.gpu-hour-capacity-v1.json`. An existing sidecar cannot be replaced.
The command does not reserve funds, release earlier reservations, extend a lease,
or contact the GPU provider. Normal reservation and launch commands still apply
all financial, access, quote, ownership and recovery-controller checks.

New leases contain `gpuHourCapacityAddendumHash`. Provider receipts contain
`infrastructureCapacityAuthorization`, including the sidecar SHA/content hash,
base-policy allowance 64, engineering allowance 128, and
`financialPolicyChanged: false`. The training lease remains version 3 with the
original policy and a hash of its actual provider lease. Qualified/native
manifests retain the base policy's `maximumGpuHours: 64`; freeze the separately
authorized sidecar as an experiment input and carry its identity in operator/run
provenance. Do not rewrite the frozen model or budget contracts to imply that the
base policy changed.
