from pathlib import Path
import argparse, hashlib, json

EXPECTED_SNAPSHOT = 'c34e754eace3e7e95c818701bedaf1e4c878458a6c6710fed8b5a4df9bfcd91c'
EXPECTED_REPORTS = {'seed17-neutral-fixed-score-report.json': 'd0eb584b34f682d47538780307c221ed9f376cec0a87323e7fc78447e3f35ab6', 'seed17-goals-fixed-score-report.json': '8909cf9306588359116befe9f810f3fdc8a2596b766691f65fde27800cc14687', 'seed17-goal-reliability.json': '872c1b28c5774d41dba14ef73716e9e470af1d1277566ffa60aae7bb712a9e5e'}
EXPECTED_MARKDOWN = 'f79f83dd571ea33ae3efb17b7c82b0d4cbf6be1ea1d524491152d21485e12097'

def checked(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Exact reviewed public snapshot and accepted source bytes are required: " + path.name)
    return data

def export(paper, output):
    snapshot = checked(paper / "disposition/recorded-snapshot.json", EXPECTED_SNAPSHOT)
    value = json.loads(snapshot)
    if value["studyComplete"] is not False or value["unitCounts"] != {"accepted": 3, "failed": 1, "derived-blocked": 4, "pending": 4}:
        raise ValueError("Only the reviewed incomplete disposition is supported")
    documents = {}
    for name, digest in EXPECTED_REPORTS.items():
        data = checked(paper / "sources" / name, digest)
        documents[name] = {"sourceSha256": digest, "recordedValues": json.loads(data)}
    markdown = checked(paper / "disposition/manuscript-accepted-values.md", EXPECTED_MARKDOWN)
    result = {"kind": "acephale-public-copied-accepted-values-v1", "studyComplete": False,
              "statisticsRecomputed": False, "documents": documents}
    encoded = (json.dumps(result, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()
    output.mkdir(parents=True, exist_ok=False)
    (output / "incomplete-report.json").write_bytes(snapshot)
    (output / "recorded-accepted-values.json").write_bytes(encoded)
    (output / "manuscript-accepted-values.md").write_bytes(markdown)
    return {"studyComplete": False, "statisticsRecomputed": False, "files": 3}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--paper", type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(export(a.paper, a.output)))
if __name__ == "__main__":
    main()
