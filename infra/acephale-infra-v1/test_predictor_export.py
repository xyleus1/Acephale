"""Serving command tests use verified-export fixtures, never a GPU or model download."""
from __future__ import annotations

import copy
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import control
from acephale.training_lora import base_weights_hash


class PredictorExportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.models = Path(temporary.name)
        self.export = self.models / "export"
        self.export.mkdir()
        self.receipt = {"files": [{"path": "config.json", "sha256": "1" * 64, "bytes": 1},
                                  {"path": "model.safetensors", "sha256": "2" * 64, "bytes": 10}]}
        self.artifact = {"schemaVersion": 2, "contentHash": "a" * 64, "servedModel": "acephale-predictor-fixture",
                         "base": {"repository": "Qwen/Qwen3.5-0.8B"}, "baseReceiptHash": control.digest(self.receipt),
                         "baseWeightsHash": base_weights_hash(self.receipt), "tokenizerHash": "b" * 64,
                         "chatTemplateHash": "c" * 64, "adapterStorageDtype": "float32", "runtimeLoraDtype": "bfloat16"}
        self.compose = control.read_json(control.HERE / "compose.json")
        self.original = copy.deepcopy(self.compose)

    def apply(self):
        with patch.object(control, "checked_predictor_export", return_value={"artifact": self.artifact}), \
                patch("acephale.training.verify_base", return_value=self.receipt), \
                patch("acephale.training.tokenizer_identity", return_value=("b" * 64, "c" * 64)):
            return control.apply_predictor_export(self.compose, self.models, self.export)

    def test_native_lora_preserves_base_command_and_adds_exact_adapter_flags(self):
        self.apply()
        original = self.original["services"]["predictor"]["command"]
        command = self.compose["services"]["predictor"]["command"]
        self.assertEqual(command[:len(original)], original)
        self.assertEqual(command[len(original):], ["--enable-lora", "--max-lora-rank", "16", "--lora-dtype", "bfloat16",
                         "--lora-modules", "acephale-predictor-fixture=/models/export/adapter"])
        self.assertEqual(self.compose["services"]["actor"], self.original["services"]["actor"])
        self.assertEqual(self.compose["x-acephale-trained-predictor"]["adapterStorageDtype"], "float32")

    def test_native_lora_rejects_wrong_base_weights_receipt_or_tokenizer(self):
        for field in ("baseReceiptHash", "baseWeightsHash", "tokenizerHash", "chatTemplateHash"):
            with self.subTest(field=field):
                original = self.artifact[field]
                self.artifact[field] = "f" * 64
                with self.assertRaisesRegex(ValueError, "base or tokenizer"):
                    self.apply()
                self.artifact[field] = original

    def test_native_lora_rejects_changed_model_command_and_duplicate_flags(self):
        for edit in (lambda c: c.extend(["--enable-lora"]),
                     lambda c: c.__setitem__(c.index("--model") + 1, "/models/other"),
                     lambda c: c.__setitem__(c.index("--served-model-name") + 1, "renamed-base")):
            self.compose = copy.deepcopy(self.original)
            edit(self.compose["services"]["predictor"]["command"])
            with self.assertRaisesRegex(ValueError, "unchanged pinned base"):
                self.apply()

    def test_legacy_merged_export_command_is_preserved(self):
        self.artifact["schemaVersion"] = 1
        self.apply()
        command = self.compose["services"]["predictor"]["command"]
        self.assertEqual(command[command.index("--model") + 1], "/models/export/model")
        self.assertEqual(command[command.index("--served-model-name") + 1], "acephale-predictor-fixture")
        self.assertNotIn("--enable-lora", command)

    def test_export_cannot_escape_model_root(self):
        with self.assertRaisesRegex(ValueError, "inside the read-only"):
            control.apply_predictor_export(self.compose, self.models, self.models.parent)

    def test_actual_node_serving_parity_contract(self):
        result = subprocess.run(["node", "--import", "tsx", "--test",
                                 "infra/acephale-infra-v1/lambda-operator/serving-parity.test.mjs"],
                                cwd=control.ROOT, capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
