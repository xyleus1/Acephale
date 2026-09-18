import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("bfcl_probe", Path(__file__).with_name("bfcl_probe.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_selection_is_disjoint_balanced_deterministic_and_id_only():
    categories = {name: [f"{name}_{index}" for index in range(40)] for name in ("multiple", "irrelevance")}
    excluded = {f"{name}_{index}" for name in categories for index in range(5)}
    selected = MODULE.select_ids(categories, excluded)
    assert all(len(ids) == 16 for ids in selected.values())
    assert not excluded & {identity for ids in selected.values() for identity in ids}
    assert selected == MODULE.select_ids({name: list(reversed(ids)) for name, ids in categories.items()}, excluded)


def test_selection_never_replaces_with_excluded_or_undersized_cases():
    categories = {name: [f"{name}_{index}" for index in range(15)] for name in ("multiple", "irrelevance")}
    with pytest.raises(ValueError, match="Insufficient"):
        MODULE.select_ids(categories, set())
    with pytest.raises(ValueError, match="sixteen"):
        MODULE.select_ids(categories, set(), 5)
    categories["multiple"] += ["multiple_0"]
    with pytest.raises(ValueError, match="Duplicate"):
        MODULE.select_ids(categories, set())
