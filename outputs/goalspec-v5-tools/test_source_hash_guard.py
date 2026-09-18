"""Small, offline regression for binding archive ZIPs to their original plans."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile


MODULE_PATH = Path(os.environ.get(
    "GOALSPEC_SOURCE_GUARD_MODULE",
    str(Path(__file__).with_name("prepare_archive_plan.py")),
))
SPEC = importlib.util.spec_from_file_location("tested_archive_preparation", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class FrozenSourceHashTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / "source.zip"
        self.plan = self.root / "plan.json"
        self.runtime = b"export const unchanged = true;\n"
        self.write_archive(b"Original documentation.\n")
        self.original_hash = MODULE.sha(self.archive)
        self.plan_value = {
            "sourceArchiveSha256": self.original_hash,
            "runtimeSources": {
                "src/runtime.ts": {"sha256": hashlib.sha256(self.runtime).hexdigest()}
            },
        }
        self.write_plan()
        self.specification = {"path": "source.zip", "plan": "plan.json"}

    def write_archive(self, documentation):
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("src/runtime.ts", self.runtime)
            archive.writestr("docs/README.md", documentation)

    def write_plan(self):
        self.plan.write_text(json.dumps(self.plan_value), encoding="utf-8")

    def test_original_plan_without_override_is_accepted(self):
        item, proof = MODULE.source_members(self.root, self.specification)
        self.assertEqual(item["sha256"], self.original_hash)
        self.assertEqual(proof["runtimeSubsetMembers"], 1)
        self.assertEqual(proof["completeZipMembers"], 2)

    def test_matching_explicit_hash_is_accepted(self):
        self.specification["sha256"] = self.original_hash
        item, _ = MODULE.source_members(self.root, self.specification)
        self.assertEqual(item["sha256"], self.original_hash)

    def test_changed_nonruntime_member_cannot_override_frozen_hash(self):
        self.write_archive(b"Substituted documentation.\n")
        self.specification["sha256"] = MODULE.sha(self.archive)
        self.assertNotEqual(self.specification["sha256"], self.original_hash)
        with self.assertRaisesRegex(ValueError, "original frozen hash"):
            MODULE.source_members(self.root, self.specification)

    def test_explicit_hash_cannot_replace_missing_original_hash(self):
        del self.plan_value["sourceArchiveSha256"]
        self.write_plan()
        self.specification["sha256"] = self.original_hash
        with self.assertRaisesRegex(ValueError, "original frozen hash"):
            MODULE.source_members(self.root, self.specification)

    def test_changed_archive_without_override_is_rejected(self):
        self.write_archive(b"Substituted documentation.\n")
        with self.assertRaisesRegex(ValueError, "Original source ZIP changed"):
            MODULE.source_members(self.root, self.specification)

    def test_present_invalid_overrides_are_rejected(self):
        for value in (None, "", "invalid"):
            with self.subTest(value=value):
                self.specification["sha256"] = value
                with self.assertRaisesRegex(ValueError, "original frozen hash"):
                    MODULE.source_members(self.root, self.specification)


if __name__ == "__main__":
    unittest.main(verbosity=2)
