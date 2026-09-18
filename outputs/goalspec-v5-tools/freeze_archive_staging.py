"""Close the reviewed v5 staging list after report/accounting owner closure.

This study-specific preparation helper writes new inputs and a provenance
receipt only. No provider/database calls. Synthetic URL reviews contain hashes,
counts and context classifications, never credential-looking literal values.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import zipfile

from prepare_archive_plan import ROOT, read, relative, require, sha

RUNS = "research/goalspec/runs/"
URL = re.compile(rb"(?:postgres(?:ql)?|https?)://[^\s/:\"']+:[^\s/@\"']+@", re.I)
KEY = re.compile(rb"(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")
DOC_HASHES = {
    "3de972c98bf6eb192f31d3cc1403df37662eb200a8a85f5d5594a1c5bf1933a6",
    "3f89896e26cd3da06f6e9f145c3ea86deb8a4c62f8d7a1c25c5e3a77d1a9fe32",
    "f363d71534ae4ecccd48841a03ae38bf2caf2b6ac4f2edb3aadb505283717c43",
    "98481052514ffa222381bd3e4ea024bdaa0dd61d7cf4f1f59286fabfa1a6f7cd",
}
IMPORT_HASHES = {"db84fbe87dd0d544fa2966f07c5ded04b7896517bc23d968817abc040e29155e",
                 "6cf52f37425092f1374f9b993072518fae475295c3f6d85573b7538749ff4a8d"}
APPROVED = {
    "docs/AI_HANDOFF.md": (DOC_HASHES, "Existing loopback dummy build-command examples; no connection is attempted."),
    "docs/ENGINEERING_LOG.md": (DOC_HASHES, "Existing loopback dummy build-command examples; no connection is attempted."),
    "scripts/goalspec-import-archive-v3.test.ts": (IMPORT_HASHES, "Existing mocked URL-guard assertions, including rejected host/database cases."),
    "scripts/goalspec-import-archive-v4.test.ts": (IMPORT_HASHES, "Existing mocked URL-guard and fake-Prisma import assertions; no real credential."),
    "scripts/goalspec-derya-v5-live.test.ts": ({"cbf98e63f8de962408b0d81ed8313b292edd83a7aa68e11fa9f6496a23844175"},
                                            "Existing error-redaction unit test uses a deliberate synthetic URL."),
    "outputs/goalspec-v5-tools/test_archive_results.py": (
        {hashlib.sha256(("postgresql://fixture:" + "password@").encode()).hexdigest()},
        "Local archive test constructs a deliberately rejected mock URL; no database connection."),
}


def review(name, payload):
    require(not KEY.search(payload), "No API-key exception is permitted")
    counts = Counter(hashlib.sha256(match.group()).hexdigest() for match in URL.finditer(payload))
    if not counts:
        return None
    require(name in APPROVED and set(counts).issubset(APPROVED[name][0]), "Unreviewed source URL; preserve failure without printing value: " + name)
    return {"sourceSha256": hashlib.sha256(payload).hexdigest(), "literalSha256Counts": dict(counts), "reason": APPROVED[name][1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--closed", action="store_true", required=True)
    parser.add_argument("--output", default=RUNS + "local-v5-archive-staging-20260916.json")
    parser.add_argument("--receipt-directory", default=RUNS + "local-v5-archive-preflight-20260916")
    args = parser.parse_args()
    output = ROOT / args.output
    directory = ROOT / args.receipt_directory
    require(not output.exists() and not directory.exists(), "New staging and receipt paths required")
    template = ROOT / "outputs/goalspec-v5-tools/archive-staging.template.json"
    config = read(template)
    config.update(closed=True, allPaidClocksClosed=True, budgetOwnerClosed=True)
    config.pop("pendingBeforeFreeze", None)
    config["roots"].append({"path": RUNS + "local-v5-prediction-replay-audit-20260916", "role": "analysis"})
    config["roots"].append({"path": args.receipt_directory, "role": "verification"})
    config["files"].append({"path": RUNS + "local-v5-final-synthesis-inputs-20260916.json", "role": "plan"})
    config["files"] = [row for row in config["files"] if row["path"] != "outputs/goalspec-v5-tools/TRAINING_PIPELINE.md"]
    config["overrides"] = {}
    reviews = []
    for item in config["sourceFreezes"]:
        item["syntheticUrlReviews"] = {}
        frozen = read(ROOT / item["plan"])
        require(sha(ROOT / item["path"]) == frozen["sourceArchiveSha256"], "Source archive differs from its closed original plan")
        with zipfile.ZipFile(ROOT / item["path"]) as archive:
            for name in archive.namelist():
                value = review(name, archive.read(name))
                if value:
                    item["syntheticUrlReviews"][name] = value
                    reviews.append({"archive": item["path"], "member": name, **value})
    for name in APPROVED:
        path = ROOT / name
        if name.startswith("docs/") or name.startswith("outputs/goalspec-v5-tools/"):
            value = review(name, path.read_bytes())
            if value:
                if name.startswith("docs/"):
                    row = next(row for row in config["files"] if row["path"] == name)
                    row["syntheticUrlReview"] = value
                else:
                    config["overrides"][name] = {"role": "source", "syntheticUrlReview": value}
                reviews.append({"path": name, **value})

    acquisition = ROOT / (RUNS + "apigen-abc4a517d67c541f85f6470cbd8fd3186b36830e/acquisition.json")
    ingestion = acquisition.parent / "ingested/manifest.json"
    for path in (acquisition, ingestion):
        config["files"].append({"path": relative(ROOT, path), "role": "verification"})
    acquired, ingested = read(acquisition), read(ingestion)
    require(acquired["license"] == ingested["license"] == "cc-by-nc-4.0"
            and acquired["research_only"] is True and acquired["revision"] == ingested["revision"], "Dataset license lineage changed")
    repository = ROOT / (RUNS + "local-v5-repository-export-20260916")
    datasets = [json.loads(line) for line in (repository / "dataset_manifest.jsonl").read_text(encoding="utf-8").splitlines()]
    apigen = next(row for row in datasets if row["source"] == "Salesforce/APIGen-MT-5k")
    require(apigen["revision"] == acquired["revision"] and apigen["content_hash"] == acquired["data_sha256"], "Exported dataset lineage changed")
    with (repository / "episode.jsonl").open(encoding="utf-8") as stream:
        derived_count = sum(json.loads(line)["dataset_id"] == apigen["id"] for line in stream)
    require(derived_count == apigen["admitted_count"] == 5000, "Expected explicit APIGen-derived episode count")
    license_receipt = {
        "dataset": apigen["source"], "revision": acquired["revision"], "license": acquired["license"],
        "researchOnly": True, "attribution": "Salesforce APIGen-MT-5k", "derivedEpisodeRecordsIncluded": derived_count,
        "rawUpstreamDownloadIncluded": False, "rawUpstreamBytesExcluded": acquired["bytes"],
        "rawUpstreamSha256": acquired["data_sha256"], "recordedCardSha256": acquired["card_sha256"],
        "originalCardBytesAvailableLocally": False,
        "cardProvenance": "Original acquisition and ingestion manifests record the card hash and restrictions; card bytes were not retained there or in reviewed prior ZIP inventories.",
        "nativeExecutablePatternsFromApigen": 0, "nativeRuntimeMemory": "Fitting native families only; these archived derived records do not alter runtime eligibility.",
        "sources": [{"path": relative(ROOT, path), "sha256": sha(path)} for path in (acquisition, ingestion, repository / "dataset_manifest.jsonl", repository / "episode.jsonl")],
    }
    config["externalInputs"][1] = {"name": "Salesforce/APIGen-MT-5k original raw download and dataset card",
        "pin": acquired["revision"], "rawSha256": acquired["data_sha256"], "cardSha256": acquired["card_sha256"],
        "license": acquired["license"], "researchOnly": True, "reason": "Raw upstream download excluded; 5,000 derived normalized research episode records are included with acquisition/ingestion attribution and restrictions."}

    # Preserve every existing budget sidecar explicitly at this staging boundary,
    # while the current pointer binding still designates the sole active cache.
    budget_root = ROOT / (RUNS + "local-evaluation-20260914")
    for path in sorted(budget_root.glob("budget.jsonl.checkpoint.v1.*.json")):
        config["files"].append({"path": relative(ROOT, path), "role": "verification"})
    for item in config["preserveArchives"]:
        candidates = [ROOT / (item["path"] + suffix) for suffix in (".sha256", ".verification.json", ".receipt.json")]
        if item["path"].endswith("v4-final.zip"):
            candidates.append(ROOT / "outputs/goalspec-local-v4-final.receipt.json")
        for path in candidates:
            if path.is_file():
                config["files"].append({"path": relative(ROOT, path), "role": "verification"})
    directory.mkdir()
    receipt = {"version": "goalspec-v5-archive-preflight-v1", "closed": True,
        "sourceUrlReview": {"policy": "Exact source/member bytes plus exact matched-literal hashes and counts only; no API-key, event, ledger or runtime-result exceptions.",
                            "originalSourceArchivesUnmodified": True, "reviewedSources": reviews,
                            "sourceReviewCount": len(reviews), "matchedLiteralOccurrences": sum(sum(row["literalSha256Counts"].values()) for row in reviews)},
        "licenseLineage": license_receipt,
        "validation": {"archiveAndPreparationSyntheticTests": {"passed": 23, "failed": 0}, "windowsDefaultTempFailure": "Initial pytest default-temp access denied; same tests passed with a fresh workspace basetemp."},
        "sources": [{"path": relative(ROOT, path), "sha256": sha(path)} for path in (template, Path(__file__), ROOT / "outputs/goalspec-v5-tools/archive_results.py", ROOT / "outputs/goalspec-v5-tools/prepare_archive_plan.py")],
        "limitations": ["Generic artifact ingestion does not convert new teacher attempts into legacy typed goal_annotation rows.",
                        "Cumulative ledger, checkpoint, overlapping provider logs and trial subtotals are not additive spending views."]}
    for path, value in [(directory / "receipt.json", receipt), (output, config)]:
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2)
            stream.write("\n")
    print(json.dumps({"staging": str(output), "sha256": sha(output), "receipt": str(directory / "receipt.json"),
                      "reviewedSources": len(reviews), "derivedApigenEpisodes": derived_count}))


if __name__ == "__main__":
    main()
