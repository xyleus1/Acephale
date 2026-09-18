"""Trusted stdio protocol for the local browser snapshot provider, with no API use."""
import json
import sys
from pathlib import Path

from goalspec.adapters.webarena_local import LocalWebArenaController

controller = LocalWebArenaController(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
for line in sys.stdin:
    request = json.loads(line)
    try:
        operation = request["operation"]
        if operation == "reset":
            result = controller.reset()
        elif operation == "acquire":
            result = controller.acquire()
        elif operation == "fresh":
            result = controller.fresh(request["snapshot"])
        elif operation == "release":
            result = controller.release(request["snapshot"])
        elif operation == "verify":
            result = controller.verify(request["expected"])
        else:
            raise ValueError("Unknown trusted browser operation")
        print(json.dumps({"id": request["id"], "result": result}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request.get("id"), "error": type(error).__name__}), flush=True)
