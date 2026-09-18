"""Assemble explicitly closed v5 reports without reading raw cases or changing scores."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

VERSION = "goalspec-v5-final-synthesis-v1"
ROLES = ("annotation", "training", "development", "confirmation", "derya_profile", "derya_live", "bfcl", "prediction", "controller", "budget")
TITLES = {"annotation": "Training annotation diagnosis", "training": "Custom native training collection",
    "development": "Custom native development", "confirmation": "Public official native subset",
    "derya_profile": "Derya database component profile", "derya_live": "Derya synthetic live read tasks",
    "bfcl": "BFCL goal-conditioning probe", "prediction": "Frozen next-action and goal replay",
    "controller": "Controller fitting and calibration", "budget": "Budget accounting"}
VERSIONS = {"annotation": {"v5-annotation-diagnosis-v1"},
    **{role: {"goalspec-native-v5-report-v1"} for role in ("training", "development", "confirmation")},
    "derya_profile": {"derya-real-read-profile-v5.1"}, "derya_live": {"derya-live-read-v5.1"},
    "prediction": {"goalspec-v5-confirmation-prediction-report-v1"}}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def fmt(value, kind="number", digits=3):
    if not number(value):
        return "unavailable"
    if kind == "percent":
        return f"{value * 100:.1f}%"
    if kind == "pp":
        return f"{value * 100:+.1f} pp"
    if kind == "usd":
        return f"${value:.6f}"
    if kind == "count":
        return str(value) if type(value) is int else f"{value:g}"
    return f"{value:.{digits}f}"


def interval(value, kind="number"):
    if not isinstance(value, dict):
        return "unavailable"
    point = fmt(value.get("estimate"), kind)
    if not number(value.get("estimate")):
        return point
    if not number(value.get("lower")) or not number(value.get("upper")):
        return point + " [CI unavailable]"
    return f"{point} [{fmt(value['lower'], kind)}, {fmt(value['upper'], kind)}]"


def cell(value):
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def table(headers, rows):
    return ["| " + " | ".join(map(cell, headers)) + " |", "| " + " | ".join("---" for _ in headers) + " |",
            *("| " + " | ".join(map(cell, row)) + " |" for row in rows)]


def pointer(value, path):
    if path == "":
        return value
    if not isinstance(path, str) or not path.startswith("/"):
        raise ValueError("Metric binding requires an RFC6901 JSON pointer")
    for token in path[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict):
            if token not in value:
                return None
            value = value[token]
        elif isinstance(value, list) and token.isdigit() and int(token) < len(value):
            value = value[int(token)]
        else:
            return None
    return value


def load_inputs(config, base):
    if config.get("version") != VERSION or config.get("allDeclaredCohortsClosed") is not True:
        raise ValueError("Explicit final closure declaration required; never assemble an in-progress subset")
    inputs = config.get("inputs", {})
    if set(inputs) != set(ROLES):
        raise ValueError("Every named report role must be present or explicitly unavailable")
    reports, sources = {}, []
    for role in ROLES:
        item = inputs[role]
        if item.get("available") is False:
            if not isinstance(item.get("reason"), str) or not item["reason"].strip():
                raise ValueError("An unavailable report requires its actual reason")
            reports[role] = None
            continue
        if item.get("closed") is not True or not isinstance(item.get("sha256"), str):
            raise ValueError("Available input must have explicit closure and exact SHA256")
        path = (base / item["path"]).resolve()
        if path.suffix.lower() != ".json" or sha(path) != item["sha256"]:
            raise ValueError("Closed report file or hash mismatch")
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("A report must be an object")
        if role in VERSIONS and data.get("version") not in VERSIONS[role]:
            raise ValueError(f"Unexpected {role} report schema; use the documented report generator")
        if role in {"training", "development", "confirmation"} and data.get("studyStage") != role:
            raise ValueError("Native report was assigned to the wrong stage")
        if role == "derya_profile" and data.get("complete") is not True:
            raise ValueError("Derya profile is incomplete")
        if role == "derya_live" and data.get("completeDeclaredCohort") is not True:
            raise ValueError("Derya live report omits declared trials")
        if role == "bfcl" and data.get("providerRunSummary", {}).get("closed") is not True:
            raise ValueError("BFCL probe must include its closed provider-run summary")
        if role == "budget" and (data.get("currency") != "USD" or data.get("totalCeilingUsd") != 500):
            raise ValueError("Original500USD budget required")
        if item.get("expectedVersion") is not None and data.get("version") != item["expectedVersion"]:
            raise ValueError("Explicit input schema version changed")
        reports[role] = data
        sources.append({"role": role, "path": str(path), "sha256": item["sha256"], "version": data.get("version"),
                        "closedDeclared": True})
    return reports, sources


def native_section(report):
    lines = [report.get("label", "Native study"), ""]
    configuration = report.get("configuration") or {}
    if report.get("studyStage") == "confirmation":
        lines += [f"Selected v5 policy: actorContext={configuration.get('actorContext', 'unavailable')}; goalConditioning={configuration.get('goalConditioning', 'unavailable')}. The goalspec arm is this selected policy, not necessarily an inferred-goal intervention.", ""]
    rows = []
    for arm, item in report["arms"].items():
        metrics, calls, cost = item["metrics"], item["counts"]["physicalCalls"], item["cost"]
        physical = fmt(calls.get("knownSum"), "count")
        if calls.get("missingTrials", 0):
            physical += f" known subtotal; {calls['missingTrials']} trials unmeasured"
        latency = item["timingSeconds"].get("totalTrialSeconds", {})
        quality = item.get("timingQuality", {})
        timing_scope = (f"n={latency.get('n', 'unavailable')}; missing={latency.get('missing', 'unavailable')}; "
            f"host-invalid={quality.get('explicitlyInvalidTimingTrials', 'unavailable')}; "
            f"health-unrecorded={quality.get('healthUnrecordedTrials', 'unavailable')}")
        rows.append([arm, f"{item['successes']}/{item['trials']}; {interval(metrics.get('pass1'), 'percent')}",
            interval(metrics.get("pass2"), "percent"), interval(metrics.get("liveTotalMeanSeconds")),
            f"{fmt(latency.get('p95'))} ({timing_scope})", physical,
            interval(metrics.get("physicalCallsPerSuccess")), f"{fmt(cost.get('knownUsageSubtotalUsd'), 'usd')}; {cost.get('unknownChargeTrials', 'unavailable')} missing/uncertain trial costs"])
    lines += table(["Arm", "Task success;95% CI", "Both-trial consistency", "Mean live seconds;95% CI", "p95 seconds", "Physical tool calls", "All calls/success;95% CI", "Usage subtotal"], rows)
    lines += ["", "Budget terminations and execution failures remain in success denominators. pass1 is empirical per-execution success. Both-trial consistency requires both declared repetitions to succeed; it is neither at-least-once success nor squared pooled accuracy. Missing/uncertain native trial costs include absent telemetry and are not a count of unresolved provider ledger requests.", ""]
    paired = report.get("paired", {})
    if paired:
        lines += table(["Paired treatment minus control", "Matched trials/families", "Measured latency pairs", "Success difference;95% CI", "Live seconds difference;95% CI"], [
            [name, f"{pair.get('matchedTrials', 'unavailable')}/{pair.get('families', 'unavailable')}",
             pair.get("pairedMeasuredLatencyTrials", "unavailable"),
             interval(pair.get("differences", {}).get("pass1"), "pp"), interval(pair.get("differences", {}).get("liveTotalMeanSeconds"))]
            for name, pair in paired.items()])
        lines += [""]
    domains = [[domain, arm, f"{item['successes']}/{item['trials']}", interval(item['metrics'].get('pass1'), 'percent')]
               for domain, groups in report.get("domains", {}).items() for arm, item in groups.items()]
    if domains:
        lines += table(["Domain", "Arm", "Successes/trials", "pass1;95% CI"], domains) + [""]
    lines += ["Live interaction includes native orchestration, model/tool work, simulation serialization and acknowledged per-trial actor/user drain. It excludes source checks, environment/task/agent/user construction, artifact persistence and shared service startup/shutdown. Native judging and judge drain are measured separately. Positive paired success differences favor the treatment; positive latency differences mean slower.",
        "Explicitly invalid host clocks are excluded from primary latency means, tails and intervals; interrupted trials still count as task failures. Source reports retain raw clocks. Timing n, missing observations and host-invalid counts remain separate; absent legacy health metadata is not evidence of valid host timing. Paired latency requires usable clocks on both members."]
    if report.get("studyStage") == "confirmation":
        lines += ["The v4 arm uses the frozen legacy policy inside the same current harness. It is not a pooled comparison with historical v4 runs. The native evaluator uses the pinned GPT-5.4 teacher; the upstream default GPT-4.1-2025-04-14 differs. Public-task exposure and prior diagnostic ancestry prevent a pristine-heldout claim."]
    return lines


def annotation_section(report):
    rows = []
    for key in ("all", "reliability:train", "reliability:calibration"):
        value = report.get("metrics", {}).get(key)
        if value:
            rows.append([key, value["selected"], value["graded"], value["missing"],
                fmt(value["strictAgreementAllSelected"], "percent"), fmt(value["strictAgreementAmongGraded"], "percent")])
    reasons = report.get("metrics", {}).get("all", {}).get("strictFailureReasonsOverlapping", {})
    lines = table(["Training stratum", "Selected", "Graded", "Missing", "Complete agreement/all", "Agreement/graded"], rows)
    if reasons:
        lines += [""] + table(["Overlapping strict-agreement failure reason", "Prefixes"], list(reasons.items()))
    return lines + ["", "These are training labels, not held-out task accuracy. Missing grades remain primary-denominator misses and masked fitting labels. Teacher agreement measures a fallible interpretation. Atomic flags overlap and share prefixes/families."]


def prediction_section(report):
    agreement = report["agreement"]
    lines = [f"Goal agreement across all {agreement['selected']} selected prefixes: Top1 {interval(agreement['goalTop1AllSelected'], 'percent')}; Top3 {interval(agreement['goalTop3AllSelected'], 'percent')}. Missing grades: {agreement['missingGrades']}.", ""]
    rows = []
    for ranker in report["primaryRankers"]:
        item = report["summary"][ranker]
        rows.append([ranker, item["checkpoints"], f"{item['readCheckpoints']}/{item['noReadCheckpoints']}/{item['unknownActionLabels']}",
            interval(item["metrics"]["exactTop1"], "percent"), interval(item["metrics"]["toolTop1"], "percent"),
            interval(item["metrics"]["poolCovered"], "percent"), interval(item["noReadSpecificity"], "percent"),
            interval(item["losses"]["categoryNllNats"])])
    lines += table(["Same-pool ranker", "n", "Read/no-read/unknown", "Read exact Top1;95% CI", "Read tool Top1;95% CI", "Read pool coverage", "NO_READ specificity", "Coarsened next-read log loss"], rows)
    lines += ["", "The same pool has at most128 current-source read candidates. No-memory is a ranking control on that shared pool. Tool/full-argument Top1 and coverage use only read-labeled checkpoints, including prediction failures as misses. These ungated ranking scores accept any audited read in the next actor batch; they do not predict the entire batch or exact write actions.",
        "The reported category log loss concerns a coarsened next-read decision/set event: matching pool reads, NO_READ or READ_UNCOVERED. NO_READ combines writes, messages, stopping and other non-read behavior without identifying exact tools or arguments. READ_UNCOVERED identifies missing read coverage without predicting the missing invocation. This is not full native action tool-and-argument log loss. Log loss estimates cross-entropy, not true conditional entropy; observed-loss counts, uncovered mass and floored read exact/tool losses remain separate in the source report.",
        "Teacher hints are fallible, not true oracle goals. Primary shuffled goals retain donor provenance and can be rejected by the normal guard. The separately reported feature-corruption sensitivity deliberately bypasses provenance outside the runtime. Rejection does not prove current-sourced semantic errors harmless. Joint READ argmax is not utility-based scheduler admission."]
    matched = report.get("matchedTemperatureResidualDiagnostic")
    lines += ["Primary frozen-policy controls may use different neutral and goal-active temperatures. Their probability/log-loss differences therefore combine residual and calibration effects."]
    if matched:
        changes = matched.get("differencesFullResidualMinusNeutral", {})
        lines += ["", f"Offline matched-temperature residual diagnostic, both temperatures fixed to {fmt(matched.get('temperature'))}; same frozen weights, current-goal context, memory and candidate pool:", ""]
        lines += table(["Full residual minus neutral", "Paired family95% interval"], [
            ["Read exact Top1", interval(changes.get("exactTop1"), "pp")],
            ["Read tool Top1", interval(changes.get("toolTop1"), "pp")],
            ["Coarsened next-read log loss", interval(changes.get("categoryNllNats"))]])
        lines += ["", "This separately declared analysis override isolates the residual at the frozen goal-active temperature. It changes neither the primary controls nor the live runtime; negative log-loss differences favor the residual."]
    return lines


def bfcl_section(report):
    groups = report.get("perArm", {})
    rows = [[arm, f"{item.get('correct', 'unavailable')}/{item.get('total', 'unavailable')}", fmt(item.get("meanTotalLatencyMs"))]
            for arm, item in groups.items()]
    count = lambda key: len(report[key]) if isinstance(report.get(key), list) else "unavailable"
    return table(["Probe arm", "Official AST correct/cases", "Mean synchronous milliseconds"], rows) + ["",
        f"Paired accuracy difference: {interval(report.get('pairedAccuracyDifference'), 'pp')}. Helped cases: {count('helpedCases')}; harmed cases: {count('harmedCases')}.",
        "This isolated synchronous goal-conditioning probe uses original public requests/tools and the official AST checker. It does not execute the full GoalSpec runtime, memory, scheduler or task environment. Case-bootstrap intervals do not account for all shared function-family dependence. It provides no live task-success or latency-win claim."]


def profile_section(report):
    performance = report.get("performance", {})
    lines = [f"Independent scenarios: {report.get('scenarioCount', 'unavailable')}; equivalence passed: {report.get('equivalencePassed', 'unavailable')}; performance gate passed: {performance.get('gatePassed', 'unavailable')}; verified reuse enabled: {report.get('verifiedReuseEnabled', 'unavailable')}; production mode: {report.get('productionMode', 'unavailable')}.", ""]
    rows = [[row.get("tool"), fmt(row.get("epoch", {}).get("p95Ms")), fmt(row.get("full", {}).get("p95Ms"))]
            for row in performance.get("perTool", [])]
    if rows:
        lines += table(["Tool", "Epoch probe p95 ms", "Full reread p95 ms"], rows) + [""]
    lines += [f"Maximum writer p95 overhead: {fmt(performance.get('writerOverheadRatio'), 'percent')}. A failed gate stays failed and cannot justify enabling reuse.",
        "This local PostgreSQL fixture profile excludes actor/provider work. Repeated samples are not independent tasks, and one-column writes do not establish production workload overhead. Epoch probing without projection does not expose an observation."]
    return lines


def derya_live_section(report):
    rows = []
    for row in report.get("arms", []):
        metrics, counts, provider, cost = row.get("metrics", {}), row.get("counts", {}), row.get("provider", {}), row.get("cost", {})
        physical = lambda key: (fmt(counts[key].get("knownSum"), "count") + (f" known subtotal; {counts[key]['missingTrials']} missing" if counts[key].get("missingTrials") else "")) if key in counts else "unavailable"
        attempts = sum(group["physicalAttempts"] for group in provider.values()) if provider else None
        rows.append([row["arm"], f"{row['successes']}/{row['trials']}",
            interval(metrics.get("meanLiveSeconds")) if metrics else fmt(row.get("meanTotalTrialSeconds")),
            f"{fmt(row.get('liveSeconds', {}).get('p95'))} (n={row.get('liveSeconds', {}).get('n', 'unavailable')})",
            physical("physicalToolReads"), physical("physicalSqlStatements"), fmt(attempts, "count"), fmt(cost.get("knownResponseUsageUsd"), "usd")])
    lines = table(["Derya arm", "Successes/trials", "Mean live seconds;95% CI", "Observed p95", "Tool reads", "SQL statements", "Provider attempts", "Usage subtotal"], rows)
    if report.get("paired"):
        lines += [""] + table(["Paired treatment minus Base", "Family pairs", "Latency difference seconds;95% CI"], [
            [name, value.get("families", "unavailable"), interval(value.get("latencySeconds"))] for name, value in report["paired"].items()])
    lines += ["", f"Integrity passed: {report.get('integrityPassed', 'unavailable')}; failure: {report.get('globalFailure') or 'none recorded'}.",
        "These are synthetic application read tasks with a cold business controller, not official native benchmark tasks. Physical tool reads, SQL statements and provider attempts are separate quantities. The clock includes per-trial connection setup, actor/tools, managed predictor drain and disconnect; shared ledger recovery and preflight are excluded. The12predeclared request families share tools and fixture state, so family intervals do not eliminate shared-tool/database correlation. Observed p95 has only12samples per arm. No task-cluster interval is inferred when the source provides none."]
    return lines


def budget_section(report):
    return [f"Known settled request usage: {fmt(report.get('totalKnownUsageCostUsd'), 'usd')}; spent or conservatively reserved: {fmt(report.get('totalSpentOrReservedUsd'), 'usd')}; unresolved requests: {report.get('unresolvedRequests', 'unavailable')}; total ceiling: {fmt(report.get('totalCeilingUsd'), 'usd')}; AWS charges: {fmt(report.get('awsChargesUsd'), 'usd')}.", "",
        *table(["Allocation", "Ceiling USD", "Known usage USD", "Spent/reserved USD", "Unresolved requests"], [
            [row.get("allocation"), fmt(row.get("ceilingUsd")), fmt(row.get("knownUsageCostUsd"), digits=6),
             fmt(row.get("spentOrReservedUsd"), digits=6), row.get("unresolvedRequests", "unavailable")] for row in report.get("allocations", [])]), "",
        "The final budget is cumulative across historical and current work. Unknown request charges retain reservations, potentially a whole cohort parent. Response-usage subtotals, settled request costs and conservative reservations are different quantities; none is an invoice, and component subtotals are not added to the cumulative ledger again."]


def bound_metrics(report, bindings):
    rows = []
    for binding in bindings:
        value = pointer(report, binding["pointer"])
        kind = binding.get("format", "number")
        if kind == "ci":
            display = interval(value, binding.get("unit", "number"))
        elif kind == "text":
            display = "unavailable" if value is None else json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
        else:
            display = fmt(value, kind)
        rows.append([binding["label"], display, binding["pointer"]])
    return table(["Declared metric", "Value", "Source JSON pointer"], rows) if rows else []


def render(config, reports):
    lines = ["# GoalSpec v5 results", "", "Each study below keeps its own task population, denominator and timing scope. This synthesis copies closed report scores; it does not change grades, fit models or combine unlike benchmarks.", ""]
    order = ("confirmation", "development", "training", "annotation", "prediction", "bfcl", "derya_profile", "derya_live", "controller", "budget")
    for role in order:
        lines += [f"## {TITLES[role]}", ""]
        report, spec = reports[role], config["inputs"][role]
        if report is None:
            lines += ["Unavailable: " + spec["reason"], ""]
            continue
        if role in {"training", "development", "confirmation"}:
            lines += native_section(report)
        elif role == "annotation":
            lines += annotation_section(report)
        elif role == "prediction":
            lines += prediction_section(report)
        elif role == "bfcl":
            lines += bfcl_section(report)
        elif role == "derya_profile":
            lines += profile_section(report)
        elif role == "derya_live":
            lines += derya_live_section(report)
        elif role == "budget":
            lines += budget_section(report)
        else:
            lines += ["This reports fitting of the local prediction controller, not fine-tuning the hosted actor or teacher. Any model-soup, selected-checkpoint or calibration metrics in the source are training/selection diagnostics, not independent confirmation accuracy. Teacher reliability predicts teacher agreement, not semantic truth or causal prefetch usefulness."]
        if spec.get("bindings"):
            lines += [""] + bound_metrics(report, spec["bindings"])
        lines += ["", f"Source: `{spec['path']}`; SHA256 `{spec['sha256']}`.", ""]
    lines += ["## Interpretation", "", "Family-clustered native/replay intervals use the source reports' declared resampling units. Small samples, overlapping metrics and zero-width intervals do not establish population certainty. BFCL uses public-case bootstrap and has a different dependence structure. No confidence interval is invented for components that provide none.",
        "Public official tasks remain exposed research data. Custom composition families, selected official subsets, annotation agreement, BFCL AST accuracy and application microbenchmarks are distinct outcomes. Training and development selection cannot be relabeled as confirmation. Reported improvements and regressions remain visible; these results do not establish superiority on every metric or a SOTA/full-benchmark score.", "",
        "Native infrastructure follows the [pinned tau2 source](https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db). BFCL uses the [pinned official checker source](https://github.com/ShishirPatil/gorilla/tree/f7cf7359b7ac615a0b294831c5ba2bc95ee4a000). Architecture comparison arms elsewhere are paper-based local baselines, not verified upstream reproductions.", ""]
    return "\n".join(lines)


def assemble(config_path, output):
    config_path, output = Path(config_path).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError("Final synthesis output must be a new directory")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    reports, sources = load_inputs(config, config_path.parent)
    markdown = render(config, reports)
    for entry in sources:
        if sha(entry["path"]) != entry["sha256"]:
            raise ValueError("Input changed during synthesis")
    output.mkdir(parents=True, exist_ok=False)
    (output / "README.md").write_text(markdown, encoding="utf-8")
    (output / "inputs.json").write_bytes(config_path.read_bytes())
    manifest = {"version": VERSION, "inputsConfiguration": {"path": str(config_path), "sha256": sha(config_path)},
        "generator": {"path": str(Path(__file__).resolve()), "sha256": sha(__file__)}, "sources": sources,
        "unavailable": {role: config["inputs"][role]["reason"] for role in ROLES if reports[role] is None},
        "outputs": [{"path": name, "sha256": sha(output / name)} for name in ("README.md", "inputs.json")],
        "scoresModified": False, "providerCalls": 0, "rawCasesRead": False, "pooledBenchmarkScore": False}
    with (output / "manifest.json").open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = assemble(args.inputs, args.output)
    print(json.dumps({"output": str(args.output.resolve()), "sources": len(manifest["sources"]),
                      "manifestSha256": sha(args.output / "manifest.json")}))


if __name__ == "__main__":
    main()
