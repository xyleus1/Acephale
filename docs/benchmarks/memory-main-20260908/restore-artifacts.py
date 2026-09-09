"""Restore published gzip artifacts locally, verifying hashes without overwrite."""
from __future__ import annotations
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(path):
    checksum = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            checksum.update(chunk)
            size += len(chunk)
    return checksum.hexdigest(), size


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("complete") is not True or manifest.get("kind") != "complete_profile_composition":
        raise ValueError("A complete profile-composition package is required.")
    restores = []
    for artifact in manifest["artifacts"]:
        archive = (ROOT / artifact["path"]).resolve()
        if not archive.is_relative_to(ROOT):
            raise ValueError("An artifact escapes the package directory.")
        if digest(archive) != (artifact["sha256"], artifact["bytes"]):
            raise ValueError(f"Packaged artifact checksum mismatch: {artifact['path']}")
        if artifact["encoding"] == "gzip":
            destination = (ROOT / artifact["rawPath"]).resolve()
            if not destination.is_relative_to(ROOT) or destination.exists():
                raise ValueError("Refusing an outside-package or existing restoration target.")
            restores.append((archive, destination, artifact))
    # Validate every input and target before creating any decompressed file.
    for archive, destination, artifact in restores:
        with gzip.open(archive, "rb") as compressed, destination.open("xb") as restored:
            while chunk := compressed.read(1024 * 1024):
                restored.write(chunk)
        if digest(destination) != (artifact["rawSha256"], artifact["rawBytes"]):
            raise ValueError("Decompressed checksum mismatch; partial files remain for inspection.")
    print(json.dumps({"ok": True, "restoredArtifacts": len(restores)}))


if __name__ == "__main__":
    main()
