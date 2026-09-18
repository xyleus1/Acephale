from types import SimpleNamespace

import pytest

from goalspec.fixtures import demo_corpus
from goalspec.models import EmbeddingIndex, LLMGoalPredictor, ModelConfig, fit_temperature
from goalspec.replay import initial_prefix


def test_model_boundary_contains_no_evaluator_or_identifiers():
    trajectory = demo_corpus(groups=1, trials=1)[0]
    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"probabilities":{"return":0.8,"__unknown__":0.2}}'))])

    predictor = LLMGoalPredictor([trajectory.outcome.goal], ModelConfig(model="fixture"), completion=completion)
    posterior = predictor.predict(initial_prefix(trajectory))
    assert posterior.probabilities["return"] == pytest.approx(0.8)
    payload = str(calls[0])
    assert trajectory.trajectory_id not in payload
    assert "native_reward" not in payload
    assert "group_id" not in payload
    assert "evaluator_version" not in payload


def test_cosine_retrieval_and_invalid_embeddings():
    index = EmbeddingIndex([[1, 0], [0, 2], [1, 1]])
    assert index.search([0, 3], 1)[0] == (1, 1.0)
    with pytest.raises(ValueError):
        index.search([float("nan"), 1])
    with pytest.raises(ValueError):
        EmbeddingIndex([[0, 0]])


def test_calibration_penalizes_confident_errors():
    assert fit_temperature([({"a": .99, "b": .01}, "b")]) > 1
