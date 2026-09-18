import json

import pytest

from goalspec.experiment import fit, replay
from goalspec.fixtures import demo_corpus
from goalspec.metrics import score_predictions
from goalspec.reporting import generate_report, verified_replay
from goalspec.splits import make_splits
from goalspec.storage import append_jsonl, file_hash, write_json


@pytest.fixture
def recorded(tmp_path):
    corpus = demo_corpus(groups=10, trials=1)
    split = make_splits(corpus, expected_trials=1)
    bundle = tmp_path / "bundle"
    fit(corpus, split, bundle)
    directory = tmp_path / "replay"
    replay(corpus, split, bundle, directory, bootstrap_samples=100)
    return directory


def refresh_summary(directory, summary):
    write_json(directory / "summary.json", summary)
    run = json.loads((directory / "run.json").read_text(encoding="utf-8"))
    run["summary_hash"] = file_hash(directory / "summary.json")
    write_json(directory / "run.json", run)


def test_report_rejects_tampered_prediction_file(recorded):
    path = recorded / "predictions.jsonl"
    with path.open("a", encoding="utf-8") as stream:
        stream.write(" ")
    with pytest.raises(ValueError, match="integrity"):
        verified_replay(recorded)


def test_report_rejects_unbound_prediction_file_even_if_summary_is_rehashed(recorded):
    summary = json.loads((recorded / "summary.json").read_text(encoding="utf-8"))
    del summary["output_hashes"]["predictions.jsonl"]
    refresh_summary(recorded, summary)
    with pytest.raises(ValueError, match="manifest"):
        verified_replay(recorded)


def test_report_recomputes_published_micro_metrics(recorded):
    summary = json.loads((recorded / "summary.json").read_text(encoding="utf-8"))
    summary["metrics"]["paste"]["tool_top1"] = 1.234
    refresh_summary(recorded, summary)
    with pytest.raises(ValueError, match="metrics differ"):
        verified_replay(recorded)


def test_negative_initial_goal_result_is_not_overridden_by_oracle_success(recorded, tmp_path):
    summary, rows = verified_replay(recorded)
    baseline = {row.step_key: row.prediction for row in rows if row.condition == "paste"}
    modified = [row.model_copy(update={"prediction": row.prediction.model_copy(update={"tool_distribution": baseline[row.step_key].tool_distribution})}) if row.condition == "goalspec_initial" else row for row in rows]
    # Construct a self-consistent negative predictor fixture. Oracle observations
    # remain positive, ensuring they cannot override the primary inference result.
    path = recorded / "predictions.jsonl"
    path.write_text("", encoding="utf-8")
    for row in modified:
        append_jsonl(path, row)
    summary["metrics"] = score_predictions(modified)
    summary["output_hashes"]["predictions.jsonl"] = file_hash(path)
    refresh_summary(recorded, summary)
    report = generate_report(recorded, tmp_path / "report")
    text = report.read_text(encoding="utf-8")
    assert "does not establish that inferred initial goals outperform" in text
    assert "Oracle endpoint conditioning reduces paired NLL" in text
    assert "latency reduction" in text and "unmeasured" in text
    assert "not an execution of the original PASTE" in text
    manifest = json.loads((report.parent / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["files"]["report.md"] == file_hash(report)
