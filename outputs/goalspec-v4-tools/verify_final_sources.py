"""Verify closed confirmation source, archives and unchanged historical reports."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.native_live_v4 import verify_plan, verify_source_archive


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    receipt = ROOT / "research/goalspec/runs/local-v4-final-source-verification-20260916.json"
    if receipt.exists():
        raise ValueError("A new receipt is required")
    runs = ROOT / "research/goalspec/runs"
    confirmation = runs / "local-v4-confirmation-plan-20260916"
    plan = json.loads((confirmation / "plan.json").read_text(encoding="utf-8"))
    if digest(confirmation / "plan.json") != "0d4f2ef316e6f109591ea58697c98e433458c5ab35062ea60e86168b6021725d":
        raise ValueError("Confirmation dispatch plan changed")
    verify_plan(plan, confirmation)
    development = runs / "local-v4-development-plan-20260916"
    dev = json.loads((development / "plan.json").read_text(encoding="utf-8"))
    if digest(development / "source.zip") != dev["sourceArchiveSha256"]:
        raise ValueError("Development source archive changed")
    verify_source_archive(development / "source.zip", dev["sources"])
    expected = {
        "research/goalspec/reports/2026-09-15-local-v3/README.md": "fa987ace22b429500ebe9cf99c6cda9535b3c409df10ac2106522f4a83c5462f",
        "research/goalspec/reports/2026-09-15-local-v3/metrics.csv": "6885543aa177481cf5996d7d2cdb617cf336dd056de115965b628351589b8fae",
        "research/goalspec/reports/2026-09-15-local-v3/report-manifest.json": "f7bd2908712bdf6b5cc9dc6831eba2c80afb6bcde6c572548eac771ee95f7129",
        "outputs/goalspec-local-v3-final.zip": "f458aac25b656f7ed42136349993a50449f7763a1e040565ad719362455d9b24",
        "outputs/goalspec-local-v2-final.zip": "cf3a5ef51e8d1a25f5fc69e56742ba198d286295b5c1d0add9b85a78eb09e3fb",
    }
    for name, value in expected.items():
        if digest(ROOT / name) != value:
            raise ValueError(f"Historical artifact changed: {name}")
    result = {
        "schemaVersion": 1,
        "confirmationRuntimeAndInputsUnchanged": True,
        "confirmationPlanSha256": digest(confirmation / "plan.json"),
        "confirmationSourceArchiveSha256": plan["sourceArchiveSha256"],
        "developmentSourceArchiveVerified": True,
        "historicalArtifactsUnchanged": expected,
        "paidCalls": 0,
        "databaseAccessed": False,
    }
    with receipt.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
