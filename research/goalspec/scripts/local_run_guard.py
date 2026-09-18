"""Run one local research command with a Windows idle-sleep hold and host evidence.

The hold uses only ES_CONTINUOUS | ES_SYSTEM_REQUIRED on this thread. It does
not override lid actions, explicit sleep, display locking, or global settings.
Network state is an OS observation, never a probe or proof of API reachability.
The child must check GOALSPEC_HOST_STATUS_FILE before paid dispatch and reject
missing, stale, or degraded status. Degradation remains latched for this run.
That variable names a directory of immutable, complete 16-digit-sequence JSON
heartbeats. Readers select its latest JSON; .next files are incomplete. Nothing
in that directory is overwritten or deleted during the run.
The output directory must be a NEW direct child of research/goalspec/runs;
nested study directories and existing directories are deliberately refused.

Example, from the repository root:
  python -B research/goalspec/scripts/local_run_guard.py \
    --output-dir research/goalspec/runs/local-v2-host-001 -- node script.js

API reference: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import json
import math
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
STATUS_ENVIRONMENT_KEY = "GOALSPEC_HOST_STATUS_FILE"
STATUS_REPLACE_MAX_RETRY_SECONDS = 0.2


def safe_error(error):
    """Keep numeric OS diagnostics, never exception messages or command arguments."""
    def number(value):
        return value if isinstance(value, int) and not isinstance(value, bool) else None
    return {"errorType": type(error).__name__, "errno": number(getattr(error, "errno", None)),
            "winerror": number(getattr(error, "winerror", None))}


def replace_status(temporary, destination, retry_seconds, *, replace=os.replace,
                   monotonic=time.monotonic, sleep=time.sleep):
    """Retry only Windows access/sharing/lock conflicts, with a fixed deadline.

    The previous complete status stays in place. We never truncate it, relax its
    expiry, or treat a retry as a new heartbeat. Non-sharing failures propagate.
    """
    started = monotonic()
    deadline = started + max(0, min(retry_seconds, STATUS_REPLACE_MAX_RETRY_SECONDS))
    retries = 0
    last_error = None
    while True:
        try:
            replace(temporary, destination)
            return {"retries": retries, "elapsedMs": (monotonic() - started) * 1000,
                    "lastError": last_error}
        except OSError as error:
            # These are ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION and
            # ERROR_LOCK_VIOLATION. No retry for missing files, disks or schema.
            remaining = deadline - monotonic()
            if getattr(error, "winerror", None) not in {5, 32, 33} or remaining <= 0:
                raise
            last_error = safe_error(error)
            sleep(min(0.005 * (2 ** min(retries, 2)), remaining))
            retries += 1
            # Do not make another attempt after the freshness-constrained deadline.
            if monotonic() >= deadline:
                raise


class WindowsHost:
    """Small injectable native seam; no registry, credentials, or network requests."""

    def __init__(self):
        if sys.platform != "win32":
            raise RuntimeError("windows_required")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.internet = ctypes.WinDLL("wininet", use_last_error=True)
        self.kernel.SetThreadExecutionState.argtypes = [ctypes.c_uint32]
        self.kernel.SetThreadExecutionState.restype = ctypes.c_uint32
        self.internet.InternetGetConnectedState.argtypes = [ctypes.POINTER(ctypes.c_uint32), ctypes.c_uint32]
        self.internet.InternetGetConnectedState.restype = ctypes.c_int
        self.owner_thread = None

    def acquire(self):
        if not self.kernel.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED):
            raise RuntimeError("execution_state_acquire_failed")
        self.owner_thread = threading.get_ident()

    def release(self):
        if self.owner_thread != threading.get_ident():
            raise RuntimeError("execution_state_thread_changed")
        if not self.kernel.SetThreadExecutionState(ES_CONTINUOUS):
            raise RuntimeError("execution_state_release_failed")
        self.owner_thread = None

    def network(self):
        # This desktop-only legacy API reports aggregate local connection state.
        # No interface names, addresses, proxy values, or destination probes are logged.
        flags = ctypes.c_uint32()
        connected = bool(self.internet.InternetGetConnectedState(ctypes.byref(flags), 0))
        return {"connected": connected, "flags": flags.value, "source": "InternetGetConnectedState",
                "destinationReachabilityVerified": False}


class Heartbeat:
    def __init__(self, gap_seconds=5.0, max_status_age_ms=3000):
        self.gap_ms = gap_seconds * 1000
        self.max_status_age_ms = max_status_age_ms
        self.previous = None
        self.sequence = 0
        self.reasons = set()

    def sample(self, wall_ns, monotonic_ns, network, extra_reason=None):
        wall_gap = monotonic_gap = skew = None
        if self.previous is not None:
            wall_gap = (wall_ns - self.previous[0]) / 1_000_000
            monotonic_gap = (monotonic_ns - self.previous[1]) / 1_000_000
            skew = wall_gap - monotonic_gap
            if max(wall_gap, monotonic_gap) > self.gap_ms:
                self.reasons.add("heartbeat_gap")
            if monotonic_gap < 0 or abs(skew) > self.gap_ms:
                self.reasons.add("clock_discontinuity")
        if network.get("connected") is not True:
            self.reasons.add("network_disconnected" if network.get("connected") is False
                             else "network_status_unavailable")
        if extra_reason:
            self.reasons.add(extra_reason)
        self.previous = (wall_ns, monotonic_ns)
        self.sequence += 1
        return {"schemaVersion": 1, "state": "degraded" if self.reasons else "healthy",
                "healthy": not self.reasons, "reasons": sorted(self.reasons),
                "observedAtUtc": datetime.fromtimestamp(wall_ns / 1_000_000_000, UTC).isoformat(),
                "observedAtUnixMs": wall_ns // 1_000_000, "monotonicNs": str(monotonic_ns),
                "heartbeatSequence": self.sequence, "heartbeatGapMs": monotonic_gap,
                "wallGapMs": wall_gap, "clockSkewMs": skew, "networkConnected": network.get("connected"),
                "network": network, "maxStatusAgeMs": self.max_status_age_ms}


class Evidence:
    def __init__(self, output):
        output.mkdir(exist_ok=False)
        self.output = output
        self.status_path = output / "status"
        self.status_path.mkdir(exist_ok=False)
        self.last_published = None
        self.events = (output / "events.jsonl").open("x", encoding="utf-8", newline="\n")

    def write(self, event, **data):
        self.events.write(json.dumps({"event": event, **data}, allow_nan=False) + "\n")
        self.events.flush()

    def status(self, status):
        sequence = status["heartbeatSequence"]
        if (type(sequence) is not int or not 0 < sequence < 10 ** 16
                or (self.last_published and sequence <= self.last_published["heartbeatSequence"])):
            raise ValueError("heartbeat_sequence_must_increase")
        destination = self.status_path / f"{sequence:016d}.json"
        temporary = self.status_path / f"{sequence:016d}.next"
        if destination.exists():
            raise FileExistsError("heartbeat_destination_already_exists")
        with temporary.open("x", encoding="utf-8", newline="\n") as target:
            json.dump(status, target, allow_nan=False)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        budget = STATUS_REPLACE_MAX_RETRY_SECONDS
        if self.last_published:
            age = time.time_ns() / 1_000_000 - self.last_published["observedAtUnixMs"]
            # Leave a 25 ms margin before the previous status expires. The
            # provider independently keeps enforcing its unchanged 3 s cap.
            remaining = min(self.last_published["maxStatusAgeMs"], 3000) - age - 25
            budget = min(budget, max(0, remaining / 1000))
        try:
            # Rename to a unique destination, never replace a reader-held file.
            # Windows os.rename also refuses an existing destination. Only this
            # writer owns this new directory; published files remain immutable.
            result = replace_status(temporary, destination, budget, replace=os.rename)
        except OSError as error:
            try:
                self.write("status_publish_failed", operation="atomic_unique_status_publish",
                           retryBudgetMs=budget * 1000, **safe_error(error))
            except OSError:
                pass
            raise
        self.last_published = dict(status)
        if result["retries"]:
            self.write("status_publish_recovered", operation="atomic_unique_status_publish", **result)
        self.write("heartbeat", statusFile=destination.name, **status)

    def close(self):
        self.events.close()


def safe_output(root, requested):
    runs = (root / "research/goalspec/runs").resolve(strict=True)
    output = requested if requested.is_absolute() else root / requested
    resolved = output.resolve()
    if resolved.parent != runs or output.is_symlink():
        raise ValueError("output_must_be_a_new_direct_child_of_research_runs")
    if resolved.exists():
        raise FileExistsError("output_already_exists")
    return resolved


def run_guard(command, output, *, host, interval=1.0, gap=5.0, root=None,
              spawn=subprocess.Popen, wall=time.time_ns, monotonic=time.monotonic_ns,
              sleep=time.sleep):
    if not command or not (0.1 <= interval <= 10) or not math.isfinite(gap) or gap < interval * 2:
        raise ValueError("invalid_command_or_heartbeat_parameters")
    evidence = Evidence(output)
    heartbeat = Heartbeat(gap, math.ceil(interval * 3000))
    child = None
    held = False
    release_ok = False
    stop_requested = False
    failure_kind = None
    failure_details = None
    exit_code = 70
    previous_signal = signal.getsignal(signal.SIGINT)

    def request_stop(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    def sample(extra=None):
        try:
            network = host.network()
        except Exception:
            network = {"connected": None, "source": "unavailable",
                       "destinationReachabilityVerified": False}
        status = heartbeat.sample(wall(), monotonic(), network, extra)
        evidence.status(status)
        return status

    try:
        signal.signal(signal.SIGINT, request_stop)
        host.acquire()
        held = True
        evidence.write("execution_state_acquired", flags=ES_CONTINUOUS | ES_SYSTEM_REQUIRED,
                       threadId=threading.get_ident(), explicitSleepAndLidActionsRespected=True)
        initial = sample("interrupted" if stop_requested else None)
        if not initial["healthy"]:
            evidence.write("launch_blocked", reasons=initial["reasons"])
            raise RuntimeError("host_preflight_degraded")
        # The environment is inherited without inspecting or serializing its contents.
        # Only the new guard-status variable is supplied explicitly to the child.
        prior_status = os.environ.get(STATUS_ENVIRONMENT_KEY)
        os.environ[STATUS_ENVIRONMENT_KEY] = str(evidence.status_path)
        try:
            child = spawn(command, cwd=root, stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr,
                          creationflags=(subprocess.CREATE_NO_WINDOW
                          if sys.platform == "win32" else 0))
        finally:
            if prior_status is None:
                os.environ.pop(STATUS_ENVIRONMENT_KEY, None)
            else:
                os.environ[STATUS_ENVIRONMENT_KEY] = prior_status
        evidence.write("child_started", pid=child.pid, argumentCount=len(command) - 1)
        while child.poll() is None:
            sleep(interval)
            sample("interrupted" if stop_requested else None)
        exit_code = child.wait()
        evidence.write("child_exited", exitCode=exit_code)
    except Exception as error:
        # Exception messages may echo command arguments; only numeric OS details.
        failure_kind = type(error).__name__
        failure_details = safe_error(error)
        try:
            evidence.write("guard_failed", **failure_details)
        except OSError:
            pass
    finally:
        # Do not abandon an active paid child or forcibly terminate its reservations.
        # A degraded/stale status blocks further provider dispatch; wait for its exit.
        if child is not None and child.poll() is None:
            try:
                sample("guard_error")
            except Exception:
                pass
            while child.poll() is None:
                sleep(interval)
            exit_code = child.wait()
        degraded_during_run = bool(heartbeat.reasons)
        try:
            sample("guard_closed")
        except Exception as error:
            failure_kind = failure_kind or "EvidenceWriteError"
            failure_details = failure_details or safe_error(error)
        if held:
            try:
                host.release()
                release_ok = True
                evidence.write("execution_state_released", flags=ES_CONTINUOUS,
                               threadId=threading.get_ident())
            except Exception as error:
                failure_kind = failure_kind or type(error).__name__
                failure_details = failure_details or safe_error(error)
        signal.signal(signal.SIGINT, previous_signal)
        guard_exit_code = 70 if exit_code == 0 and (failure_kind or degraded_during_run) else exit_code
        try:
            evidence.write("guard_closed", childExitCode=exit_code, failureKind=failure_kind,
                           failureDetails=failure_details,
                           executionStateReleased=release_ok, childStillRunning=False,
                           interrupted=stop_requested, paidCallsByGuard=0, guardExitCode=guard_exit_code,
                           degradedDuringRun=degraded_during_run)
        finally:
            evidence.close()
    return guard_exit_code


def decode_command(encoded, plain):
    if encoded is not None:
        if plain:
            raise ValueError("command_sources_conflict")
        command = json.loads(base64.b64decode(encoded, validate=True).decode("utf-8"))
    else:
        command = plain[1:] if plain[:1] == ["--"] else plain
    if not isinstance(command, list) or not command or not all(isinstance(arg, str) for arg in command):
        raise ValueError("command_requires_string_array")
    if not command[0] or any("\x00" in arg for arg in command):
        raise ValueError("invalid_command_argument")
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--heartbeat-seconds", type=float, default=1.0)
    parser.add_argument("--gap-seconds", type=float, default=5.0)
    parser.add_argument("--command-base64", help="Lossless argv transport for Windows PowerShell")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    try:
        command = decode_command(args.command_base64, args.command)
        output = safe_output(root, args.output_dir)
        return run_guard(command, output, host=WindowsHost(), interval=args.heartbeat_seconds,
                         gap=args.gap_seconds, root=root)
    except Exception as error:
        print(json.dumps({"event": "guard_launch_error", **safe_error(error)}),
              file=sys.stderr)
        return 70


if __name__ == "__main__":
    sys.exit(main())
