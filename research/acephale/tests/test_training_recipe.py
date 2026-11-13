from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.training import (
    effective_training_recipe,
    lora_options,
    optimizer_steps,
    trainer_options,
    validate_training_lease,
)
from acephale.training_data import RECIPE, training_recipe


@pytest.mark.parametrize("micro,accumulation", [(1, 16), (2, 8), (4, 4)])
def test_batch_profiles_preserve_effective_batch_and_recipe(micro, accumulation):
    original = copy.deepcopy(RECIPE)
    recipe = training_recipe(micro_batch=micro, gradient_accumulation=accumulation)
    steps = optimizer_steps(34, 500, recipe)
    assert steps == 9
    effective = effective_training_recipe(steps, micro_batch=micro, gradient_accumulation=accumulation)
    options = trainer_options(effective)
    assert options["per_device_train_batch_size"] * options["gradient_accumulation_steps"] == 16
    assert options["max_steps"] == 9
    assert options["learning_rate"] == original["learningRate"]
    assert options["max_length"] == original["maxLength"]
    assert options["warmup_ratio"] == 0.03
    assert options["completion_only_loss"] is True
    assert lora_options(effective, ["q_proj"]) == {
        "r": 16, "lora_alpha": 32, "lora_dropout": 0.05, "target_modules": ["q_proj"], "task_type": "CAUSAL_LM", "bias": "none"}
    recipe["seeds"].append(99)
    assert RECIPE == original


@pytest.mark.parametrize("micro,accumulation", [(4, 16), (8, 2), (0, 16), (True, 16), (1, 16.0)])
def test_reject_undeclared_batch_profiles(micro, accumulation):
    with pytest.raises(ValueError, match="batch profile"):
        training_recipe(micro_batch=micro, gradient_accumulation=accumulation)


def test_optimizer_steps_are_bounded_and_require_actual_examples():
    recipe = training_recipe()
    assert optimizer_steps(10000, 500, recipe) == 500
    assert optimizer_steps(34, 1, recipe) == 1
    for count, steps in ((0, 500), (1, 501), (1, True)):
        with pytest.raises(ValueError):
            optimizer_steps(count, steps, recipe)


def amended_lease():
    policy = json.loads((Path(__file__).resolve().parents[3] / "src/lib/acephale/contracts/budget-policy-v2.json").read_text())
    return {"version": 2, "profile": "acephale-training-lease-v2", "phase": "predictor_training", "status": "active",
            "actorStopped": True, "startedAt": 100, "deadline": 14500, "hardwareProfile": "a100-40gb-v1",
            "instanceId": "instance", "leaseId": "lease", "studyBindingHash": hash_v1("study"),
            "providerLeaseHash": hash_v1("provider"), "studyReservation": {"reservationId": "lambda-infra:lease", "maximumMicrodollars": 40_000_000},
            "budgetPolicy": policy, "budgetPolicyHash": hash_v1(policy), "budgetAmendmentHash": hash_v1("amendment"), "trainingKind": "fit"}


def test_amended_lease_requires_exact_versioned_policy_and_keeps_legacy_caps(tmp_path):
    lease = amended_lease()
    path = tmp_path / "lease.json"

    def validate():
        path.write_text(json.dumps(lease))
        return validate_training_lease(path, now=150)

    assert validate() == lease
    lease["version"], lease["profile"] = 1, "acephale-training-lease-v1"
    with pytest.raises(ValueError, match="window"):
        validate()
    lease["deadline"] = 200
    with pytest.raises(ValueError, match="reservation"):
        validate()
    lease = amended_lease()
    lease["trainingKind"] = "smoke"
    with pytest.raises(ValueError, match="window"):
        validate()
    lease["deadline"] = 1000
    assert validate() == lease
    lease["budgetPolicy"]["additionalSmokeSeconds"] = 99999
    lease["budgetPolicyHash"] = hash_v1(lease["budgetPolicy"])
    with pytest.raises(ValueError, match="exact approved"):
        validate()
