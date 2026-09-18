"""Describe the frozen annotation pilot without changing any teacher verdict."""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def report(directory, output):
    summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
    raw = (directory / "annotations.jsonl").read_bytes()
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 100 or len({row["groupId"] for row in rows}) != 100:
        raise ValueError("The complete frozen 100-prefix pilot is required")
    digest = hashlib.sha256(raw).hexdigest()
    declared = summary.get("outputSha256") or summary.get("composedAnnotationsSha256")
    if declared != digest:
        raise ValueError("Closed annotation digest mismatch")
    strata = defaultdict(list)
    for row in rows:
        strata["all"].append(row)
        strata["reliability:" + row["reliabilitySplit"]].append(row)
        strata["family:" + row["familyId"]].append(row)
    metrics = {}
    for name, group in strata.items():
        graded = [row for row in group if row["agreement"]["status"] == "completed"]
        atoms = defaultdict(Counter)
        errors = Counter()
        failure_reasons = Counter()
        for row in graded:
            value = row["agreement"]["value"]
            for key in ("ambiguous", "unsupportedPrediction", "stalePrediction"):
                errors[key] += bool(value[key])
            indexed = {atom["id"]: atom for atom in value["atoms"]}
            required = [atom for atom in row["annotation"]["value"]["atoms"]
                        if atom["status"] in {"active", "unresolved"}]
            all_covered = all(indexed[atom["id"]]["covered"] and not indexed[atom["id"]]["contradicted"]
                              for atom in required)
            if row["agreement"]["label"] != 1:
                failure_reasons["wrongOverallGoal"] += not value["goalMatches"]
                failure_reasons["missingOrContradictedRequiredAtom"] += not all_covered
                failure_reasons["ambiguous"] += bool(value["ambiguous"])
                failure_reasons["blindAnnotationAmbiguous"] += bool(row["annotation"]["value"]["ambiguous"])
                failure_reasons["unsupported"] += bool(value["unsupportedPrediction"])
                failure_reasons["stale"] += bool(value["stalePrediction"])
                failure_reasons["ambiguityOnly"] += bool((value["ambiguous"] or row["annotation"]["value"]["ambiguous"]) and value["goalMatches"]
                    and all_covered and not value["unsupportedPrediction"] and not value["stalePrediction"])
            for atom in row["annotation"]["value"]["atoms"]:
                if atom["status"] not in {"active", "unresolved"}:
                    continue
                grade = indexed[atom["id"]]
                atoms[atom["kind"]].update(total=1, covered=int(grade["covered"]), contradicted=int(grade["contradicted"]))
        strict = sum(row["agreement"]["label"] == 1 for row in group)
        metrics[name] = {"selected": len(group), "graded": len(graded), "missing": len(group) - len(graded),
            "strictCompleteAgreementCount": strict, "strictAgreementAllSelected": strict / len(group),
            "strictAgreementAmongGraded": strict / len(graded) if graded else None,
            "overallGoalMatchesAmongGraded": sum(row["agreement"]["value"]["goalMatches"] for row in graded) / len(graded) if graded else None,
            "teacherErrorFlags": dict(errors), "strictFailureReasonsOverlapping": dict(failure_reasons),
            "requiredAtomsByKind": dict(atoms)}
    value = {"version": "v5-annotation-diagnosis-v1", "sourceSha256": digest, "metrics": metrics,
        "interpretation": ["Training diagnostic, not held-out task accuracy.",
            "Teacher agreement is not independent semantic truth.",
            "Strict complete agreement is the primary declared label; overall goal match is a separate descriptive diagnostic.",
            "Missing grades remain misses in the all-selected denominator and masked labels in fitting.",
            "Atomic observations share prefixes/families and are not independent trials.",
            "All original attempted provider outcomes are retained; continuation dispatches only previously unattempted prefixes."]}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"output": str(output), **metrics["all"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    report(args.directory, args.output)
