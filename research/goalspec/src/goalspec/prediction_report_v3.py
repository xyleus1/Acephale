"""Offline analysis of closed v3.3 prediction replay; no model, ledger or DB access."""
from __future__ import annotations

import csv
import hashlib
import itertools
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path

import rfc8785

VERSION = "goalspec-prediction-report-v3.1"
ARMS = ("stateless", "paste", "paste_memory", "goalspec_no_episodic", "goalspec", "oracle_goals", "shuffled_goals", "salesforce")
CONTROLS = ("uniform", "pattern_frequency", "contextual_memory", "goal_plus_memory")
EPSILON = .001
METRICS = ("toolTop1", "fullArgumentsTop1", "fullArgumentsTop3", "readCoverage", "conditionalToolPrecision",
           "conditionalArgumentPrecision", "nextReadToolCrossEntropyNats", "allDecisionCoverage", "noReadAbstention",
           "readPrecision", "binaryReadNllNats", "binaryReadBrier", "completedPredictionToolTop1", "completedPredictionArgumentsTop1",
           "completedPredictionReadCoverage", "completedPredictionConditionalToolPrecision", "completedPredictionConditionalArgumentPrecision")
REQUIRED = ("dispatch-plan.json", "selection.json", "manifest.json", "predictions.jsonl", "model-events.jsonl",
            "provider-events.jsonl", "requested-annotations.jsonl", "annotations-frozen.json", "requested-grades.jsonl",
            "goal-summary.json", "billing.json", "summary.json", "completion.json")


def canonical(value):
    return rfc8785.dumps(value)


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            value.update(block)
    return value.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def load_replay(directory):
    directory = Path(directory).resolve()
    receipt = read(directory / "execution-receipt.json")
    files = receipt.get("files", [])
    if receipt.get("status") != "complete" or len(files) != len(REQUIRED) or {row.get("path") for row in files} != set(REQUIRED):
        raise ValueError("A complete immutable replay receipt is required")
    for row in files:
        if file_hash(directory / row["path"]) != row["sha256"]:
            raise ValueError("Replay receipt artifact hash mismatch")
    manifest, selection, completion = (read(directory / name) for name in ("manifest.json", "selection.json", "completion.json"))
    plan = read(directory / "dispatch-plan.json")
    if receipt.get("planHash") != file_hash(directory / "dispatch-plan.json") or plan.get("selection") != selection:
        raise ValueError("Replay dispatch differs from its exact frozen plan")
    selection_body = {key: value for key, value in selection.items() if key != "contentHash"}
    if selection.get("contentHash") != digest(selection_body):
        raise ValueError("Replay selection hash mismatch")
    chosen = selection["selectedCheckpointIds"]
    if len(chosen) != len(set(chosen)) or manifest["checkpointIds"] != chosen or plan.get("checkpointIds") != chosen or set(chosen) & set(selection["omittedCheckpointIds"]):
        raise ValueError("Replay selected checkpoint identities changed")
    if set(chosen) | set(selection["omittedCheckpointIds"]) != set(selection["inputCheckpointIds"]):
        raise ValueError("Replay parent selection does not partition its checkpoints")
    rows, previous = [], "0" * 64
    for index, saved in enumerate(jsonl(directory / "predictions.jsonl")):
        body = saved["body"]
        if body["sequence"] != index or body["previousHash"] != previous or digest(body) != saved["hash"]:
            raise ValueError("Replay prediction hash chain mismatch")
        rows.append(body["row"])
        previous = saved["hash"]
    if [row["checkpoint"]["id"] for row in rows] != chosen or completion.get("rows") != len(rows) or completion.get("tailHash") != previous:
        raise ValueError("Incomplete replay rows")
    for filename, key in (("manifest.json", "manifestHash"), ("predictions.jsonl", "predictionsHash"), ("summary.json", "summaryHash"), ("model-events.jsonl", "modelEventsHash")):
        if file_hash(directory / filename) != completion[key]:
            raise ValueError("Replay completion digest mismatch")
    annotations, grades = jsonl(directory / "requested-annotations.jsonl"), jsonl(directory / "requested-grades.jsonl")
    barrier = read(directory / "annotations-frozen.json")
    if barrier.get("beforeAnyPredictorCall") is not True or barrier.get("annotationsHash") != digest(annotations):
        raise ValueError("Requested goal annotations lack their frozen barrier")
    if any(row.get("version") != "goalspec-prediction-v3.3" for row in rows):
        raise ValueError("This analyzer requires the frozen v3.3 tool-distribution contract")
    for row in rows:
        predictions = row["predictions"]
        if len(predictions) != len(ARMS) or {prediction["arm"] for prediction in predictions} != set(ARMS):
            raise ValueError("Closed replay lacks a declared comparison arm")
    return {"directory": str(directory), "rows": rows, "annotations": annotations, "grades": grades,
            "selection": selection, "summary": read(directory / "summary.json"), "goalSummary": read(directory / "goal-summary.json"),
            "billing": read(directory / "billing.json"), "sources": [{"path": str(directory / row["path"]), "sha256": row["sha256"]} for row in files]
            + [{"path": str(directory / "execution-receipt.json"), "sha256": file_hash(directory / "execution-receipt.json")}]}


