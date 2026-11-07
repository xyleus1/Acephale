# Bounded AWS lifecycle

`aws_control.py` is an additive EC2 controller; `control.py` still manages Lambda
only. This implementation has offline mocked tests, not a verified AWS deployment.
It does not create accounts, apply credits, create IAM roles or network resources,
install AWS CLI, choose an AMI, download models or call a model.

The current approved candidate is `g6e.2xlarge`, with one 48 GB-class NVIDIA GPU,
eight vCPUs and 64 GiB RAM. Live `DescribeInstanceTypes` must confirm that shape.
AWS reports this exact L40S shape as 45,776 MiB, consistent with its documented
48 GB class. The checker recognizes that specific device/type combination and
still requires actual simultaneous model fit. It does not admit arbitrary smaller GPUs.
On 2026-11-06, the founder explicitly approved raising the gross GPU hourly cap
from USD1.25 to USD2.50. The observed USD2.24208/hour compute rate fits that cap;
the controller still requires a fresh live quote and all other execution gates.
Credits do not reduce the gross rate checked here. Only `limits.hourlyUsd` changed
in `versions.json`: USD35 infrastructure, USD500 study, USD65 protected
contingency, 24 cumulative GPU-hours, eight hours/session and 30 minutes/setup
remain unchanged. Previously rendered package and ledger hashes must not be
treated as evidence for the changed configuration.

For the complete two-region serverless deployment, original-journal overhead
reservation, bounded first-recovery canaries and actual recovery-evidence import,
follow [AWS_WATCHDOGS.md](AWS_WATCHDOGS.md). `reserve-overhead` works before
watchdog enrollment and calls no AWS API. The narrowly scoped `recovery-canary`
bootstrap accepts fresh healthy deployed-controller arming evidence, but normal
`launch` still requires two real recovery proofs. Both modes retain every
original price, quota and budget gate. A canary cannot become inference-ready.

## Required operator inputs

Use the actual company account and region. Verify the applied credit balance,
expiry and EC2 eligibility in Billing before any paid launch. A YC offer or an
account signup is not an applied grant. No investment or equity agreement is part
of this controller. Use AWS CLI v2 with a named profile assuming the explicit
research IAM role; root or an unexpected role/account is rejected by live STS.

Create a local configuration outside the repository with these fields. The
capitalized values below are requirements, not executable example identifiers.
Every cloud identifier must come from actual account inspection. Never put an
access key, private key, secret or credential value in this JSON.

```json
{
  "profile": "RESEARCH_AWS_PROFILE",
  "accountId": "ACTUAL_12_DIGIT_ACCOUNT",
  "operatorRoleArn": "ACTUAL_RESEARCH_ROLE_ARN",
  "region": "us-east-1",
  "instanceType": "g6e.2xlarge",
  "imageId": "EXPLICIT_VERIFIED_AMI_ID",
  "imageOwnerId": "VERIFIED_AMI_OWNER_ACCOUNT",
  "subnetId": "EXISTING_RESEARCH_SUBNET_ID",
  "securityGroupId": "EXISTING_RESTRICTED_SECURITY_GROUP_ID",
  "keyName": "EXISTING_PUBLIC_SSH_KEY_NAME",
  "sshCidrs": ["ACTUAL_OPERATOR_PUBLIC_IP/32"],
  "associatePublicIp": true,
  "rootVolumeGiB": 100,
  "deploymentId": "acephale-aws-research-20261106",
  "studyLedgerPath": "ABSOLUTE_ORIGINAL_STUDY_JOURNAL_PATH",
  "studyCheckpointPath": "ABSOLUTE_ORIGINAL_CHECKPOINT_PATH",
  "studyCheckpointHash": "CANONICAL_CHECKPOINT_HASH_FROM_CHECKPOINT_COMMAND",
  "infrastructureLedgerPath": "ABSOLUTE_SINGLE_AWS_SLICE_LEDGER_PATH",
  "exportRoot": "ABSOLUTE_DURABLE_EXPORT_DIRECTORY"
}
```

The AMI must be explicitly pinned, available, x86-64 HVM Linux/UNIX with one EBS
root device, no Marketplace product code and a volume fitting the chosen size.
The controller verifies the exact ID and owner using `DescribeImages`; it never
selects a latest image. Driver/CUDA/container compatibility still needs the live
host checks. The existing subnet and security group must belong to the account
and VPC. Ingress may contain only TCP22 from the pinned restricted addresses
(IPv4 /24 or narrower, IPv6 /64 or narrower). All Compose listeners remain on
loopback; use SSH tunnels. No instance IAM profile is attached. Model downloads
need appropriate outbound network access. Public IPv4, EBS, transfer and tax are
not included in the compute rate and need a conservative additional reservation.

