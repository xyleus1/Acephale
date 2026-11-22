"""Reproduce copied original native numerical sections; no model or provider access."""
import argparse,json
from pathlib import Path
from original_numeric import reproduce_original_sections
def main():
 p=argparse.ArgumentParser();p.add_argument("--input",required=True);p.add_argument("--expected");p.add_argument("--output",required=True);a=p.parse_args()
 value=json.loads(Path(a.input).read_bytes())
 if value.get("validationStatus")!="unvalidated" or value.get("scientificAcceptanceAsserted")is not False:raise ValueError("Expected explicit unvalidated public input")
 report=reproduce_original_sections(value)
 if a.expected and report!=json.loads(Path(a.expected).read_bytes()):raise ValueError("Reproduced numerical sections differ from original computed report")
 path=Path(a.output)
 with path.open("x")as f:json.dump(report,f,sort_keys=True,indent=2,allow_nan=False);f.write("\n")
 print(json.dumps({"numericalSectionsMatched":bool(a.expected),"statisticsSource":"unchanged original functions/statements","scientificAcceptanceAsserted":False}))
if __name__=="__main__":main()
