"""Synthetic scanner tests; no provider, database or original artifact reads."""
import hashlib
import importlib.util
import re
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("postrun_archive", Path(__file__).with_name("export_native_archive_postrun.py"))
overlay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(overlay)


@pytest.mark.parametrize("prefix", ["", '"', "Bearer ", "token:", "\n"])
@pytest.mark.parametrize("kind", ["", "proj-", "svcacct-"])
def test_standalone_synthetic_key_prefixes_remain_rejected(prefix, kind):
    synthetic = prefix + "sk-" + kind + "x" * 32
    assert re.search(overlay.KEY_PATTERN, synthetic)


@pytest.mark.parametrize("prefix", ["A", "0", "_", "-"])
def test_embedded_substring_in_opaque_token_is_not_a_key_prefix(prefix):
    synthetic = prefix + "sk-" + "x" * 32
    assert re.search(r"sk-[A-Za-z0-9_-]{20,}", synthetic)
    assert re.search(overlay.KEY_PATTERN, synthetic) is None


@pytest.mark.parametrize("secret", [False, True])
def test_overlay_scans_artifacts_and_restores_original_scanner(tmp_path, monkeypatch, secret):
    path = tmp_path / "fixture.json"
    value = ("" if secret else "opaque_A") + "sk-" + "x" * 32
    path.write_text('{"value":"' + value + '"}\n', encoding="utf-8")
    previous = overlay.archive_v3.KEY_PREFIX
    before = hashlib.sha256(Path(overlay.archive_v3.__file__).read_bytes()).hexdigest()

    def scanned_export(configuration, output, *, closed_confirmed):
        assert closed_confirmed is True
        return overlay.archive_v3._scan_text(path)

    monkeypatch.setattr(overlay.archive_v3, "export_archive", scanned_export)
    if secret:
        with pytest.raises(ValueError, match="Credential-like content"):
            overlay.export_with_token_boundaries({}, tmp_path / "unused", closed_confirmed=True)
    else:
        assert overlay.export_with_token_boundaries({}, tmp_path / "unused", closed_confirmed=True) == "text_key_prefix_scan_passed"
    assert overlay.archive_v3.KEY_PREFIX is previous
    assert hashlib.sha256(Path(overlay.archive_v3.__file__).read_bytes()).hexdigest() == before


def test_packager_uses_the_same_token_boundary():
    spec = importlib.util.spec_from_file_location("postrun_package", Path(__file__).with_name("build_package.py"))
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    assert package.KEY.pattern.decode("ascii") == overlay.KEY_PATTERN
