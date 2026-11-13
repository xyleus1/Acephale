"""Offline amendment checks against public raw OCI bytes. No API or ledger access."""
from __future__ import annotations

import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("metadata_control", HERE / "control.py")
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)


class VersionsMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        original = control.read_json(HERE / "versions.json")
        original["servingCuda"] = "13.0.3"
        original.pop("servingCudaSource", None)
        original.pop("servingTorchCuda", None)
        self.original = self.root / "original-versions.json"
        control.write_new(self.original, original)
        (self.source / "versions.json").write_bytes(self.original.read_bytes())
        (self.source / "hardware-profiles.json").write_bytes((HERE / "hardware-profiles.json").read_bytes())
        self.patch = patch.object(control, "HERE", self.source)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.ledger = self.root / "ledger.json"
        self.plan = {"version": 1, "provider": "lambda", "profile": control.PROFILE,
                     "sourceCommit": "a" * 40, "infrastructureLedgerPath": str(self.ledger.resolve())}
        self.calls = []
        def budget(plan, operation, lease=None):
            self.calls.append(operation)
            return {"committedMicrodollars": 166891414, "infrastructureMicrodollars": 1000000}
        self.budget = budget
        self.initial = control.init_bound_ledger(self.ledger, self.plan, 1, budget=budget)
        self.before = self.ledger.read_bytes()
        self.effective = {**original, "servingCuda": "13.0.2", "servingCudaSource": "immutable_image_cuda_version", "servingTorchCuda": "13.0"}
        control.atomic_json(self.source / "versions.json", self.effective)
        self.evidence = HERE / "fixtures" / "vllm-0.32.0-cuda-identity"

    def record(self, **kwargs):
        return control.record_versions_metadata_amendment(self.ledger, self.original, kwargs.pop("evidence", self.evidence),
            "Correct metadata using the identical pinned image; no installed toolkit patch claim",
            source_probe=lambda _: "b" * 40, budget=self.budget, **kwargs)

    def rewrite_sidecar(self, value):
        value["contentHash"] = control.digest({key: item for key, item in value.items() if key != "contentHash"})
        control.atomic_json(control.versions_amendment_path(self.ledger), value)

    def test_append_only_correction_keeps_original_bytes_and_finances(self):
        value = self.record()
        self.assertEqual(self.ledger.read_bytes(), self.before)
        self.assertEqual(control.checked_bound_ledger(self.ledger), self.initial)
        self.assertEqual(value["originalVersionsSha256"], self.initial["versionsSha256"])
        self.assertNotEqual(value["originalVersionsSha256"], value["effectiveVersionsSha256"])
        self.assertFalse(value["financialBindingChanged"])
        self.assertFalse(value["observedCudaIdentity"]["installedToolkitPatchEstablished"])
        self.assertEqual(value["observedCudaIdentity"]["cudaImageBaseRelease"], "13.0.2")
        self.assertEqual(self.calls, ["bind", "inspect"])
        with self.assertRaisesRegex(ValueError, "cannot be overwritten"):
            self.record()
        self.assertEqual(self.ledger.read_bytes(), self.before)

    def test_changed_versions_without_amendment_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "append-only"):
            control.checked_bound_ledger(self.ledger)

    def test_original_raw_bytes_must_match_original_ledger(self):
        self.original.write_text(self.original.read_text() + " ", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Original versions bytes"):
            self.record()

    def test_every_nonapproved_change_is_rejected(self):
        changes = [lambda v: v["models"]["actor"].update(revision="f" * 40),
                   lambda v: v["images"].update(vllm="unrelated@sha256:" + "f" * 64),
                   lambda v: v["limits"].update(totalUsd=501),
                   lambda v: v.update(minimumDriverMajor=579),
                   lambda v: v.update(servingTorch="2.14.0"),
                   lambda v: v.update(verifiedAt="changed"),
                   lambda v: v.update(servingCudaSource="toolkit"),
                   lambda v: v.update(servingTorchCuda="13.1"),
                   lambda v: v.update(servingCuda="13.0.3")]
        for change in changes:
            value = copy.deepcopy(self.effective)
            change(value)
            control.atomic_json(self.source / "versions.json", value)
            with self.assertRaisesRegex(ValueError, "three-field"):
                self.record()
        self.assertEqual(self.calls, ["bind"])

    def test_each_oci_raw_artifact_is_hash_verified(self):
        destination = self.root / "oci"
        destination.mkdir()
        for name in ("pinned-manifest.json", "linux-amd64-manifest.json", "linux-amd64-config.json"):
            for source in self.evidence.iterdir():
                if source.suffix == ".json":
                    (destination / source.name).write_bytes(source.read_bytes())
            with (destination / name).open("ab") as stream:
                stream.write(b" ")
            with self.assertRaisesRegex(ValueError, "digest chain"):
                self.record(evidence=destination)
        self.assertEqual(self.calls, ["bind"])

    def test_rehashed_sidecar_cannot_forge_oci_evidence(self):
        value = self.record()
        value["ociEvidence"]["configUtf8"] += " "
        self.rewrite_sidecar(value)
        with self.assertRaisesRegex(ValueError, "digest chain"):
            control.checked_bound_ledger(self.ledger)

    def test_rehashed_sidecar_cannot_change_raw_versions_or_summary(self):
        value = self.record()
        altered = copy.deepcopy(value)
        altered["originalVersionsUtf8"] += " "
        self.rewrite_sidecar(altered)
        with self.assertRaisesRegex(ValueError, "raw versions"):
            control.checked_bound_ledger(self.ledger)
        value["observedCudaIdentity"]["installedToolkitPatchEstablished"] = True
        self.rewrite_sidecar(value)
        with self.assertRaisesRegex(ValueError, "summary changed"):
            control.checked_bound_ledger(self.ledger)

    def test_new_lease_rows_preserve_binding_but_financial_limits_do_not(self):
        self.record()
        value = control.read_json(self.ledger)
        value["leases"].append({"id": "existing-reservation", "status": "terminated"})
        control.atomic_json(self.ledger, value)
        self.assertEqual(control.checked_bound_ledger(self.ledger)["leases"], value["leases"])
        value["infrastructureAllocationUsd"] = 36
        control.atomic_json(self.ledger, value)
        with self.assertRaisesRegex(ValueError, "financial/source"):
            control.checked_bound_ledger(self.ledger)

    def test_real_training_windows_preserve_metadata_binding_and_two_hour_limit(self):
        amendment = self.record()
        sidecar = control.versions_amendment_path(self.ledger)
        original_sidecar = sidecar.read_bytes()
        now = 1000
        value = control.read_json(self.ledger)
        value["leases"].append({"id": "funded", "status": "active", "instanceId": "observed-gpu",
            "deadline": now + 7200, "quote": {"hardwareProfileHash": "c" * 64}, "studyReservation": "original-reservation"})
        control.atomic_json(self.ledger, value)
        probe = self.root / "preflight.json"
        control.write_new(probe, {"profile": "acephale-training-preflight-v1", "observedAt": now,
            "hardwareProfile": "a100-40gb-v1", "hardwareProfileHash": "c" * 64, "actorStopped": True, "gpuProcesses": 0})
        with patch.object(control.time, "time", return_value=now):
            for index in (1, 2):
                control.training_lease(self.ledger, "funded", probe, self.root / f"training-{index}.json", 1)
                checked = control.checked_bound_ledger(self.ledger)
                self.assertEqual(len(checked["trainingWindows"]), index)
                self.assertEqual(control.effective_versions_metadata(self.ledger, checked)["amendmentHash"], amendment["contentHash"])
                self.assertEqual(sidecar.read_bytes(), original_sidecar)
            before_denial = self.ledger.read_bytes()
            with self.assertRaisesRegex(ValueError, "two-hour"):
                control.training_lease(self.ledger, "funded", probe, self.root / "training-denied.json", 0.01)
            self.assertEqual(self.ledger.read_bytes(), before_denial)
            self.assertFalse((self.root / "training-denied.json").exists())
        checked["infrastructureAllocationUsd"] = 36
        control.atomic_json(self.ledger, checked)
        with self.assertRaisesRegex(ValueError, "financial/source"):
            control.checked_bound_ledger(self.ledger)
        self.assertEqual(sidecar.read_bytes(), original_sidecar)

    def test_hardware_profile_change_is_never_amended(self):
        self.record()
        with (self.source / "hardware-profiles.json").open("ab") as stream:
            stream.write(b" ")
        with self.assertRaisesRegex(ValueError, "exact source profiles"):
            control.checked_bound_ledger(self.ledger)

    def test_source_amendment_binds_effective_versions_without_rebinding_ledger(self):
        metadata = self.record()
        readiness, output = self.root / "ready.json", self.root / "source-amendment.json"
        control.write_new(readiness, {"localChecksPassed": True})
        with patch.object(control, "controller_source_files", return_value=[{"path": "control.py", "sha256": "c" * 64}]):
            value = control.record_source_amendment(self.ledger, output, "Use qualified CUDA identity metadata", readiness,
                source_probe=lambda _: "b" * 40, budget=self.budget)
            self.assertEqual(value["effectiveVersionsMetadata"]["amendmentHash"], metadata["contentHash"])
            self.assertEqual(control.deployment_source(self.initial, output, source_probe=lambda _: "b" * 40)["amendment"], value)
            del value["effectiveVersionsMetadata"]
            value["contentHash"] = control.digest({key: item for key, item in value.items() if key != "contentHash"})
            control.atomic_json(output, value)
            with self.assertRaisesRegex(ValueError, "does not bind"):
                control.deployment_source(self.initial, output, source_probe=lambda _: "b" * 40)
        self.assertEqual(self.ledger.read_bytes(), self.before)

    def test_mutation_during_journal_inspection_does_not_publish_amendment(self):
        def changed(plan, operation, lease=None):
            with self.ledger.open("ab") as stream:
                stream.write(b" ")
            return {}
        with self.assertRaisesRegex(ValueError, "changed while recording"):
            control.record_versions_metadata_amendment(self.ledger, self.original, self.evidence, "Correction",
                source_probe=lambda _: "b" * 40, budget=changed)
        self.assertFalse(control.versions_amendment_path(self.ledger).exists())


if __name__ == "__main__":
    unittest.main()
