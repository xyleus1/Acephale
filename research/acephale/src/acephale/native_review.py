"""Build a local, pending human review form from a frozen native annotation pilot."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import _public_check, read_jsonl, verify_bundle
from acephale.storage import file_hash
from acephale.training_data import annotation_goal_draft, write_new

RUBRIC = "acephale-native-goal-review-v1"


def _page(packet: dict[str, Any]) -> str:
    escape = html.escape
    sections = []
    for index, case in enumerate(packet["cases"], 1):
        goals = "".join(f"<li><strong>{escape(goal['objective'])}</strong><ul>"
                        + "".join(f"<li>{escape(constraint['text'])}</li>" for constraint in goal["constraints"])
                        + "</ul></li>" for goal in case["goalDraft"]["hypotheses"])
        sources = json.dumps(case["publicInput"]["input"]["sources"], ensure_ascii=False, indent=2)
        references = json.dumps(case["resolvedReferences"], ensure_ascii=False, indent=2)
        sections.append(f"<section data-case='{index - 1}'><h2>{index:02}: {escape(case['familyId'])}</h2>"
                        f"<h3>Visible evidence</h3><pre>{escape(sources)}</pre><h3>Proposed goals</h3><ol>{goals}</ol>"
                        f"<p>Unknown probability: {case['goalDraft']['unknown']}</p>"
                        f"<details><summary>Resolved objective and constraint references</summary><pre>{escape(references)}</pre></details>"
                        f"<details><summary>Complete public checkpoint</summary><pre>{escape(json.dumps(case['publicInput'], ensure_ascii=False, indent=2))}</pre></details>"
                        f"<fieldset><legend>Your decision</legend><label><input type='radio' name='case-{index}' value='A'> Acceptable and supported</label>"
                        f"<label><input type='radio' name='case-{index}' value='R'> Incorrect or incomplete</label>"
                        f"<label><input type='radio' name='case-{index}' value='U'> Unsupported factual binding</label></fieldset>"
                        "<label>Notes (required for an incorrect or unsupported annotation)<textarea rows='2'></textarea></label></section>")
    payload = json.dumps({"packetHash": packet["contentHash"], "rubric": RUBRIC,
                          "cases": [{"checkpoint_id": row["checkpointId"], "annotationHash": row["annotationHash"]} for row in packet["cases"]]})
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'">
<title>Acephale native annotation review</title>
<style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#18212b}section{border-top:1px solid #ccd2da;padding:28px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f6;padding:16px;font:13px/1.5 monospace}label{display:block;margin:10px 0}textarea{display:block;width:95%;font:inherit}fieldset{margin:16px 0}button,input{font:inherit}button{padding:10px 16px}summary{cursor:pointer}</style>
<h1>Review 20 native goal annotations</h1>
<p>Check whether the proposed goals preserve the visible request and material constraints. A valid reference does not prove semantic support. No future actions or completion verdicts are shown.</p>
<p>Read each example and choose a decision. At least 18 of 20 must be acceptable, with zero unsupported bindings. Opening this file records no approval. Your choices remain in this page until you download them.</p>
<label>Your name or reviewer identifier <input id="reviewer" autocomplete="off" required></label>
""" + f"<p>Packet: <code>{packet['contentHash']}</code></p>" + "".join(sections) + r"""
<p id="progress" role="status">0 of 20 reviewed</p><button id="download" disabled>Download reviews.jsonl</button>
<script>
const packet = """ + payload + r""";
const sections = [...document.querySelectorAll('section')];
const reviewer = document.getElementById('reviewer');
const button = document.getElementById('download');
function decisions() {
  return sections.map(section => ({choice: section.querySelector('input:checked')?.value, notes: section.querySelector('textarea').value.trim()}));
}
function update() {
  const rows = decisions();
  const complete = rows.filter(row => row.choice && (row.choice === 'A' || row.notes)).length;
  document.getElementById('progress').textContent = `${complete} of ${rows.length} reviewed`;
  button.disabled = complete !== rows.length || !reviewer.value.trim();
}
document.addEventListener('input', update);
button.addEventListener('click', () => {
  update(); if (button.disabled) return;
  const rows = decisions().map((row, index) => ({...packet.cases[index], reviewer: reviewer.value.trim(), rubric_version: packet.rubric,
    semantics_acceptable: row.choice === 'A', unsupported_binding: row.choice === 'U', notes: row.notes,
    packetHash: packet.packetHash, reviewed_at: new Date().toISOString()}));
  const url = URL.createObjectURL(new Blob([rows.map(row => JSON.stringify(row)).join('\n') + '\n'], {type: 'application/x-ndjson'}));
  const link = document.createElement('a'); link.href = url; link.download = 'reviews.jsonl'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
</script></html>
"""


