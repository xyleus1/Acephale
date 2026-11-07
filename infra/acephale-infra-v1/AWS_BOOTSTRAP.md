# AWS identity and network preparation

`aws_bootstrap.py` writes local, reviewable payloads for account `971290362335`
and EC2 region `us-east-1`. It makes no AWS calls and never reads credentials.
IAM/bootstrap changes and a security group can be prepared without a GPU rental.
No launch policy is attached by the initial identity setup.

## Console identity and temporary credentials

AWS explicitly prohibits root from calling `AssumeRole`. Root can perform this
initial administrative setup, but the research role must trust a non-root user
or federated principal. The supplied payloads create the console-only IAM user
`acephale-operator` and the role `AcephaleResearch`.
[AWS role switching rules](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-api.html).

Render identity payloads to a new private local directory:

```text
python infra/acephale-infra-v1/aws_bootstrap.py identity --output NEW_PRIVATE_BOOTSTRAP_DIRECTORY
```

Review the generated account and role ARNs. Using the already-authorized temporary
bootstrap profile, the five explicit API operations are:

```text
aws iam create-user --cli-input-json file://01-create-user.json --profile BOOTSTRAP_PROFILE
aws iam attach-user-policy --cli-input-json file://02-attach-signin-policy.json --profile BOOTSTRAP_PROFILE
aws iam create-role --cli-input-json file://03-create-research-role.json --profile BOOTSTRAP_PROFILE
aws iam put-user-policy --cli-input-json file://04-user-assume-role-policy.json --profile BOOTSTRAP_PROFILE
aws iam put-role-policy --cli-input-json file://05-readonly-research-role-policy.json --profile BOOTSTRAP_PROFILE
```

Run these from the generated directory, with the intended account confirmed by
`aws sts get-caller-identity`. Existing names are not overwritten by create
operations; inspect any existing user/role before continuing. The inline policies
grant the user only the exact research-role assumption, its own password change,
and password-policy reading. Long-lived access-key creation is explicitly denied.
The research role initially has regional EC2 evidence reads, Pricing and the exact
GPU quota read, plus a denial of instance-role delegation. It cannot launch or
terminate instances at this stage.

An administrator must enable the new user's console access and set its initial
password through the IAM console. Deliver that password securely, require a
password change, and enroll MFA in the console. Passwords and MFA secrets never
belong in these payloads, source files, command history or chat. There is no need
to create an IAM access key or a root access key.

