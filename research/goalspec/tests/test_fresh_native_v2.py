import json

from goalspec.fresh_tasks import build_tasks as build_v1
from goalspec.fresh_tasks import digest
from goalspec.fresh_tasks_v2 import STRUCTURES, build_tasks
from goalspec.native_live import (
    build_user_policy,
    drain_trial,
    exchange_user_message,
    native_run_id,
    summarize_costs,
    telemetry,
)


def test_v2_has_disjoint_compositions_and_new_study_task_identities():
    dev = build_tasks("study-v2-test", "development-1")
    second = build_tasks("study-v2-test", "development-2")
    confirmation = build_tasks("study-v2-test", "confirmation")
    assert [len(rows) for rows in (dev, second, confirmation)] == [8, 8, 16]
    assert not {t["familyId"] for t in dev} & {t["familyId"] for t in confirmation}
    assert not {t["familyId"] for t in build_v1()} & {t["familyId"] for t in dev + confirmation}
    assert len(set(STRUCTURES.values())) == 12
    assert len({t["taskId"] for t in dev + second + confirmation}) == 32
    assert not {t["fixtureHash"] for t in dev} & {t["fixtureHash"] for t in second}
    assert confirmation == build_tasks("study-v2-test", "confirmation")
    for task in dev + second + confirmation:
        assert task["fixtureHash"] == digest({k: v for k, v in task.items() if k != "fixtureHash"})


def test_confirmation_variants_change_decision_branches_not_only_entity_values():
    tasks = build_tasks("study-v2-test", "confirmation")
    def family(name):
        return [task for task in tasks if task["familyId"].endswith(name)]
    availability = family("v2_availability_change_or_cancel")
    assert [t["referenceActions"][0]["name"] for t in availability] == ["modify_pending_order_items", "cancel_pending_order"]
    fare = family("v2_fare_cap_retime_or_keep")
    assert [len(t["referenceActions"]) for t in fare] == [1, 0]
    assert fare[1]["responsePatterns"]
    booking = family("v2_seat_and_price_booking")
    assert [t["referenceActions"][0]["arguments"]["cabin"] for t in booking] == ["business", "economy"]
    refunds = family("v2_status_selected_refunds")
    for task in refunds:
        orders = task["initialDatabase"]["orders"]
        assert len(orders) == 3 and len(task["referenceActions"]) == 2
        for reference in task["referenceActions"]:
            order = orders[reference["arguments"]["order_id"]]
            assert order["status"] == "delivered"
            assert reference["arguments"]["payment_method_id"].startswith("gift_card") == (order["items"][0]["price"] > 100)


def test_run_ids_separate_studies_and_rounds_and_preserve_v1_identity():
    trial = {"family": "retail:status", "variant": 0, "trial": 0, "arm": "base", "seed": 7, "reserved_usd": 1.25}
    assert native_run_id({"generator": "fresh-native-v1"}, {"phase": "train"}, 0, trial) == f"train-0000-{digest(trial)[:12]}"
    ids = {native_run_id({"generator": "fresh-native-v2", "studyId": study, "studyStage": stage}, {"designHash": "a" * 64}, 0, trial)
           for study in ("study-v2-one", "study-v2-two") for stage in ("development-1", "development-2", "confirmation")}
    assert len(ids) == 6


def test_total_trial_timing_includes_both_worker_drains_and_retains_errors():
    class Broker:
        def __init__(self):
            self.closed = []
        def finish(self, identity):
            self.closed.append(identity)
            if identity == "run":
                raise RuntimeError("drain failed")
    broker = Broker()
    ticks = iter([3.0, 6.0])
    result = drain_trial(broker, "run", started=1.0, native_seconds=2.0, clock=lambda: next(ticks))
    assert broker.closed == ["run", "run:user"]
    assert result["nativeOrchestrationSeconds"] == 2.0
    assert result["serviceDrainSeconds"] == 3.0
    assert result["totalTrialSeconds"] == 5.0
    assert not result["serviceDrainSucceeded"]
    assert result["serviceDrainErrors"] == [{"workerId": "run", "exceptionType": "RuntimeError"}]


def test_unacknowledged_drain_censors_cost_even_before_provider_failure_is_logged(tmp_path):
    (tmp_path / "events-test.jsonl").write_text(json.dumps({"body": {"event": {"runId": "run", "event": {
        "type": "model_attempt", "costMicrodollars": 27}}}}) + "\n", encoding="utf-8")
    result = telemetry(tmp_path, "run", managed_work_drained=False)
    assert result["billedUsd"] is None and result["unknownProviderCharge"]
    assert result["knownUsageSubtotalUsd"] == .000027
    assert result["costCensoringReason"] == "managed_work_drain_not_acknowledged"


def test_user_policy_goes_only_to_user_worker_and_native_stop_output_is_untouched():
    actor_policy = "Public tool policy"
    private_user_policy = "User scenario: private scenario detail"
    messages = [{"role": "user", "content": "Please confirm the change."}]
    stop_response = {"role": "user", "content": "Yes, please proceed. ###STOP###", "metadata": {"native": True}}
    dispatched = []
    class Broker:
        def exchange(self, worker_id, payload):
            dispatched.append((worker_id, payload))
            return stop_response
    assert build_user_policy(private_user_policy, is_v2=False) == private_user_policy
    policy = build_user_policy(private_user_policy, is_v2=True)
    for arm in ("base", "neutral_memory_prefetch", "goalspec"):
        reply = exchange_user_message(Broker(), arm, messages, policy)
        assert reply is stop_response
    assert [worker for worker, _ in dispatched] == ["base:user", "neutral_memory_prefetch:user", "goalspec:user"]
    assert all(payload == {"messages": messages, "policy": policy, "tools": []} for _, payload in dispatched)
    assert len({payload["policy"] for _, payload in dispatched}) == 1
    assert private_user_policy in policy and policy != private_user_policy
    assert "private scenario detail" not in actor_policy
    assert messages == [{"role": "user", "content": "Please confirm the change."}]


def test_failed_provider_charge_keeps_known_usage_subtotal_in_phase_summary(tmp_path):
    events = [{"type": "model_attempt", "costMicrodollars": 61823}, {"type": "model_attempt_failed"}]
    (tmp_path / "events-test.jsonl").write_text("".join(json.dumps({"body": {"event": {"runId": "unknown", "event": event}}}) + "\n" for event in events), encoding="utf-8")
    unknown = telemetry(tmp_path, "unknown", managed_work_drained=True)
    assert unknown["billedUsd"] is None and unknown["unknownProviderCharge"]
    assert unknown["knownUsageSubtotalUsd"] == .061823
    known = {"billedUsd": .1, "knownUsageSubtotalUsd": .1, "unknownProviderCharge": False}
    summary = summarize_costs([known, unknown])
    assert summary == {"billedUsd": None, "knownUsageSubtotalUsd": .161823, "unknownCharges": 1}
    assert summarize_costs([known]) == {"billedUsd": .1, "knownUsageSubtotalUsd": .1, "unknownCharges": 0}