The launch role needs the exact read operations in `aws_control.py`, plus scoped
`RunInstances`, tag-on-create, `CreateTags` for readiness and `TerminateInstances`.
The two external watchdog roles need STS identity, scoped EC2 reads and termination
for this deployment's tagged instances. Verify their actual policies and service
installation separately. The code does not claim that an IAM role name proves
least privilege. The GPU host must not hold either watchdog credential.

## Original study and one infrastructure slice

Create a checkpoint of the existing nonempty study journal using the existing
command. Never substitute an empty journal or a new USD500 budget:

```text
node --import tsx scripts/acephale-infra-native.ts checkpoint ORIGINAL_BUDGET.jsonl NEW_CHECKPOINT.json
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json init-ledger --ledger SINGLE_AWS_SLICE.json --prior-gpu-hours RECONCILED_PRIOR_HOURS
```

Initialization invokes `scripts/acephale-aws-budget.ts`. It validates the original
hash-chain journal and checkpoint, preserves every unresolved reservation, and
exclusively creates `ORIGINAL_BUDGET.jsonl.aws-infrastructure-pointer.json`. That
pointer binds the one AWS slice, deployment and checkpoint. A second initialization
cannot reset cumulative hours. A crash during binding requires manual recovery of
the same pointer and slice; do not delete them to get a fresh allowance. Reconcile
prior Lambda/other infrastructure hours before supplying `--prior-gpu-hours`.

Every launch writes a conservative slice reservation, then durably appends a new
`infrastructure` reservation in the original journal before the provider request.
The study bridge retains the USD35 allocation and protected study contingency.
The slice also retains cumulative GPU hours. A reused launch UUID cannot use an
old study reservation to finance a second launch. There is no automatic settlement,
invoice assumption or reservation release after termination.

Writes use fsync; Unix directory entries are synced after replacement. Windows
process-restart behavior is tested, but power-loss recovery and the actual Linux
deployment filesystem remain live verification requirements. Do not remove a
crash lock or reservation until the exact original owner and provider state have
been reconciled.

## Two independent watchdogs

The complete two-region AWS Lambda hosting package is described in
[AWS_WATCHDOGS.md](AWS_WATCHDOGS.md). It uses the same cleanup function, adds
SDK transport and durable evidence, and requires no pre-existing controller VMs.
The persistent CLI option below remains available. Neither implementation's
offline tests count as deployed controller enrollment.

Install this controller as an always-on service on **two different external hosts
in different failure domains**. Neither can be the rented GPU VM or a laptop that
sleeps. Both discover leases directly using EC2 deployment/plan tags, so losing
the launcher's disk does not remove their deadline information. The external
configuration can use different named profiles and local paths; those local
fields do not change the deployment hash. Cloud identity and original checkpoint
hash must stay identical.

Serverless receipts also record their one-minute schedule precision and internal
poll offsets `[0, 30, 60]`, explicitly set `deliveryGuaranteed: false`, and bind
actual provider recovery evidence. Both coverage windows must include the full
reserved lease plus five minutes. An expiring scheduled controller cannot admit
a longer lease merely because its most recent heartbeat was fresh.

Each controller needs an operator enrollment receipt containing:

- `profile: "acephale-infra-v1"`, `provider: "aws"`, `accountId`, `region`,
  `planHash` from `deployment_hash(config)` in this module.
- Distinct `controllerId`, `hostId`, and `failureDomain` for each controller.
- `controllerKind: "independent_always_on"`, `discovery: "ec2_tags"`,
  `maxPollSeconds` from 1 through 60.
- `verifiedAt` as Unix seconds, `terminationRecoveryTestPassed: true`, and
  `recoveryEvidenceSha256` identifying actual recovery-test evidence.

These fields are operator attestations, not proof manufactured by the program.
Verify the service, credentials, clock and recovery test on each controller before
writing them. The checked-in fixtures are not valid enrollment receipts.

```text
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json watchdog --profile WATCHDOG_PROFILE --role-arn WATCHDOG_ROLE_ARN --enrollment VERIFIED_ENROLLMENT.json --heartbeat LOCAL_HEARTBEAT.json
```

The service targets a 30-second poll interval, retries failed cleanup, and writes
a heartbeat only after successful discovery and any required provider-confirmed
termination. One malformed historical instance cannot prevent cleanup of other
instances. Unresolved cleanup keeps the old heartbeat, which blocks new launch.
Use `--once` for a single real provider tick. Copy both current heartbeat receipts
to the launcher: launch requires each heartbeat within 120 seconds and operator
verification within five minutes. Keep continuous logs/evidence externally.

