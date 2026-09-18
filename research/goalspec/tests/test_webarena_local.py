import importlib.util
import json
from pathlib import Path

import pytest

from goalspec.adapters.webarena_local import REVISION, LocalWebArenaController


def fixture():
    config = {"sourceRevision": REVISION, "site": "shopping", "checkout": "/trusted/webarena", "deploymentDirectory": "/trusted/generated",
              "origins": {"authoritative": "http://127.0.0.1:7770", "snapshot": "http://127.0.0.1:17770"},
              "fingerprintCommand": ["fingerprint", "{stack}"], "verifierCommand": ["native-verifier"], "tasks": {"task-1": {"registered": True}}}
    hashes = {"authoritative": "a" * 64, "snapshot": "a" * 64}
    calls = []
    share_storage = [False]
    def command(argv, payload=None, timeout=10):
        calls.append((argv, payload, timeout))
        if argv[0] == "git":
            return REVISION
        if argv[0] == "fingerprint":
            return json.dumps({"stateHash": hashes[argv[1]], "completeDatabaseProjection": True})
        if argv[:2] == ["docker", "inspect"]:
            stack = "snapshot" if "snapshot" in argv[2] else "authoritative"
            return json.dumps([{"Id": f"{stack}-{index}", "State": {"Running": True}, "Config": {"Labels": {"goalspec.stack": stack}},
                                "Mounts": [{"Source": f"/volume/{'shared' if share_storage[0] else stack}/{index}", "RW": True}],
                                "NetworkSettings": {"Networks": {stack: {}}}} for index in range(4)])
        if argv[:2] == ["docker", "compose"]:
            return ""
        if argv[0] == "native-verifier":
            return json.dumps({"passed": True, "evidence": {"fixtureNativeScore": 1}})
        raise AssertionError("Unexpected backend command")
    return config, hashes, calls, share_storage, command


def test_local_controller_requires_real_backend_separation_and_complete_state():
    config, hashes, calls, shared, command = fixture()
    controller = LocalWebArenaController(config, command)
    with pytest.raises(ValueError, match="verified"):
        controller.acquire()
    controller.reset()
    snapshot = controller.acquire()
    assert snapshot["origin"] != config["origins"]["authoritative"]
    assert controller.fresh(snapshot)
    shared[0] = True
    with pytest.raises(ValueError, match="ownership"):
        controller.fresh(snapshot)
    shared[0] = False
    with pytest.raises(ValueError, match="Release"):
        controller.reset()
    hashes["authoritative"] = "b" * 64
    assert not controller.fresh(snapshot)
    controller.release(snapshot)
    with pytest.raises(ValueError, match="changed"):
        controller.acquire()
    hashes["authoritative"] = "a" * 64
    shared[0] = True
    with pytest.raises(ValueError, match="ownership"):
        controller.acquire()
    assert all(argv[argv.index("-p") + 1].startswith("goalspec-webarena-") for argv, _, _ in calls if argv[:2] == ["docker", "compose"])
    assert not any("pull" == part for argv, _, _ in calls for part in argv)


def test_native_verdict_registration_cannot_be_overridden_by_actor_paths():
    config, _, _, _, command = fixture()
    controller = LocalWebArenaController(config, command)
    assert controller.verify({"taskId": "task-1"})["passed"]
    with pytest.raises(ValueError, match="preregistered"):
        controller.verify({"taskId": "task-1", "configPath": "/actor/chosen.py"})
    with pytest.raises(ValueError, match="preregistered"):
        controller.verify({"taskId": "unknown"})
    config["origins"]["snapshot"] = config["origins"]["authoritative"]
    with pytest.raises(ValueError, match="not isolated"):
        LocalWebArenaController(config, command)


def test_local_deployment_rejects_mutable_images_and_shares_no_backends():
    path = Path(__file__).resolve().parents[3] / "infra/webarena-local/deployment.py"
    spec = importlib.util.spec_from_file_location("webarena_deployment", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    images = {site: "sha256:" + "a" * 64 for site in module.SITES}
    authoritative = module.compose(images, "authoritative")
    snapshot = module.compose(images, "snapshot")
    for site, service in authoritative["services"].items():
        other = snapshot["services"][site]
        assert service["container_name"] != other["container_name"]
        assert service["ports"] != other["ports"]
        assert service["ports"][0].startswith("127.0.0.1:")
        assert service["pull_policy"] == "never"
        assert "volumes" not in service
    assert authoritative["networks"]["isolated"]["internal"]
    images["shopping"] = "shopping:latest"
    with pytest.raises(ValueError, match="immutable"):
        module.compose(images, "authoritative")
