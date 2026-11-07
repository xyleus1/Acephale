import pytest

from acephale.live_design import ARMS, freeze_heldout, validate_completed_grid


def test_balanced_paired_grid_freezes_from_development_costs_only():
    families = [f"{domain}:{i}" for domain in ("retail", "airline") for i in range(8)]
    design = freeze_heldout(families, [1], False, seed=19)
    assert len(design["families"]) == 16
    assert len(design["trials"]) == 192
    assert design["reserved_usd"] == 240
    for index in range(0, len(design["trials"]), 3):
        block = design["trials"][index:index + 3]
        assert {t["arm"] for t in block} == set(ARMS)
        assert len({t["seed"] for t in block}) == 1
    censored = freeze_heldout(families, [1], True, seed=19)
    assert len(censored["families"]) == 8
    assert censored["reserved_usd"] == 240
    with pytest.raises(ValueError):
        validate_completed_grid(design, [])


def test_remaining_allocation_limits_complete_paired_blocks():
    families = [f"{domain}:{i}" for domain in ("retail", "airline") for i in range(8)]
    design = freeze_heldout(families, [1], False, seed=19, remaining_usd=60)
    assert len(design["families"]) == 4
    assert len(design["trials"]) == 48
    assert design["reserved_usd"] == 60
    assert freeze_heldout(families, [1], False, seed=19, remaining_usd=0)["trials"] == []
    with pytest.raises(ValueError, match="remaining"):
        freeze_heldout(families, [1], False, seed=19, remaining_usd=241)
