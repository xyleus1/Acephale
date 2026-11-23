"""Presentation-only formatter for an existing original native_report result.

No estimation, aggregation, model calls, filesystem access, or input mutation.
Missing values remain NA; all estimates and intervals come from the input.
"""
import math

_ARM_LABELS = {"base": "Base", "neutral_memory_prefetch": "Neutral memory prefetch",
               "acephale": "Acephale"}


def _text(value):
    if value is None:
        return "NA"
    return str(value).replace("|", "&#124;").replace("\n", " ")


def _number(value, digits=4):
    if value is None:
        return "NA"
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("Expected a recorded numeric value or null")
    if not math.isfinite(value):
        raise ValueError("Non-finite report value")
    if isinstance(value, int):
        return str(value)
    return format(value, "." + str(digits) + "f")


def _count(value, camel=False):
    value = value if isinstance(value, dict) else {}
    total, missing = ("knownTotal", "missingTrials") if camel else ("known_total", "missing_trials")
    return _number(value.get(total)) + " (missing " + _number(value.get(missing)) + ")"


def _interval(value, paired=False):
    value = value if isinstance(value, dict) else {}
    ci = value.get("ci95")
    if ci is None:
        interval = "NA"
    else:
        if not isinstance(ci, (list, tuple)) or len(ci) != 2:
            raise ValueError("Expected the original two-ended ci95")
        interval = "[" + _number(ci[0]) + ", " + _number(ci[1]) + "]"
    n = value.get("paired_trials" if paired else "trials")
    return (_number(value.get("estimate")) + " [" + "95% CI " + interval + "]; n="
            + _number(n) + ", families=" + _number(value.get("families")))


def _table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |",
             "| " + " | ".join("---" for _ in headers) + " |"]
    lines.extend("| " + " | ".join(_text(v) for v in row) + " |" for row in rows)
    return "\n".join(lines)