def ratio(pair):
    return pair[0] / pair[1] if pair[1] else None


def percentile(values, probability):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lo, hi = math.floor(position), math.ceil(position)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


def cluster_interval(groups, *, samples=5000, seed=20260915, control=None):
    """Resample whole families, keeping paired denominators even for abstentions."""
    keys = sorted(set(groups) | (set(control) if control is not None else set()))
    keys = [key for key in keys if groups.get(key, (0, 0))[1] or control is not None and control.get(key, (0, 0))[1]]
    def total(values, selected):
        return tuple(sum(values.get(key, (0, 0))[index] for key in selected) for index in (0, 1))
    treatment_total = total(groups, keys)
    control_total = total(control, keys) if control is not None else None
    estimate, other = ratio(treatment_total), ratio(control_total) if control_total is not None else None
    if control is not None:
        estimate = estimate - other if estimate is not None and other is not None else None
    result = {"estimate": estimate, "lower": None, "upper": None, "clusters": len(keys), "numerator": treatment_total[0],
              "denominator": treatment_total[1], "controlNumerator": control_total[0] if control_total else None,
              "controlDenominator": control_total[1] if control_total else None, "bootstrapSamplesUsed": 0,
              "bootstrapSamplesSkipped": 0, "unavailableReason": None}
    if len(keys) < 2 or estimate is None:
        result["unavailableReason"] = "fewer than two measured independent clusters" if len(keys) < 2 else "zero conditional denominator"
        return result
    generator, draws = random.Random(seed), []
    for _ in range(samples):
        selected = generator.choices(keys, k=len(keys))
        value = ratio(total(groups, selected))
        if control is not None:
            baseline = ratio(total(control, selected))
            value = value - baseline if value is not None and baseline is not None else None
        if value is not None:
            draws.append(value)
    result.update(lower=percentile(draws, .025), upper=percentile(draws, .975), bootstrapSamplesUsed=len(draws), bootstrapSamplesSkipped=samples - len(draws))
    if not draws:
        result["unavailableReason"] = "all bootstrap draws had zero conditional denominator"
    return result


