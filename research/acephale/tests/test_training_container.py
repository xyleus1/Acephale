from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from acephale import training_container as container
from acephale.contracts_v1 import hash_v1
from acephale.training_data import hashed


def test_system_package_change_invalidates_image_inputs(tmp_path):
    names = [container.DOCKERFILE, "infra/acephale-infra-v1/trainer-system-packages.txt", ".dockerignore",
             "research/acephale/pyproject.toml", "research/acephale/training/pyproject.toml",
             "research/acephale/training/uv.lock"]
    for name in names:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture\n")
    before = container.build_inputs(tmp_path)
    packages = tmp_path / "infra/acephale-infra-v1/trainer-system-packages.txt"
    packages.write_text("gcc=changed-fixture-version\n")
    after = container.build_inputs(tmp_path)
    assert hash_v1(before) != hash_v1(after)
    packages.unlink()
    with pytest.raises(ValueError, match="regular source files"):
        container.build_inputs(tmp_path)


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


@pytest.mark.parametrize("action,unmerged", [("smoke", False), ("smoke", True), ("profile", False), ("train", False),
    ("export", False), ("evaluate", False), ("export", True), ("evaluate", True)])
def test_launch_retains_cache_environment_without_weakening_isolation(tmp_path, monkeypatch, action, unmerged):
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
        artifact_mode="unmerged_lora" if unmerged and action in {"export", "smoke"} else "merged",
        predictor_export=prior if unmerged and action == "evaluate" else None,
        seed=17, max_steps=500, maximum_seconds=None, partition="development")
    assert container.run(args)["status"] == "completed"
    command = calls[0]
    if action in {"profile", "train"}:
        assert command[command.index("--maximum-seconds") + 1] == ("600" if action == "profile" else "3600")
    if action in {"export", "smoke"}:
        assert command[command.index("--artifact-mode") + 1] == ("unmerged_lora" if unmerged else "merged")
    if unmerged and action == "evaluate":
        assert command[command.index("--predictor-export") + 1] == "/predictor-export"
        assert command[command.index("--model") + 1] == "/model"
    assert command[command.index("--network") + 1] == "none"
    assert command[command.index("--user") + 1] == "1000:1000"
    assert "--privileged" not in command
    mounts = [command[i + 1] for i, value in enumerate(command) if value == "--mount"]
    for target in ("/model", "/dataset", "/lease.json"):
        assert any(value.endswith("dst=" + target + ",readonly") for value in mounts)
    assert any(value.endswith("dst=/output") for value in mounts)
    if unmerged and action == "evaluate":
        assert any(value.endswith("dst=/predictor-export,readonly") for value in mounts)
    environment = dict(command[i + 1].split("=", 1) for i, value in enumerate(command) if value == "--env")
    assert environment == {**container.CACHE_ENVIRONMENT, "ACEPHALE_TRAINER_IMAGE_DIGEST": image["Id"]}
    launch_receipt = json.loads((output / "launch.json").read_text())
    assert launch_receipt["environment"] == container.CACHE_ENVIRONMENT
    assert launch_receipt["launcherSourceHash"] == container.file_hash(Path(container.__file__))
    assert launch_receipt["imageReceiptHash"] == receipt["contentHash"]
    for target in container.CACHE_ENVIRONMENT.values():
        assert (output / target.removeprefix("/output/")).is_dir()


@pytest.mark.parametrize("maximum", [0, 1201, True])
def test_profile_rejects_unbounded_launch_before_docker(maximum):
    with pytest.raises(ValueError, match="bounded"):
        container.run(SimpleNamespace(action="profile", maximum_seconds=maximum))


def test_unmerged_options_cannot_silently_change_training():
    with pytest.raises(ValueError, match="only to export"):
        container.run(SimpleNamespace(action="train", artifact_mode="unmerged_lora"))
    with pytest.raises(ValueError, match="evaluation-only"):
        container.run(SimpleNamespace(action="train", predictor_export=Path("unmerged")))
