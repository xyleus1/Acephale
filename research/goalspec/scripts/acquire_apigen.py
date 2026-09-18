"""Download only the pinned public APIGen release, with bounded size and lineage."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen


def main():
    root = Path(__file__).resolve().parents[1]
    pin = json.loads((root / "dataset-releases.lock.json").read_text())["releases"]["apigen"]
    destination = root / "runs" / f"apigen-{pin['revision']}"
    destination.mkdir(parents=True, exist_ok=False)
    url = f"https://huggingface.co/datasets/{pin['repository']}/resolve/{pin['revision']}/apigen-mt_5k.json"
    digest = hashlib.sha256()
    total = 0
    with urlopen(url, timeout=60) as response, (destination / "apigen-mt_5k.json").open("xb") as output:
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > 512 * 1024 * 1024:
                raise ValueError("Corpus exceeds bounded download")
            digest.update(chunk)
            output.write(chunk)
    manifest = {**pin, "data_url": url, "bytes": total, "data_sha256": digest.hexdigest(), "research_only": True, "independent_replay_verified": False}
    (destination / "acquisition.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"destination": str(destination), "bytes": total, "sha256": digest.hexdigest()}))


if __name__ == "__main__":
    main()
