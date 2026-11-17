from __future__ import annotations

import copy
import json

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.training_data import TrainingExample, multitask_training_coverage


def examples():
    rows = []
    for family in range(24):
        for checkpoint in range(4):
            prefix = f"f{family}-c{checkpoint}"
            prompt = [{"role": "user", "content": prefix}]
            base = {"schemaVersion": 1, "id": prefix, "familyId": str(family), "partition": "weight_fit",
                    "task": "rank_binary", "condition": "neutral", "prompt": prompt,
                    "completion": json.dumps({"action": "READ" if checkpoint < 2 else "NO_READ", "hits": [int(checkpoint < 2)]}),
                    "compiledInputHash": hash_v1(prompt), "sourceFrameHash": hash_v1(prefix), "candidateIds": ["candidate"],
                    "candidateWindowHash": hash_v1([prefix]), "promptTokens": 10,
                    "provenance": {"sourceDatasetHash": hash_v1("source"), "publicInputHash": hash_v1(prefix),
                        "labelHash": hash_v1(prefix), "compilerHash": hash_v1("compiler"), "tokenizerHash": hash_v1("tokenizer"),
                        "chatTemplateHash": hash_v1("template"), "sourceSplit": "train", "observedNextBatch": True,
                        "exportProtocol": "native-multitask-v2"}}
            neutral = copy.deepcopy(base)
            neutral["id"] += ":neutral"
            conditional = copy.deepcopy(base)
            conditional.update(id=prefix + ":conditional", condition="conditional")
            conditional["provenance"]["annotationHash"] = hash_v1([prefix, "annotation"])
            goal = copy.deepcopy(conditional)
            goal.update(id=prefix + ":goal", task="goal", condition=None, candidateIds=[], candidateWindowHash=None,
                        completion='{"schemaVersion":1,"hypotheses":[],"unknown":1}')
            rows.extend(TrainingExample.model_validate(row) for row in (neutral, conditional, goal))
    return rows


def test_floor_counts_checkpoint_triplets_not_supervised_rows():
    rows = examples()
    assert len(rows) == 288
    coverage = multitask_training_coverage(rows)
    assert coverage["completeCheckpoints"] == 96
    assert coverage["positiveReadCheckpoints"] == 48
    assert coverage["fittingFamilies"] == 24
    assert set(coverage["checkpointsPerFamily"].values()) == {4}


def test_missing_pair_cannot_become_neutral_fitting():
    rows = examples()
    with pytest.raises(ValueError, match="complete goal"):
        multitask_training_coverage(rows[:-1])
    rows[-1].provenance.pop("exportProtocol")
    with pytest.raises(ValueError, match="neutral-only"):
        multitask_training_coverage(rows)


def test_both_conditions_must_use_identical_targets_and_windows():
    rows = examples()
    rows[1].candidateIds = ["changed"]
    with pytest.raises(ValueError, match="matched labels"):
        multitask_training_coverage(rows)


def test_cannot_train_on_one_family_repeated_or_too_few_positive_prefixes():
    rows = examples()
    with pytest.raises(ValueError, match="24 families"):
        multitask_training_coverage([row for row in rows if row.familyId != "23"])
    for row in rows[:2]:
        row.completion = '{"action":"NO_READ","hits":[0]}'
    with pytest.raises(ValueError, match="48 positive"):
        multitask_training_coverage(rows)


def test_legacy_neutral_pilot_is_not_relabelled_as_multitask():
    rows = examples()[:1]
    rows[0].provenance.pop("exportProtocol")
    assert multitask_training_coverage(rows) is None