def prepare_native_review(pilot_directory: Path, dataset_directory: Path, annotations_path: Path, output: Path) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError("Review output must be new")
    pilot_manifest, dataset_manifest = verify_bundle(pilot_directory), verify_bundle(dataset_directory)
    pilot = json.loads((pilot_directory / "pilot.json").read_text(encoding="utf-8"))
    split = json.loads((dataset_directory / "split.json").read_text(encoding="utf-8"))
    inputs = read_jsonl(pilot_directory / "annotation-inputs.jsonl")
    public_rows = read_jsonl(dataset_directory / "public.jsonl")
    public = {row["checkpoint_id"]: row for row in public_rows}
    annotations = read_jsonl(annotations_path)
    by_id = {row["checkpoint_id"]: row for row in annotations}
    audit_ids = [row["checkpoint_id"] for row in pilot["audit"]]
    input_ids = [row["checkpoint_id"] for row in inputs]
    if (pilot.get("pilot_count") != 100 or len(inputs) != 100 or len(set(input_ids)) != 100
            or pilot.get("audit_count") != 20 or len(audit_ids) != 20 or len(set(audit_ids)) != 20
            or not set(audit_ids) <= set(input_ids) or len(by_id) != len(annotations) or set(by_id) != set(input_ids)
            or len(public) != len(public_rows) or pilot.get("source_dataset_hash") != dataset_manifest["bundle_hash"]
            or pilot.get("source_split_hash") != hash_v1(split)
            or pilot.get("checkpoints") != [{"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"]} for row in inputs]):
        raise ValueError("Review requires a complete frozen 100-input native pilot and 20 predeclared audits")
    drafts = {}
    for row in inputs:
        original = public.get(row["checkpoint_id"])
        if (not original or original.get("split") != "train" or original.get("domain") not in {"retail", "airline"}
                or split["families"].get(original["family_id"]) != "train"
                or row != {key: original[key] for key in ("checkpoint_id", "input_hash", "request_revision", "input")}):
            raise ValueError("Review prefix differs from the frozen native training source")
        _public_check(row["input"])
        drafts[row["checkpoint_id"]] = annotation_goal_draft(by_id[row["checkpoint_id"]], row)
    cases = []
    for checkpoint in audit_ids:
        row, draft = public[checkpoint], drafts[checkpoint]
        source_values = {source["id"]: source["value"] for source in row["input"]["sources"]}
        references = []
        for goal in draft["hypotheses"]:
            for reference in [*goal["sources"], *(ref for constraint in goal["constraints"] for ref in constraint["sources"])]:
                value = source_values[reference["sourceId"]]
                for part in reference["path"]:
                    value = value[part]
                references.append({"reference": reference, "value": value})
        cases.append({"checkpointId": checkpoint, "familyId": row["family_id"], "annotationHash": hash_v1(by_id[checkpoint]),
                      "publicInput": {key: row[key] for key in ("checkpoint_id", "input_hash", "request_revision", "input")},
                      "goalDraft": draft, "resolvedReferences": references})
    body = {"version": 2, "kind": "acephale-native-goal-review", "humanReviewStatus": "pending", "requiredCount": 20,
            "rubricVersion": RUBRIC, "cases": cases, "provenance": {"pilotBundleHash": pilot_manifest["bundle_hash"],
            "sourceDatasetHash": dataset_manifest["bundle_hash"], "pilotHash": hash_v1(pilot), "annotationsSha256": file_hash(annotations_path)}}
    packet = {**body, "contentHash": hash_v1(body)}
    output.mkdir(parents=True)
    write_new(output / "packet.json", packet)
    (output / "review-pilot.json").write_bytes((pilot_directory / "pilot.json").read_bytes())
    (output / "annotations.jsonl").write_bytes(annotations_path.read_bytes())
    (output / "review.html").write_text(_page(packet), encoding="utf-8", newline="\n")
    return {"contentHash": packet["contentHash"], "cases": 20, "status": "pending_human_review", "html": str(output / "review.html")}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("pilot-directory", "dataset", "annotations", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_native_review(args.pilot_directory, args.dataset, args.annotations, args.output)))


if __name__ == "__main__":
    main()
