"""Convert durable execution events to standalone OTLP JSON spans without payloads."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--events", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    spans, omissions = [], 0
    for path in sorted(args.events.glob("events-*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            body = row["body"]
            recorded = body.get("recordedAtUnixMs")
            event = body["event"]
            run_id = event.get("runId", "service")
            event = event.get("event", event)
            if recorded is None:
                omissions += 1
                continue
            latency = event.get("latencyMs", event.get("details", {}).get("latencyMs", 0))
            identity = f"{path.name}:{body['sequence']}".encode()
            attributes = [{"key": "goalspec.run_id", "value": {"stringValue": run_id}}]
            for key in ("model", "status", "costMicrodollars", "attempt", "key"):
                if key in event:
                    attributes.append({"key": f"goalspec.{key}", "value": {"stringValue": str(event[key])}})
            spans.append({"traceId": hashlib.sha256(run_id.encode()).hexdigest()[:32],
                          "spanId": hashlib.sha256(identity).hexdigest()[:16], "name": event.get("type", "execution_event"),
                          "kind": 1, "startTimeUnixNano": str(round((recorded - latency) * 1_000_000)),
                          "endTimeUnixNano": str(recorded * 1_000_000), "attributes": attributes})
    result = {"resourceSpans": [{"resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "goalspec-local-research"}}]},
                                 "scopeSpans": [{"scope": {"name": "goalspec", "version": "1"}, "spans": spans}]}]}
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, separators=(",", ":"))
    print(json.dumps({"spans": len(spans), "omitted_without_wall_clock": omissions,
                      "format": "OTLP JSON", "export": str(args.output)}))


if __name__ == "__main__":
    main()