The AWS-managed `SignInLocalDevelopmentAccess` policy attached by step 2 enables
browser-based temporary local credentials. AWS CLI v2.32.0 or newer supports this
flow; AWS manages the token cache and refreshes the session for up to 12 hours.
[Official sign-in instructions](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

Sign into the new IAM user at the account's console sign-in page, then run:

```text
aws login --profile acephale-operator --region us-east-1
aws configure set role_arn arn:aws:iam::971290362335:role/AcephaleResearch --profile acephale-runtime
aws configure set source_profile acephale-operator --profile acephale-runtime
aws configure set region us-east-1 --profile acephale-runtime
aws configure set duration_seconds 3600 --profile acephale-runtime
aws configure set role_session_name acephale-research --profile acephale-runtime
aws sts get-caller-identity --profile acephale-runtime
```

The final identity must be `assumed-role/AcephaleResearch/...` in the intended
account. Use this new profile instead of adding role settings to a profile that
already contains a root `login_session`. Do not run a command that prints exported
credentials. The generated `temporary-profile.config` contains only nonsensitive
profile settings. End the bootstrap root session after administrative setup.

## Restricted network without compute

Read the existing VPC/subnet/route configuration in `us-east-1`. Supply the actual
operator's current public IPv4 address with `/32`; a web service running elsewhere
can report the wrong egress address. The renderer rejects private IPs and broader
CIDRs. It does not discover an address or create a new VPC, NAT gateway, public
address, endpoint, load balancer or instance.

```text
python infra/acephale-infra-v1/aws_bootstrap.py network --vpc-id ACTUAL_VPC_ID --operator-cidr ACTUAL_PUBLIC_IPV4/32 --deployment-id acephale-aws-research-20261106 --output NEW_NETWORK_DIRECTORY
aws cloudformation create-stack --stack-name acephale-research-network --template-body file://research-security-group.template.json --region us-east-1 --profile BOOTSTRAP_PROFILE
aws cloudformation describe-stacks --stack-name acephale-research-network --region us-east-1 --profile BOOTSTRAP_PROFILE
```

The template contains exactly one new security group. It permits TCP22 from the
one operator address, with outbound TCP80/443 for package/model/container downloads.
All model, database and observability access stays on loopback/SSH tunnels. It does
not modify the default security group. Account/region conditions prevent resources
from being created elsewhere; require the expected security-group output before
using it. Update the exact operator `/32` when its address changes, then regenerate
the frozen deployment plan. Verify subnet routing and DNS separately.

## Exact research and watchdog policies

After observing the real AMI, its owner/root snapshot, subnet, new security group
and existing SSH key-pair ID, fill the local controller configuration described in
[AWS_CONTROL.md](AWS_CONTROL.md). Use profile `acephale-runtime` and the exact
`AcephaleResearch` role ARN. Then render the policies:

```text
python infra/acephale-infra-v1/aws_bootstrap.py policies --config LOCAL_CONFIG.json --key-pair-id ACTUAL_KEY_PAIR_ID --root-snapshot-id PINNED_AMI_ROOT_SNAPSHOT_ID --output NEW_POLICY_DIRECTORY
aws accessanalyzer validate-policy --policy-document file://research-launch-policy.json --policy-type IDENTITY_POLICY --region us-east-1 --profile BOOTSTRAP_PROFILE
```

Review validation errors and the actual resource pins before attachment. The
renderer performs structural offline checks; it does not claim IAM authorization
has been tested in AWS. The optional `research-put-launch-policy.json` payload is
for `iam put-role-policy` only after all launch prerequisites and the spending
decision are resolved. On 2026-11-06 the founder explicitly approved the increase
of the gross hourly cap to USD2.50; the observed USD2.24208/hour compute rate fits.
The USD35 infrastructure and USD500 overall budgets and every other limit remain
unchanged. Policy rendering alone does not verify current quota, credits,
watchdog recovery or live launch readiness.

The launch policy limits RunInstances to the pinned image/owner, root snapshot,
key, subnet and security group. Only `g6e.2xlarge`, On-Demand/default tenancy,
IMDSv2, encrypted bounded gp3 storage and the exact deployment tags are allowed.
It grants no `iam:PassRole`, instance profile, Spot request, network editing or
instance start/resize permission. Post-launch tagging can change only
`AcephaleReady` on already-owned instances; deadline/scope tags cannot be changed
with this role. Termination requires the exact account/region/type/deployment tags.
EC2 describe operations require `Resource: "*"`; they are action- and region-limited.

IAM does not enforce the controller's USD/GPU-hour ledger, semantic timestamp
bounds or its one-instance request count. Those gates remain mandatory in
`aws_control.py`; do not dispatch directly with the role. Exact IAM API conditions
and resource types come from the
[EC2 authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html)
and [tag-on-create documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/supported-iam-actions-tagging.html).

## Two watchdogs without two existing machines

The renderer also supplies separate `AcephaleWatchdogA` and `AcephaleWatchdogB`
role-creation and inline-policy payloads. Their trust principal is the AWS Lambda
service. Each can read the target account's EC2 instances in `us-east-1` and
terminate only this exact tagged G6e deployment. Neither can launch, retag, pass
roles, create credentials or edit network rules. Logging is restricted to its
own precreated Lambda log group, with A hosted in `us-east-1` and B in `us-west-2`.
These are proposed execution roles, not deployed services or enrollment receipts.

Two scheduled AWS Lambda functions can supply independent execution hosts without
renting two VMs. Deploy one in each execution region, with separate roles,
schedules, logs and recovery evidence. Both must call EC2 in the target region,
discover immutable deadline tags and verify termination. This separates execution
regions, but both still depend on the target EC2 control plane and account/IAM.

The complete serverless implementation is now supplied separately in
[AWS_WATCHDOGS.md](AWS_WATCHDOGS.md): a boto3 adapter around the existing
`watchdog_tick`, a deterministic source/versions ZIP, two regional CloudFormation
stacks, separate scheduled invocations, private versioned evidence storage and
failure queues. The stacks create their own execution roles. Do not create the
standalone role payloads above as well, because the fixed role names would collide.
No hosting component has been deployed or live-verified by the offline tests.
Do not create successful enrollment JSON from fixture results.

EventBridge Scheduler has 60-second precision. Each invocation makes three
bounded polls at offsets 0, 30 and 60 seconds, overlapping the next invocation.
Distributed invocation can still be late, so the program does not promise a
30-second delivery SLA or an exact deadline. The launcher checks current
heartbeats and that both coverage windows extend beyond the lease. Verify actual
timing and provider recovery before enrollment.
[Scheduler timing documentation](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html).
Functions, logs, schedules and artifact storage can incur charges, so include their
actual cost in the infrastructure allowance rather than calling them free.

## Offline checks

```text
python -m unittest discover -s infra/acephale-infra-v1 -p test_aws_bootstrap.py -v
```

The tests inspect role trust, absence of launch permission in bootstrap, denied
access-key creation, exact launch/termination scopes, the SSH-only `/32` group,
watchdog separation and refusal to overwrite prepared artifacts. No AWS APIs,
credentials, password generation, model calls or GPU rental are involved.