def render_native_section(original_native_report):
    """Return Markdown by formatting stored report fields only."""
    if not isinstance(original_native_report, dict):
        raise TypeError("original_native_report must be a dict")
    report = original_native_report
    native = report.get("nativeCompletionAndLiveLatency", {})
    arms = native.get("arms")
    if not isinstance(arms, dict) or not arms:
        raise ValueError("Original native report has no per-arm results")
    additional = report.get("additionalArmMetrics", {})
    ordered = [a for a in _ARM_LABELS if a in arms]
    ordered += sorted(set(arms) - set(ordered))
    labels = [_ARM_LABELS.get(a, a) for a in ordered]
    rows = []

    def add(label, getter):
        rows.append([label] + [getter(arms[a], additional.get(a, {})) for a in ordered])

    add("Scheduled trials", lambda a, e: _number(a.get("scheduled_trials")))
    add("Status counts", lambda a, e: "; ".join(_text(k) + "=" + _number(v)
        for k, v in sorted(a.get("status_counts", {}).items())) or "NA")
    add("DB reward successes", lambda a, e: _number(a.get("successes")))
    add("DB reward pass1 (trial rate)", lambda a, e: _number(a.get("pass1")))
    add("DB reward family estimate / CI", lambda a, e: _interval(e.get("nativePass1FamilyBootstrap")))
    add("Known constraint-clean pass1", lambda a, e: _number(e.get("knownConstraintCleanPass1")))
    add("Constraint audit complete / scheduled", lambda a, e:
        _number(e.get("constraintAuditCompleteTrials")) + " / " + _number(a.get("scheduled_trials")))
    add("Constraint violations (missing trials)", lambda a, e: _count(a.get("constraint_violations")))
    add("Logical tool calls", lambda a, e: _count(a.get("logical_calls")))
    add("Physical tool calls", lambda a, e: _count(a.get("physical_calls")))
    add("Physical calls / success", lambda a, e: _number(a.get("physical_calls_per_success")))
    add("Speculative starts", lambda a, e: _count(a.get("speculative_starts")))
    for key, label in (
        ("useful", "Useful speculations"), ("wasted", "Wasted speculations"),
        ("rejected", "Rejected speculation requests"),
        ("cancel_requested", "Cancellation requests"),
        ("cancellation_confirmed", "Confirmed cancellations"),
        ("revalidation_completed", "Completed revalidations")):
        add(label, lambda a, e, k=key: _count(e.get("schedulerEvents", {}).get(k), camel=True))
    add("Revalidation calls", lambda a, e: _count(a.get("revalidation_calls")))
    add("Unpromoted physical calls", lambda a, e: _count(e.get("nativeUnpromotedPhysicalCalls"), camel=True))
    add("Hosted known usage (USD)", lambda a, e: _number(e.get("hostedUsage", {}).get("knownUsageSubtotalUsd"), 6))
    add("Hosted missing-subtotal trials / unknown charges", lambda a, e:
        _number(e.get("hostedUsage", {}).get("missingKnownSubtotalTrials")) + " / "
        + _number(e.get("hostedUsage", {}).get("unknownCharges")))
    add("Unknown-cost trials", lambda a, e: _number(a.get("unknown_cost_trials")))
    add("Valid live-latency samples", lambda a, e: _number(a.get("latency_samples")))
    add("Live latency mean / median / p95 (ms)", lambda a, e:
        " / ".join(_number(a.get(k)) for k in ("mean_latency_ms", "median_latency_ms", "observed_p95_latency_ms")))
    add("Joint actor/predictor-seed consistency (paired-task n)", lambda a, e:
        _number(a.get("joint_actor_and_predictor_seed_consistency")) + " (n="
        + _number(a.get("two_trial_tasks")) + ")")
    add("Known constraint-clean joint consistency (paired-task n)", lambda a, e:
        _number(e.get("knownConstraintCleanJointSeedConsistency")) + " (n="
        + _number(a.get("two_trial_tasks")) + ")")

    parts = [
        "**" + _text(report.get("stage")).capitalize() + " native results — UNVALIDATED.** "
        "Custom tau-compatible execution; " + _number(report.get("declaredSlots"))
        + " declared original slots. This is not a qualified or full-benchmark score.",
        _table(["Recorded metric"] + labels, rows),
        "Counts include all recorded statuses. Parenthesized missing counts are retained, not imputed. "
        "The DB reward trial rate and equal-family estimate are distinct stored fields. "
        "Constraint-clean results cover the configured assertion audit, not complete policy compliance. "
        "NA denotes a null or absent report value; zero valid latency samples do not imply zero latency. "
        "Joint seed consistency is not fixed-checkpoint pass².",
    ]
    comparisons = native.get("paired_comparisons", [])
    clean = {(c.get("treatment"), c.get("baseline")): c
             for c in report.get("knownConstraintCleanPairedDifferences", [])}
    if comparisons:
        headers = ["Original paired estimate / 95% CI"]
        for c in comparisons:
            headers.append(_ARM_LABELS.get(c.get("treatment"), c.get("treatment", "NA")) + " − "
                           + _ARM_LABELS.get(c.get("baseline"), c.get("baseline", "NA")))
        paired_rows = []
        for label, key, is_clean in (
            ("DB reward difference", "success_difference", False),
            ("Known constraint-clean difference", "success_difference", True),
            ("Logical tool-call difference", "logical_calls_difference", False),
            ("Physical tool-call difference", "physical_calls_difference", False),
            ("Valid live-latency difference (ms)", "latency_ms_difference", False)):
            cells = []
            for c in comparisons:
                item = clean.get((c.get("treatment"), c.get("baseline")), {}) if is_clean else c
                cells.append(_interval(item.get("metrics", {}).get(key), paired=True))
            paired_rows.append([label] + cells)
        parts.extend([
            _table(headers, paired_rows),
            "Paired differences are treatment minus baseline, copied with their original family-weighted "
            "confidence intervals and per-metric denominators; no statistics were recomputed."
        ])
    scopes = sorted({str(additional[a].get("hostedUsage", {}).get("scope"))
                     for a in ordered if a in additional and additional[a].get("hostedUsage", {}).get("scope")})
    parts.append("Hosted usage scope: " + (", ".join(_text(s) for s in scopes) or "not recorded")
                 + ". These are recorded provider-usage/ledger values, not reconciled invoices or confirmed "
                 "cash debits; GPU charges are separate.")
    if report.get("seedDesignLimitation"):
        parts.append("Seed-design limitation: " + _text(report["seedDesignLimitation"]))
    return "\n\n".join(parts) + "\n"
