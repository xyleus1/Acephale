# Two independent serverless AWS watchdogs

The watchdog implementation is complete in source and offline-tested. Package
generation and offline verification do not deploy AWS resources. The separate
deployment commands below can incur charges. GPU quota, applied credits, gross
budget limits and actual recovery verification remain separate prerequisites.

`aws_serverless_watchdog.py` adapts the existing `watchdog_tick` to the Lambda
runtime's boto3 SDK. The SDK transport allows only STS identity, EC2 discovery and
termination. `aws_watchdog_package.py` produces one deterministic source ZIP and
two regional CloudFormation stacks: A executes in `us-east-1`, B in `us-west-2`.
Both target only the pinned account's `us-east-1` G6e deployment. They have separate
roles, schedules, evidence buckets, log groups and failure queues. They share the
target EC2 control plane and AWS account, so they are not independent of an outage
in that control plane or account-wide access loss.

## Prepare a disabled deployment package

Use the actual local plan with the verified AMI/subnet/security group/key and the
original study checkpoint. Choose an explicit future coverage window of at most
24 hours. Do not start a schedule while GPU access or spending authorization is
blocked. Re-render for the real launch window; illustrative dates are not a plan
to start billing automatically.

```text
python infra/acephale-infra-v1/aws_watchdog_package.py --config LOCAL_CONFIG.json --output NEW_PRIVATE_DIRECTORY --start-at FUTURE_UTC_START --end-at FUTURE_UTC_END
```

Outputs:

- `acephale-watchdog.zip`: standard-library controller code plus the exact
  `versions.json`, with a source-file manifest verified by every invocation.
- `watchdog-artifacts.template.json`: private encrypted/versioned code bucket,
  deployed separately in each execution region before uploading the package.
- `watchdog-a.template.json` and `watchdog-b.template.json`: complete regional
  function, evidence storage, logs, queue, IAM roles and schedule resources.
- `package.json`: plan hash, deterministic ZIP SHA256, Lambda's expected base64
  code hash, source manifest hash, coverage window and billable workload counts.

