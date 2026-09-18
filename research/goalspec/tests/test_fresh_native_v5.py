import copy
from collections import Counter

import pytest

from goalspec.fresh_tasks import digest
from goalspec.fresh_tasks_v5 import STRUCTURES, build_tasks, family_splits


def test_structural_family_splits_precede_labels_and_keep_variants_together():
    train, dev = build_tasks("test-v5-families", "training"), build_tasks("test-v5-families", "development")
    assert len(train) == 40 and len(dev) == 4
    assert Counter(row["domain"] for row in train) == {"airline": 20, "retail": 20}
    assert Counter(row["learningSplit"] for row in train) == {"train": 32, "calibration": 8}
    assert len({row["familyId"] for row in train}) == 20
    assert not {row["familyId"] for row in train} & {row["familyId"] for row in dev}
    structures = [value for splits in STRUCTURES.values() for families in splits.values() for value in families.values()]
    assert len(structures) == len(set(structures)) == 24
    assert family_splits() == family_splits()
    for family in {row["familyId"] for row in train}:
        rows = [row for row in train if row["familyId"] == family]
        assert {row["variant"] for row in rows} == {0, 1}
        assert len({row["learningSplit"] for row in rows}) == 1
        assert len({row["structureHash"] for row in rows}) == 1


def test_generation_is_reproducible_and_has_honest_lineage():
    tasks = build_tasks("test-v5-families", "training")
    assert tasks == build_tasks("test-v5-families", "training")
    for row in tasks:
        assert row["fixtureHash"] == digest({k: v for k, v in row.items() if k != "fixtureHash"})
        assert row["lineage"]["publishedTaskUsed"] is False
        assert row["label"] == "custom tau-compatible pilot"
        assert row["preservePaths"]
        assert "###STOP###" not in row["userInstructions"]
    with pytest.raises(ValueError):
        build_tasks("../unsafe", "training")
    with pytest.raises(ValueError):
        build_tasks("test-v5-families", "confirmation")


def test_conditional_variants_include_predeclared_negative_decisions():
    tasks = build_tasks("test-v5-families", "training")
    for suffix in ("two_product_modification_total_cap", "all_economy_upgrades_combined_cap", "group_upgrade_seat_feasibility"):
        pair = [row for row in tasks if row["familyId"].endswith(suffix)]
        assert pair[0]["referenceActions"]
        assert pair[1]["referenceActions"] == [] and pair[1]["responsePatterns"]
        assert pair[1]["requireConfirmation"] is False
    seats = next(row for row in tasks if row["familyId"].endswith("group_upgrade_seat_feasibility") and row["variant"] == 1)
    first = next(iter(seats["initialDatabase"]["reservations"].values()))
    assert len(first["passengers"]) == 2


def test_compositions_preserve_cross_record_original_values_and_ordering():
    tasks = build_tasks("test-v5-families", "training")
    swap = next(row for row in tasks if row["familyId"].endswith("swap_two_order_shipping_addresses"))
    orders = swap["initialDatabase"]["orders"]
    left, right = swap["referenceActions"]
    assert {k: v for k, v in left["arguments"].items() if k != "order_id"} == orders[right["arguments"]["order_id"]]["address"]
    assert {k: v for k, v in right["arguments"].items() if k != "order_id"} == orders[left["arguments"]["order_id"]]["address"]
    ordered = next(row for row in tasks if row["familyId"].endswith("payment_before_variant_same_order"))
    before, after = ordered["referenceActions"]
    assert before["name"] == "modify_pending_order_payment" and after["name"] == "modify_pending_order_items"
    assert before["arguments"]["payment_method_id"] == after["arguments"]["payment_method_id"]
    pair = next(row for row in tasks if row["familyId"].endswith("two_product_modification_total_cap") and row["variant"] == 0)
    assert len(pair["referenceActions"]) == 1 and len(pair["referenceActions"][0]["arguments"]["item_ids"]) == 2


def test_fixture_hash_detects_reference_change_without_mutating_original():
    original = build_tasks("test-v5-families", "training")[0]
    changed = copy.deepcopy(original)
    changed["referenceActions"].reverse()
    assert changed["fixtureHash"] != digest({k: v for k, v in changed.items() if k != "fixtureHash"})
    assert original == build_tasks("test-v5-families", "training")[0]
