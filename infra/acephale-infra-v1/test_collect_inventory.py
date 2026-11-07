"""Offline inventory tests. All model bytes, processes and provider identities are fixtures."""
from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("collect_inventory", Path(__file__).with_name("collect_inventory.py"))
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.models, self.source, self.host = (self.root / name for name in ("models", "source", "host"))
        self.pins = inventory.read(inventory.HERE / "versions.json")
        self.compose = inventory.read(inventory.HERE / "compose.json")
        for role in ("actor", "predictor"):
            root = self.models / role
            write(root / "config.json", {"model_type": "fixture"})
            write(root / "tokenizer_config.json", {"chat_template": "{{ fixture_messages }}"})
            write(root / "tokenizer.json", {"fixture": role})
            (root / "model.safetensors").write_bytes(b"offline fixture weights: " + role.encode())
            rows = [inventory.record(path, path.name) for path in sorted(root.iterdir())]
            write(root / inventory.RECEIPT, {"profile": self.pins["profile"], "role": role,
                                            **self.pins["models"][role], "files": rows})
        for name in inventory.LOCKS:
            write(self.source / name, {"offlineFixture": name})
        self.image_lock, self.provider = self.root / "images.json", self.root / "provider.json"
        self.image_id = "sha256:" + "a" * 64
        write(self.image_lock, {"profile": self.pins["profile"], "images": {"vllm": {
            "requested": self.pins["images"]["vllm"], "pinned": self.pins["images"]["vllm"], "imageId": self.image_id}}})
        write(self.provider, {"Reservations": [{"Instances": [{"InstanceId": "i-1234567890abcdef0",
            "InstanceType": "g6e.2xlarge", "ImageId": "ami-1234567890abcdef0", "State": {"Name": "running"}}]}]})
        for name, value in {"sys/devices/virtual/dmi/id/board_asset_tag": "i-1234567890abcdef0\n",
                            "proc/cpuinfo": "model name\t: Fixture CPU\n",
                            "proc/meminfo": "MemTotal:       65000000 kB\n"}.items():
            path = self.host / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)
        self.containers = {role: {"id": letter * 64, "image": self.image_id,
            "requestedImage": self.pins["images"]["vllm"], "running": True,
            "startedAt": "2026-11-06T12:00:00Z", "command": self.compose["services"][role]["command"],
            "mounts": [{"Type": "bind", "Source": str(self.models.resolve()), "Destination": "/models", "RW": False}]}
            for role, letter in (("actor", "b"), ("predictor", "c"))}
        self.packages = {"python": "3.12.16", "vllm": "0.32.0", "torch": "2.13.0+cu130",
                         "transformers": "fixture-version", "cuda": "13.0.3", "torchCuda": "13.0",
                         "packages": [{"name": "vllm", "version": "0.32.0"}]}
        self.gpu = "NVIDIA Fixture GPU, 580.95.05, 49140, GPU-fixture\n"
        self.allocations = "101, GPU-fixture, 25000\n202, GPU-fixture, 5000\n"
        self.commands, self.dirty, self.bad_digest = [], False, False
        self.inspect_count, self.restart = {}, False
        self.allocation_queries, self.drop_late_allocation = 0, False
        self.orchestrator_receipt = None
        self.node_version, self.python_version = "22.23.4", "3.12.16"

    def run_fixture(self, argv, cwd):
        self.commands.append(argv)
        self.assertEqual(cwd, self.source.resolve())
        if argv[0] == "git":
            return " M changed.py" if self.dirty else ("d" * 40 if argv[1] == "rev-parse" else "")
        if argv[0] == "nvidia-smi":
            if argv[1].startswith("--query-gpu="):
                return self.gpu
            self.allocation_queries += 1
            return ("101, GPU-fixture, 25000\n" if self.drop_late_allocation and self.allocation_queries > 1
                    else self.allocations)
        if argv[0] == "docker":
            self.assertEqual(argv[:3], inventory.DOCKER)
            args = argv[3:]
            if args[0] == "image":
                return json.dumps(["fixture@sha256:" + "f" * 64] if self.bad_digest else [self.pins["images"]["vllm"]])
            if args[0] == "ps":
                role = "actor" if "label=com.docker.compose.service=actor" in args else "predictor"
                return self.containers[role]["id"]
            role = "actor" if self.containers["actor"]["id"] in args else "predictor"
            if args[0] == "inspect":
                self.inspect_count[role] = self.inspect_count.get(role, 0) + 1
                current = copy.deepcopy(self.containers[role])
                if self.restart and self.inspect_count[role] > 1:
                    current["startedAt"] = "2026-11-06T12:01:00Z"
                return json.dumps(current)
            if args[0] == "top":
                return "PID\n101\n" if role == "actor" else "PID\n202\n"
            if args[0] == "exec":
                self.assertIn("-B", args)
                return json.dumps(self.packages)
        if argv[0] == "fixture-python":
            return json.dumps({"python": self.python_version, "packages": [{"name": "acephale", "version": "fixture"}]})
        if argv[0] == "fixture-node":
            return json.dumps({"node": self.node_version, "packages": [{"name": "tsx", "version": "fixture"}]})
        self.fail(f"Unexpected probe: {argv[0:4]}")

    def collect(self):
        return inventory.collect(self.models, self.image_lock, self.provider, source=self.source,
                                 host_root=self.host, python="fixture-python", node="fixture-node",
                                 orchestrator_receipt=self.orchestrator_receipt, runner=self.run_fixture)

    def prepare_orchestrator(self):
        value = inventory.orchestrator_inventory(source=self.source, python="fixture-python", node="fixture-node",
                                                 runner=self.run_fixture)
        self.orchestrator_receipt = self.root / "orchestrator-inventory.json"
        write(self.orchestrator_receipt, value)
        self.commands.clear()
        return value

    def test_observed_inventory_binds_real_fixture_bytes_and_retains_hash_inputs(self):
        deployment, evidence = self.collect()
        self.assertTrue(deployment["observed"])
        self.assertFalse(deployment["smokeReadinessVerified"])
        self.assertEqual(deployment["evidenceHash"], inventory.digest(evidence))
        self.assertEqual(deployment["runtime"]["dependencyLockHash"], inventory.digest(evidence["dependencyLocks"]))
        self.assertEqual(deployment["runtime"]["packageInventoryHash"], inventory.digest(evidence["packageInventory"]))
        for role in ("actor", "predictor"):
            for field in ("weights", "tokenizer", "chatTemplate"):
                self.assertEqual(deployment[role][field + "Hash"], inventory.digest(
                    evidence["modelFiles"][role][field + "HashInput"]))
        self.assertEqual(deployment["hardware"]["instanceType"], "g6e.2xlarge")
        self.assertEqual(deployment["hardware"]["gpuMemoryBytes"], 49140 * 1024**2)
        output = self.root / "inventory-output"
        inventory.write_inventory(output, deployment, evidence)
        self.assertEqual(inventory.read(output / "observed-deployment.json"), deployment)
        with self.assertRaises(FileExistsError):
            inventory.write_inventory(output, deployment, evidence)

    def test_manifest_schema_accepts_observed_sections(self):
        # Validate against the actual versioned JSON schema with the repository's
        # existing Ajv dependency. No TS compilation, model calls, or downloads.
        deployment, evidence = self.collect()
        fixture = self.root / "observed.json"
        write(fixture, deployment)
        write(self.root / "evidence.json", evidence)
        script = """
const fs = require('node:fs'), Ajv = require('ajv/dist/2020');
const {hash} = require('./src/lib/acephale/canonical.ts');
const schema = JSON.parse(fs.readFileSync('src/lib/acephale/contracts/infra-manifest-v2.schema.json'));
const deployment = JSON.parse(fs.readFileSync(process.argv[1]));
const evidence = JSON.parse(fs.readFileSync(process.argv[2]));
if (hash(evidence) !== deployment.evidenceHash) throw Error('Actual Node split guard cannot verify Python inventory hash');
for (const name of ['actor','predictor','runtime','hardware']) {
 const validate = new Ajv({strict:true}).compile({$defs:schema.$defs, ...schema.properties[name]});
 if (!validate(deployment[name])) throw Error(JSON.stringify(validate.errors));
}
"""
        result = subprocess.run(["node", "--import", "tsx", "-e", script, str(fixture), str(self.root / "evidence.json")], cwd=inventory.ROOT,
                                capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_edited_or_unreceipted_weights_cannot_be_observed(self):
        path = self.models / "actor/model.safetensors"
        path.write_bytes(path.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "differs"):
            self.collect()

    def test_extra_unreceipted_file_is_rejected(self):
        (self.models / "actor/override.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "Unreceipted"):
            self.collect()

    def test_duplicate_and_path_traversal_receipts_rejected(self):
        path = self.models / "actor" / inventory.RECEIPT
        original = inventory.read(path)
        for row in (original["files"][0], {"path": "../outside", "bytes": 1, "sha256": "0" * 64}):
            edited = copy.deepcopy(original)
            edited["files"].append(row)
            write(path, edited)
            with self.assertRaisesRegex(ValueError, "Unsafe or duplicate"):
                self.collect()

    def test_wrong_model_revision_is_rejected(self):
        path = self.models / "actor" / inventory.RECEIPT
        value = inventory.read(path)
        value["revision"] = "e" * 40
        write(path, value)
        with self.assertRaisesRegex(ValueError, "pinned identity"):
            self.collect()

    def test_provider_receipt_for_another_host_is_rejected(self):
        path = self.host / "sys/devices/virtual/dmi/id/board_asset_tag"
        path.write_text("i-00000000000000000")
        with self.assertRaisesRegex(ValueError, "this host"):
            self.collect()

    def test_image_lock_cannot_substitute_image_content(self):
        self.bad_digest = True
        with self.assertRaisesRegex(ValueError, "content digest"):
            self.collect()

    def test_writable_mount_wrong_command_and_wrong_image_rejected(self):
        original = copy.deepcopy(self.containers["actor"])
        for changed in ({"image": "sha256:" + "f" * 64}, {"command": ["--wrong-model"]},
                        {"mounts": [{"Type": "bind", "Destination": "/models", "Source": str(self.models), "RW": True}]}):
            self.containers["actor"] = {**copy.deepcopy(original), **changed}
            with self.assertRaisesRegex(ValueError, "Resident model"):
                self.collect()

    def test_container_started_without_gpu_residency_is_rejected(self):
        self.allocations = "101, GPU-fixture, 25000\n"
        with self.assertRaisesRegex(ValueError, "Both model containers"):
            self.collect()

    def test_driver_memory_cuda_and_dirty_checkout_fail_closed(self):
        for text in ("Fixture, 579.10, 49140, GPU-fixture", "Fixture, 580.10, 24576, GPU-fixture"):
            self.gpu = text
            with self.assertRaisesRegex(ValueError, "below"):
                self.collect()
        self.gpu = "Fixture, 580.10, 49140, GPU-fixture"
        self.packages["cuda"] = "13.0"
        with self.assertRaisesRegex(ValueError, "packages/CUDA"):
            self.collect()
        self.dirty = True
        with self.assertRaisesRegex(ValueError, "clean committed"):
            self.collect()

    def test_restarted_container_invalidates_observation(self):
        self.restart = True
        with self.assertRaisesRegex(ValueError, "changed during"):
            self.collect()

    def test_dead_model_worker_with_living_container_invalidates_observation(self):
        self.drop_late_allocation = True
        with self.assertRaisesRegex(ValueError, "lost GPU residency"):
            self.collect()

    def test_probe_allowlist_and_output_never_capture_environment_or_credentials(self):
        _, evidence = self.collect()
        self.assertEqual({command[0] for command in self.commands},
                         {"docker", "git", "nvidia-smi", "fixture-python", "fixture-node"})
        self.assertTrue(all("pull" not in command and "run" not in command and "start" not in command
                            for command in self.commands))
        self.assertNotIn(".Config.Env", inventory.INSPECT)
        self.assertNotIn("command", evidence["containers"]["actor"])
        self.assertNotIn("mounts", evidence["containers"]["actor"])
        self.assertEqual(evidence["networkCalls"], 0)
        self.assertEqual(evidence["modelCalls"], 0)

    def test_orchestrator_receipt_requires_no_docker_gpu_cloud_journal_or_credentials(self):
        value = inventory.orchestrator_inventory(source=self.source, python="fixture-python", node="fixture-node",
                                                 runner=self.run_fixture)
        self.assertEqual({c[0] for c in self.commands}, {"git", "fixture-python", "fixture-node"})
        self.assertFalse(value["journalRead"])
        self.assertFalse(value["credentialsRead"])
        self.assertEqual(value["contentHash"], inventory.digest({k: v for k, v in value.items() if k != "contentHash"}))

    def test_split_inventory_uses_actual_orchestrator_packages_without_probing_gpu_host_node(self):
        self.python_version = "3.12.14"
        observed = self.prepare_orchestrator()
        self.node_version, self.python_version = "not-installed-on-gpu", "not-used-for-benchmark"
        deployment, evidence = self.collect()
        self.assertEqual(deployment["runtime"]["python"], "3.12.14")
        self.assertEqual(deployment["runtime"]["node"], "22.23.4")
        self.assertEqual(evidence["topology"], "split-orchestrator-and-gpu-host")
        self.assertEqual(evidence["orchestratorInventory"], observed)
        self.assertEqual(evidence["orchestratorReceiptSha256"], inventory.file_hash(self.orchestrator_receipt))
        self.assertTrue(all(c[0] not in {"fixture-python", "fixture-node"} for c in self.commands))

    def test_split_receipt_tampering_and_different_source_or_pins_rejected(self):
        original = self.prepare_orchestrator()
        for field, changed in (("contentHash", "f" * 64), ("sourceCommit", "f" * 40), ("sourcePinsContentHash", "f" * 64)):
            value = {**original, field: changed}
            if field != "contentHash":
                value["contentHash"] = inventory.digest({k: v for k, v in value.items() if k != "contentHash"})
            write(self.orchestrator_receipt, value)
            with self.assertRaisesRegex(ValueError, "receipt hash, clean source commit"):
                self.collect()

    def test_split_dependency_hash_is_the_observed_orchestrator_lock_bytes(self):
        observed = self.prepare_orchestrator()
        # A clean Windows checkout and clean Linux checkout may use different
        # newline bytes. Runtime lock identity must remain the orchestrator's.
        for name in inventory.LOCKS:
            with (self.source / name).open("ab") as stream:
                stream.write(b"\n")
        deployment, evidence = self.collect()
        self.assertEqual(evidence["dependencyLocks"], observed["dependencyLocks"])
        self.assertEqual(deployment["runtime"]["dependencyLockHash"], inventory.digest(observed["dependencyLocks"]))

    def test_orchestrator_wrong_runtime_or_missing_lock_rejected(self):
        self.node_version = "22.23.5"
        with self.assertRaisesRegex(ValueError, "incorrect Node"):
            self.prepare_orchestrator()
        self.node_version = "22.23.4"
        observed = self.prepare_orchestrator()
        observed["dependencyLocks"].pop()
        observed["contentHash"] = inventory.digest({k: v for k, v in observed.items() if k != "contentHash"})
        write(self.orchestrator_receipt, observed)
        with self.assertRaisesRegex(ValueError, "dependency-lock inventory"):
            self.collect()


if __name__ == "__main__":
    unittest.main()
