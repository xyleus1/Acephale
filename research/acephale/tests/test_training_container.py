from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from acephale import training_container as container
from acephale.contracts_v1 import hash_v1
from acephale.training_data import hashed


def test_cache_paths_are_writable_retained_and_independent(tmp_path):
    first, second = tmp_path / "first", tmp_path / "second"
    environment = container.writable_environment(first)
    assert environment == container.writable_environment(second)
    for target in environment.values():
        relative = target.removeprefix("/output/")
        assert (first / relative).is_dir()
        assert (second / relative).is_dir()
        assert not list((first / relative).glob(".write-probe-*"))
    (first / "cache" / "triton" / "retained").write_text("first run")
    assert not (second / "cache" / "triton" / "retained").exists()


def test_cache_creation_failure_remains_visible(tmp_path):
    (tmp_path / "home").write_text("existing file")
    with pytest.raises(FileExistsError):
        container.writable_environment(tmp_path)


@pytest.mark.parametrize("action", ["smoke", "train", "export", "evaluate"])
def test_launch_retains_cache_environment_without_weakening_isolation(tmp_path, monkeypatch, action):
    inputs = [{"path": "training/uv.lock", "bytes": 1, "sha256": "a" * 64}]
    image = {"Id": "sha256:" + "c" * 64, "Config": {"Labels": {container.LABEL: hash_v1(inputs)}}}
    receipt = hashed({"kind": "acephale-training-image", "imageId": image["Id"], "inputs": inputs,
                      "inputHash": hash_v1(inputs), "imageInventory": image})
    receipt_path = tmp_path / "image.json"
    receipt_path.write_text(json.dumps(receipt))
    dataset, model, prior = (tmp_path / name for name in ("dataset", "model", "prior"))
    for path in (dataset, model, prior):
        path.mkdir()
    lease_path = tmp_path / "lease.json"
    lease_path.write_text("{}")
    actor_id = "f" * 64
    monkeypatch.setattr(container, "os", SimpleNamespace(name="posix", getuid=lambda: 1000, getgid=lambda: 1000))
    monkeypatch.setattr(container, "validate_training_lease", lambda path: {"testFixture": True})
    monkeypatch.setattr(container, "checked", lambda command, **kwargs: json.dumps([image if command[1] == "image" else
        {"Id": actor_id, "State": {"Running": False}}]))
    calls = []

    class Process:
        returncode = 0

        def poll(self):
            return self.returncode

    def launch(command, **kwargs):
        calls.append(command)
        return Process()

    monkeypatch.setattr(container, "subprocess", SimpleNamespace(Popen=launch, STDOUT=-2,
        run=lambda command, **kwargs: SimpleNamespace(returncode=0)))
    output = tmp_path / "run"
    args = SimpleNamespace(actor_container=actor_id, lease=lease_path, receipt=receipt_path, output=output,
        action=action, model=model, dataset=dataset, training_run=prior if action == "export" else None,
        seed=17, max_steps=500, maximum_seconds=3600, partition="development")
    assert container.run(args)["status"] == "completed"
    command = calls[0]
    assert command[command.index("--network") + 1] == "none"
    assert command[command.index("--user") + 1] == "1000:1000"
    assert "--privileged" not in command
    mounts = [command[i + 1] for i, value in enumerate(command) if value == "--mount"]
    for target in ("/model", "/dataset", "/lease.json"):
        assert any(value.endswith("dst=" + target + ",readonly") for value in mounts)
    assert any(value.endswith("dst=/output") for value in mounts)
    environment = dict(command[i + 1].split("=", 1) for i, value in enumerate(command) if value == "--env")
    assert environment == {**container.CACHE_ENVIRONMENT, "ACEPHALE_TRAINER_IMAGE_DIGEST": image["Id"]}
    launch_receipt = json.loads((output / "launch.json").read_text())
    assert launch_receipt["environment"] == container.CACHE_ENVIRONMENT
    assert launch_receipt["launcherSourceHash"] == container.file_hash(Path(container.__file__))
    assert launch_receipt["imageReceiptHash"] == receipt["contentHash"]
    for target in container.CACHE_ENVIRONMENT.values():
        assert (output / target.removeprefix("/output/")).is_dir()
