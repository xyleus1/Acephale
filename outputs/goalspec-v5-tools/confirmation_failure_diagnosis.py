"""Bounded post-hoc notes on three closed v5 failures, with no trace re-reading.

Trace contents were inspected before the next paid cohort. Their hashes come
from the independently closed confirmation report manifest, which is itself
verified here. Final packaging independently rehashes originals after paid work.
No provider, model fitting, native execution, database or ledger access occurs.
"""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / "research/goalspec/runs/local-v5-confirmation-20260916"
PRIOR = ROOT / "research/goalspec/runs/local-v5-confirmation-report-20260916"
OUTPUT = ROOT / "research/goalspec/runs/local-v5-confirmation-diagnosis-20260916"
AUDIT_SHA = "c331b35fdf92582fc19799c89dba26bb0bf35e2c5a3c7b2a0dd8323dafbdece8"
REPORT_SHA = "1dfb9ee133c05563127166b7c812dfaa40497e5884de8991c6634fe8d5d1eb3f"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf8"))


def main():
    assert not OUTPUT.exists()
    assert sha(PRIOR / "manifest.json") == AUDIT_SHA and sha(PRIOR / "report.json") == REPORT_SHA
    audit, prior = read(PRIOR / "manifest.json"), read(PRIOR / "report.json")
    assert sha(RUN / "outcomes.jsonl") == audit["sources"][str((RUN / "outcomes.jsonl").resolve())]
    rows = [json.loads(line) for line in (RUN / "outcomes.jsonl").read_text(encoding="utf8").splitlines()]
    failed = [row for row in rows if not row["success"]]
    assert len(rows) == 36 and len(failed) == 3 and all(row["measuredTimingValid"] and not row["hostInterrupted"] for row in rows)
    assert {(row["taskId"], row["trial"], row["arm"]) for row in failed} == {("68", 0, "goalspec"), ("61", 1, "base"), ("42", 1, "goalspec")}
    pairing = lambda row: tuple(row[key] for key in ("domain", "family", "taskId", "variant", "trial", "seed"))
    pairs = {pairing(row) for row in failed}
    selected = [row for row in rows if pairing(row) in pairs]
    assert len(selected) == 9 and all({row["arm"] for row in selected if pairing(row) == key} == {"base", "v4", "goalspec"} for key in pairs)
    run_id = lambda task, trial, arm: next(row["runId"] for row in selected if (row["taskId"], row["trial"], row["arm"]) == (task, trial, arm))
    reference = lambda task, trial, arm, pointer: {"runId": run_id(task, trial, arm), "jsonPointer": pointer}
    cases = [
        {"taskId": "68", "trial": 0, "failedArm": "goalspec", "classification": "required_language_assertion_failed_after_dialogue_target_shift",
         "rewardBasis": ["DB", "NL_ASSERTION"], "rewardBreakdown": {"DB": 1.0, "NL_ASSERTION": 0.0},
         "requiredAssertion": "Agent should tell the user the order total is $829.43.",
         "checkerEvidence": {"databaseMatches": True, "expectedReadActionMatches": "4/4", "communicate82943": True,
             "communicateIsRewardComponent": False, "assertionCoverageComplete": True,
             "judgeReason": "The agent mentioned $829.43 for the expected order, but did not identify it as the most recent order total; the later dialogue focused on a different delivered order."},
         "observedTrace": [
             "All three paired arms executed the same six-tool name/argument sequence: the incorrect and corrected ZIP lookups, user details, and all three order details.",
             "All three actors said that the returned order details lacked placement dates/times. The observations inspected did not contain date/time fields.",
             "GoalSpec listed #W6729841 at $829.43, then the simulator asked about delivered order #W3445693; the remaining dialogue focused on that order at $919.67.",
             "In Base and v4, the simulator subsequently identified the Bluetooth Speaker and Air Purifier from the target order, and each actor explicitly confirmed $829.43 for that order."],
         "selectedEvidence": [
             {**reference("68", 0, "goalspec", "/simulation/messages/18/content"), "excerpt": "I found your account, but the order details available to me do not include the order placement date/time, so I can\u2019t determine with certainty which order is the most recent."},
             {**reference("68", 0, "goalspec", "/simulation/messages/19/content"), "excerpt": "Could you help me look more closely at the order that was marked as delivered?"},
             {**reference("68", 0, "base", "/simulation/messages/23/content"), "excerpt": "the most recent order I'm interested in is the one with the Bluetooth Speaker and the medium-sized Air Purifier"},
             {**reference("68", 0, "v4", "/simulation/messages/21/content"), "excerpt": "The most recent order had a Bluetooth Speaker and an Air Purifier."},
             reference("68", 0, "goalspec", "/officialRewardInfo/nl_assertions/0")],
         "limits": "This failure is not missing tool coverage or wrong arithmetic. Simulator follow-up and the semantic judge affect the endpoint; the alternate conversations are observations, not controlled counterfactuals."},
        {"taskId": "61", "trial": 1, "failedArm": "base", "classification": "database_reference_refund_destination_mismatch_after_explicit_user_choice",
         "rewardBasis": ["DB", "NL_ASSERTION"], "rewardBreakdown": {"DB": 0.0, "NL_ASSERTION": 1.0},
         "checkerEvidence": {"databaseMatches": False, "requiredAssertions": [], "assertionCoverageComplete": True,
             "expectedMutation": {"tool": "modify_pending_order_items", "order_id": "#W5061109", "item_ids": ["3694871183"], "new_item_ids": ["8555936349"], "payment_method_id": "paypal_3742148"},
             "actualMutationDifference": {"payment_method_id": "gift_card_3406421"},
             "otherFailedActionCheck": "The reference calculate action is unmatched, but ACTION is not in the reward basis; DB is the failing component."},
         "observedFinalState": {"allThreeArms": {"newItemId": "8555936349", "color": "blue", "batteryLife": "8 hours", "waterResistance": "IPX4", "newPrice": 226.49, "refundAmountRoundedUsd": 30.18, "status": "pending (item modified)"},
             "baseRefundMethod": "gift_card_3406421", "v4AndGoalSpecRefundMethod": "paypal_3742148"},
         "observedTrace": [
             "Base fetched user details, offered both original PayPal and an existing gift card, then received explicit user approval to refund the gift card.",
             "The native tool accepted the gift-card refund and applied the requested blue-earbud replacement.",
             "v4 and GoalSpec offered/used original PayPal and their simulators approved it, matching the frozen reference state.",
             "The initial task instructions require blue earbuds at the same or lower price, without an explicit refund-method preference. The reference action fixes PayPal."],
         "selectedEvidence": [
             {**reference("61", 1, "base", "/simulation/messages/13/content"), "excerpt": "I would like the $30.18 refund to go to gift_card_3406421. Yes, please proceed"},
             reference("61", 1, "base", "/simulation/messages/14/tool_calls/0/arguments"),
             reference("61", 1, "base", "/finalDatabase/orders/#W5061109/payment_history/1"),
             reference("61", 1, "goalspec", "/simulation/messages/9/content"),
             reference("61", 1, "v4", "/simulation/messages/9/content")],
         "limits": "The strict database grade is preserved. A permitted user-chosen alternative can differ from the fixed reference endpoint; this is an evaluation/simulator sensitivity, not evidence that the actor used the wrong item or violated the observed consent."},
        {"taskId": "42", "trial": 1, "failedArm": "goalspec", "classification": "required_order_address_omitted_after_overbroad_one_modification_interpretation",
         "rewardBasis": ["DB", "NL_ASSERTION"], "rewardBreakdown": {"DB": 0.0, "NL_ASSERTION": 1.0},
         "checkerEvidence": {"databaseMatches": False, "requiredAssertions": [], "assertionCoverageComplete": True,
             "onlyUnmatchedReferenceAction": {"tool": "modify_pending_order_address", "order_id": "#W4082615", "address1": "445 Maple Drive"}},
         "observedFinalState": {"allThreeArms": {"userAddress1": "445 Maple Drive", "otherOrderAddress1": "445 Maple Drive", "puzzleItemId": "1096508426", "puzzleOptions": "500 pieces, art, beginner", "refundAmountRoundedUsd": 7.98, "refundMethod": "paypal_4768213"},
             "puzzleOrderAddress1": {"base": "445 Maple Drive", "v4": "445 Maple Drive", "goalspec": "443 Maple Drive"}},
         "observedTrace": [
             "GoalSpec initially proposed all address changes plus the puzzle replacement, and the user confirmed the combined plan.",
             "It then stated that only one order modification total was allowed and asked the user to choose between the puzzle order address and item change.",
             "The simulator accepted the reduced plan. The actor updated the user, the other order address, and the puzzle item, leaving the puzzle shipping address unchanged.",
             "Base and v4 updated both order addresses before the item mutation and reached the required final state."],
         "policyAndToolEvidence": {"broadPolicySentence": "Exchange or modify order tools can only be called once per order.",
             "narrowerPolicySection": "The Modify items section specifies one item modification and a terminal modified status.",
             "nativeToolBehavior": "modify_pending_order_address updates the address without changing pending status; modify_pending_order_items then accepts a pending order and changes its status.",
             "interpretation": "The broad policy wording and narrower item rule can support an overbroad reading. The actor's single-modification-total claim differs from the native sequence and reference actions actually used by the successful comparators."},
         "selectedEvidence": [
             reference("42", 1, "goalspec", "/simulation/messages/15/content"),
             reference("42", 1, "goalspec", "/simulation/messages/17/content"),
             {**reference("42", 1, "goalspec", "/simulation/messages/18/content"), "excerpt": "For a pending order, I can only make one order modification total."},
             reference("42", 1, "goalspec", "/simulation/messages/21/content"),
             reference("42", 1, "goalspec", "/finalDatabase/orders/#W4082615/address/address1"),
             reference("42", 1, "base", "/simulation/messages/20/tool_calls/0"),
             reference("42", 1, "v4", "/simulation/messages/24/tool_calls/0")],
         "limits": "The benchmark preserves the original complete objective even after the simulator accepts a reduced one. No evidence here isolates whether the extra literal actor context caused this policy interpretation."},
    ]
    sources = []
    for path in [RUN / "design.json", RUN / "outcomes.jsonl", RUN / "summary.json", RUN / "service-manifest.json", RUN / "public-contexts.json",
                 *[RUN / (row["runId"] + ".json") for row in selected]]:
        digest = audit["sources"].get(str(path.resolve()))
        provenance = "Closed confirmation report manifest; original trace bytes were not rehashed during subsequent paid clocks."
        if digest is None:
            assert path == RUN / "public-contexts.json" and path.stat().st_size < 2 * 1024 * 1024
            digest, provenance = sha(path), "Independently hashed small public-context JSON; trace bodies were not re-read."
        sources.append({"path": str(path.relative_to(ROOT)).replace("\\", "/"), "sha256": digest, "hashProvenance": provenance})
    plan_path = ROOT / "research/goalspec/runs/local-v5-confirmation-plan-20260916/plan.json"
    assert sha(plan_path) == audit["sources"][str(plan_path.resolve())]
    plan = read(plan_path)
    for name in ("research/goalspec/.benchmarks/tau3/src/tau2/domains/retail/tools.py", "research/goalspec/.benchmarks/tau3/data/tau2/domains/retail/policy.md"):
        assert (ROOT / name).stat().st_size < 200000
        digest = sha(ROOT / name)
        assert digest == plan["runtimeSources"][name]["sha256"]
        sources.append({"path": name, "sha256": digest, "hashProvenance": "Small native source independently matched to frozen execution source hash."})
    result = {"version": "goalspec-v5-confirmation-failure-diagnosis-v1", "closed": True, "postHoc": True,
        "studyId": prior["studyId"], "designHash": prior["designHash"], "cohortTrials": 36,
        "successes": {arm: sum(row["success"] for row in rows if row["arm"] == arm) for arm in ("base", "v4", "goalspec")},
        "denominators": dict(Counter(row["arm"] for row in rows)), "failedCases": cases,
        "pairedComparators": [{key: row.get(key) for key in ("runId", "domain", "family", "taskId", "variant", "trial", "seed", "arm", "success", "officialReward", "termination", "evaluationValid", "authoritativeCalls", "speculativeCalls", "hostInterrupted", "measuredTimingValid")} for row in selected],
        "configuration": {"goalSpecActorContext": "literal", "goalConditioning": False, "speculativeCallsInCohort": sum(row.get("speculativeCalls", 0) for row in rows)},
        "limitations": ["Three post-hoc failures and their nine paired transcripts, not a new independent evaluation.",
            "All original native rewards, grades, denominators, seeds and traces remain unchanged; no judge calls or regrading.",
            "Same task/trial seed does not make the model-generated user turns identical between arms.",
            "No causal claim about literal context, memory, controller, goal inference or prefetching is supported by this audit.",
            "The selected v5 arm disabled goal conditioning and admitted no speculative reads; these cases cannot establish an effect of active goal-conditioned speculation.",
            "The three retail failures are distinct: one required language assertion and two strict final-state mismatches. Action-check mismatches are not themselves an ACTION reward component here."],
        "providerCalls": 0, "fits": 0, "runtimeEdits": 0, "databaseAccessed": False, "ledgerAccessed": False,
        "sourceFiles": sources, "sourceIntegrityReceipt": {"path": str((PRIOR / "manifest.json").relative_to(ROOT)).replace("\\", "/"), "sha256": AUDIT_SHA},
        "closedReport": {"path": str((PRIOR / "report.json").relative_to(ROOT)).replace("\\", "/"), "sha256": REPORT_SHA},
        "builderSha256": sha(Path(__file__))}
    OUTPUT.mkdir()
    with (OUTPUT / "report.json").open("x", encoding="utf8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2); stream.write("\n")
    print(json.dumps({"report": str(OUTPUT / "report.json"), "sha256": sha(OUTPUT / "report.json"), "cases": 3, "pairedRuns": 9, "traceFilesReread": 0}))


if __name__ == "__main__":
    main()
