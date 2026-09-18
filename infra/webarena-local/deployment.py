"""Generate two isolated local stacks from already loaded immutable image IDs."""
import argparse
import json
import re
from pathlib import Path

REVISION = "dce04686a56253aefba7b18a4fa0937cf1dc987b"
SITES = {"shopping": (7770, 80), "shopping_admin": (7780, 80), "gitlab": (8023, 8023), "forum": (9999, 80)}
UPSTREAM_NAMES = {"shopping": "shopping_final_0712", "shopping_admin": "shopping_admin_final_0719", "gitlab": "gitlab-populated-final-port8023", "forum": "postmill-populated-exposed-withimg"}


def compose(images, stack):
    if stack not in {"authoritative", "snapshot"} or set(images) != set(SITES):
        raise ValueError("Require exactly the four approved independent website images")
    services = {}
    for site, (port, container_port) in SITES.items():
        image = images[site]
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
            raise ValueError("Use locally inspected immutable image IDs; mutable tags are rejected")
        service = {"image": image, "pull_policy": "never", "container_name": f"goalspec-webarena-{stack}-{site}",
                   "ports": [f"127.0.0.1:{port + (10000 if stack == 'snapshot' else 0)}:{container_port}"],
                   "networks": ["isolated"], "restart": "no", "labels": {"goalspec.stack": stack, "goalspec.source": REVISION}}
        if site == "gitlab":
            service["command"] = ["/opt/gitlab/embedded/bin/runsvdir-start"]
        services[site] = service
    # No bind mounts, external volumes, shared writable paths, or shared networks.
    return {"name": f"goalspec-webarena-{stack}", "services": services, "networks": {"isolated": {"internal": True}}}


def generate(lock, output):
    if lock.get("sourceRevision") != REVISION:
        raise ValueError("Upstream source pin changed; audit before using a new revision")
    definitions = {stack: compose(lock["images"], stack) for stack in ["authoritative", "snapshot"]}
    output.mkdir(exist_ok=False, parents=True)
    for stack, definition in definitions.items():
        (output / f"{stack}.compose.json").write_text(json.dumps(definition, indent=2) + "\n", encoding="utf-8")
    (output / "release.json").write_text(json.dumps({**lock, "upstreamNames": UPSTREAM_NAMES, "paidEvaluation": "deferred",
        "source": f"https://github.com/web-arena-x/webarena/tree/{REVISION}", "infrastructure": "local only", "recommendedFreeStorageGB": 1000,
        "supportedSites": list(SITES), "unsupportedSites": ["map", "wikipedia", "homepage", "documentation"]}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("lock", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    generate(json.loads(args.lock.read_text(encoding="utf-8")), args.output)
