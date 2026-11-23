"""Verify saved public aggregate data; no model or statistical estimator."""
from pathlib import Path
import csv,hashlib,json
ROOT=Path(__file__).resolve().parent
def main():
    manifest=json.loads((ROOT/"reproducibility/data-checksums.json").read_text())
    for item in manifest["files"]:
        raw=(ROOT/item["path"]).read_bytes()
        assert len(raw)==item["bytes"] and hashlib.sha256(raw).hexdigest()==item["sha256"],item["path"]
    data=json.loads((ROOT/"figure-data.json").read_text())
    for name,item in data["tables"].items():
        path=ROOT/"tables"/(name+".csv");raw=path.read_bytes()
        with path.open(newline="") as stream:rows=list(csv.DictReader(stream))
        assert hashlib.sha256(raw).hexdigest()==item["sha256"] and rows==item["rows"],name
    print("Verified saved file bytes and all CSV/figure-data rows; no estimates recomputed.")
if __name__=="__main__":main()
