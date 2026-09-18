# V5 research archive

These helpers operate only after all listed inputs close. They never call a
provider, recover/open the budget ledger, discover files by glob, or update a
prior archive. Ledger and provider logs are read as immutable artifact bytes.
No export, pack or database import has been performed merely by adding them.

The optional preparation helper is the only step permitted to enumerate staging
roots. Copy `archive-staging.template.json` to a new input, resolve every pending
entry, and mark `closed`, `allPaidClocksClosed` and `budgetOwnerClosed` true only
after the respective writers stop. Then run, outside measured clocks:

```text
python outputs/goalspec-v5-tools/prepare_archive_plan.py NEW_CLOSED_STAGING.json NEW_ARCHIVE_PLAN.json
```

The resulting immutable plan contains only explicit files, hashes and roles.
It preserves every original source ZIP member, checks the execution subset
against archived bytes, resolves each exact service event log, and binds the
final full journal to its checkpoint pointer. It also checks all five prior
archives against their original receipt hashes. Preparation can take substantial
I/O and must not run alongside live timing or ledger writers.

The input JSON is an explicit allowlist:

```json
{
  "version": "goalspec-v5-archive-plan-v1",
  "archiveId": "goalspec-v5-local-20260916",
  "closed": true,
  "maximumBytes": 2147483648,
  "files": [
    {"path": "research/goalspec/runs/EXACT_CLOSED/report.json", "role": "analysis", "sha256": "EXACT_SHA256"},
    {"path": "research/goalspec/runs/EXACT_CLOSED/events.jsonl", "role": "provider-events", "chain": "events", "sha256": "EXACT_SHA256"}
  ],
  "cohorts": [],
  "preserveArchives": [{"path": "outputs/EXACT_PRIOR.zip", "sha256": "EXACT_SHA256"}],
  "externalInputs": [{"name": "upstream native environment and raw public datasets", "pin": "EXACT_SOURCE_REVISION", "reason": "Pinned external inputs, excluded from this results bundle"}]
}
```

File roles include ledger, provider-events, native-outcomes, native-trace,
controller, memory, library, replay, annotation, analysis, verification, plan,
source, source-freeze, documentation and failed-attempt. Include all interrupted
or failed startup attempts separately; never replace them with later outputs.
Ledger chains use `chain: "budget"`; provider logs use `events` or explicitly
`plain-jsonl` according to their actual encoding. Plain JSONL receives structural
and byte checks, without a claimed chain proof.

The default per-file limit is 256 MiB. Only an entry with `role: "ledger"` and
`chain: "budget"` can set `maximumFileBytes: 536870912` (512 MiB). The complete
journal must remain intact and pass its full sequence/hash-chain check. The
default 2 GiB archive-total limit is unchanged. Checkpoint pointers and checkpoint
JSON are separate `verification` artifacts, never additional ledger entries or
additional spending; retain the journal plus their exact bytes and source hashes.

An optional `budgetCheckpointBindings` array contains objects with `journal`,
`pointer`, `checkpoint` (all explicitly allowlisted paths), and the unchanged
`originalJournalPath` string used by the budget owner. The audit checks pointer,
sidecar content/entry hashes, journal identity, complete prefix bytes and terminal
sequence/hash against the full journal. It records `checkpointStateReplayed:
false`: byte/prefix verification is not a second accounting reconstruction.
Retain the owner's independent final accounting receipt as well. A checkpoint
may cover a proper prefix; subsequent journal events remain preserved and checked.

Every native cohort additionally declares `closed: true`, exact relative paths
for `design`, `serviceManifest`, and `outcomes`, and `traces` mapping every run ID
to an explicitly allowlisted native artifact. The validator recomputes v5 run
IDs and checks every failed or successful declared slot. Training/development
custom scores stay separate from selected official-task confirmation rewards.
A `source-freeze` ZIP entry additionally requires its exact `members` mapping
of original member paths to `{sha256, bytes}`. No unpacked upstream checkout is
admitted, and only exact pinned tau3 source members may occur inside a freeze.

Use a Python environment already containing pyarrow and rfc8785:

```text
python outputs/goalspec-v5-tools/archive_results.py export INPUT_PLAN NEW_ARCHIVE_DIRECTORY
python outputs/goalspec-v5-tools/archive_results.py inspect ARCHIVE_DIRECTORY MANIFEST_SHA256
python outputs/goalspec-v5-tools/archive_results.py pack INPUT_PLAN ARCHIVE_DIRECTORY MANIFEST_SHA256 outputs/NEW_RESULTS.zip
```

Parquet reconstructs every original file byte through bounded binary chunks,
including missing/null distinctions, whitespace, line endings and numeric
spelling. JSONL and Parquet files have independent hashes and roundtrip checks.
ZIP members have fixed timestamps, stable ordering, a file hash manifest and an
external verified receipt. A new archive directory is mandatory. No source is
silently redacted: private filenames or credential-looking content fail closed.
Existing synthetic URL examples in source or documentation can receive an
explicit `syntheticUrlReview` binding the entire source SHA256, exact matched
literal SHA256 counts and reviewed provenance. A source-ZIP member carries the
same review inside its pinned member entry. This narrow exception never applies
to API keys, ledgers, provider/event logs or other experiment records. Changed
source bytes, changed literals or changed counts fail closed. Original source
ZIPs remain unchanged; reviewed examples are recorded in the staging receipt.

The optional append-only Postgres import is a separate operation:

```text
node --import tsx outputs/goalspec-v5-tools/import_archive.ts ARCHIVE_DIRECTORY MANIFEST_SHA256 NEW_IMPORT_RECEIPT
```

Configure `GOALSPEC_ARCHIVE_DATABASE_URL` securely in the environment. The guard
accepts only loopback port 55440 and databases `goalspec_research` or
`goalspec_repository_test`. It refuses the application URL. The existing local
research owner role is `goalspec_owner`; no password is printed or embedded in
the plan. `GOALSPEC_ARCHIVE_PYTHON` can select the installed analysis interpreter.
The Derya fixture database is not an archive destination.

Import runs the independent Parquet/source verifier before opening Prisma,
writes only `goalspec_archive_v5`, verifies every stored canonical row, and
hashes existing `goalspec` and v1-v4 archive table contents before and after the
transaction. Conflicting identities or mismatched bytes roll back. Matching
archive IDs are idempotent and still receive full readback verification. Run
this after all measured clocks and other database writers finish, because the
preservation scans are deliberately comprehensive. The new schema stores
research artifacts; it does not publish controller weights or workflow memory
into the active runtime repository.

Relocation requires a new plan with mapped relative paths and fresh hashes.
Keep original source manifests and plans unchanged as provenance artifacts.
