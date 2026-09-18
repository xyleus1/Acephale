"""Bounded packager checks with synthetic bytes only; no final archive build."""
import hashlib
import importlib.util
import io
import contextlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("build_package", Path(__file__).with_name("build_package.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageBoundaries(unittest.TestCase):
    def test_streamed_hash(self):
        content = b"synthetic artifact\n" * 1000
        self.assertEqual(module.digest_stream(io.BytesIO(content)), dict(bytes=len(content), sha256=hashlib.sha256(content).hexdigest()))

    def test_rejects_secret_and_runtime_names(self):
        for path in ("research/goalspec/runs/example/.env", "research/goalspec/runs/example/api-key.json",
                     "research/goalspec/runs/example/credentials.json", "research/goalspec/runs/example/key.dpapi",
                     "research/goalspec/runs/example/node_modules/a.json", "research/goalspec/runs/example/budget.jsonl.lock"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.deny_path(path)

    def test_rejects_unbounded_or_escaping_roots(self):
        for path in ("research/goalspec/runs", "research/goalspec/runs/pg17-local-v1", "research/goalspec/runs/pytest-any", "docs"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.artifact_root_allowed(path)
        for path in ("../outside", "C:/outside", "/outside", "research/../outside", "research\\outside"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.relative_path(path)

    def test_secrets_split_across_chunks_report_only_path(self):
        prior = module.BLOCK
        module.BLOCK = 16
        try:
            for value in (b"sk-" + b"x" * 40, b'{"gatewayToken":"' + b"y" * 40 + b'"}'):
                with self.subTest(kind=value[:2]), self.assertRaises(ValueError) as error:
                    module.digest_stream(io.BytesIO(b"padding1234 " + value), scan_path="manifest.json")
                self.assertIn("manifest.json", str(error.exception))
                self.assertNotIn(value.decode(), str(error.exception))
        finally:
            module.BLOCK = prior

    def test_source_categories_preserve_freeze_boundary(self):
        self.assertEqual(module.source_category("research/goalspec/src/goalspec/native_live.py"), "execution")
        self.assertEqual(module.source_category("research/goalspec/src/goalspec/evaluation_v1.py"), "analysis")
        self.assertEqual(module.source_category("scripts/goalspec-export-repository.ts"), "artifact_export")
        self.assertEqual(module.source_category("research/goalspec/.benchmarks/tau3/data/tau2/domains/airline/policy.md"), "execution")

    def test_generated_task_identifier_is_not_an_api_key(self):
        value = b"task-" + b"abcdef0123456789" * 3
        self.assertEqual(module.digest_stream(io.BytesIO(value), scan_path="native.json")["bytes"], len(value))

    def test_synthetic_archive_round_trip_and_exclusive_outputs(self):
        with tempfile.TemporaryDirectory(prefix="goalspec-package-fixture-") as temporary:
            root = Path(temporary).resolve()
            self.assertEqual(root.parent, Path(tempfile.gettempdir()).resolve())
            for tree in module.SOURCE_TREES:
                (root / tree).mkdir(parents=True, exist_ok=True)
            source_name = "src/lib/goalspec/example.ts"
            doc_name = "docs/goalspec/example.md"
            (root / source_name).write_text("export const fixture = true;\n")
            (root / doc_name).parent.mkdir(parents=True)
            (root / doc_name).write_text("Original documentation.\n")
            sources = {name: dict(category=module.source_category(name), **module.digest_file(root / name)) for name in (source_name, doc_name)}
            freeze_name = "research/goalspec/runs/synthetic-freeze"
            freeze = root / freeze_name
            freeze.mkdir(parents=True)
            with zipfile.ZipFile(freeze / "source.zip", "x") as archive:
                for name in sources:
                    archive.write(root / name, name)
            artifact_name = "research/goalspec/runs/synthetic-results/outcomes.json"
            artifact = root / artifact_name
            artifact.parent.mkdir(parents=True)
            artifact.write_text('{"success":false,"unknownCharge":true}\n')
            frozen = dict(sources=sources, sourceTreeHash=hashlib.sha256(module.canonical(sources)).hexdigest(),
                archive=dict(path="source.zip", **module.digest_file(freeze / "source.zip")),
                inputs=dict(outcomes=dict(path=artifact_name, **module.digest_file(artifact))))
            (freeze / "manifest.json").write_bytes(module.json_bytes(frozen))
            (freeze / "manifest.sha256").write_text(module.digest_file(freeze / "manifest.json")["sha256"] + "  manifest.json\n")
            (root / doc_name).write_text("Allowed final documentation.\n")
            cfg = dict(schemaVersion=1, packageLabel="Synthetic local test", freezeDirectory=freeze_name,
                groups=[dict(name="freeze",path=freeze_name,patterns=["*.json","*.sha256","source.zip"]),
                    dict(name="results",path=artifact.parent.relative_to(root).as_posix(),patterns=["*.json"])])
            inputs = root / "inputs.json"
            inputs.write_bytes(module.json_bytes(cfg))
            output = root / "synthetic.zip"
            with contextlib.redirect_stdout(io.StringIO()):
                module.build(root, inputs, cfg, output)
            verification = json.loads(Path(str(output) + ".verification.json").read_text())
            self.assertTrue(verification["allArchivedHashesVerified"])
            self.assertEqual(verification["disclosedAllowedChanges"][0]["path"], doc_name)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read("repository/" + artifact_name), artifact.read_bytes())
                self.assertEqual(archive.read("current-source/" + doc_name), (root / doc_name).read_bytes())
                internal = archive.read("PACKAGE_MANIFEST.json")
                self.assertEqual(internal, Path(str(output) + ".manifest.json").read_bytes())
            with self.assertRaises(ValueError):
                module.build(root, inputs, cfg, output)


if __name__ == "__main__":
    unittest.main()
