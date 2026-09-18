"""Read-only post-hoc replay audit. Never alters grades, fits models or calls a provider."""
from pathlib import Path
import collections
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "research/goalspec/runs"
REPLAY = RUNS / "local-v5-prediction-replay-20260916"
REPORT = RUNS / "local-v5-prediction-replay-report-20260916.json"
OUT = RUNS / "local-v5-prediction-replay-audit-20260916"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def lines(name):
    return [json.loads(line) for line in (REPLAY / name).read_text(encoding="utf-8").splitlines()]


def close(a, b):
    assert a is None and b is None or a is not None and b is not None and abs(a-b) < 1e-12, (a,b)


def key(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main():
    assert not OUT.exists(), "New immutable output directory required"
    paths = [REPORT, Path(__file__), *(REPLAY / name for name in ["plan.json", "manifest.json", "annotations.jsonl",
        "annotation-events.jsonl", "provider-events.jsonl", "public-pools.json", "scores.jsonl", "labels.jsonl", "predictions.jsonl"]),
        ROOT / "outputs/goalspec-v5-tools/prediction-replay.ts", ROOT / "outputs/goalspec-v5-tools/prediction_replay_report.py",
        ROOT / "scripts/goalspec-annotation-v5.ts"]
    sources = [{"path": str(path.relative_to(ROOT)).replace("\\", "/"), "sha256": sha(path)} for path in paths]
    report, plan, manifest = read(REPORT), read(REPLAY / "plan.json"), read(REPLAY / "manifest.json")
    assert sha(REPLAY / "plan.json") == manifest["planSha256"] == report["planSha256"]
    annotations, events, attempts, scores = lines("annotations.jsonl"), lines("annotation-events.jsonl"), lines("provider-events.jsonl"), lines("scores.jsonl")
    assert len(annotations) == 16 and len(scores) == 128
    assert [r["id"] for r in annotations] == [r["id"] for r in plan["selected"]]
    assert collections.Counter(row["domain"] for row in plan["selected"]) == {"retail": 8, "airline": 8}
    assert len({r["familyId"] for r in plan["selected"]}) == 6
    provider = [r["body"]["event"] for r in attempts]
    assert len(provider) == 47 and all(row["attempt"] == 0 for row in provider)
    # These descriptive categories were assigned from the unchanged teacher reasons,
    # not used as replacement grades. Categories overlap and are not outcome labels.
    categories = {
        "omitted_urgency": [1,2,3,12,15],
        "omitted_uncertainty_or_lookup_background": [0,8,10,13],
        "stale_payment_instruction": [5,11],
        "unsupported_status_policy_or_supporting_action": [1,3,13,14,15],
        "missing_prior_complementary_request_or_payment_detail": [4],
        "weakened_preference_conditional_or_exception_request": [3,6,7,12,14],
        "missing_requested_lookup_step": [0,5,7],
        "incomplete_blind_annotation": [9],
    }
    rows, flags, atom_counts = [], collections.Counter(), collections.Counter()
    raw_responses_verified = 0
    for index, row in enumerate(annotations):
        own = [e["event"] for e in events if e["id"] == row["id"]]
        responses = [e for e in own if e["type"] == "teacher_response"]
        for response in responses:
            text_hash = hashlib.sha256(json.dumps(response["text"], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
            assert response["responseHash"] == text_hash
            raw = json.loads(response["text"])
            if response["id"].endswith(":blind"):
                assert raw == row["annotation"]
            else:
                assert raw["assessments"] == [{"rank": g["rank"], "agreement": g["agreement"]} for g in row["grades"]]
            raw_responses_verified += 1
        goal_response = next(e for e in own if e["type"] == "goal_delta_response")
        raw_goal = json.loads(goal_response["text"])
        assert len(raw_goal["set_active_goals"]) == len(row["goals"]["hypotheses"]) == 1
        assert raw_goal["set_active_goals"][0]["objective"] == row["goals"]["hypotheses"][0]["objective"]
        assert [c["text"] for c in raw_goal["set_active_goals"][0]["constraints"]] == [c["text"] for c in row["goals"]["hypotheses"][0]["constraints"]]
        details = []
        for grade in row["grades"] or []:
            annotation, agreement = row["annotation"], grade["agreement"]
            assert sorted(a["id"] for a in annotation["atoms"]) == sorted(a["id"] for a in agreement["atoms"])
            required = [a for a in annotation["atoms"] if a["status"] in ["active", "unresolved"]]
            observed = {a["id"]: a for a in agreement["atoms"]}
            uncovered = [a for a in required if not observed[a["id"]]["covered"] or observed[a["id"]]["contradicted"]]
            strict = int(agreement["goalMatches"] and not annotation["ambiguous"] and not agreement["ambiguous"]
                and not agreement["unsupportedPrediction"] and not agreement["stalePrediction"] and not uncovered)
            assert strict == grade["match"] == 0
            flags.update({"teacherGoalMatchesTrue": int(agreement["goalMatches"]), "teacherAmbiguous": int(agreement["ambiguous"]),
                "annotationAmbiguous": int(annotation["ambiguous"]), "unsupportedPrediction": int(agreement["unsupportedPrediction"]),
                "stalePrediction": int(agreement["stalePrediction"]), "missingRequiredAtom": int(bool(uncovered))})
            atom_counts.update({"required": len(required), "coveredNoncontradicted": len(required)-len(uncovered), "uncoveredOrContradicted": len(uncovered)})
            details.append({"rank": grade["rank"], "strictMatch": strict, "teacherGoalMatches": agreement["goalMatches"],
                "reason": agreement["reason"], "uncoveredRequiredAtoms": uncovered})
        if row["grades"] is None:
            assert index == 9 and row["failures"] == [{"error": "Model response incomplete", "stage": "blind_annotation"}]
            bad = [e for e in provider if row["id"] in e["id"] and e["id"].endswith(":blind")]
            assert len(bad) == 1 and bad[0]["status"] == "incomplete"
        else:
            assert row["goalTop1"] is False and row["goalTop3"] is False
        rows.append({"id": row["id"], "familyId": row["familyId"], "boundary": row["boundary"],
            "categories": [category for category, indices in categories.items() if index in indices],
            "objective": row["goals"]["hypotheses"][0]["objective"], "failures": row["failures"], "grades": details})
    pools = {r["id"]: r["pool"] for r in read(REPLAY / "public-pools.json")}
    labels = {r["id"]: r for r in lines("labels.jsonl")}
    reads = {"retail": {"find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"},
        "airline": {"get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"}}
    nll = lambda p: -math.log(max(1e-12, min(1, p)))
    for score in scores:
        pool, label, decision = pools[score["id"]], labels[score["id"]], score["decision"]
        assert score["poolHash"] == pool["poolHash"] and score["status"] == "completed" and label["error"] is None
        actual = [a for a in label["actual"] if a["tool"] in reads[score["domain"]]]
        keys, names = {key([a["tool"], a["arguments"]]) for a in actual}, {a["tool"] for a in actual}
        candidates = {c["id"]: c["invocation"] for c in pool["candidates"]}
        ranked = [(c, candidates[c["candidateId"]]) for c in decision["candidates"]]
        assert all(ranked[i][0]["probability"] >= ranked[i+1][0]["probability"] for i in range(len(ranked)-1))
        mass = sum(c["probability"] for c,a in ranked if key([a["tool"],a["arguments"]]) in keys)
        tool_mass = sum(c["probability"] for c,a in ranked if a["tool"] in names)
        covered = any(key([a["tool"],a["arguments"]]) in keys for a in candidates.values())
        close(sum(c["probability"] for c,a in ranked)+decision["noReadProbability"]+decision["uncoveredProbability"], 1)
        for k in [1,3]:
            exact = any(key([a["tool"],a["arguments"]]) in keys for c,a in ranked[:k])
            tool = any(a["tool"] in names for c,a in ranked[:k])
            assert score[f"exactTop{k}"] == (exact if actual else None)
            assert score[f"toolTop{k}"] == (tool if actual else None)
        close(score["categoryNllNats"], nll(decision["noReadProbability"] if not actual else mass if covered else decision["uncoveredProbability"]))
        close(score["binaryReadNllNats"], nll(1-decision["noReadProbability"] if actual else decision["noReadProbability"]))
        close(score["exactSetNllNats"], nll(mass) if actual else None)
        close(score["toolSetNllNats"], nll(tool_mass) if actual else None)
    by_id = {row["id"]: {s["ranker"]: s for s in scores if s["id"] == row["id"]} for row in annotations}
    for group in by_id.values():
        a,b = group["matched-temperature-neutral"], group["matched-temperature-full-goal"]
        assert a["contextHash"] == b["contextHash"] and a["calibrationOverride"] == b["calibrationOverride"]
        assert a["appliedTemperature"] == b["appliedTemperature"] == 0.75
        assert group["neutral-active-memory"]["appliedTemperature"] == 1 and group["full-goal"]["appliedTemperature"] == 0.75
        assert {c["candidateId"]: c["neutralLogit"] for c in a["decision"]["candidates"]} == {c["candidateId"]: c["neutralLogit"] for c in b["decision"]["candidates"]}
        assert group["shuffled-goal"]["decision"]["goalReliability"] == 0
        close(group["shuffled-goal"]["categoryNllNats"], group["neutral-active-memory"]["categoryNllNats"])
    summary = report["summary"]
    for ranker, reported in summary.items():
        selected = [s for s in scores if s["ranker"] == ranker]
        for name, metric in reported["metrics"].items():
            values = [s[name] for s in selected if s["actualRead"]]
            close(metric["estimate"], sum(x is True for x in values)/len(values))
        for name, metric in reported["losses"].items():
            values = [s[name] for s in selected if s[name] is not None]
            close(metric["estimate"], sum(values)/len(values))
    diagnostic = {"version": "goalspec-v5-posthoc-prediction-audit-v1", "passed": True, "providersCalled": 0,
        "runtimeOrGradesChanged": False, "sources": sources, "rawTeacherResponsesVerified": raw_responses_verified,
        "goalResponsesVerified": 16, "rankingRowsIndependentlyVerified": 128,
        "conclusion": "No parsing, selection-replacement or score-recomputation defect found. The zero score follows the predeclared strict all-active/unresolved-atom agreement rule; it is not zero main-objective understanding.",
        "strictAgreement": {"selected": 16, "graded": 15, "passed": 0, "incompleteBlindAnnotation": 1, "flagsOver15Grades": dict(flags), "atomicCoverageDescriptiveOnly": dict(atom_counts)},
        "overlappingPosthocCategories": {k: len(v) for k,v in categories.items()}, "rows": rows,
        "ranking": {name: {"readCases": r["readCheckpoints"], "exactTop1": r["metrics"]["exactTop1"]["estimate"],
            "exactTop3": r["metrics"]["exactTop3"]["estimate"], "categoryNllNats": r["losses"]["categoryNllNats"]["estimate"],
            "exactSetNllNats": r["losses"]["exactSetNllNats"]["estimate"]} for name,r in summary.items()},
        "matchedTemperature": report["matchedTemperatureResidualDiagnostic"],
        "measurementCaveats": ["One raw teacher goalMatches=true still fails strict scoring because two unresolved background atoms are uncovered; fourteen raw teacher goalMatches=false.",
            "Urgency, uncertain background information and supporting lookup steps are required when teacher atoms label them active/unresolved, alongside material objectives and constraints.",
            "Some teacher reasons acknowledge the core goal is captured. Per-atom strict agreement and broad semantic understanding are different quantities; no alternative score is substituted.",
            "Source-grounded means syntactically valid current source citations, not entailment or teacher agreement.",
            "All sixteen emit one hypothesis, so Top1 and Top3 are necessarily identical.",
            "Memory improves read exactTop1 from1/6 to3/6; inferred goals do not improve accuracy over active memory. This is six read prefixes, not task success.",
            "Primary full-goal category loss improvement combines residual plus temperature. Matched-temperature residual alone changes no accuracy and has +0.00022247nats category loss, confidence interval crossing zero.",
            "Strict all-selected denominator includes the one incomplete annotation as failure. No retries or outcome-based replacement occurred."]}
    for source in sources: assert sha(ROOT / source["path"]) == source["sha256"]
    OUT.mkdir()
    (OUT / "diagnosis.json").write_text(json.dumps(diagnostic,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    (OUT / "README.md").write_text("# Frozen prediction replay audit\n\nThe 0/16 strict goal score is reproduced from the unchanged raw responses and predeclared scoring contract. Fourteen graded hypotheses have teacher `goalMatches=false`; one has `goalMatches=true` but misses two unresolved background atoms; one blind annotation is incomplete. No parser or score recomputation defect was found. This is strict complete-annotation agreement, not evidence of zero understanding of the main objective.\n\nAll 30 raw completed teacher responses, 16 goal responses and 128 ranker score rows were checked. Descriptive categories overlap: omitted urgency5, omitted uncertain background4, stale payment2, unsupported status/policy/supporting action5, earlier complementary request1, weakened conditional/preference/exception5 and missing requested lookup3. They do not replace the official grades.\n\nOn six read prefixes, active memory improves exact Top1 from1/6 to3/6; inferred goals add no accuracy. Matched temperature0.75 holds contexts, pools, weights and memory equal: goal residual category loss changes by +0.00022247nats, with an interval crossing zero. The primary category-loss gain is mostly the changed temperature.\n\n`diagnosis.json` binds all inspected source artifacts and records per-prefix reasons. No provider, fit, runtime edit, replacement or grade change occurred.\n",encoding="utf-8")
    print(json.dumps({"directory": str(OUT), "diagnosisSha256": sha(OUT/"diagnosis.json"), "readmeSha256": sha(OUT/"README.md"), "flags":dict(flags),"atoms":dict(atom_counts)}))


if __name__ == "__main__": main()
