from collections import defaultdict

import pytest

from goalspec.contracts_v1 import hash_v1
from goalspec.fixtures import demo_corpus
from goalspec.goals import fit_goals
from goalspec.models import public_model_input
from goalspec.prediction_v1 import (
    CONDITIONS,
    FrozenGoal,
    identical_candidate_pool,
    publish_prediction_report,
    rank_identical_pool,
    replay_predictions,
    summarize_replay,
)
from goalspec.replay import decision_points
from goalspec.schemas import Candidate, Prediction


def cohorts():
    corpus = demo_corpus(groups=4, trials=1)
    return corpus[:6], corpus[6:]


def test_pool_freezes_binding_opportunity_and_does_not_reuse_entity_values():
    training, heldout = cohorts()
    rows, manifest = replay_predictions(training, heldout)
    assert len(rows) == 6 * 2 * 7 * 2
    pools = defaultdict(set)
    for row in rows:
        if row.rankingControl:
            pools[row.pair_key].add(row.candidatePoolHash)
        for candidate in row.candidates:
            assert candidate.arguments["item_id"] in {"item-2", "item-3"}
    assert all(len(values) == 1 for values in pools.values())
    assert manifest["goalInput"] == "lexical_uncalibrated_baseline"
    report = summarize_replay(rows, bootstrap_samples=100)
    assert len(report["conditions"]) == len(CONDITIONS) * 2
    assert report["speculationHitRate"] is None
    assert "not true conditional entropy" in report["lossInterpretation"]
    assert any(value["rankingControl"] for value in report["comparisons"])


def test_same_tool_multiple_bindings_share_mass_and_duplicates_deduplicate():
    a = Candidate(tool="lookup", arguments={"id": "a"}, probability=.8)
    b = Candidate(tool="lookup", arguments={"id": "b"}, probability=.2)
    prediction = Prediction(tool_distribution={"lookup": .6, "other": .4}, candidates=(a, a, b))
    pool = identical_candidate_pool({"a": prediction})
    assert len(pool) == 2
    ranked = rank_identical_pool(prediction, pool)
    assert [c.probability for c in ranked.candidates] == [.3, .3]


def test_rejects_family_contamination_environment_drift_and_future_goal_cache():
    training, heldout = cohorts()
    with pytest.raises(ValueError, match="families overlap"):
        replay_predictions(training, training[:1] + heldout)
    with pytest.raises(ValueError, match="compatible training scope"):
        replay_predictions(training, [t.model_copy(update={"benchmark_revision": "changed"}) for t in heldout])
    catalog = fit_goals(training)
    cache = [FrozenGoal(trajectory_id=t.trajectory_id, through_seq=point.prefix.through_seq,
                        visible_input_hash=hash_v1(public_model_input(point.prefix)),
                        posterior=catalog.predict(point.prefix))
             for t in heldout for point in decision_points(t)]
    rows, provenance = replay_predictions(training, heldout, frozen_goals=cache)
    assert rows and provenance["goalInput"] == "frozen_checkpoint_cache"
    corrupt = cache[0].model_copy(update={"visible_input_hash": "future"})
    with pytest.raises(ValueError, match="different visible input"):
        replay_predictions(training, heldout, frozen_goals=[corrupt, *cache[1:]])


def test_report_is_immutable_and_hashes_artifacts(tmp_path):
    rows, provenance = replay_predictions(*cohorts())
    output = tmp_path / "fixture-only-report"
    summary = publish_prediction_report(rows, provenance, output, bootstrap_samples=100)
    assert summary["conditions"]["local_paste"]["steps"] == 12
    assert (output / "manifest.json").exists()
    with pytest.raises(FileExistsError):
        publish_prediction_report(rows, provenance, output, bootstrap_samples=100)
