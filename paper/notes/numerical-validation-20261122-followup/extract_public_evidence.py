"""Copy only the reviewed public projection from one exact retained input.

No model call, numerical calculation or statistical analysis is performed.
The input contains private evidence references; only publicProjection is emitted.
"""
from pathlib import Path
import argparse,hashlib,json

EXPECTED_INPUT_SHA256 = "ad7b11072dc7261fa1ba07762c906feaf3f7a9c4dc7ef5c8612106bcfc9d0fe7"

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    raw=args.input.read_bytes()
    actual=hashlib.sha256(raw).hexdigest()
    if actual != EXPECTED_INPUT_SHA256:
        raise SystemExit("Input SHA256 mismatch: expected reviewed snapshot "+EXPECTED_INPUT_SHA256+"; got "+actual)
    value=json.loads(raw)
    if value["kind"] != "acephale-reviewed-numerical-followup-integration-v1":
        raise SystemExit("Unexpected reviewed integration schema")
    result=value["publicProjection"]
    content=(json.dumps(result,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
    with args.output.open("xb") as output:output.write(content)

if __name__=="__main__":
    main()
