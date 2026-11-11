from __future__ import annotations

import copy
import sys
from types import SimpleNamespace

import pytest

from acephale import training, training_cli
from acephale.training_data import RECIPE


def test_explicit_smoke_recipe_preserves_all_fitting_settings():
    original = copy.deepcopy(RECIPE)
    assert training.effective_training_recipe(9) == {**original, "maxSteps": 9}
    assert training.effective_training_recipe(1) == {**original, "maxSteps": 1}
    assert training.effective_training_recipe(1, smoke=True) == {
        **original, "maxSteps": 1, "warmupRatio": 0.0,
    }
    assert RECIPE == original
    with pytest.raises(ValueError, match="exactly one"):
        training.effective_training_recipe(9, smoke=True)


def test_smoke_cli_explicitly_selects_smoke_without_changing_train_command(tmp_path, monkeypatch):
    calls = []

    def record_train(*args, **kwargs):
        calls.append((args, kwargs))
        return {"contentHash": "training-receipt"}

    exports = []

    def record_export(*args):
        exports.append(args)
        return {"contentHash": "export-receipt"}

    monkeypatch.setattr(training, "train", record_train)
    monkeypatch.setattr(training, "export_model", record_export)
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(empty_cache=lambda: None)))
    paths = ["--dataset", str(tmp_path / "dataset"), "--model", str(tmp_path / "model"),
             "--lease", str(tmp_path / "lease.json")]
    training_cli.main(["smoke", *paths, "--output", str(tmp_path / "smoke")])
    assert calls[0][1] == {"seed": 17, "max_steps": 1, "maximum_seconds": 900, "smoke": True}
    assert exports[0][2] == tmp_path / "smoke" / "training"
    for seed in (17, 29):
        training_cli.main(["train", *paths, "--output", str(tmp_path / str(seed)), "--seed", str(seed)])
        assert calls[-1][1] == {"seed": seed, "max_steps": 500, "maximum_seconds": 3600}
    assert len(exports) == 1
