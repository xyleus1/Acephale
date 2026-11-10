"""Installed CLI and extracted native controls need no application or model runtime."""

import json
import tomllib
from pathlib import Path

import pytest

from acephale.infra_cli import main
from acephale.native_common import REVISION, drain_trial, read, summarize_costs, write
from acephale.training_cli import main as training_main


def test_console_entry_and_help_are_the_current_infrastructure_pipeline(capsys):
    root = Path(__file__).resolve().parents[1]
    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    assert project["project"]["scripts"] == {"acephale": "acephale.infra_cli:main", "acephale-train": "acephale.training_cli:main"}
    with pytest.raises(SystemExit) as stopped:
        main(["--help"])
    assert stopped.value.code == 0
    output = capsys.readouterr().out
    for command in ("export", "pilot", "fit-calibration", "native", "score-panel-replay"):
        assert command in output
    assert "import-v5" not in output
    with pytest.raises(SystemExit) as stopped:
        training_main(["--help"])
    assert stopped.value.code == 0
    output = capsys.readouterr().out
    for command in ("prepare", "verify", "train", "smoke", "export", "evaluate"):
        assert command in output


def test_native_checkout_pin_matches_the_lock():
    root = Path(__file__).resolve().parents[1]
    lock = json.loads((root / "benchmarks.lock.json").read_text(encoding="utf-8"))
    assert REVISION == lock["benchmarks"]["tau3"]["revision"]


def test_control_artifacts_are_exclusive_and_do_not_replace_existing_content(tmp_path):
    path = tmp_path / "control.json"
    write(path, {"reservation": 25})
    original = path.read_bytes()
    with pytest.raises(FileExistsError):
        write(path, {"reservation": 0})
    assert path.read_bytes() == original
    assert read(path) == {"reservation": 25}


def test_failed_drain_preserves_unknown_charge_and_attempts_both_workers():
    workers = []

    class Broker:
        def finish(self, worker):
            workers.append(worker)
            if worker == "run":
                raise TimeoutError("fixture")

    ticks = iter([11, 14])
    result = drain_trial(Broker(), "run", 1, 9, clock=lambda: next(ticks))
    assert workers == ["run", "run:user"]
    assert result["serviceDrainSucceeded"] is False
    assert result["nativeOrchestrationSeconds"] == 9
    assert result["totalTrialSeconds"] == 13
    assert result["serviceDrainErrors"] == [{"workerId": "run", "exceptionType": "TimeoutError"}]
    assert summarize_costs(
        [
            {"billedUsd": 0.25},
            {"billedUsd": None, "knownUsageSubtotalUsd": 0.1, "unknownProviderCharge": True},
        ]
    ) == {"billedUsd": None, "knownUsageSubtotalUsd": 0.35, "unknownCharges": 1}
