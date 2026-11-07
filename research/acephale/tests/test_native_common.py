import json
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.native_common import (
    ServiceTelemetry,
    apply_host_health,
    assess_official_reward,
    await_service_ready,
    close_failed_workers,
    observe_host_health,
)


def test_hung_startup_stops_once_and_forty_slots_do_not_each_wait_for_workers():
    broker, process = Mock(), Mock()
    broker.wait_ready.side_effect = TimeoutError("fixture readiness timeout")
    process.poll.return_value = None
    ready, failure = await_service_ready(broker, process)
    assert ready is None and failure == "TimeoutError"
    broker.wait_ready.assert_called_once_with(timeout=600)
    broker.close.assert_called_once()
    process.terminate.assert_called_once()
    process.wait.assert_called_once_with(timeout=15)
    process.kill.assert_not_called()
    for index in range(40):
        close_failed_workers(broker, f"run-{index}", custom=True, ready_at=ready)
    broker.finish.assert_not_called()


def test_startup_shutdown_escalates_only_when_terminate_does_not_reap():
    broker, process = Mock(), Mock()
    broker.wait_ready.side_effect = TimeoutError()
    process.poll.return_value = None
    process.wait.side_effect = [subprocess.TimeoutExpired("fixture", 15), 1]
    assert await_service_ready(broker, process) == (None, "TimeoutError")
    process.kill.assert_called_once()
    assert process.wait.call_count == 2


def test_ready_service_preserves_acknowledged_worker_draining():
    broker, process = Mock(), Mock()
    broker.wait_ready.return_value = 123.0
    assert await_service_ready(broker, process) == (123.0, None)
    process.terminate.assert_not_called()
    broker.close.assert_not_called()
    close_failed_workers(broker, "run", custom=False, ready_at=123.0)
    assert [call.args[0] for call in broker.finish.call_args_list] == [
        "run",
        "run:user",
        "run:evaluator",
    ]


def log_fixture(tmp_path):
    # This prior log must never be opened or parsed by native telemetry.
    (tmp_path / "events-historical.jsonl").write_bytes(b"deliberately invalid historical log")
    telemetry = ServiceTelemetry(tmp_path, "manifest")
    (tmp_path / "budget.jsonl.lock").write_text(json.dumps({"pid": 123}), encoding="utf8")
    path, previous, sequence = tmp_path / "events-current.jsonl", "0" * 64, 0

    def append(event):
        nonlocal previous, sequence
        body = {
            "sequence": sequence,
            "previousHash": previous,
            "recordedAtUnixMs": 1000 + sequence,
            "event": event,
        }
        previous = hash_v1(body)
        sequence += 1
        raw = (json.dumps({"body": body, "hash": previous}) + "\n").encode()
        with path.open("ab") as stream:
            stream.write(raw)
        return raw

    append({"type": "research_manifest", "manifestHash": "manifest"})
    return telemetry, path, append


def test_telemetry_consumes_only_one_owned_log_and_never_counts_new_bytes_twice(tmp_path):
    telemetry, path, append = log_fixture(tmp_path)
    telemetry.bind(123)
    append({"runId": "run", "event": {"type": "model_attempt", "costMicrodollars": 125}})
    first = telemetry.summary("run", True)
    assert first["billedUsd"] == 0.000125 and first["providerCalls"] == 1
    assert telemetry.summary("run", True) == first
    append({"runId": "other", "event": {"type": "model_attempt", "costMicrodollars": 900}})
    append({"runId": "run", "event": {"type": "model_attempt_failed"}})
    last = telemetry.summary("run", True)
    assert last["billedUsd"] is None and last["knownUsageSubtotalUsd"] == 0.000125
    assert last["providerCalls"] == 1 and telemetry.offset == path.stat().st_size


def test_unrelated_owner_or_ambiguous_new_logs_cannot_bind(tmp_path):
    telemetry, _path, _append = log_fixture(tmp_path)
    with pytest.raises(ValueError, match="exclusive"):
        telemetry.bind(999)
    (tmp_path / "events-second-new.jsonl").write_text("", encoding="utf8")
    with pytest.raises(ValueError, match="exclusive"):
        telemetry.bind(123)


def test_truncated_live_log_censors_cost_and_does_not_rescan_historical_logs(tmp_path):
    telemetry, path, _append = log_fixture(tmp_path)
    telemetry.bind(123)
    path.write_bytes(b"")
    result = telemetry.summary("run", True)
    assert result["billedUsd"] is None and result["unknownProviderCharge"]
    assert result["telemetryIntegrityError"] == "ValueError"
    assert telemetry.summary("run", False)["billedUsd"] is None


@pytest.mark.parametrize(
    "returned,valid",
    [
        (["first", "second"], True),
        (["second", "first"], True),
        ([], False),
        (["first"], False),
        (["first", "first"], False),
        (["first", "second", "second"], False),
    ],
)
def test_required_assertions_need_exact_multiset_but_raw_native_reward_is_preserved(
    returned, valid
):
    task = SimpleNamespace(
        evaluation_criteria=SimpleNamespace(
            nl_assertions=["first", "second"], reward_basis=["DB", "NL_ASSERTION"]
        )
    )
    reward = SimpleNamespace(
        reward=1.0,
        nl_assertions=[SimpleNamespace(nl_assertion=item, met=True) for item in returned],
    )
    result = assess_official_reward(task, reward)
    assert result["officialReward"] == reward.reward == 1.0
    assert result["evaluationValid"] is valid and result["passed"] is valid
    assert result["requiredJudgeAssertionCoverage"] is valid
    assert result["evaluationErrorType"] == (None if valid else "IncompleteRequiredNLAssertions")


