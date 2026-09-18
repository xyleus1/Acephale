import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from goalspec.goal_backends import BackendConfig, GoalBackend, _digest
from goalspec.goals import UNKNOWN_GOAL, GoalCatalog, GoalExample, normalize_goal
from goalspec.models import public_model_input
from goalspec.schemas import Event, GoalSignature, PrefixView
from goalspec.storage import file_hash, write_json


def fixtures():
    returned = normalize_goal(GoalSignature(goal_id="r", objective="RETURN_ITEM", object_type="item", completion=("return refund",)))
    expedited = normalize_goal(GoalSignature(goal_id="e", objective="EXPEDITE", object_type="shipment", completion=("expedite delivery",)))
    transfer = normalize_goal(GoalSignature(goal_id="b", objective="TRANSFER_FUNDS", object_type="account", completion=("money transferred",)))
    catalog = GoalCatalog(signatures=(returned, expedited, transfer), examples=(GoalExample(benchmark="fixture", domain="retail", goal_id=returned.goal_id, text="return refund"), GoalExample(benchmark="fixture", domain="retail", goal_id=expedited.goal_id, text="expedite delivery"), GoalExample(benchmark="fixture", domain="banking", goal_id=transfer.goal_id, text="transfer money")))
    prefix = PrefixView(trajectory_id="private-trajectory-id", benchmark="fixture", domain="retail", task_id="private-task-id", trial=3, through_seq=0, policy="Follow policy", tools=(), events=(Event(seq=0, kind="message", role="user", content="return refund"),))
    return catalog, prefix, returned, expedited, transfer


def test_backend_model_and_temperature_are_explicit_and_valid():
    assert BackendConfig().backend == "lexical"
    for kwargs in ({"backend": "llm"}, {"backend": "embedding", "model": ""}, {"calibration_temperature": 0}, {"calibration_temperature": float("nan")}, {"retrieval_engine": "wrong"}, {"model": "unused"}):
        with pytest.raises(ValidationError):
            BackendConfig(**kwargs)


def test_lexical_backend_is_offline_calibrated_and_cached_by_visible_context():
    catalog, prefix, returned, _, _ = fixtures()
    backend = GoalBackend(catalog)
    predicted = backend.predict(prefix)
    assert max(predicted.probabilities, key=predicted.probabilities.get) == returned.goal_id
    renamed = prefix.model_copy(update={"task_id": "different-private-id", "through_seq": 2})
    again = backend.predict(renamed)
    assert again.probabilities == predicted.probabilities
    assert again.through_seq == 2
    artifacts = backend.artifacts()
    assert len(artifacts["scored_inputs"]) == 1
    assert "private-task-id" not in json.dumps(artifacts)
    assert artifacts["embedding_indexes"] == []


def test_llm_only_receives_scope_catalog_and_visible_context_and_shares_outputs():
    catalog, prefix, returned, expedited, banking = fixtures()
    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        body = json.loads(kwargs["messages"][1]["content"])
        assert {goal["goal_id"] for goal in body["goals"]} == {returned.goal_id, expedited.goal_id}
        assert banking.goal_id not in kwargs["messages"][1]["content"]
        assert "private-task-id" not in kwargs["messages"][1]["content"]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"probabilities": {returned.goal_id: 0.8, expedited.goal_id: 0.1, UNKNOWN_GOAL: 0.1}})))])

    backend = GoalBackend(catalog, BackendConfig(backend="llm", model="mock/model"), completion=completion)
    assert backend.predict(prefix).probabilities[returned.goal_id] == pytest.approx(0.8)
    backend.predict(prefix.model_copy(update={"trajectory_id": "different"}))
    assert len(calls) == 1
    assert backend.predict(prefix.model_copy(update={"domain": "unseen"})).probabilities == {UNKNOWN_GOAL: 1.0}
    assert len(calls) == 1


def test_embedding_index_is_training_only_scoped_and_provenance_complete():
    catalog, prefix, returned, _, banking = fixtures()
    calls = []

    def embedder(texts, model):
        calls.append((list(texts), model))
        assert model == "mock/embedding"
        assert "private-task-id" not in " ".join(texts)
        return [[1.0, 0.0, 0.0] if "return" in text.lower() else [0.0, 1.0, 0.0] if "expedite" in text.lower() else [0.0, 0.0, 1.0] for text in texts]

    backend = GoalBackend(catalog, BackendConfig(backend="embedding", model="mock/embedding"), embedder=embedder)
    assert len(calls) == 1
    assert len(calls[0][0]) == 3
    result = backend.predict(prefix)
    assert result.probabilities[returned.goal_id] > 0.9
    assert banking.goal_id not in result.probabilities
    backend.predict(prefix)
    assert len(calls) == 2
    artifacts = backend.artifacts()
    assert len(artifacts["embedding_indexes"]) == 2
    assert all(len(row["vectors"]) == len(row["text_sha256"]) == len(row["goal_ids"]) for row in artifacts["embedding_indexes"])
    assert len(artifacts["scored_inputs"][0]["vector"]) == 3
    json.dumps(artifacts, allow_nan=False)