def tool_distribution(candidates, universe):
    if not universe or len(set(universe)) != len(universe):
        raise ValueError("Invalid full audited read-tool universe")
    weights = dict.fromkeys(universe, 0.0)
    for candidate in candidates:
        confidence, tool = candidate["probability"], candidate["invocation"]["tool"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not math.isfinite(confidence) or not 0 <= confidence <= 1 or tool not in weights:
            raise ValueError("Invalid categorical tool confidence")
        weights[tool] = max(weights[tool], confidence)
    total, count = sum(weights.values()), len(weights)
    return {tool: (1 - EPSILON) * (weight / total if total else 1 / count) + EPSILON / count for tool, weight in weights.items()}


def action_key(action):
    return canonical([action["tool"], action["arguments"]])


def checkpoint_metrics(checkpoint, prediction):
    values = dict.fromkeys(METRICS, (0.0, 0))
    if checkpoint["actual"] is None or checkpoint["unavailableReason"] is not None:
        return values
    candidates = prediction["candidates"]
    predicted, actual_read = bool(candidates), checkpoint["decisionKind"] in ("read_only", "mixed")
    p = max(EPSILON, min(1 - EPSILON, max((candidate["probability"] for candidate in candidates), default=0)))
    values.update(allDecisionCoverage=(int(predicted), 1), noReadAbstention=(int(not predicted), 1) if not actual_read else (0, 0),
                  readPrecision=(int(actual_read), 1) if predicted else (0, 0),
                  binaryReadNllNats=(-math.log(p if actual_read else 1 - p), 1), binaryReadBrier=((p - int(actual_read)) ** 2, 1))
    if checkpoint["decisionKind"] != "read_only":
        return values
    target = checkpoint["actual"][0]
    tool_hit = bool(candidates and candidates[0]["invocation"]["tool"] == target["tool"])
    argument_hit = bool(candidates and action_key(candidates[0]["invocation"]) == action_key(target))
    distribution = tool_distribution(candidates, checkpoint["readToolSchemaNames"])
    if target["tool"] not in distribution:
        raise ValueError("Observed read is outside frozen audited schema")
    values.update(toolTop1=(int(tool_hit), 1), fullArgumentsTop1=(int(argument_hit), 1),
                  fullArgumentsTop3=(int(any(action_key(candidate["invocation"]) == action_key(target) for candidate in candidates[:3])), 1),
                  readCoverage=(int(predicted), 1), conditionalToolPrecision=(int(tool_hit), 1) if predicted else (0, 0),
                  conditionalArgumentPrecision=(int(argument_hit), 1) if predicted else (0, 0),
                  nextReadToolCrossEntropyNats=(-math.log(distribution[target["tool"]]), 1))
    completed = prediction.get("status") == "completed"
    values.update(completedPredictionToolTop1=(int(completed and tool_hit), 1), completedPredictionArgumentsTop1=(int(completed and argument_hit), 1),
                  completedPredictionReadCoverage=(int(completed and predicted), 1),
                  completedPredictionConditionalToolPrecision=(int(tool_hit), 1) if completed and predicted else (0, 0),
                  completedPredictionConditionalArgumentPrecision=(int(argument_hit), 1) if completed and predicted else (0, 0))
    return values


def add_metric(target, family, metric, value):
    before = target[metric].get(family, (0.0, 0))
    target[metric][family] = (before[0] + value[0], before[1] + value[1])


def shared_metrics(row, control):
    checkpoint = row["checkpoint"]
    if checkpoint["actual"] is None or checkpoint["unavailableReason"] is not None or checkpoint["decisionKind"] != "read_only":
        return {metric: (0, 0) for metric in ("toolTop1", "fullArgumentsTop1", "poolOracleFullArguments")}
    pool, ranking = row["sharedPool"]["candidates"], row["sharedPool"]["rankings"][control]
    ids = [candidate["id"] for candidate in pool]
    if len(ids) != len(set(ids)) or sorted(item["candidateId"] for item in ranking) != sorted(ids):
        raise ValueError("Shared ranking controls do not use an identical pool")
    candidate = next((candidate for candidate in pool if ranking and candidate["id"] == ranking[0]["candidateId"]), None)
    actual = checkpoint["actual"][0]
    return {"toolTop1": (int(bool(candidate and candidate["invocation"]["tool"] == actual["tool"])), 1),
            "fullArgumentsTop1": (int(bool(candidate and action_key(candidate["invocation"]) == action_key(actual))), 1),
            "poolOracleFullArguments": (int(any(action_key(candidate["invocation"]) == action_key(actual) for candidate in pool)), 1)}


def goal_statistics(data, *, samples, seed):
    checkpoints = {row["checkpoint"]["id"]: row["checkpoint"] for row in data["rows"]}
    annotations = {row["revision"]: row for row in data["annotations"]}
    if len(annotations) != len(data["annotations"]) or len(data["grades"]) != len(annotations):
        raise ValueError("Goal revisions are duplicated or incompletely graded")
    parents = {checkpoint["familyId"]: checkpoint["familyId"] for checkpoint in checkpoints.values()}
    def find(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key
    seen_checkpoints, seen_revisions, measured = set(), set(), []
    for assessment in data["grades"]:
        revision = assessment["revision"]
        annotation = annotations.get(revision)
        if annotation is None or revision in seen_revisions or set(assessment["checkpointIds"]) != set(annotation["checkpointIds"]):
            raise ValueError("Goal revision checkpoint provenance mismatch")
        seen_revisions.add(revision)
        ids = assessment["checkpointIds"]
        if not ids or len(ids) != len(set(ids)) or seen_checkpoints & set(ids) or any(key not in checkpoints for key in ids):
            raise ValueError("Goal checkpoint assigned to multiple revisions")
        seen_checkpoints.update(ids)
        families = sorted({checkpoints[key]["familyId"] for key in ids})
        if sorted(assessment["familyIds"]) != families or set(assessment["runIds"]) != {checkpoints[key]["runId"] for key in ids}:
            raise ValueError("Goal family/run provenance mismatch")
        for family in families[1:]:
            parents[find(family)] = find(families[0])
        grade, reference = assessment["grade"], annotation["reference"]
        if assessment["referenceHash"] != digest(reference) or grade["annotation_hash"] != digest(reference) or grade["prediction_hash"] != digest(assessment["prediction"]):
            raise ValueError("Goal assessment is not linked to frozen annotation/prediction")
        if grade["status"] != "completed":
            continue
        if reference["status"] != "completed" or len(grade["matches"]) != len(grade["ranked_ids"]) or any(not isinstance(value, bool) for value in grade["matches"]):
            raise ValueError("Invalid completed goal assessment")
        measured.append((families[0], len(ids), int(bool(grade["matches"] and grade["matches"][0])), int(any(grade["matches"][:3]))))
    eligible = {key for key, checkpoint in checkpoints.items() if checkpoint["unavailableReason"] is None}
    if seen_checkpoints != eligible:
        raise ValueError("Goal revision coverage differs from eligible replay checkpoints")
    unique, weighted = defaultdict(dict), defaultdict(dict)
    for family, count, top1, top3 in measured:
        cluster = find(family)
        for metric, value in (("goalTop1", top1), ("goalTop3", top3)):
            add_metric(unique, cluster, metric, (value, 1))
            add_metric(weighted, cluster, metric, (value * count, count))
    return {"uniqueGoalRevisions": len(annotations), "scoredRevisions": len(measured), "missingAnnotationOrGrade": len(annotations) - len(measured),
            "failedGoalPredictions": sum(row["prediction"]["status"] != "completed" for row in data["grades"]),
            "unknownReferences": sum(bool((row["reference"].get("annotation") or {}).get("unknown")) for row in data["annotations"]),
            "clusterRule": "Task families linked by a shared cached goal revision form one resampling component; each unique revision is counted once",
            "familyComponents": len({find(family) for family in parents}),
            "uniqueRevisionWeighted": {metric: cluster_interval(unique[metric], samples=samples, seed=seed) for metric in ("goalTop1", "goalTop3")},
            "checkpointWeighted": {metric: cluster_interval(weighted[metric], samples=samples, seed=seed) for metric in ("goalTop1", "goalTop3")}}


def analyze(data, *, samples=5000, seed=20260915):
    if not isinstance(samples, int) or isinstance(samples, bool) or not 100 <= samples <= 100000:
        raise ValueError("Bootstrap sample count must be between 100 and 100000")
    groups = {arm: defaultdict(dict) for arm in ARMS}
    controls = {control: defaultdict(dict) for control in CONTROLS}
    statuses = {arm: Counter() for arm in ARMS}
    for row in data["rows"]:
        checkpoint, predictions = row["checkpoint"], {prediction["arm"]: prediction for prediction in row["predictions"]}
        for arm in ARMS:
            prediction = predictions[arm]
            statuses[arm][prediction["status"]] += 1
            if prediction.get("failureCode"):
                statuses[arm]["reason:" + prediction["failureCode"]] += 1
            for metric, value in checkpoint_metrics(checkpoint, prediction).items():
                add_metric(groups[arm], checkpoint["familyId"], metric, value)
        for control in CONTROLS:
            for metric, value in shared_metrics(row, control).items():
                add_metric(controls[control], checkpoint["familyId"], metric, value)
    estimates = {arm: {metric: cluster_interval(groups[arm][metric], samples=samples, seed=seed) for metric in METRICS} for arm in ARMS}
    paired = []
    for treatment, control in itertools.combinations(ARMS, 2):
        for metric in METRICS:
            paired.append({"treatment": treatment, "control": control, "metric": metric,
                           **cluster_interval(groups[treatment][metric], samples=samples, seed=seed, control=groups[control][metric])})
    reductions = {arm: cluster_interval(groups["paste"]["nextReadToolCrossEntropyNats"], samples=samples, seed=seed,
                                        control=groups[arm]["nextReadToolCrossEntropyNats"]) for arm in ARMS}
    goalspec_pairs = {control: {metric: cluster_interval(groups["goalspec"][metric], samples=samples, seed=seed, control=groups[control][metric])
                               for metric in ("toolTop1", "fullArgumentsTop1", "nextReadToolCrossEntropyNats")}
                      for control in ARMS if control != "goalspec"}
    control_estimates = {control: {metric: cluster_interval(controls[control][metric], samples=samples, seed=seed)
                                  for metric in ("toolTop1", "fullArgumentsTop1", "poolOracleFullArguments")} for control in CONTROLS}
    control_pairs = [{"treatment": treatment, "control": control, "metric": metric,
                      **cluster_interval(controls[treatment][metric], samples=samples, seed=seed, control=controls[control][metric])}
                     for treatment, control in itertools.combinations(CONTROLS, 2) for metric in ("toolTop1", "fullArgumentsTop1")]
    for arm, saved in data.get("summary", {}).get("arms", {}).items():
        mappings = (("toolTop1", "top1ToolAccuracy"), ("fullArgumentsTop1", "top1FullArgumentAccuracy"), ("readCoverage", "coverage"),
                    ("nextReadToolCrossEntropyNats", "nextToolCrossEntropyNats"))
        for metric, field in mappings:
            expected, actual = saved["readOnly"][field], estimates[arm][metric]["estimate"]
            if (expected is None) != (actual is None) or expected is not None and not math.isclose(expected, actual, rel_tol=1e-10, abs_tol=1e-10):
                raise ValueError("Recomputed prediction metric differs from immutable runtime summary")
    return {"version": VERSION, "label": "Frozen base-trajectory prediction replay, separate from native task success and live latency",
            "method": {"interval": "Pointwise percentile task-family bootstrap, 95%; no multiplicity adjustment", "samples": samples, "seed": seed,
                       "readDenominator": "read_only checkpoints with saved actor response and native visible prefix; first call is target",
                       "otherDecisions": "Mixed, write, pure compute and message decisions contribute to read/no-read metrics only",
                       "failures": "Failed predictors remain in denominators; valid deterministic fallback candidates remain scored; absent actor responses are unscorable",
                       "completedPredictionMetrics": "Secondary metrics require status=completed and keep failures as misses in the unconditional read-only denominator; primary system-proposal accuracy legitimately scores valid deterministic fallback proposals",
                       "categoricalCrossEntropy": "Uncalibrated next-read-tool cross-entropy proxy conditional on read-only decisions, over the full audited read-tool schema; not full-action likelihood or true conditional entropy",
                       "toolDistribution": "Maximum candidate confidence per tool, normalized and mixed with epsilon=.001 uniform mass; uniform for abstention",
                       "argumentLikelihood": "Not estimated; arguments receive exact-match accuracy only", "pairedDifferences": "treatment minus control using the identical checkpoint and family pool",
                       "reductionVsPaste": "PASTE tool cross-entropy minus arm tool cross-entropy; positive means lower estimated cross-entropy, not measured true entropy reduction",
                       "conditionalIntervals": "Zero conditional denominators remain explicit; bootstrap draws with zero denominator are counted and omitted, never silently filled",
                       "sharedPoolControls": "Fixed feature rankings over identical candidates, not authentic extra model baselines",
                       "goalAccuracy": "Automated prefix-only teacher semantic agreement; not independent human or benchmark truth"},
            "selection": data["selection"], "decisions": len(data["rows"]), "decisionKinds": dict(Counter(row["checkpoint"]["decisionKind"] for row in data["rows"])),
            "unscorableReasons": dict(Counter(row["checkpoint"]["unavailableReason"] for row in data["rows"] if row["checkpoint"]["unavailableReason"] is not None)),
            "taskFamilies": len({row["checkpoint"]["familyId"] for row in data["rows"]}), "baseRuns": len({row["checkpoint"]["runId"] for row in data["rows"]}),
            "predictionStatuses": {arm: dict(statuses[arm]) for arm in ARMS}, "arms": estimates, "pairedDifferences": paired,
            "goalspecPairedDifferences": goalspec_pairs,
            "crossEntropyReductionVsPaste": reductions, "identicalPoolControls": control_estimates, "identicalPoolPairedDifferences": control_pairs,
            "goals": goal_statistics(data, samples=samples, seed=seed), "billing": data.get("billing"), "sources": data.get("sources", []),
            "limitations": ["Observed actor next calls are replay labels; matching them does not establish task correctness or an optimal tool path.",
                            "Intervals with very few task families are unstable and remain descriptive.",
                            "Goal annotation and semantic grading share the same teacher and can share errors.",
                            "Oracle and shuffled goals are diagnostics; this replay cannot establish their live task or latency effects."]}


def fmt(value, percent=False):
    if value is None:
        return "unmeasured"
    return f"{value * 100:.1f}%" if percent else f"{value:.3f}"


def interval_text(value, percent=False, difference=False):
    def render(number):
        text = fmt(number, percent)
        return text[:-1] + " pp" if percent and difference and number is not None else text
    estimate = render(value["estimate"])
    return estimate + (f" [{render(value['lower'])}, {render(value['upper'])}]" if value["lower"] is not None else " [CI unavailable]")


def markdown(report):
    lines = ["# Frozen prediction replay", "", report["label"] + ".", "",
             f"{report['baseRuns']} base runs, {report['taskFamilies']} task families, {report['decisions']} selected checkpoints. Brackets show pointwise 95% family-cluster intervals.", "",
             "| Comparison | Read checkpoints | Tool Top-1 | Full arguments Top-1 | Read coverage | Next-tool CE (nats) | CE reduction vs PASTE |",
             "|---|---:|---|---|---|---|---|"]
    for arm in ARMS:
        metrics = report["arms"][arm]
        lines.append(f"| {arm} | {metrics['toolTop1']['denominator']} | {interval_text(metrics['toolTop1'], True)} | {interval_text(metrics['fullArgumentsTop1'], True)} | {interval_text(metrics['readCoverage'], True)} | {interval_text(metrics['nextReadToolCrossEntropyNats'])} | {interval_text(report['crossEntropyReductionVsPaste'][arm])} |")
    lines += ["", "Categorical CE is an uncalibrated next-read-tool cross-entropy proxy, not true conditional entropy or full-argument likelihood. Native task success and measured live latency are reported separately.", "",
              "| GoalSpec minus comparison | Tool accuracy difference | Argument accuracy difference | Tool CE difference (lower is better) |", "|---|---|---|---|"]
    for control, metrics in report["goalspecPairedDifferences"].items():
        lines.append(f"| goalspec minus {control} | {interval_text(metrics['toolTop1'], True, True)} | {interval_text(metrics['fullArgumentsTop1'], True, True)} | {interval_text(metrics['nextReadToolCrossEntropyNats'])} |")
    lines += ["",
              "| Goal weighting | Scored denominator | Semantic Top-1 | Semantic Top-3 |", "|---|---:|---|---|"]
    for weighting in ("uniqueRevisionWeighted", "checkpointWeighted"):
        goals = report["goals"][weighting]
        lines.append(f"| {weighting} | {goals['goalTop1']['denominator']} | {interval_text(goals['goalTop1'], True)} | {interval_text(goals['goalTop3'], True)} |")
    lines += ["", f"Missing annotations/grades: {report['goals']['missingAnnotationOrGrade']}; failed goal predictions: {report['goals']['failedGoalPredictions']}. Shared goal revisions connect task families into dependent resampling components.", "",
              "| Identical candidate pool ranking | Tool Top-1 | Full arguments Top-1 | Oracle argument coverage |", "|---|---|---|---|"]
    for name, metrics in report["identicalPoolControls"].items():
        lines.append(f"| {name} | {interval_text(metrics['toolTop1'], True)} | {interval_text(metrics['fullArgumentsTop1'], True)} | {interval_text(metrics['poolOracleFullArguments'], True)} |")
    lines += ["", "Primary system-proposal accuracy includes valid deterministic fallback proposals. Failures without a valid proposal remain misses. Secondary completed-prediction accuracy, conditional precision, coverage, all pairwise differences and binary read/no-read metrics are preserved in report.json and CSV files. These feature rankings are diagnostics, not verified paper reproductions.", ""]
    return "\n".join(lines)


def write_report(directory, output, *, samples=5000, seed=20260915):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError("Use a new prediction report directory")
    data = load_replay(directory)
    report = analyze(data, samples=samples, seed=seed)
    output.mkdir(parents=True, exist_ok=False)
    (output / "report.json").write_bytes(canonical(report) + b"\n")
    (output / "report.md").write_text(markdown(report), encoding="utf-8")
    fields = ("comparison", "metric", "estimate", "lower", "upper", "clusters", "numerator", "denominator", "bootstrapSamplesUsed", "bootstrapSamplesSkipped", "unavailableReason")
    with (output / "metrics.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for group in (report["arms"], report["identicalPoolControls"], {"goal_" + key: report["goals"][key] for key in ("uniqueRevisionWeighted", "checkpointWeighted")}):
            for comparison, metrics in group.items():
                for metric, value in metrics.items():
                    writer.writerow({"comparison": comparison, "metric": metric, **value})
    with (output / "paired-differences.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("pool", "treatment", "control", "metric", *fields[2:], "controlNumerator", "controlDenominator"), extrasaction="ignore")
        writer.writeheader()
        for pool, rows in (("arm_candidates", report["pairedDifferences"]), ("identical_union", report["identicalPoolPairedDifferences"])):
            for row in rows:
                writer.writerow({"pool": pool, **row})
    paths = ("report.json", "report.md", "metrics.csv", "paired-differences.csv")
    receipt = {"status": "complete", "version": VERSION, "analyzerSha256": file_hash(__file__), "sourceFiles": report["sources"],
               "files": [{"path": name, "sha256": file_hash(output / name)} for name in paths], "paidApiCalls": 0, "ledgerOpened": False}
    (output / "analysis-receipt.json").write_bytes(canonical(receipt) + b"\n")
    return report
