"""Synthetic documentation provenance checks for the post-run package."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("document_package", Path(__file__).with_name("build_package.py"))
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


def fixture(root):
    name, original, current = "docs/AI_HANDOFF.md", b"Captured documentation\n", b"Final results added\n"
    frozen_sha, current_sha = (hashlib.sha256(data).hexdigest() for data in (original, current))
    directory = "research/goalspec/runs/capture"
    target = root / directory / "manifest.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps({"sources": {name: {"category": "documentation", "sha256": frozen_sha}}}), encoding="utf-8")
    spec = {"sourceArchives": [{"id": "final", "directory": directory}], "finalSourceId": "final",
            "documentOverlays": [{"path": name, "sha256": current_sha, "frozenSha256": frozen_sha, "reason": "Add post-run results"}]}
    return name, spec, {name: {"sha256": current_sha}}


def test_changed_document_keeps_both_hashes_and_reason(tmp_path):
    _, spec, metadata = fixture(tmp_path)
    result = package.verify_document_overlays(tmp_path, spec, metadata)
    assert result[0]["changedSinceConfirmationCapture"] is True
    assert result[0]["frozenSha256"] != result[0]["sha256"]


@pytest.mark.parametrize("name,allowed", [
    ("research/goalspec/reports/2026-09-15-local-v2/README.md", True),
    ("research/goalspec/reports/2026-09-15-local-v2/other.md", False),
    ("research/goalspec/reports/2026-09-14-local-v1/README.md", False),
])
def test_only_exact_prior_report_is_allowed(tmp_path, name, allowed):
    target = tmp_path / name
    target.parent.mkdir(parents=True)
    target.write_text("Historical custom-task results\n", encoding="utf-8")
    spec = {"groups": [], "sourceArchives": [], "finalSourceId": "unused",
            "looseFiles": [{"path": name, "purpose": "Explicit historical comparison input"}]}
    if allowed:
        selected, _, _ = package.collect(tmp_path, spec)
        assert list(selected) == [name]
    else:
        with pytest.raises(ValueError, match="Unsupported loose-file scope"):
            package.collect(tmp_path, spec)


@pytest.mark.parametrize("mutation", ["undeclared", "missing_metadata", "wrong_current", "wrong_frozen", "empty_reason", "duplicate", "execution"])
def test_invalid_document_overlay_is_rejected(tmp_path, mutation):
    name, spec, metadata = fixture(tmp_path)
    declared = spec["documentOverlays"][0]
    if mutation == "undeclared":
        spec["documentOverlays"] = []
    elif mutation == "missing_metadata":
        metadata.clear()
    elif mutation == "wrong_current":
        declared["sha256"] = "0" * 64
    elif mutation == "wrong_frozen":
        declared["frozenSha256"] = "0" * 64
    elif mutation == "empty_reason":
        declared["reason"] = " "
    elif mutation == "duplicate":
        spec["documentOverlays"].append(dict(declared))
    else:
        path = tmp_path / spec["sourceArchives"][0]["directory"] / "manifest.json"
        content = json.loads(path.read_bytes())
        content["sources"][name]["category"] = "execution"
        path.write_text(json.dumps(content), encoding="utf-8")
    with pytest.raises(ValueError):
        package.verify_document_overlays(tmp_path, spec, metadata)