def test_embedding_unknown_and_provider_failures_do_not_silently_change_backend():
    catalog, prefix, _, _, _ = fixtures()

    def embedder(texts, model):
        if len(texts) > 1:
            return [[1.0, 0.0] for _ in texts]
        return [[-1.0, 0.0]]

    backend = GoalBackend(catalog, BackendConfig(backend="embedding", model="mock"), embedder=embedder)
    assert backend.predict(prefix).probabilities == {UNKNOWN_GOAL: 1.0}
    with pytest.raises(ValueError, match="incomplete"):
        GoalBackend(catalog, BackendConfig(backend="embedding", model="mock"), embedder=lambda texts, model: [])
    broken = GoalBackend(catalog, BackendConfig(backend="embedding", model="mock"), embedder=lambda texts, model: [[1.0, 0.0] for _ in texts] if len(texts) > 1 else [[0.0, 0.0]])
    with pytest.raises(ValueError, match="query"):
        broken.predict(prefix)


def cached_fixture(tmp_path, *, probabilities=None, change=None):
    catalog, prefix, returned, _, _ = fixtures()
    capture = {"schema_version": 1, "model": "mock/captured", "catalog_sha256": _digest(catalog.model_dump(mode="json")), "status": "complete", "input_policy": "public_initial_context_only", "predictions": [{"benchmark": prefix.benchmark, "domain": prefix.domain, "input_sha256": _digest(public_model_input(prefix)), "probabilities": probabilities or {returned.goal_id: 0.9, UNKNOWN_GOAL: 0.1}}]}
    if change:
        change(capture)
    path = tmp_path / "capture.json"
    write_json(path, capture)
    config = BackendConfig(backend="cached_llm", model="mock/captured", update_policy="initial", cached_predictions=str(path), cache_sha256=file_hash(path))
    return catalog, prefix, path, config


def test_cached_backend_matches_exact_public_input_without_record_ids(tmp_path):
    catalog, prefix, _, config = cached_fixture(tmp_path)
    backend = GoalBackend(catalog, config)
    first = backend.predict(prefix)
    renamed = prefix.model_copy(update={"task_id": "renamed-task", "trajectory_id": "renamed-trial", "trial": 55})
    assert backend.predict(renamed).probabilities == first.probabilities
    assert "private-task-id" not in json.dumps(backend.artifacts())
    changed = prefix.model_copy(update={"events": (Event(seq=0, kind="message", role="user", content="another visible query"),)})
    with pytest.raises(ValueError, match="exact public context"):
        backend.predict(changed)
    with pytest.raises(ValueError, match="exact public context"):
        backend.predict(prefix.model_copy(update={"domain": "banking"}))


def test_cached_backend_rejects_content_tampering_and_wrong_model_or_catalog(tmp_path):
    catalog, prefix, path, config = cached_fixture(tmp_path)
    with pytest.raises(ValueError, match="catalog or model"):
        GoalBackend(catalog, config.model_copy(update={"model": "different"}))
    altered = catalog.model_copy(update={"score_power": 7.0})
    with pytest.raises(ValueError, match="catalog or model"):
        GoalBackend(altered, config)
    path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256"):
        GoalBackend(catalog, config)


@pytest.mark.parametrize("change", [lambda body: body.update(status="failed"), lambda body: body.update(input_policy="all_future_events"), lambda body: body["predictions"].append(body["predictions"][0])])
def test_cached_backend_rejects_partial_or_duplicate_capture(tmp_path, change):
    catalog, _, _, config = cached_fixture(tmp_path, change=change)
    with pytest.raises(ValueError):
        GoalBackend(catalog, config)


def test_cached_backend_rejects_out_of_scope_posterior(tmp_path):
    banking_id = fixtures()[-1].goal_id
    catalog, prefix, _, config = cached_fixture(tmp_path, probabilities={banking_id: 1.0})
    with pytest.raises(ValueError, match="out-of-scope"):
        GoalBackend(catalog, config).predict(prefix)