At launch, EC2 tags store the immutable session deadline and the earlier setup
deadline. Without a verified readiness tag, both watchdogs terminate at setup
expiry. After readiness, they still terminate at the original session deadline.
The two controllers may issue the same idempotent termination request. Deadline
enforcement depends on clocks, controllers, credentials and AWS responding; an
outage can exceed the reserved estimate. Keep continuous exports and monitor it.

## Quote, launch, inspect and close

```text
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json quote --output NEW_QUOTE.json
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json launch --ledger SINGLE_AWS_SLICE.json --lease-id NEW_UUID --hours 2 --extra-allowance-usd 2 --watchdog-receipts FIRST_HEARTBEAT.json SECOND_HEARTBEAT.json
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json reconcile --ledger SINGLE_AWS_SLICE.json --lease-id SAME_UUID
```

The monetary and hour values above are command examples, not a current-price
authorization or an estimate of actual storage/transfer/tax costs. Launch obtains
fresh public AWS Pricing evidence, exact EC2 hardware/AMI/network/key evidence,
the regional G/VT quota and current pending/running On-Demand G/VT vCPU usage.
It checks the selected subnet's AZ offering. Available quota and a regional
offering do not guarantee capacity, and account activity can race the check.

The sole `RunInstances` request fixes `MinCount=MaxCount=1`, a stable `ClientToken`,
explicit AMI/type/AZ/subnet/group/key, encrypted gp3 root storage with deletion on
termination, IMDSv2, no instance IAM profile, no Spot market, no paid Marketplace
image and no capacity reservation. There is no launch retry. Timeout, malformed
response or an interrupted study reservation retains the slice and study amounts,
blocks another launch, and requires reconciliation by the exact token. Missing
instances can reflect AWS eventual consistency; absence never proves no charge.

`reconcile` saves the raw, account-checked `DescribeInstances` response under
`SINGLE_AWS_SLICE.json.evidence/`, with its file hash and path in the lease. This
is the provider receipt for actual host inventory; it does not replace host-side
hardware/model verification. Lost launch responses never cause another instance
to be requested. Ambiguous/missing instances require operator reconciliation.

```text
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json mark-ready --ledger SINGLE_AWS_SLICE.json --lease-id SAME_UUID --smoke-receipt ACTUAL_HOST_SMOKE.json
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json terminate --ledger SINGLE_AWS_SLICE.json --lease-id SAME_UUID --export-receipt VERIFIED_EXPORT.json
```

`mark-ready` must run inside setup time, with a running provider instance and a
passing smoke receipt for its instance/lease. Its `checks` object must affirm
`pinnedImages`, `pinnedModels`, `driver`, `concurrentModels`, `toolParsing`,
`telemetry`, `export` and `watchdogRecovery`. It also reads the actual volume to
verify encryption/size/type, verifies delete-on-termination and the intended
security group, and rejects an unexpected instance IAM profile. It then sets
only the readiness tag; it cannot extend the immutable session deadline. A JSON
attestation is not a substitute for actually performing the named host checks.

Normal termination verifies a nonempty export receipt's lease ID, relative file
paths, sizes and SHA256 hashes under `exportRoot`. Export all required experiment
artifacts first; the program verifies declared files, not semantic completeness.
Deadline/emergency cleanup deliberately skips this gate using `--emergency`.
Only a subsequent exact provider `terminated` state closes the lease. A successful
termination request, guest shutdown, missing result or stopped instance does not.
Exit code 2 means termination was requested but not provider-verified yet. Repeat
reconciliation/termination as necessary; the reservations remain until separate
actual invoice reconciliation. Existing subnet, SG and key resources are never
deleted. Verify root EBS deletion and any remaining external charges afterward.

## Offline verification and API references

```text
python -m unittest discover -s infra/acephale-infra-v1 -p test_aws_control.py -v
node --import tsx --test scripts/acephale-aws-budget.test.ts
```

The tests cover budget and UUID reuse, two-controller evidence, expired/bad
identities, price/hardware/network failures, unknown launch and termination,
provider reconciliation, export hashes, setup/session deadlines and independent
cleanup without the launcher ledger. They use fixture journals and mocked AWS
responses. No live account, credential, model call or GPU is used.

Official contracts: [RunInstances](https://docs.aws.amazon.com/cli/latest/reference/ec2/run-instances.html),
[DescribeInstances and eventual consistency](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-instances.html),
[DescribeImages](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-images.html),
[security groups](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-security-groups.html),
[idempotent termination](https://docs.aws.amazon.com/cli/latest/reference/ec2/terminate-instances.html),
[readiness tags](https://docs.aws.amazon.com/cli/latest/reference/ec2/create-tags.html),
and [AWS Pricing](https://docs.aws.amazon.com/cli/latest/reference/pricing/get-products.html).
