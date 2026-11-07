# AWS candidate readiness

AWS can host the existing Linux, NVIDIA and vLLM experiment. The fixed actor,
predictor and benchmark identities stay unchanged. The conservative starting
candidate is `g6e.2xlarge`: eight vCPUs, 64 GiB host memory and one 48 GB NVIDIA
L40S GPU. The smaller `g6e.xlarge` has only four vCPUs and 32 GiB host memory.
These are hardware candidates; concurrent model and telemetry fit still requires
a live host test. See [AWS G6e specifications](https://aws.amazon.com/ec2/instance-types/g6e/).

The existing `control.py` launch, termination and watchdog operations manage
Lambda Cloud only. Do not point them at an AWS account or treat a local shutdown
as verified EC2 termination. The additive [AWS controller](AWS_CONTROL.md) now
implements reservations, bounded launch, reconciliation, private service access,
verified export/termination and two independent watchdog enrollment gates. Its
tests use mocked AWS responses. No live AWS deployment or watchdog recovery has
been verified. This readiness inspection remains read-only.

The [two-region serverless watchdog package](AWS_WATCHDOGS.md) supplies disabled
deployment templates, original-journal overhead reservations and bounded recovery
canaries. Real deployed recovery evidence is still required before experiment
launch; generated templates and mocked tests do not satisfy that gate.

After the actual pinned stack is running, use the
[read-only host inventory collector](HOST_INVENTORY.md) to generate the observed
deployment metadata used by [native preparation](../../docs/acephale/INFRA_NATIVE_LAUNCH.md).
Identity inventory does not replace inference, telemetry or watchdog smoke checks.

## No-network inspection

From the repository root:

```text
python infra/acephale-infra-v1/aws_readiness.py
python -m unittest discover -s infra/acephale-infra-v1 -p test_aws_readiness.py -v
```

The default command does not invoke AWS CLI or inspect credentials. It reports
the unchanged gross limits from `versions.json` and the unresolved deployment
gates. Exit code 2 means execution is not ready; even a successful account
inspection below returns 2 because it cannot verify all deployment gates.

## Explicit account inspection

After an authorized operator installs AWS CLI v2 and signs into the intended
company account using a named profile, run:

```text
python infra/acephale-infra-v1/aws_readiness.py --inspect-account --profile RESEARCH_AWS_PROFILE --region us-east-1 --instance-type g6e.2xlarge --output research/acephale/runs/aws-readiness.json
```

The [offline AWS bootstrap templates](AWS_BOOTSTRAP.md) prepare scoped role,
operator and network-policy artifacts from explicitly observed identifiers.
Rendering templates does not install policies, create resources or establish
working credentials; verify the applied account configuration separately.

The output path must be new, with an existing parent directory. No key value or
provider error body is printed. The command performs only these five read APIs:

| Purpose | Read operation |
| --- | --- |
| Identify the authenticated account | `sts get-caller-identity` |
| Check actual device, CPU and RAM specifications | `ec2 describe-instance-types` |
| Check regional offering | `ec2 describe-instance-type-offerings` |
| Read regional G/VT On-Demand vCPU quota | `service-quotas get-service-quota`, code `L-DB2E81BA` |
| Read public Linux shared On-Demand compute price | `pricing get-products` |

The price request uses the `us-east-1` Pricing endpoint and filters the selected
deployment region separately. It requires one matching USD hourly compute rate
and records its product identity, effective date, retrieval time and response
hash. It rejects incomplete, ambiguous, tiered, reserved, nonfinite and mismatched
prices. This is public pricing evidence, not an account invoice, a capacity
reservation or a launch quote. See [AWS Pricing API](https://docs.aws.amazon.com/cli/latest/reference/pricing/get-products.html).

A regional offering does not guarantee available capacity. A quota of eight
vCPUs can cover the candidate's eight vCPUs only if account usage leaves enough
headroom; this tool does not measure current usage. GPU count is not the quota
unit. See [EC2 quota documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-resource-limits.html).

## Gates before any paid launch

- Verify the actual credit grant, remaining balance, expiration and EC2 service
  eligibility in the correct billing account. YC offer eligibility or a Bookface
  redemption is not an applied AWS credit balance. This tool leaves credits
  unverified; it does not apply for credits or accept investment terms.
- Reconcile and reserve against the original study and infrastructure journals.
  Preserve the $500 overall, $35 infrastructure, $2.50 gross hourly, 24 cumulative
  GPU-hour and eight-hour session limits. Credits do not reduce the gross price
  used for these limits. If the live quote exceeds the hourly cap, stop; a credit
  balance does not authorize changing the cap. Storage, IPv4, transfer, tax and
  other services require their own allowance in the total reservation.
  The founder explicitly authorized the hourly-only increase from $1.25 to $2.50
  on 2026-11-06. All other limits, including the $65 protected contingency and
  30-minute setup deadline, remain unchanged.
- Review and live-verify the implemented [AWS lifecycle controller](AWS_CONTROL.md),
  including its original-study reservation binding and unknown-response recovery.
  Enroll and exercise two independent, always-on AWS watchdogs and verify the
  30-minute setup cutoff. Offline fixture tests do not satisfy these host gates.
- Freeze the account, region, image, restricted IAM role, network, encrypted
  storage, export destination and cleanup rules. Keep model and telemetry
  listeners private and preserve the original research isolation.
- Run the [existing host checks](README.md#final-host-verification): pinned
  images/models, driver, both resident model servers, tool parsing, telemetry,
  artifact export and watchdog recovery. Record receipts in the manifest.

Trainium/Inferentia credits do not establish compatibility with the pinned CUDA
stack. Substituting those accelerators or a hosted Bedrock model requires a
separate implementation and experiment decision. No quota increase, EC2 launch,
resource mutation, model call or credit application is performed by this tool.
