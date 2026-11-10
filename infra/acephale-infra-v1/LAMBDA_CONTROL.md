# Lambda GPU lifecycle and independent cleanup

All commands are explicit. `control.py` uses the original study journal via
`scripts/acephale-aws-budget.ts`; numeric legacy slices cannot launch. Install
`boto3` in a separate controller environment for `lambda_watchdog_deploy.py`.
AWS profiles using login-session authentication also require `botocore[crt]`.
Keep the original Node 22 toolchain available to that Python process. Credentials
are supplied through an AWS profile and the process-only `LAMBDA_API_KEY`.

The new launch-plan JSON contains:

```json
{
  "version": 1,
  "provider": "lambda",
  "profile": "acephale-infra-v1",
  "hardwareProfile": "a100-40gb-v1",
  "studyLedgerPath": "ABSOLUTE_ORIGINAL_JOURNAL",
  "studyCheckpointPath": "ABSOLUTE_EXISTING_CHECKPOINT",
  "studyCheckpointHash": "CANONICAL_64_HEX_HASH",
  "infrastructureLedgerPath": "ABSOLUTE_NEW_SLICE",
  "exportRoot": "ABSOLUTE_EXPORT_ROOT",
  "sourceCommit": "COMMITTED_40_HEX_REVISION",
  "region": "us-east-1",
  "sshKeyName": "EXISTING_LAMBDA_PUBLIC_KEY_NAME",
  "firewallRulesetId": "EXPLICIT_RESTRICTED_RULESET_ID",
  "deploymentId": "acephale-UNIQUE_NAME"
}
```

Verify prior GPU hours and provider charges. Initialize the slice and reserve
five dollars of associated charges before creating cleanup infrastructure:

```text
python infra/acephale-infra-v1/control.py init-ledger --plan PLAN --ledger SLICE --prior-gpu-hours VERIFIED_HOURS
python infra/acephale-infra-v1/control.py reserve-overhead --ledger SLICE --reservation-id UNIQUE_UUID --maximum-usd 5
```

The cleanup config contains `version:1`, a lowercase `deploymentId` matching
`acephale-[a-z0-9-]+`, two different `regions` (for example `us-east-2` and
`us-west-2`), `awsProfile`, `infrastructureLedgerPath`, and the funded
`overheadReservationId`. Deploy creates two named private buckets, token secrets,
scoped IAM roles, Python 3.12 AWS Lambda functions, minute EventBridge schedules
and three-day log groups. A creation receipt is persisted after every stage.
The token never appears in that receipt or a command argument.

```text
python infra/acephale-infra-v1/lambda_watchdog_deploy.py deploy --config CONFIG --receipt NEW_DEPLOYMENT_RECEIPT
```

Before research, test each controller with one funded canary, at most ten minutes
each. These are real GPU rentals charged against the same journal. Use controller
IDs `DEPLOYMENT_ID-1` and `DEPLOYMENT_ID-2` in separate iterations:

```text
python infra/acephale-infra-v1/control.py prepare-lease --ledger SLICE --hours 0.16666666666666666 --extra-allowance-usd 0 --purpose cleanup_canary --recovery-controller-id CONTROLLER_ID
python infra/acephale-infra-v1/lambda_watchdog_deploy.py publish --receipt DEPLOYMENT --ledger SLICE --lease-id LEASE_ID
python infra/acephale-infra-v1/lambda_watchdog_deploy.py enroll --receipt DEPLOYMENT --output ENROLLMENT
python infra/acephale-infra-v1/control.py launch --ledger SLICE --lease-id LEASE_ID --watchdog-receipt ENROLLMENT
python infra/acephale-infra-v1/lambda_watchdog_deploy.py publish --receipt DEPLOYMENT --ledger SLICE --lease-id LEASE_ID
python infra/acephale-infra-v1/control.py request-canary-termination --ledger SLICE --lease-id LEASE_ID
python infra/acephale-infra-v1/lambda_watchdog_deploy.py publish --receipt DEPLOYMENT --ledger SLICE --lease-id LEASE_ID
python infra/acephale-infra-v1/lambda_watchdog_deploy.py enroll --receipt DEPLOYMENT --output ENROLLMENT
python infra/acephale-infra-v1/control.py observe-termination --ledger SLICE --lease-id LEASE_ID
```

If termination is asynchronous, repeat enrollment and observation until the
actual provider status is absent/terminated. Neither uncertainty nor failure
releases the financial reservation. The named canary controller performs the
test; the second remains a backup at the hard deadline. A recovery receipt is
created only after an actual termination request and its observed completion.
No simulated test can produce a production recovery receipt.

For research use `prepare-lease --hours HOURS --extra-allowance-usd 0`, publish,
enroll and launch in that order. Normal launch requires both fresh controller
receipts with recovery proof. Immediately publish the resulting instance ID and
run `lambda_watchdog_deploy.py heartbeat --receipt DEPLOYMENT --ledger SLICE
--lease-id LEASE_ID` in a managed process. It refreshes private state every 30
seconds. Loss of that process triggers cleanup after 120 seconds. Keep exporting
artifacts continuously. Setup must complete in 30 minutes or the GPU is stopped.

Run `training-preflight --hardware-profile a100-40gb-v1 --output NEW_RECEIPT`
on the GPU after stopping actor and predictor serving. Create a training lease
from that recent receipt on the journal-owning controller using `training-lease
--ledger SLICE --lease-id LEASE_ID --preflight RECEIPT --output NEW_TRAINING_LEASE
--hours 1`. Two hours of total training windows are allowed. Build the separate
`trainer.Dockerfile` using the pinned training `uv.lock`; never alter vLLM's Torch.
Use the training package's container wrapper to record the actual image digest.
For a merged predictor, place the complete export beneath the model root and
render a new locked Compose with `--models-root ROOT --predictor-export
ROOT/trained/SEED`. The collector accepts the same `--predictor-export`; both
reuse the training package verifier and bind the five manifests, exact merged
files, tokenizer, base revision and derived served name. Run these commands with
the lightweight research Python environment. No base-weight identity is reused
for a trained export.

Only SSH is public. Copy the public key to Lambda, never the private key. Pin the
observed ed25519 server key in a dedicated known-hosts file and record the actual
`/etc/machine-id` bytes hash. `provider-receipt --ledger SLICE --lease-id LEASE_ID
--ssh-observation SSH_JSON --output NEW_RECEIPT` binds that observation to a live
API response. SSH JSON fields are `host`, `port:22`, `user:"ubuntu"`,
`hostKeySha256:"SHA256:..."` and `machineIdSha256`. The inventory collector uses
this identity plus `--hardware-profile a100-40gb-v1`; it does not invent an EC2 ID.
Initial SSH host trust is an operator-pinned observation, not provider attestation.

After verified GPU termination, export controller artifacts and remove only the
new resources in its creation receipt:

```text
python infra/acephale-infra-v1/lambda_watchdog_deploy.py export --receipt DEPLOYMENT --output NEW_EXPORT_DIRECTORY
python infra/acephale-infra-v1/lambda_watchdog_deploy.py cleanup --receipt DEPLOYMENT --export-receipt NEW_EXPORT_DIRECTORY/export.json
```

Cleanup verifies local export hashes, refuses deletion while a registered GPU is
live, deletes exact stack IDs and created secret ARNs, and checks bucket ownership.
Partial creation receipts permit the same bounded cleanup path. AWS outages or
provider API outages can delay termination; configured polling is not an SLA.
