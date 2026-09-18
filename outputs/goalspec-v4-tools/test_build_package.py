"""Synthetic packager verification, with no research artifact inputs."""
import hashlib
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

import build_package as package


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="goalspec-package-v4-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "inputs").mkdir()
        (self.root / "inputs/a.txt").write_bytes(b"one\r\ntwo\n")
        (self.root / "later.py").write_text("print('analysis only')\n", encoding="utf-8")
        with zipfile.ZipFile(self.root / "source.zip", "w") as archive:
            archive.writestr("runtime.py", "print('executed source declaration')\n")
        self.allowlist = self.root / "allowlist.json"
        self.allowlist.write_text(json.dumps({"schemaVersion": 1, "entries": [
            {"path": "inputs", "role": "artifact"}, {"path": "later.py", "role": "analysis-overlay"},
            {"path": "source.zip", "role": "executed-source-archive"}]}), encoding="utf-8")

    def build(self, name="result.zip"):
        return package.build_package(self.allowlist, self.root / name, self.root)

    def test_roundtrip_and_deterministic_bytes_with_distinct_source_roles(self):
        first, second = self.build(), self.build("second.zip")
        self.assertEqual(first, second)
        self.assertEqual((self.root / "result.zip").read_bytes(), (self.root / "second.zip").read_bytes())
        with zipfile.ZipFile(self.root / "result.zip") as archive:
            source = archive.read("executed-source-archive/source.zip")
            self.assertEqual(source, (self.root / "source.zip").read_bytes())
            manifest = json.loads(archive.read("_package/manifest.json"))
            self.assertIn("not independently attested", manifest["classificationSource"])
            for info in archive.infolist():
                self.assertEqual(info.date_time, package.TIMESTAMP)
                self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
            for row in manifest["members"]:
                raw = archive.read(row["member"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), row["sha256"])
                self.assertEqual(len(raw), row["bytes"])

    def test_existing_output_is_untouched(self):
        self.build()
        before = (self.root / "result.zip").read_bytes()
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual((self.root / "result.zip").read_bytes(), before)

    def test_secret_cache_and_mutable_lock_paths_rejected(self):
        for name in (".env", "credentials.json", "api_key.txt", "budget.lock", "cache/item.json"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                package.relative_path(name)
        package.relative_path("package-lock.json")
        package.relative_path("research/uv.lock")

    def test_parent_traversal_and_outside_output_rejected(self):
        for name in ("../outside", "/absolute", "a/../outside", "a\\b", "a//b"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                package.relative_path(name)
        with self.assertRaises(ValueError):
            package.build_package(self.allowlist, self.root.parent / "outside.zip", self.root)

    def test_links_and_linked_zip_members_rejected(self):
        info = zipfile.ZipInfo("linked")
        info.create_system = 3
        info.external_attr = 0o120777 << 16
        with zipfile.ZipFile(self.root / "source.zip", "w") as archive:
            archive.writestr(info, "elsewhere")
        with self.assertRaises(ValueError):
            self.build()
        self.assertFalse((self.root / "result.zip").exists())

    def test_unsafe_nested_zip_name_rejected(self):
        with zipfile.ZipFile(self.root / "source.zip", "w") as archive:
            archive.writestr("../escaped", "invalid")
        with self.assertRaises(ValueError):
            self.build()

    def test_mutation_during_copy_removes_only_new_partial_output(self):
        original = zipfile.ZipFile.open
        def changed(archive, name, mode="r", *args, **kwargs):
            if mode == "w" and getattr(name, "filename", "") == "artifact/inputs/a.txt":
                (self.root / "inputs/a.txt").write_text("changed after enumeration", encoding="utf-8")
            return original(archive, name, mode, *args, **kwargs)
        with patch.object(zipfile.ZipFile, "open", changed), self.assertRaises(ValueError):
            self.build()
        self.assertFalse((self.root / "result.zip").exists())
        self.assertTrue((self.root / "inputs/a.txt").exists())

    def test_byte_bound_and_overlapping_selections_rejected(self):
        with patch.object(package, "MAX_FILE_BYTES", 3), self.assertRaises(ValueError):
            self.build()
        value = json.loads(self.allowlist.read_text(encoding="utf-8"))
        value["entries"].append({"path": "inputs/a.txt", "role": "artifact"})
        self.allowlist.write_text(json.dumps(value), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.build()

    @unittest.skipUnless(os.name == "nt", "Windows stat/fstat compatibility")
    def test_windows_stat_and_fstat_ctime_difference_does_not_invent_mutation(self):
        common = {"st_dev": 1, "st_ino": 2, "st_size": 3, "st_mtime_ns": 4, "st_mode": 0o100644}
        self.assertEqual(package.identity(SimpleNamespace(**common, st_ctime_ns=5)),
                         package.identity(SimpleNamespace(**common, st_ctime_ns=6)))


if __name__ == "__main__":
    unittest.main()