def test_unused_nl_assertions_do_not_change_original_reward_basis():
    task = SimpleNamespace(
        evaluation_criteria=SimpleNamespace(
            nl_assertions=["unused"], reward_basis=["DB", "COMMUNICATE"]
        )
    )
    reward = SimpleNamespace(reward=1.0, nl_assertions=[])
    result = assess_official_reward(task, reward)
    assert result["passed"] and result["evaluationValid"]
    assert (
        result["judgeAssertionCoverage"] is False
        and result["requiredJudgeAssertionCoverage"] is None
    )


def test_complete_judge_cannot_upgrade_a_native_failure():
    task = SimpleNamespace(
        evaluation_criteria=SimpleNamespace(nl_assertions=["first"], reward_basis=["NL_ASSERTION"])
    )
    reward = SimpleNamespace(
        reward=0.0, nl_assertions=[SimpleNamespace(nl_assertion="first", met=False)]
    )
    result = assess_official_reward(task, reward)
    assert result["officialReward"] == 0 and result["passed"] is False
    assert result["constraintViolations"] == 1 and result["evaluationValid"] is True


def heartbeat(path, sequence=1, **changes):
    value = {
        "healthy": True,
        "networkConnected": True,
        "state": "healthy",
        "observedAtUnixMs": 100_000,
        "maxStatusAgeMs": 5000,
        "heartbeatSequence": sequence,
        **changes,
    }
    file = path / f"{sequence:016d}.json"
    file.write_text(json.dumps(value), encoding="utf8")
    return file


@pytest.mark.parametrize(
    "now,valid", [(99_000, True), (98_999, False), (103_000, True), (103_001, False)]
)
def test_host_heartbeat_provider_ttl_and_future_clock_boundaries_are_unchanged(
    tmp_path, now, valid
):
    heartbeat(tmp_path)
    sample = observe_host_health("before_native", status_path=tmp_path, now_ms=now)
    assert sample["healthy"] is valid and sample["maxStatusAgeMs"] == 3000
    assert len(sample["publicationSha256"]) == 64


def test_newest_host_publication_never_falls_back_and_temporary_files_are_ignored(tmp_path):
    heartbeat(tmp_path)
    (tmp_path / "0000000000000002.next").write_text("incomplete", encoding="utf8")
    assert observe_host_health("before_native", status_path=tmp_path, now_ms=100_000)["healthy"]
    latest = heartbeat(tmp_path, 2, healthy=False, state="degraded")
    assert not observe_host_health("after_trial", status_path=tmp_path, now_ms=100_000)["healthy"]
    latest.write_text("malformed", encoding="utf8")
    assert (
        observe_host_health("after_trial", status_path=tmp_path, now_ms=100_000)["reason"]
        == "host_status_unavailable"
    )
    latest.write_text(json.dumps({"heartbeatSequence": 1}), encoding="utf8")
    assert not observe_host_health("after_trial", status_path=tmp_path, now_ms=100_000)["healthy"]


def test_host_status_requires_guard_and_rejects_numeric_booleans_or_shorter_expired_ttl(
    tmp_path, monkeypatch
):
    monkeypatch.delenv("ACEPHALE_HOST_STATUS_FILE", raising=False)
    assert (
        observe_host_health("before_native", now_ms=100_000)["reason"]
        == "host_guard_not_configured"
    )
    for change in (
        {"observedAtUnixMs": True},
        {"maxStatusAgeMs": True},
        {"networkConnected": False},
        {"maxStatusAgeMs": 100},
    ):
        heartbeat(tmp_path, **change)
        assert not observe_host_health("after_trial", status_path=tmp_path, now_ms=100_200)[
            "healthy"
        ]


def test_native_stop_after_host_gap_keeps_raw_reward_and_clocks_but_invalidates_study_result():
    row = {
        "success": True,
        "termination": "user_stop",
        "nativeTermination": "user_stop",
        "officialReward": 1,
        "latencyMs": 535_219,
        "totalTrialSeconds": 536,
        "budget_terminated": False,
    }
    samples = [
        {"phase": phase, "healthy": phase != "after_actor_user_drain"}
        for phase in ("before_native", "after_actor_user_drain", "after_trial")
    ]
    apply_host_health(row, samples)
    assert row["successWithoutHostGuard"] and row["success"] is False and row["hostInterrupted"]
    assert (
        row["termination"] == "host_interruption"
        and row["nativeTermination"] == "user_stop"
        and row["officialReward"] == 1
    )
    assert (
        row["terminationBeforeHostGuard"] == "user_stop"
        and row["latencyMs"] == 535_219
        and row["totalTrialSeconds"] == 536
    )
    assert row["measuredTimingValid"] is False
    healthy = {"success": True, "termination": "agent_stop"}
    apply_host_health(
        healthy,
        [
            {"phase": phase, "healthy": True}
            for phase in ("before_native", "after_actor_user_drain", "after_trial")
        ],
    )
    assert (
        healthy["success"]
        and healthy["measuredTimingValid"]
        and healthy["hostInterrupted"] is False
    )
