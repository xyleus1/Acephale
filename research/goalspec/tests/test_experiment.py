import json

import pytest
from typer.testing import CliRunner

from goalspec.cli import app
from goalspec.experiment import fit, load_bundle, replay
from goalspec.fixtures import demo_corpus
from goalspec.gates import GateReport
from goalspec.goal_backends import BackendConfig, GoalBackend
from goalspec.splits import make_splits


def test_complete_pilot_keeps_synthetic_gate_closed(tmp_path):
    corpus = demo_corpus(groups=10)
    split = make_splits(corpus)
    artifacts = tmp_path / "artifacts"
    fit(corpus, split, artifacts)
    summary = replay(corpus, split, artifacts, tmp_path / "replay", bootstrap_samples=100)
    assert summary["scheduler_allowed"] is False
    assert summary["gate_status"] == "insufficient_evidence"
    assert set(summary["metrics"]) == {"paste", "oracle", "goalspec_initial", "goalspec", "shuffled", "shuffled_initial", "shuffled_oracle"}
    assert summary["metrics"]["oracle"]["next_tool_nll"] < summary["metrics"]["paste"]["next_tool_nll"]
    gate = GateReport.model_validate_json((tmp_path / "replay/gates.json").read_text())
    gate.verify()
    rows = [json.loads(line) for line in (tmp_path / "replay/observations.jsonl").read_text().splitlines()]
    assert all(row["speculation_hit"] is None for row in rows)
    assert all(row["tool_latency"] is None for row in rows)
    contexts = {}
    for row in rows:
        key = (row["trajectory_id"], row["turn"])
        contexts.setdefault(key, set()).add(tuple(row["selected_context"]) if row["selected_context"] is not None else None)
    assert all(len(values) == 1 for values in contexts.values())
    assert summary["paired_comparisons"]["shuffled_oracle_vs_oracle"]["status"] == "estimated"
    initial = {row["trajectory_id"]: row for row in (json.loads(line) for line in (tmp_path / "replay/initial-goals.jsonl").read_text().splitlines())}
    for row in rows:
        donor = summary["shuffled_donors"][row["trajectory_id"]]
        if row["condition"] == "shuffled_initial":
            assert row["goal_distribution"] == initial[donor]["posterior"]["probabilities"]
        if row["condition"] == "shuffled_oracle":
            assert row["goal_distribution"] == {initial[donor]["expected_goal"]: 1.0}


def test_frozen_bundle_rejects_tampering_and_output_reuse(tmp_path):
    corpus = demo_corpus(groups=5, trials=1)
    split = make_splits(corpus, expected_trials=1)
    artifacts = tmp_path / "artifacts"
    fit(corpus, split, artifacts)
    with pytest.raises(ValueError, match="never overwritten"):
        fit(corpus, split, artifacts)
    path = artifacts / "patterns.json"
    path.write_text(path.read_text() + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="hash mismatch"):
        load_bundle(corpus, split, artifacts)


def test_cli_native_spec_uses_documented_options(tmp_path):
    path = tmp_path / "spec.json"
    result = CliRunner().invoke(app, ["tau-spec", str(path), str(tmp_path / "native"),
                                     "--actor-model", "actor-snapshot", "--user-model", "user-snapshot",
                                     "--task-id", "0", "--task-id", "1"])
    assert result.exit_code == 0, result.output or str(result.exception)
    spec = json.loads(path.read_text())
    assert spec["seeds"] == [0, 1, 2, 3]
    assert spec["task_ids"] == ["0", "1"]


def test_cli_demo_is_executable(tmp_path):
    result = CliRunner().invoke(app, ["demo", "--output", str(tmp_path / "demo"), "--groups", "10", "--bootstrap-samples", "100"])
    assert result.exit_code == 0, result.output or str(result.exception)
    assert '"scheduler_allowed": false' in result.output


def test_fitting_rejects_task_endpoints_that_change_across_actor_trials(tmp_path):
    corpus = demo_corpus(groups=5)
    changed = corpus[0].outcome.goal.model_copy(update={"completion": ("different realized endpoint",)})
    corpus[0] = corpus[0].model_copy(update={"outcome": corpus[0].outcome.model_copy(update={"goal": changed})})
    split = make_splits(corpus)
    with pytest.raises(ValueError, match="endpoint labels must remain identical"):
        fit(corpus, split, tmp_path / "invalid")
    assert not (tmp_path / "invalid").exists()


def test_initial_update_policy_never_requests_future_context_from_backend(tmp_path, monkeypatch):
    corpus = demo_corpus(groups=10, trials=1)
    split = make_splits(corpus, expected_trials=1)
    artifacts = tmp_path / "artifacts"
    fit(corpus, split, artifacts)

    class InitialOnlyBackend(GoalBackend):
        def predict(self, prefix):
            assert not any(event.kind in {"tool_request", "tool_result"} for event in prefix.events)
            return super().predict(prefix)

    monkeypatch.setattr("goalspec.experiment.GoalBackend", InitialOnlyBackend)
    summary = replay(corpus, split, artifacts, tmp_path / "replay", bootstrap_samples=100, goal_config=BackendConfig(update_policy="initial"))
    assert summary["metrics"]["goalspec"]["next_tool_nll"] == summary["metrics"]["goalspec_initial"]["next_tool_nll"]
    assert summary["metrics"]["shuffled"]["next_tool_nll"] == summary["metrics"]["shuffled_initial"]["next_tool_nll"]
