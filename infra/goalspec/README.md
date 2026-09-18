# Ephemeral research infrastructure

This definition is prepared, not provisioned or validated by Terraform. It needs
an existing VPC/subnet with HTTPS egress, a verified Linux AMI containing the locked
runner tools, an immutable release artifact, and regional price verification.
No credential values belong in variables, user data, plans, logs, or artifacts.

The runner is t3a.xlarge in us-east-2, with a 100 GB encrypted gp3 volume and no
inbound ports. PostgreSQL/pgvector and the Node/Python services must bind locally.
SSM provides administration. The release must include its dependency locks,
container digests, schemas, manifests and run-research.sh. That complete release
is not built yet; do not apply this template as a substitute for runtime preflight.

Budget preflight must account for EC2, gp3, public IPv4, S3, transfer and telemetry
within $35. A mandatory estimate variable prevents an implicit unpriced launch;
it is not an AWS billing cap. Verify prices immediately before provisioning.

The instance stops within its configured lifetime. Normal completion exports and
downloads artifacts to verify bytes before terminating compute and deleting its
volume. An export failure retains the stopped volume for recovery and continues
to incur storage charges; recover it within the reserved contingency and then
destroy created infrastructure. Artifact storage remains until reviewed/exported.

WebArena is outside this deployment and the paid pilot. Its independent definition
must use the upstream reset images, isolated browser/backends and at least the
recommended 1,000 GB volume. Browser deployment and adapter are still outstanding.
