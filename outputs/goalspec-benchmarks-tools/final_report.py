"""Offline synthesis of closed, separately scored benchmark reports.

No model, environment, scorer, fitting, or statistical resampling is invoked here.
Run after every cohort is closed; all input paths are explicit and output is new.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from string import Template

VERSION = "goalspec-cross-benchmark-report-v1"
ARMS = ("base", "paste", "salesforce", "goalspec")
RANKERS = ("current-prior", "frozen-logistic")
INPUTS = ("tau", "bfcl", "apigen", "cpu_initial", "cpu_isolated", "budget")
TEMPLATE = Path(__file__).with_name("README.template.md")


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def close(a, b):
    return numeric(a) and numeric(b) and math.isclose(a, b, rel_tol=1e-8, abs_tol=1e-8)


def validate_tau(report):
    require(report.get("version") == "official-tau-v4-report-v1", "Expected closed official tau v4 analysis")
    rows = report["trials"]
    require(len(rows) == 112 and len({row["runId"] for row in rows}) == 112, "Official cohort must retain all 112 unique trials")
    selection = report["benchmark"]["selection"]
    models = selection["models"]
    require(models.get("actor") == "gpt-5.4-2026-03-05" and models.get("actorReasoning") == "medium"
            and models.get("actorOutputCap") == 4096 and models.get("userSimulator") == "gpt-4.1-mini-2025-04-14", "Native model identity differs from declared report configuration")
    require(report["benchmark"]["upstreamRevision"] == selection["upstreamRevision"], "Native revision differs from selection")
    selected = selection["selectedByDomain"]
    require(set(selected) == {"retail", "airline"} and all(len(set(map(str, ids))) == 7 for ids in selected.values()), "Expected seven selected tasks per domain")
    expected = {(domain, str(task)) for domain, ids in selected.items() for task in ids}
    exclusions = {(domain, str(task)) for domain, ids in selection["excludedIdsByDomain"].items() for task in ids}
    require(len(exclusions) == 12 and not expected.intersection(exclusions), "Native direct-exposure exclusions differ")
    exposure = selection["historicalPublicExposure"]
    require(sum(value["tasks"] for value in exposure.values()) == 164 and
            all(set(map(str, exposure[domain]["selectedPreviouslyPublicExposed"])) == set(map(str, ids)) for domain, ids in selected.items()), "Historical exposure caveat differs from audit")
    by_arm = defaultdict(list)
    for row in rows:
        require(row["arm"] in ARMS and isinstance(row.get("success"), bool), "Unknown arm or missing success grade")
        require((row["domain"], str(row["taskId"])) in expected, "Trial outside frozen ID selection")
        if row["success"]:
            require(row.get("officialReward") == 1 and row.get("nativeTermination") in {"user_stop", "agent_stop"}, "Success needs native reward and valid termination")
        by_arm[row["arm"]].append(row)
    signatures = []
    for arm in ARMS:
        members = by_arm[arm]
        grouped = defaultdict(list)
        for row in members:
            grouped[(row["domain"], str(row["taskId"]))].append(row)
        require(len(members) == 28 and set(grouped) == expected and all(len({r["trial"] for r in group}) == 2 and len(group) == 2 for group in grouped.values()), "Every arm must retain 14 tasks and two distinct trials")
        signatures.append({(r["domain"], str(r["taskId"]), r["trial"], r["seed"]) for r in members})
        summary = report["arms"][arm]
        successes = sum(r["success"] for r in members)
        require(summary["trials"] == 28 and summary["tasks"] == 14 and summary["successes"] == successes and summary["failures"] == 28 - successes, "Arm summary differs from complete retained outcomes")
        require(close(summary["metrics"]["successRate"]["estimate"], successes / 28), "Pass1 summary mismatch")
        both = sum(all(r["success"] for r in group) for group in grouped.values())
        consistency = summary["twoTrialConsistency"]
        require(consistency["eligibleTasks"] == 14 and consistency["bothSucceeded"] == both and close(summary["metrics"]["bothTrialsSuccessRate"]["estimate"], both / 14), "Two-trial consistency summary mismatch")
        for domain in selected:
            domain_summary = report["domains"][domain]["arms"][arm]
            require(domain_summary["trials"] == 14 and domain_summary["tasks"] == 7 and domain_summary["successes"] == sum(r["success"] for r in members if r["domain"] == domain), "Domain denominator or outcome mismatch")
    require(all(signature == signatures[0] for signature in signatures), "Arms differ in trial seeds or task grid")
    require(report["service"].get("startupOutsideTrialClocks") is True and report["service"].get("judgeOutsideLiveLatency") is True, "Timing boundary must be declared")


def validate_bfcl(report):
    manifest = report["manifest"]
    require(manifest.get("model") == "gpt-5.4-2026-03-05" and manifest.get("reasoning") == "medium"
            and manifest.get("maxOutputTokens") == 4096, "BFCL actor configuration differs")
    require(report.get("total") == 64 and len(report["results"]) == 64 and len({r["id"] for r in report["results"]}) == 64, "BFCL must retain all 64 unique cases")
    require(report["providerRunSummary"].get("closed") is True and report["providerRunSummary"].get("declared") == 64, "BFCL provider cohort is not closed")
    categories = Counter(r["category"] for r in report["results"])
    require(categories == {"multiple": 32, "irrelevance": 32}, "BFCL category denominator mismatch")
    for category in categories:
        rows = [r for r in report["results"] if r["category"] == category]
        for row in rows:
            require(isinstance(row["verdict"].get("valid"), bool), "Missing BFCL verdict")
            require(row["predictionStatus"] == "completed" or row["verdict"]["valid"] is False, "Failed BFCL prediction cannot score correct")
        require(report["categories"][category] == {"correct": sum(r["verdict"]["valid"] for r in rows), "total": 32}, "BFCL category scores differ from retained rows")
    require(report["correct"] == sum(r["verdict"]["valid"] for r in report["results"]), "BFCL total mismatch")


def validate_apigen(report):
    manifest = report["inputManifest"]
    require(report.get("version") == "goalspec-apigen-controller-report-v1" and manifest.get("closedAt") and manifest.get("completeDeclaredCorpus") is True, "APIGen transfer must be complete")
    require(report["pairedDifferences"].get("samePoolVerified") is True, "APIGen comparison needs identical candidate pools")
    require(set(report["summary"]) == set(RANKERS), "Unexpected APIGen rankers")
    for ranker in RANKERS:
        summary = report["summary"][ranker]
        require(summary["checkpoints"] == report["checkpoints"] and summary["knownActions"] + summary["unknownActions"] == summary["checkpoints"], "APIGen coverage mismatch")
        require(summary["readActions"] + summary["nonReadActions"] == summary["knownActions"], "APIGen read denominator mismatch")
        for name in ("toolTop1", "toolTop3", "exactTop1", "exactTop3", "gatedExactTop1", "poolCoverage"):
            require(summary["metrics"][name]["denominator"] == summary["readActions"], "APIGen read metric dropped labels")
        require(summary["metrics"]["noReadSpecificity"]["denominator"] == summary["nonReadActions"], "APIGen NO_READ denominator mismatch")


def validate_cpu(initial, isolated, controller_hash):
    require(initial["artifactHash"] == isolated["artifactHash"] == controller_hash, "CPU and APIGen controller identity differs")
    require(isolated.get("closedAt") and isolated.get("providerCalls") == 0 and isolated.get("fitting") is False, "Isolated component measurement is not closed/frozen")
    require(isolated["samples"] == isolated["measuredPasses"] * isolated["statesPerPass"] == sum(p["samples"] for p in isolated["perPass"]), "CPU measurement dropped samples")
    for run in (initial, isolated):
        require(numeric(run["p95Ms"]) and run["samples"] > 0 and run["targetMet"] == (run["p95Ms"] <= run["targetP95Ms"]), "CPU target claim or count invalid")


def validate_budget(report):
    require(report.get("currency") == "USD" and report.get("totalCeilingUsd") == 500, "Expected original USD500 budget")
    allocations = report["allocations"]
    require(close(sum(a["knownUsageCostUsd"] for a in allocations), report["totalKnownUsageCostUsd"]), "Known budget subtotal mismatch")
    require(close(sum(a["spentOrReservedUsd"] for a in allocations), report["totalSpentOrReservedUsd"]), "Reserved budget subtotal mismatch")
    require(close(sum(a["ceilingUsd"] for a in allocations), 500), "Allocation ceilings mismatch")
    require(sum(a["unresolvedRequests"] for a in allocations) == report["unresolvedRequests"], "Unresolved request count mismatch")
    require(all(a["spentOrReservedUsd"] >= a["knownUsageCostUsd"] - 1e-8 for a in allocations), "Reservations cannot omit known usage")


def fmt(value, percent=False):
    return "unavailable" if value is None else f"{value * 100:.1f}%" if percent else f"{value:.3f}"


def interval(metric, percent=False):
    return f"{fmt(metric['estimate'], percent)} [{fmt(metric.get('lower'), percent)}, {fmt(metric.get('upper'), percent)}]"


def difference_interval(metric, percentage_points=False):
    def display(value):
        return "unavailable" if value is None else f"{value * 100:.1f} pp" if percentage_points else f"{value:.3f} s"
    return f"{display(metric['estimate'])} [{display(metric.get('lower'))}, {display(metric.get('upper'))}]"


def table(headers, rows):
    return "\n".join(["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"] + ["| " + " | ".join(map(str, row)) + " |" for row in rows])


def native_table(arms):
    return table(["Arm", "Successes / trials", "Pass1 [95% CI]", "Both trials / tasks", "Two-trial rate [95% CI]"], [
        [arm, f"{s['successes']}/{s['trials']}", interval(s["metrics"]["successRate"], True),
         f"{s['twoTrialConsistency']['bothSucceeded']}/{s['twoTrialConsistency']['eligibleTasks']}", interval(s["metrics"]["bothTrialsSuccessRate"], True)] for arm, s in arms.items()])


def render(report):
    tau, bfcl, apigen, cpu, budget = (report[k] for k in ("tau", "bfcl", "apigen", "cpu", "budget"))
    native = native_table(tau["arms"])
    domains = "\n\n".join(f"{domain.title()} (seven tasks, 14 trials per arm):\n\n{native_table(data['arms'])}" for domain, data in tau["domains"].items())
    paired = [r for r in tau["pairedDifferences"] if r["treatment"] == "goalspec" and r["metric"] in {"successRate", "bothTrialsSuccessRate", "liveTotalMeanSeconds"}]
    paired_table = table(["GoalSpec minus", "Metric", "Difference [95% CI]", "Tasks", "Matched trials"], [[r["control"], r["metric"], difference_interval(r, r["metric"] != "liveTotalMeanSeconds"), r["measuredTasks"], r["matchedTrials"]] for r in paired])
    timing_rows, call_rows = [], []
    for arm, summary in tau["arms"].items():
        timing = summary["timingSeconds"]
        live, judge, drain = (timing[k] for k in ("totalTrialSeconds", "evaluationSeconds", "serviceDrainSeconds"))
        timing_rows.append([arm, f"{live['n']} ({live['missing']} missing)", fmt(live["mean"]), fmt(live["p95"]), fmt(drain["mean"]), fmt(judge["mean"]), f"{judge['n']} ({judge['missing']} missing)"])
        physical = summary["physicalCallsPerSuccess"]
        counts = summary["counts"]
        leases = tau["leaseChecks"][arm]
        attempts = summary.get("physicalNativeToolAttemptsFromTimings")
        complete_physical = physical["missingTrials"] == 0
        attempts_display = attempts if complete_physical and attempts is not None else "unavailable" if attempts is None else f"unavailable (known subtotal: {attempts})"
        call_rows.append([arm, attempts_display, f"{physical['measuredTrials']}/{summary['trials']}", fmt(physical["estimate"] if complete_physical else None), counts["authoritativeCalls"]["sum"], counts["speculativeCalls"]["sum"], summary["consumedPromotionReceipts"], f"{leases['refreshChecks']} / {leases['consumptionChecks']}"])
    timing_table = table(["Arm", "Timed live trials", "Live mean s", "Live p95 s", "Mean drain s", "Mean judge s", "Timed judge trials"], timing_rows)
    calls_table = table(["Arm", "All physical attempts", "Measured trials", "All attempts / success", "Authoritative requested", "Speculative calls", "Consumed promotions", "Refresh / consume lease checks"], call_rows)
    native_diagnostics = table(["Arm", "Tool non-error rate", "Reference tool recall", "Reference full-argument recall", "Required assertion trials", "Missing required assertions", "Observed response usage USD"], [[arm, interval(s["metrics"]["nativeToolNonErrorRate"], True), interval(s["metrics"]["goldToolNameRecall"], True), interval(s["metrics"]["goldFullArgumentsRecall"], True), s["nativeAssertionAudit"]["requiredAssertionTrials"], s["nativeAssertionAudit"]["missingRequiredAssertions"], f"{s['cost']['knownUsageSubtotalUsd']:.6f}"] for arm, s in tau["arms"].items()])
    bfcl_table = table(["Category", "Correct / cases", "AST accuracy"], [[name, f"{s['correct']}/{s['total']}", fmt(s["correct"] / s["total"], True)] for name, s in bfcl["categories"].items()] + [["Combined selected subset", f"{bfcl['correct']}/{bfcl['total']}", fmt(bfcl["correct"] / bfcl["total"], True)]])
    audit = report.get("bfclErrorAudit")
    bfcl_error_audit = "No separate post-hoc error audit is included."
    if audit:
        counts, subtypes = audit["classificationCounts"], audit["subtypeCounts"]
        bfcl_error_audit = (f"The post-hoc audit retains all {audit['officialMisses']} official misses: "
            f"{counts.get('abstention', 0)} abstention errors "
            f"({subtypes.get('called_when_official_label_requires_no_call', 0)} unnecessary calls and "
            f"{subtypes.get('no_call_when_official_label_requires_function', 0)} missing calls), "
            f"{counts.get('argument_value', 0)} argument-value errors, and "
            f"{counts.get('function_selection_or_cardinality', 0)} function-selection/cardinality errors. "
            "The extra-call failure does not establish a wrong function name. This is diagnostic classification after scoring, with no changed official grades or causal GoalSpec claim.")
    apigen_rows = []
    for name in ("toolTop1", "toolTop3", "exactTop1", "exactTop3", "gatedExactTop1", "poolCoverage", "readSensitivity", "noReadSpecificity"):
        prior, learned = (apigen["summary"][ranker]["metrics"][name] for ranker in RANKERS)
        difference = apigen["pairedDifferences"]["differences"][name]
        apigen_rows.append([name, f"{prior['numerator']}/{prior['denominator']} ({fmt(prior['estimate'], True)})", f"{learned['numerator']}/{learned['denominator']} ({fmt(learned['estimate'], True)})", difference_interval(difference, True)])
    apigen_table = table(["Metric", "Same-pool prior", "Frozen logistic", "Logistic minus prior [95% CI]"], apigen_rows)
    changes = []
    for name in ("toolTop1", "exactTop1", "gatedExactTop1", "noReadSpecificity"):
        delta = apigen["pairedDifferences"]["differences"][name]["estimate"]
        changes.append(f"{name} {'rose' if delta > 0 else 'fell' if delta < 0 else 'was unchanged by'} {abs(delta) * 100:.2f} percentage points")
    apigen_change_text = "; ".join(changes) + ". These are observed estimates, not claims that every paired interval excludes zero."
    cpu_table = table(["Run", "Samples", "Mean ms", "p50 ms", "p95 ms", "Max ms", "p95 target met"], [[label, data["samples"], fmt(data["meanMs"]), fmt(data["p50Ms"]), fmt(data["p95Ms"]), fmt(data["maximumMs"]), data["targetMet"]] for label, data in cpu.items()])
    allocation_table = table(["Allocation", "Ceiling USD", "Known usage USD", "Spent or reserved USD", "Unresolved requests"], [[a["allocation"], fmt(a["ceilingUsd"]), fmt(a["knownUsageCostUsd"]), fmt(a["spentOrReservedUsd"]), a["unresolvedRequests"]] for a in budget["allocations"]])
    source_table = table(["Input", "SHA256", "Path"], [[name, f"`{source['sha256']}`", f"[{Path(source['path']).name}]({Path(source['path']).as_posix()})"] for name, source in report["sources"].items()])
    substitutions = dict(native_table=native, domains=domains, paired_table=paired_table, timing_table=timing_table,
        calls_table=calls_table, native_diagnostics=native_diagnostics, bfcl_table=bfcl_table, apigen_table=apigen_table,
        apigen_change_text=apigen_change_text, cpu_table=cpu_table, allocation_table=allocation_table,
        known_cost=f"{budget['totalKnownUsageCostUsd']:.6f}", reserved_cost=f"{budget['totalSpentOrReservedUsd']:.6f}",
        cohort_observed_usage=f"{tau['cost']['knownUsageSubtotalUsd']:.6f}",
        cohort_settled_trials=f"{tau['cost']['settledRecordedUsd']:.6f}",
        cohort_unknown_trials=tau["cost"]["unknownChargeTrials"],
        unresolved=budget["unresolvedRequests"], source_table=source_table, apigen_checkpoints=apigen["checkpoints"],
        apigen_unknown=apigen["summary"]["current-prior"]["unknownActions"],
        selected_ids=json.dumps(tau["benchmark"]["selection"]["selectedByDomain"], sort_keys=True),
        upstream_revision=tau["benchmark"]["upstreamRevision"],
        bfcl_failed=sum(r["predictionStatus"] != "completed" for r in bfcl["results"]), bfcl_error_audit=bfcl_error_audit)
    return Template(TEMPLATE.read_text(encoding="utf-8")).substitute(substitutions)


def build(inputs):
    validate_tau(inputs["tau"])
    validate_bfcl(inputs["bfcl"])
    validate_apigen(inputs["apigen"])
    validate_cpu(inputs["cpu_initial"], inputs["cpu_isolated"], inputs["apigen"]["inputManifest"]["frozenControllerHash"])
    validate_budget(inputs["budget"])
    tau = inputs["tau"]
    require(tau["benchmark"]["selection"]["controllerExposure"]["frozenControllerContentHash"] == inputs["apigen"]["inputManifest"]["frozenControllerHash"], "Native selection and component reports do not share frozen controller")
    return {"version": VERSION, "providerCalls": 0, "fitting": False, "scoringChanged": False,
        "tau": {key: tau[key] for key in ("label", "studyId", "studyStage", "designHash", "method", "service", "arms", "domains", "pairedDifferences", "benchmark", "cost", "leaseChecks")},
        "bfcl": inputs["bfcl"], "apigen": inputs["apigen"],
        "cpu": {"initial concurrent analysis": {key: value for key, value in inputs["cpu_initial"].items() if key != "decisions"}, "isolated fixed protocol": inputs["cpu_isolated"]},
        "budget": inputs["budget"],
        "limitations": ["No aggregate score across unlike benchmarks.", "Official tau subset has prior public exposure; not pristine held-out or full leaderboard evaluation.", "Local PASTE and Salesforce controls are paper-based implementations, not verified upstream reproductions.", "APIGen is frozen controller transfer, BFCL is actor function-call generation, and CPU is one component only.", "Intervals are copied from separately validated analyses; pointwise, not multiplicity corrected.", "Unknown charges stay reserved and are not added to known usage a second time."]}


def numeric_rows(value, prefix=""):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from numeric_rows(child, f"{prefix}.{key}" if prefix else key)
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from numeric_rows(child, f"{prefix}[{i}]")
    elif numeric(value):
        yield prefix, value


def generate(paths, output):
    output = Path(output).resolve()
    require(not output.exists(), "Output directory already exists; reports are immutable")
    paths = {key: Path(paths[key]).resolve() for key in INPUTS}
    require(all(not output.is_relative_to(path.parent) for path in paths.values()), "Write the final report outside source artifact directories")
    sources = {key: {"path": str(path), "sha256": sha256(path)} for key, path in paths.items()}
    inputs = {key: read(path) for key, path in paths.items()}
    for name in ("tau", "apigen"):
        sidecar_path = paths[name].with_name("manifest.json")
        if sidecar_path.exists():
            sidecar = read(sidecar_path)
            if name == "apigen":
                require(sidecar == inputs[name]["inputManifest"], "APIGen report input manifest differs from closed replay")
            else:
                expected = sidecar.get("outputs", {}).get(paths[name].name)
                require(expected == sources[name]["sha256"], f"{name} analysis manifest does not bind report bytes")
            sources[f"{name}_manifest"] = {"path": str(sidecar_path), "sha256": sha256(sidecar_path)}
        elif name == "tau":
            raise ValueError("Closed official analysis requires its immutable manifest")
    context_path = paths["cpu_initial"].with_name("context.json")
    if context_path.exists():
        sources["cpu_initial_context"] = {"path": str(context_path), "sha256": sha256(context_path)}
    bfcl_receipt = paths["bfcl"].with_name("integrity-receipt.json")
    if bfcl_receipt.exists():
        sources["bfcl_integrity_receipt"] = {"path": str(bfcl_receipt), "sha256": sha256(bfcl_receipt)}
    isolated_samples = paths["cpu_isolated"].with_name("samples.jsonl")
    require(sha256(isolated_samples) == inputs["cpu_isolated"]["samplesSha256"], "Isolated CPU sample hash mismatch")
    sources["cpu_isolated_samples"] = {"path": str(isolated_samples), "sha256": sha256(isolated_samples)}
    report = build(inputs)
    bfcl_audit_path = paths["bfcl"].with_name("error-audit.json")
    if bfcl_audit_path.exists():
        audit = read(bfcl_audit_path)
        require(audit.get("officialGradesPreserved") is True and audit["officialTotal"] == inputs["bfcl"]["total"]
                and audit["officialCorrect"] == inputs["bfcl"]["correct"], "BFCL audit changed original scores")
        failed_ids = {row["id"] for row in inputs["bfcl"]["results"] if not row["verdict"]["valid"]}
        require(len(audit["failures"]) == audit["officialMisses"] == len(failed_ids)
                and {row["id"] for row in audit["failures"]} == failed_ids, "BFCL audit omitted or added failures")
        sources["bfcl_error_audit"] = {"path": str(bfcl_audit_path), "sha256": sha256(bfcl_audit_path)}
        report["bfclErrorAudit"] = audit
    sources["generator"] = {"path": str(Path(__file__).resolve()), "sha256": sha256(__file__)}
    sources["readme_template"] = {"path": str(TEMPLATE.resolve()), "sha256": sha256(TEMPLATE)}
    report["sources"] = sources
    text = render(report)
    require(all(sha256(item["path"]) == item["sha256"] for item in sources.values()), "Input bytes changed during synthesis")
    output.mkdir(parents=True, exist_ok=False)
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    (output / "README.md").write_text(text, encoding="utf-8")
    with (output / "metrics.csv").open("x", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["metric_path", "value"])
        writer.writerows(numeric_rows({k: report[k] for k in ("tau", "bfcl", "apigen", "cpu", "budget")}))
    manifest = {"version": VERSION, "immutable": True, "providerCalls": 0, "sources": sources,
                "outputs": {path.name: sha256(path) for path in sorted(output.iterdir())}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in INPUTS:
        parser.add_argument("--" + name.replace("_", "-"), required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = generate({name: getattr(args, name) for name in INPUTS}, args.output)
    print(json.dumps({"output": str(args.output.resolve()), "outputs": manifest["outputs"], "providerCalls": 0}))


if __name__ == "__main__":
    main()
