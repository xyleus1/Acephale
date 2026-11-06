from __future__ import annotations

import json

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.infra_import_v5 import import_v5


def test_historical_import_requires_original_hashed_pipeline(tmp_path):
    pipeline = tmp_path / "pipeline"
    pipeline.mkdir()
    (pipeline / "pipeline.json").write_text(json.dumps({"version": "goalspec-v5-post-closure-training-pipeline-v1", "contentHash": "0" * 64}), encoding="utf-8")
    with pytest.raises(ValueError, match="pipeline receipt"):
        import_v5(tmp_path / "export", tmp_path / "cohort", pipeline, tmp_path / "result")
    assert not (tmp_path / "result").exists()


def test_historical_import_refuses_changed_closed_cohort_before_export(tmp_path):
    pipeline = tmp_path / "pipeline"
    cohort = tmp_path / "cohort"
    pipeline.mkdir()
    cohort.mkdir()
    (cohort / "outcomes.jsonl").write_text("changed\n", encoding="utf-8")
    document = {"version": "goalspec-v5-post-closure-training-pipeline-v1", "cohort": {"files": {"outcomes.jsonl": "0" * 64}}}
    document["contentHash"] = hash_v1(document)
    (pipeline / "pipeline.json").write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValueError, match="source hash mismatch"):
        import_v5(tmp_path / "export", cohort, pipeline, tmp_path / "result")
    assert not (tmp_path / "result").exists()
