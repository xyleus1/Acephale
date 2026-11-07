"""Pin public repository metadata without credentials or accepting access terms."""
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from acephale.corpus import SOURCES


def main():
    destination = Path(__file__).resolve().parents[1] / "dataset-releases.lock.json"
    if destination.exists():
        raise ValueError("Existing corpus pins must be reviewed, not silently replaced")
    releases = {}
    for name, (repository, license_id, _, _) in SOURCES.items():
        with urlopen(f"https://huggingface.co/api/datasets/{repository}", timeout=30) as response:
            metadata = json.load(response)
        revision = metadata["sha"]
        with urlopen(f"https://huggingface.co/datasets/{repository}/raw/{revision}/README.md", timeout=30) as response:
            card = response.read()
        releases[name] = {"repository": repository, "revision": revision, "license": metadata.get("cardData", {}).get("license", license_id),
                          "card_sha256": hashlib.sha256(card).hexdigest(), "gated": metadata.get("gated", False),
                          "files": [item["rfilename"] for item in metadata.get("siblings", [])], "verification_tier": "source_reported"}
        if name == "apigen":
            try:
                request = Request(f"https://huggingface.co/datasets/{repository}/resolve/{revision}/apigen-mt_5k.json", method="HEAD")
                with urlopen(request, timeout=30) as response:
                    releases[name]["unauthenticated_data_http_status"] = response.status
            except HTTPError as error:
                releases[name]["unauthenticated_data_http_status"] = error.code
    destination.write_text(json.dumps({"schema_version": 1, "verified_at": datetime.now(UTC).isoformat(), "releases": releases}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({name: {"revision": r["revision"], "gated": r["gated"]} for name, r in releases.items()}))


if __name__ == "__main__":
    main()
