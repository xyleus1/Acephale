"""Call the pinned upstream evaluator on a registered native trajectory and browser.

This bridge is deferred until the upstream checkout, Python environment and local
website images are installed. Fuzzy/model judging is denied to prevent unbudgeted calls.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


def main(registration):
    from goalspec.adapters.webarena_local import REVISION
    if registration["sourceRevision"] != REVISION:
        raise ValueError("Unpinned native evaluator")
    checkout = Path(registration["checkout"]).resolve()
    actual = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    if actual != REVISION:
        raise ValueError("Native evaluator checkout changed")
    task = Path(registration["configPath"]).resolve()
    trajectory = Path(registration["trajectoryPath"]).resolve()
    for name, path in [("config", task), ("trajectory", trajectory)]:
        if hashlib.sha256(path.read_bytes()).hexdigest() != registration[name + "Hash"]:
            raise ValueError("Independent evaluator input changed after registration")
    config = json.loads(task.read_text(encoding="utf-8"))
    if "fuzzy_match" in config.get("eval", {}).get("reference_answers", {}):
        raise ValueError("Model-assisted WebArena judging remains deferred")
    endpoint = urlparse(registration["cdpEndpoint"])
    if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1":
        raise ValueError("Only a registered local authoritative browser is supported")
    sys.path.insert(0, str(checkout))
    from evaluation_harness.evaluators import evaluator_router
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(registration["cdpEndpoint"])
        pages = [page for context in browser.contexts for page in context.pages if page.url.startswith(registration["authoritativeOrigin"] + "/")]
        if len(pages) != 1:
            raise ValueError("Expected one registered authoritative task page")
        page = pages[0]
        client = page.context.new_cdp_session(page)
        score = evaluator_router(str(task))(trajectory=json.loads(trajectory.read_text(encoding="utf-8")), config_file=str(task), page=page, client=client)
        client.detach()
    return {"passed": score == 1.0, "evidence": {"nativeScore": score, "verifierRevision": REVISION,
            "configHash": registration["configHash"], "trajectoryHash": registration["trajectoryHash"]}}


if __name__ == "__main__":
    try:
        print(json.dumps(main(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps({"error": type(error).__name__}))
        raise SystemExit(1) from None
