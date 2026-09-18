# Deferred local WebArena environment

This definition uses local Docker only. No images have been downloaded, no Docker
stack has been started, and no paid WebArena evaluation has run. The current
machine does not have the upstream images or Docker available. The browser adapter
has a separate real Chrome integration test with independent local HTTP backends.

The upstream source is pinned to `dce04686a56253aefba7b18a4fa0937cf1dc987b`.
The [upstream instructions](https://github.com/web-arena-x/webarena/blob/dce04686a56253aefba7b18a4fa0937cf1dc987b/environment_docker/README.md)
recommend 1,000 GB storage. The full upstream environment also contains map,
Wikipedia, homepage and documentation services. This definition covers only the
four mutable sites: shopping, shopping administration, GitLab and forum.

After separately loading the official images, create a JSON lock with
`sourceRevision` set to the pin above and `images` mapping each of `shopping`,
`shopping_admin`, `gitlab`, and `forum` to its actual locally inspected immutable
`sha256:` image ID. Run `python deployment.py LOCK.json NEW_DIRECTORY` to generate
two Compose definitions. Neither definition pulls images. They use distinct
containers, writable layers, anonymous image volumes and internal networks;
published ports bind to loopback only. Snapshot ports are 10,000 above the
authoritative ports. Do not reuse database volumes or bind mounts across stacks.

`LocalBrowserSnapshotProvider` connects the TypeScript browser adapter to
`research/goalspec/scripts/webarena_local_gateway.py` using trusted stdio commands.
Its configuration requires the pinned `checkout`, `deploymentDirectory`, `site`,
two canonical loopback `origins`, `fingerprintCommand`, `verifierCommand`, and a
server-owned `tasks` registry. Optional `postResetCommands` contain literal argv
lists for each stack's upstream site URL rewrites and readiness checks. These are
server configuration, never actor-generated shell commands.

The fingerprint command receives the stack name through an argv `{stack}` field
and must return `{"stateHash":"64 hex characters","completeDatabaseProjection":true}`.
It must hash the complete relevant logical database, normalize only declared site
origin differences, and include joined state. A URL, container ID, timestamp, or
browser context ID is insufficient. A site-specific fingerprint implementation
and its database isolation audit remain prerequisites for real upstream use.

Reset destroys and recreates only the two fixed GoalSpec Compose projects, then
checks container, writable storage and network separation plus logical state
equivalence. The implementation supports speculation only while both databases
remain equivalent to this verified reset state. It fails closed after an
authoritative mutation; arbitrary current-state database cloning is not implemented.

The native verifier command can invoke `webarena_native_verify.py` inside the
upstream Python environment. Each registered task supplies immutable config and
native trajectory paths/hashes plus the local authoritative browser CDP endpoint.
It calls the pinned `evaluation_harness.evaluators.evaluator_router` after checking
the checkout and input hashes. Model-assisted fuzzy judging is denied. The
upstream dependencies, images, site fingerprint hooks, URL configuration and
native evaluator have not been exercised here; mock controller tests are not an
upstream WebArena integration score.
