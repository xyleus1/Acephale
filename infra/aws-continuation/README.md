# AWS continuation implementation

This directory records the operational sources used by the existing AWS study.
The original manifest lists byte-for-byte snapshots and deployed source hashes in
`source-manifest.json`. The frozen scientific checkouts are separate and unchanged.

Included changes cover the persistent DAG controller, region-aware qualification
metadata, same-assignment continuation before scientific dispatch, SageMaker
HyperPod node commands, finite allocation protection, and replacement of an empty
compute group with a supported availability-zone placement.

These sources depend on the versioned deployment configurations and source
references held in the private AWS artifact store. They are not a standalone
installer. Do not execute an archived launcher or create another coordinator.
Current model files, checkpoints, financial journals, credentials, run state and
results remain in AWS and are intentionally absent from Git.

At this snapshot, Ohio passed qualification and reused its original checkpoint.
Its next preparation step stopped because the generated opportunity manifest
contains an empty output-success predicate. A metadata-only repair is in progress.
The archived generation01 preserves this failed preparation; it is not a completed
benchmark result. Both Virginia A100 requests lack compute capacity; additional
regional requests are being prepared. Three previously accepted components remain
accepted, and no new scientific result is claimed here.

Publication checks compile every copied Python source, check shell syntax,
compare source hashes, scan for credential formats and run `git diff --check`.
The deployment-specific tests remain alongside their source or in the private
AWS evidence store. This archive does not claim a fresh full application test run.

## Deployed owner handler snapshot, November 22

See [the handler archive](sources/operator/direct-owner-handler-03/README.md)
and [its sanitized source manifest](source-manifest-owner-handler-03.json).
This separate snapshot contains no runtime authority or current assignment state.
