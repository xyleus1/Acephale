"""Propose a small native cohort from public requests. Never dispatches an actor.

The inherited keyword taxonomy is a conservative overlap screen, not a certified
semantic task-family ontology. Every proposal remains provisional for evaluation.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research" / "acephale" / "src"))
from acephale.contracts_v1 import hash_v1
from acephale.corpus_audit import near_pairs, request_tokens, shingles

INTENTS = {
    "cancel": r"cancel", "return": r"return|refund", "exchange": r"exchange|replace",
    "modify": r"change|modify|update", "book": r"book|reserv", "status": r"status|track|where",
    "baggage": r"bag|luggage", "payment": r"pay|credit|gift.card", "search": r"find|search|available",
}
# These source-only proposals are small enough to inspect manually. IDs never
# define a family: the grouping rule and public request evidence are exported.
PROPOSALS = {
    "weight_fit": [
        ("airline", "book+cancel", ["0", "1"], "Cancel one existing reservation; contest a policy refusal"),
        ("airline", "other", ["5", "27"], "Complain about delay and request compensation without changing the flight"),
        ("retail", "exchange+modify", ["0", "1"], "Exchange two delivered items subject to feature constraints"),
        ("retail", "payment+return", ["10", "11"], "Return orders while requesting an alternative refund payment route"),
    ],
    "calibration": [
        ("airline", "book+cancel+return", ["28", "49"], "Request reservation cancellation and refund"),
        ("retail", "book+cancel+modify+return+status", ["103", "104"], "Return several items; change a pending order and inspect tracking"),
    ],
    "development": [
        ("airline", "book+modify+payment", ["14", "23"], "Inspect payment balances and revise the trip under funding constraints"),
        ("retail", "cancel+exchange+modify+payment+return+search", ["98", "99"], "Exchange several constrained items and conditionally cancel another item"),
    ],
    "test": [
        ("airline", "book+modify", ["16", "29"], "Modify an existing itinerary subject to route, timing and fare preferences"),
        ("retail", "cancel+payment", ["36", "38"], "Resolve an order above the credit limit through a conditional sequence of alternatives"),
    ],
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def jsonl(path: Path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path: Path, value) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def project_public_task(task: dict, domain: str, official_split: str) -> dict:
    instructions = task["user_scenario"]["instructions"]
    if not isinstance(instructions, dict) or not isinstance(instructions.get("reason_for_call"), str):
        raise ValueError("Pinned task lacks structured public request instructions")
    request = {"reason_for_call": instructions["reason_for_call"], "task_instructions": instructions.get("task_instructions") or ""}
    if not isinstance(request["task_instructions"], str):
        raise ValueError("Invalid public task instructions")
    text = request["reason_for_call"].lower()
    matches = {name: [{"start": match.start(), "end": match.end(), "text": match.group()} for match in re.finditer(pattern, text)]
               for name, pattern in INTENTS.items() if re.search(pattern, text)}
    family = domain + ":" + ("+".join(sorted(matches)) or "other")
    return {"taskId": str(task["id"]), "domain": domain, "officialSplit": official_split,
            "provisionalFamily": family, "publicScenario": request, "publicScenarioHash": hash_v1(request),
            "intentMatchEvidence": matches, "isActorInput": False}


def lexical_pairs(rows: list[dict], text_key: str, threshold: float) -> list[dict]:
    signatures = []
    for row in rows:
        tokens = request_tokens(row[text_key])
        signatures.append(shingles(tokens) if len(tokens) >= 12 else frozenset())
    return [{"a": rows[a]["id"], "b": rows[b]["id"], "aSplit": rows[a]["split"], "bSplit": rows[b]["split"],
             "crossSplit": rows[a]["split"] != rows[b]["split"], "jaccard": similarity}
            for a, b, similarity in near_pairs(signatures, threshold)]


def design(benchmark: Path, seed_partition_path: Path, queue: Path, annotations: Path, output: Path,
           historical_corpus: Path | None = None) -> dict:
    if output.exists():
        raise FileExistsError("Cohort design output must be new")
    lock = read_json(ROOT / "research" / "acephale" / "benchmarks.lock.json")["benchmarks"]["tau3"]
    revision = subprocess.check_output(["git", "-C", str(benchmark), "rev-parse", "HEAD"], text=True).strip()
    if revision != lock["revision"]:
        raise ValueError("Native task checkout differs from pinned benchmark revision")
    seed = read_json(seed_partition_path)
    if seed["contentHash"] != hash_v1({key: value for key, value in seed.items() if key != "contentHash"}):
        raise ValueError("Historical seed partition identity differs")
    if seed.get("sourceAnnotationsSha256") != digest(annotations):
        raise ValueError("Historical seed annotations differ from the frozen partition")
    seed_ids = {row["checkpoint_id"] for row in jsonl(annotations)}
    seed_rows = []
    for row in jsonl(queue):
        if row["episode_id"] not in seed_ids:
            continue
        prefix = json.loads(row["visible_input_json"])
        request = next((message["content"] for message in prefix["messages"] if message["role"] == "user"), "")
        seed_rows.append({"id": row["episode_id"], "domain": row["family_id"].split(":")[0],
                          "split": "seed_" + seed["families"][row["family_id"]], "reason": request, "full": request})
    if len(seed_rows) != len(seed_ids):
        raise ValueError("Historical seed public queue is incomplete")
    sources = [seed_partition_path, queue, annotations]
    public, all_pairs, seed_pairs, historical_pairs = [], [], [], []
    groups = defaultdict(lambda: {"train": [], "test": []})
    for domain in ("airline", "retail"):
        directory = benchmark / "data" / "tau2" / "domains" / domain
        tasks, splits = read_json(directory / "tasks.json"), read_json(directory / "split_tasks.json")
        sources.extend([directory / "tasks.json", directory / "split_tasks.json"])
        official = {str(identifier): partition for partition in ("train", "test") for identifier in splits[partition]}
        if len(official) != len(splits["train"]) + len(splits["test"]) or set(official) != {str(task["id"]) for task in tasks}:
            raise ValueError("Native official split must be complete and disjoint")
        current = [project_public_task(task, domain, official[str(task["id"])]) for task in tasks]
        public.extend(current)
        for row in current:
            groups[row["provisionalFamily"]][row["officialSplit"]].append(row["taskId"])
        lexical = [{"id": domain + ":" + row["taskId"], "split": row["officialSplit"],
                    "reason": row["publicScenario"]["reason_for_call"],
                    "full": " ".join(row["publicScenario"].values())} for row in current]
        for field in ("reason", "full"):
            all_pairs.extend({**pair, "representation": field} for pair in lexical_pairs(lexical, field, 0.8))
        joined = lexical + [row for row in seed_rows if row["domain"] == domain]
        seed_pairs.extend(pair for pair in lexical_pairs(joined, "reason", 0.8)
                          if pair["a"].startswith(domain + ":") and pair["b"].startswith("Salesforce/"))
        if historical_corpus:
            historical = []
            for row in jsonl(historical_corpus):
                if not row["family_id"].startswith(domain + ":"):
                    continue
                request = next((message["content"] for message in row["messages"] if message["role"] == "user" and isinstance(message.get("content"), str)), "")
                historical.append({"id": row["id"], "split": "historical_" + row["split"], "reason": request})
            historical_pairs.extend(pair for pair in lexical_pairs(lexical + historical, "reason", 0.8)
                                    if pair["a"].startswith(domain + ":") and pair["b"].startswith("Salesforce/"))
    if historical_corpus:
        sources.append(historical_corpus)
    locks = seed["families"]
    seed_test_quarantine = [domain + ":" + identifier for family, members in groups.items() if family in locks
                            for identifier in members["test"] for domain in [family.split(":")[0]]]
    train_quarantine = [family.split(":")[0] + ":" + identifier for family, members in groups.items()
                        if family not in locks and members["test"] for identifier in members["train"]]
    candidates, seen_families = [], set()
    index = {(row["domain"], row["taskId"]): row for row in public}
    for partition, proposals in PROPOSALS.items():
        for domain, suffix, identifiers, description in proposals:
            family = domain + ":" + suffix
            if family in seen_families or len(identifiers) != 2:
                raise ValueError("Cohort proposals must have disjoint families and two variants")
            seen_families.add(family)
            if family in locks and locks[family] != partition:
                raise ValueError("Proposal would reassign a historical seed family")
            selected = [index[domain, identifier] for identifier in identifiers]
            if any(row["provisionalFamily"] != family or row["officialSplit"] != ("test" if partition == "test" else "train") for row in selected):
                raise ValueError("Proposal differs from current public evidence or official split")
            if any(domain + ":" + identifier in train_quarantine + seed_test_quarantine for identifier in identifiers):
                raise ValueError("Proposal includes a quarantined split-overlap record")
            candidates.append({"partition": partition, "domain": domain, "provisionalFamily": family, "taskIds": identifiers,
                               "requestStructureProposal": description, "semanticReviewStatus": "pending",
                               "executionAuthorized": False, "evaluationEligible": False,
                               "publicScenarioHashes": [row["publicScenarioHash"] for row in selected]})
    availability = {}
    for domain in ("airline", "retail"):
        eligible = {family: members for family, members in groups.items() if family.startswith(domain + ":")}
        availability[domain] = {
            "lockedWeightFitPairedFamilies": sum(len(members["train"]) >= 2 and locks.get(family) == "weight_fit" for family, members in eligible.items()),
            "lockedCalibrationPairedFamilies": sum(len(members["train"]) >= 2 and locks.get(family) == "calibration" for family, members in eligible.items()),
            "unassignedLearningPairedFamilies": sum(len(members["train"]) >= 2 and not members["test"] and family not in locks for family, members in eligible.items()),
            "unoccupiedOfficialTestPairedFamilies": sum(len(members["test"]) >= 2 and family not in locks for family, members in eligible.items()),
        }
    report = {"schemaVersion": 1, "kind": "acephale-provisional-native-cohort-design", "benchmark": lock,
              "publicFieldsUsed": ["id", "user_scenario.instructions.reason_for_call", "user_scenario.instructions.task_instructions"],
              "privateEvaluatorFieldsUsed": False, "modelCalls": 0, "actorExecutions": 0, "modelTraining": False,
              "familyScreen": {"version": "historical-visible-request-taxonomy-v1", "patterns": INTENTS,
                               "assignmentText": "reason_for_call", "domainSource": "pinned domain directory", "certifiedSemanticFamilies": False},
              "lexicalScreen": {"implementation": "acephale.corpus_audit", "shingleWords": 3, "jaccard": 0.8, "minimumTokens": 12,
                                "masking": "lowercase ASCII words; email and tokens containing digits/underscores replaced"},
              "sourceFiles": [{"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": digest(path)} for path in sources],
              "officialTasks": dict(Counter(row["domain"] + ":" + row["officialSplit"] for row in public)),
              "availability": availability, "proposedFamilies": dict(Counter(row["partition"] for row in candidates)),
              "proposedVariants": dict(Counter(row["partition"] for row in candidates for _ in row["taskIds"])),
              "seedOverlapOfficialTestQuarantine": sorted(seed_test_quarantine), "newTestFamilyTrainingQuarantine": sorted(train_quarantine),
              "crossSplitNearPairs": [pair for pair in all_pairs if pair["crossSplit"]],
              "seedNearPairs": seed_pairs, "historicalNearPairs": historical_pairs,
              "finalEvaluationEligible": False, "executionAuthorized": False,
              "limitations": [
                  "Keyword families conflate negated actions, return flights and book shelves; they require source-only semantic review.",
                  "No lexical overlap at 0.8 is not evidence of semantic independence or uncontaminated pretraining.",
                  "Official test tasks are never reassigned to weight fitting, memory, or calibration.",
                  "The 24-family, two-variant training-library target cannot be supported by this strict balanced source design; generate and independently verify new task fixtures or reduce the declared pilot.",
                  "The proposed balanced held-out set has two provisional families and four tasks, so it cannot establish a broad benchmark score or reliable tail latency.",
                  "These scenarios belong to the user simulator; they are not an actor prompt or predictor training input.",
              ]}
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "public-task-proposals.json", public)
    write_new(output / "cohort-proposals.json", candidates)
    write_new(output / "lexical-near-pairs.json", all_pairs)
    report["contentHash"] = hash_v1(report)
    write_new(output / "audit.json", report)
    return {"contentHash": report["contentHash"], "proposedFamilies": report["proposedFamilies"],
            "crossSplitNearPairs": len(report["crossSplitNearPairs"]), "status": "provisional_no_executions"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path, required=True)
    parser.add_argument("--seed-partition", type=Path, required=True)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--historical-corpus", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(design(args.benchmark, args.seed_partition, args.queue, args.annotations, args.output, args.historical_corpus)))


if __name__ == "__main__":
    main()