The Lambda Python runtime includes boto3. Its actual SDK version is recorded in
every poll receipt. No local pip installation or AWS CLI on the Lambda host is
needed. Before activation, compare the deployed Lambda `CodeSha256` with the
package's base64 hash. The code S3 object **version ID** is a required stack
parameter; a mutable object key alone is insufficient.
[AWS Python packaging contract](https://docs.aws.amazon.com/lambda/latest/dg/python-package.html).

## Estimate and reserve the gross cost first

Package generation deliberately leaves `grossCostEstimateUsd: null`. It never
assumes free-tier eligibility or that credits eliminate gross charges. Price the
actual two execution regions, reserve the overhead under the original study's
USD35 infrastructure allocation, and retain the reservation through reconciliation.
Do this before creating/uploading paid storage or activating functions/schedules.
Do not reset the original study journal. The founder explicitly raised only the
GPU hourly cap to USD2.50 on 2026-11-06; all other gross limits remain unchanged.

The concrete reservation path works before either controller is enrolled and
does not call AWS. Use the single original-checkpoint-bound slice initialized by
`aws_control.py init-ledger`, the final package and a gross cost receipt with
`regions`, `coverageHours`, `estimatedGrossUsd`, `lineItemsUsd`,
`creditsApplied:false`, `freeTierDiscountsApplied:false`, and hash-verified local
`priceEvidence` files. Line items must sum exactly to the estimate. The estimate
must cover the package's entire window and fit the proposed reservation:

```text
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json reserve-overhead --ledger ACTUAL_SLICE.json --reservation-id NEW_UUID --maximum-usd 3 --cost-receipt ACTUAL_GROSS_COST.json --package-receipt FINAL_PACKAGE/package.json
```

The controller records the slice intention before reserving in the original
study journal. Uncertainty retains the intention and blocks retrying that UUID;
it never releases money or silently starts a new journal. The reservation binds
the actual ZIP hash, source manifest and coverage window. Every serverless-backed
GPU launch must find that exact package/window reservation. A new window needs
a new reservation. Overhead and GPU reservations both count toward the same
USD35 allocation and original USD500 study budget. This is a planning reservation,
not an AWS-enforced billing cap.

For a 12-hour coverage window, the conservative single-delivery planning counts
are 1,444 scheduled invocations across both regions, at most 21,660 Lambda
GB-seconds at 128 MiB and the full 120-second timeout, 14,440 S3 PUTs and 1,444 S3
GETs. The actual internal poll wait lasts about 60 seconds in the healthy case;
the cost calculation conservatively allows the full timeout. One-minute
scheduling and free-tier discounts are not hard monetary caps.

Using AWS's published example rates of USD0.0000166667/GB-second and
USD0.20/million requests gives approximately USD0.3612895 for those Lambda
invocations before credits. The published Scheduler example rate adds
USD0.001444. This **USD0.3627335 subtotal excludes** regional S3 requests/storage,
CloudWatch logs, SQS failure delivery, manual tests, duplicate delivery, transfer,
tax and retained resources. Verify current region-specific rates and add a
conservative allowance before reserving; this subtotal is not the total bill.
[Lambda pricing](https://aws.amazon.com/lambda/pricing/),
[Scheduler pricing](https://aws.amazon.com/eventbridge/pricing/),
[S3 pricing](https://aws.amazon.com/s3/pricing/),
[CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/),
[SQS pricing](https://aws.amazon.com/sqs/pricing/).

The schedule is bounded to its declared end. Repeated delivery, manual invocation
and retained versioned objects are explicitly excluded from the single-delivery
count and must be covered separately. Do not let the coverage end while an EC2
lease is unresolved; provision verified replacement coverage before then, or
terminate the lease and confirm provider state. The operator remains responsible
for handling a provider outage beyond the declared window.

## Deploy each region with schedules disabled

Use an authorized administrative deployment profile. The research operator role
does not have IAM, Lambda, Scheduler or storage administration privileges. Do not
attach broader deployment permissions to the GPU host. The serverless stacks
create `AcephaleWatchdogA/B` and their schedule roles, so do not pre-create the
same fixed names using the optional standalone IAM payloads.

For each region, first create the artifact stack from
`watchdog-artifacts.template.json`, wait for completion, and read its `CodeBucket`
output. Then upload the ZIP to that same region's versioned bucket:

```text
aws cloudformation create-stack --stack-name acephale-watchdog-code --template-body file://watchdog-artifacts.template.json --region HOST_REGION --profile DEPLOY_PROFILE
aws cloudformation describe-stacks --stack-name acephale-watchdog-code --region HOST_REGION --profile DEPLOY_PROFILE
aws s3api put-object --bucket ACTUAL_CODE_BUCKET --key acephale-watchdog.zip --body acephale-watchdog.zip --server-side-encryption AES256 --expected-bucket-owner 971290362335 --region HOST_REGION --profile DEPLOY_PROFILE
```

Retain the returned `VersionId`. Create an ordinary local JSON parameter array
containing `CodeBucket`, `CodeObjectKey=acephale-watchdog.zip`, that exact
`CodeObjectVersion`, and `ScheduleState=DISABLED`. This file contains no credentials.
Then create A in `us-east-1` and B in `us-west-2`:

```text
aws cloudformation create-stack --stack-name acephale-watchdog-a --template-body file://watchdog-a.template.json --parameters file://ACTUAL_PARAMETERS.json --capabilities CAPABILITY_NAMED_IAM --region us-east-1 --profile DEPLOY_PROFILE
aws cloudformation create-stack --stack-name acephale-watchdog-b --template-body file://watchdog-b.template.json --parameters file://ACTUAL_PARAMETERS_B.json --capabilities CAPABILITY_NAMED_IAM --region us-west-2 --profile DEPLOY_PROFILE
```

Check CloudFormation results, function code hashes, exact IAM policies and output
account/regions. Validate the templates/policies with AWS before enabling them;
offline tests do not establish AWS acceptance. The template supplies no EC2 launch
permission or instance IAM profile. It scopes termination to the exact type and
deployment/plan tags. The Scheduler trust policy restricts `SourceAccount` and
the exact **schedule group** ARN, as required by
[AWS confused-deputy guidance](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html).

## Verify, enroll and activate

Each schedule targets `rate(1 minute)` with no flexible window. Every invocation
makes up to three polls at offsets 0, 30 and 60 seconds, subject to the 120-second
Lambda timeout and a remaining-runtime check. These overlapping polls reduce
normal one-minute scheduling gaps. They do not guarantee delivery during service
delays/outages, and the receipts explicitly say `deliveryGuaranteed: false`.
[Scheduler precision](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html).

Enable the schedules only for the bounded approved window and cost reservation.
Use a CloudFormation update retaining the exact artifact version and changing
only `ScheduleState` to `ENABLED`. A manual synchronous probe can invoke the
function with `{"planHash":"THE_PACKAGE_PLAN_HASH"}`; preserve its response and
logs. Probe calls incur usage and belong in the reservation. The function performs
real scoped cleanup if it discovers an expired lease, even before enrollment.

The first healthy scheduled invocation writes `armed.json` after verifying the
deployed code, actual STS identity, scoped EC2 discovery and durable evidence
export. This receipt explicitly has `terminationRecoveryTestPassed:false`. It
can authorize only the bounded recovery test described below; normal experiment
launch rejects it. No operator enrollment is created automatically.

After actual schedule/role/code verification and each real provider recovery
test, import its evidence with `enroll-canary` and upload its resulting
`enrollment.json` to that controller's own `EvidenceBucket`. In addition to the
fields in [AWS_CONTROL.md](AWS_CONTROL.md), it contains:

- Its actual `controllerId` (`acephale-watchdog-a` or `acephale-watchdog-b`).
- `hostId` equal to that function's unqualified ARN, and `failureDomain` equal to
  `aws-region:us-east-1` or `aws-region:us-west-2` respectively.
- `recoveryEvidenceKind: "live_provider_recovery"`, an actual recovery evidence
  SHA256, immutable `recoveryVerifiedAt` and a recent operator `verifiedAt`
  timestamp. Fixtures do not qualify.
- The exact `codeManifestSha256`, `coverageStartsAt` and `coverageEndsAt` that
  were tested. Changing code or the schedule window invalidates that recovery
  evidence for the new deployment.

The execution role can read that one enrollment object but **cannot write it**.
Missing, malformed, wrong-deployment or fixture enrollment never prevents
emergency termination, but it prevents publishing an admissible heartbeat.
Stable recovery evidence stays valid for the same deployment window. Fresh
healthy observations keep heartbeats flowing throughout an eight-hour lease;
the operator does not need to re-verify every five minutes while it runs.

Download each private `heartbeat.json` to the launcher's two receipt paths just
before launch. The controller requires fresh heartbeats, operator verification
within five minutes, distinct execution failure domains, and coverage through
the full lease **plus five minutes**. A fresh heartbeat cannot admit a lease whose
schedule will expire too soon. If the approved window changes, regenerate and
review both templates; do not silently extend a lease deadline.

## First recovery tests without circular enrollment

`recovery-canary` is a deliberately narrow bootstrap exception to the usual
requirement for two already-recovered controllers. It requires two actual fresh
`armed.json` receipts from the deployed A/B functions, exact code/window overhead
reservation, current account/AMI/network/price/quota evidence and the same
original budget caps except the explicitly authorized hourly increase. It cannot
start an experiment. The observed USD2.24208/hour compute rate fits the USD2.50
cap authorized on 2026-11-06. A fresh quote, sufficient actual quota, the original
budget reservation and both live armed controllers remain mandatory.

When those external prerequisites have actually been satisfied:

1. Activate both schedules in the approved window and verify their deployed
   code hashes and schedule settings. Download each current `armed.json` from its
   evidence bucket. The receipts must be no older than 120 seconds and coverage
   must extend at least five minutes past the canary's hard deadline.

```text
aws s3api get-object --bucket ACTUAL_A_EVIDENCE_BUCKET --key armed.json --expected-bucket-owner 971290362335 --region us-east-1 --profile DEPLOY_PROFILE ARMED_A.json
aws s3api get-object --bucket ACTUAL_B_EVIDENCE_BUCKET --key armed.json --expected-bucket-owner 971290362335 --region us-west-2 --profile DEPLOY_PROFILE ARMED_B.json
```

2. Run one canary for A with a new UUID. The command stays attached to monitor
   provider state and perform operator cleanup. It sends exactly one instance
   launch, no user data or model commands, and never marks the host ready.

```text
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json recovery-canary --ledger ACTUAL_SLICE.json --lease-id CANARY_A_UUID --controller-id acephale-watchdog-a --extra-allowance-usd 1 --watchdog-receipts ARMED_A.json ARMED_B.json
```

3. A receives an early termination deadline at two minutes. B continues to
   enforce the five-minute hard deadline. The attached operator process also
   requests cleanup at five minutes and keeps checking for up to five more
   minutes. Each canary reserves ten minutes of gross compute and GPU hours,
   plus the explicit non-compute allowance, to cover that cleanup margin.
   Delayed provider responses can exceed estimates; no command can guarantee
   AWS termination during a control-plane outage. Unknown state retains all
   reservations and requires further operator/provider reconciliation.
4. Download A's immutable poll containing its actual termination request and a
   poll confirming provider termination **before** the five-minute fallback.
   They may be the same poll. Download a fresh A arming receipt. Import these
   along with the provider-confirmed local canary ledger evidence:

```text
python infra/acephale-infra-v1/aws_control.py --config LOCAL_CONFIG.json enroll-canary --ledger ACTUAL_SLICE.json --lease-id CANARY_A_UUID --armed-receipt ARMED_A.json --request-evidence A_REQUEST_POLL.json --confirmation-evidence A_CONFIRMED_POLL.json --output NEW_A_ENROLLMENT.json
```

5. Upload that output as `enrollment.json` in A's evidence bucket using the
   authorized deployment profile. Refresh both arming downloads and repeat the
   canary/import steps with a second UUID targeting B. The single active-lease
   gate prevents concurrent canaries or experiments.

```text
aws s3api put-object --bucket ACTUAL_A_EVIDENCE_BUCKET --key enrollment.json --body NEW_A_ENROLLMENT.json --server-side-encryption AES256 --expected-bucket-owner 971290362335 --region us-east-1 --profile DEPLOY_PROFILE
```

6. Just before the normal experiment launch, repeat the imports into new local
   output files using the same immutable successful recovery evidence and fresh
   arming receipts, then upload them. This refreshes operator review while
   preserving the original recovery timestamp. Download the resulting fresh
   `heartbeat.json` from each controller for the normal launch command.

Only the intended controller's real request plus provider-confirmed early
termination can enroll it. Another controller's fallback, operator cleanup, a
mere successful TerminateInstances response, fake fixtures or a changed
code/window cannot pass. Both successful recoveries remain mandatory for normal
launch. The bootstrap mode is implemented and mocked-tested, not exercised on
this account. No actual recovery receipt exists yet.

## Evidence and cleanup

Every poll writes an immutable-name S3 object under
`evidence/REQUEST_ID/poll-N.json` before attempting a heartbeat. It includes exact
plan/code identity, clocks, request/response hashes, real provider results and
SDK version. An invocation summary retains failures. Provider errors are reduced
to safe categories; credentials and raw SDK error messages are not logged.

Unconfirmed termination or failed evidence export does not renew the heartbeat.
Other instances still receive cleanup if a malformed record is encountered.
CloudWatch logs provide failure summaries if S3 is unavailable. Failed Scheduler
delivery and failed Lambda invocation go to the regional encrypted SQS failure
queue. Both retry settings are zero; the next scheduled invocation independently
tries discovery/cleanup again. There is no infinite retry loop inside an invocation.

Evidence and artifact buckets are encrypted, private and versioned. Their
CloudFormation deletion policy retains them, as well as log groups and failure
queues. SQS messages expire after 14 days and CloudWatch logs after 30 days:
export failures and needed logs promptly into the permanent experiment archive.
The S3 evidence itself has no automatic expiry. Retained resources can keep
incurring storage charges after schedules stop. Export, reconcile and deliberately
clean them up under the approved project workflow rather than assuming stack
deletion removed all costs.

## Offline verification

```text
python -m unittest discover -s infra/acephale-infra-v1 -p test_aws_serverless_watchdog.py -v
```

Tests cover both regional identities, exact deployment scope, bounded polling,
SDK date serialization, S3 owner/encryption constraints, fail-closed heartbeats,
cleanup without enrollment, unknown termination, coverage gates, deterministic
code packaging and all generated role/schedule/storage/failure resources. These
are mocked tests and do not claim deployed watchdogs or current AWS acceptance.
