from __future__ import annotations

import copy

import pytest

from acephale.custom_native_tasks import family_plan
from acephale.native_study import (
    paired_schedule,
    reviewed_partitions,
    smoke_command,
    validate_schedule,
)
from acephale.training_data import hashed, verify_hashed


def source():
    families = family_plan()
    partition = hashed({"families": {row["familyId"]: row["partition"] for row in families}})
    receipt = hashed({"fixture": "no native execution in this unit test"})
    tasks = [{"domain": family["domain"], "taskId": family["familyId"] + f"-v{variant}", "familyId": family["familyId"]}
             for family in families for variant in (0, 1)]
    return receipt, partition, tasks


def test_partition_review_binds_exact_source_and_never_claims_human_labels():
    receipt, partition, _ = source()
    proposal, review, approved = reviewed_partitions(receipt, partition)
    for artifact in (proposal, review, approved):
        verify_hashed(artifact)
    assert review["partitionProposalHash"] == proposal["contentHash"]
    assert approved["review"]["sourceDesignReviewHash"] == review["contentHash"]
    assert approved["customTaskReceiptHash"] == receipt["contentHash"]
    assert approved["review"]["humanAnnotationLabelReview"] is False
    assert approved["efficacyClaimAllowed"] is False
    assert len(approved["weightFitFamilies"]) == 24
    assert len(approved["testFamilies"]) == 8
    assert set(approved["weightFitFamilies"]).isdisjoint(approved["calibrationFamilies"])


def test_paired_schedules_fix_actor_seed_and_change_only_declared_arm():
    _, partition, tasks = source()
    development = paired_schedule(tasks, partition["families"], stage="development", experiment_id="unit")
    heldout = paired_schedule(tasks, partition["families"], stage="heldout", experiment_id="unit")
    assert len(development) == 36 and len(heldout) == 96
    assert development == paired_schedule(tasks, partition["families"], stage="development", experiment_id="unit")
    assert {row["seed"] for row in development} == {17}
    assert {row["predictorTrainingSeed"] for row in development} == {17, 29}
    assert {row["seed"] for row in heldout} == {17, 29}
    broken = copy.deepcopy(development)
    broken[1]["seed"] = 29
    with pytest.raises(ValueError, match="same task"):
        validate_schedule(broken)
    with pytest.raises(ValueError, match="all three"):
        validate_schedule(development[:-1])


def test_smoke_command_requires_actual_container_identity():
    options = {"python": "/usr/bin/python", "dataset": "/data/diagnostic", "model": "/models/predictor",
               "image_receipt": "/receipts/image.json", "lease": "/receipts/smoke-lease.json",
               "actor_container": "a" * 64, "output": "/runs/new-smoke"}
    command = smoke_command(**options)
    assert command[command.index("--action") + 1] == "smoke"
    assert command[command.index("--dataset") + 1] == "/data/diagnostic"
    assert "--max-steps" not in command
    options["actor_container"] = "placeholder"
    with pytest.raises(ValueError, match="actual paths"):
        smoke_command(**options)
