"""Close an exactly identified, never-dispatched reservation; keep every hold.

The existing lifecycle enum ``terminated`` also represents this closed local
reservation. It does not establish provider termination: the explicit closure
kind and false provider flags distinguish cancellation from resource cleanup.
There is deliberately no CLI or automatic retry.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

PREDISPATCH_SOURCE_SHA256 = "0e7641794fcfa85c9cc4e009a3ba88b92e11454c8ba81f930e1079a9f0363d63"
MARKERS = (
    "launched.json", "heartbeat-live.json", "study-start-release.json",
    "evaluation-handoff.json", "evaluation-sequence/active.lock",
    "successor-sequence/active.lock", "managed-stages/active.lock",
)


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_new(path: Path, value) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, sort_keys=True, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def windows_owner_snapshot(tasks: list[dict]) -> dict:
    """Read actual process ancestry and Task Scheduler state without changing it."""
    script = r"""
$ErrorActionPreference = 'Stop'
$names = [Console]::In.ReadToEnd() | ConvertFrom-Json
$processes = @(Get-CimInstance Win32_Process | ForEach-Object {
    @{pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId}
})
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
$registered = @($folder.GetTasks(1))
$tasks = @($names | ForEach-Object {
    $name = $_.name
    $match = @($registered | Where-Object { $_.Name -ceq $name })
    if ($match.Count -gt 1) { throw 'Duplicate task identity' }
    if ($match.Count -eq 0) { @{name=$name; exists=$false} }
    else { @{name=$name; exists=$true; enabled=[bool]$match[0].Enabled; state=[int]$match[0].State} }
})
@{processes=$processes; tasks=$tasks} | ConvertTo-Json -Depth 5 -Compress
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        input=json.dumps(tasks), capture_output=True, text=True, timeout=30, check=True,
    )
    return json.loads(result.stdout)


def assert_stopped(snapshot: dict, pids: list[int], tasks: list[dict]) -> None:
    processes = snapshot["processes"]
    if not isinstance(processes, list) or any(
        type(row.get(key)) is not int for row in processes for key in ("pid", "parentPid")
    ):
        raise ValueError("Complete process inventory required")
    descendants = set(pids)
    while True:
        expanded = descendants | {row["pid"] for row in processes if row["parentPid"] in descendants}
        if expanded == descendants:
            break
        descendants = expanded
    if descendants & {row["pid"] for row in processes}:
        raise ValueError("An exact owner or descendant is still alive")
    observed = snapshot["tasks"]
    if len(observed) != len(tasks) or {row["name"] for row in observed} != {row["name"] for row in tasks}:
        raise ValueError("Exact scheduled-task inventory required")
    for task in tasks:
        row = next(row for row in observed if row["name"] == task["name"])
        if row.get("exists") is False and task["required"] is False:
            continue
        if row.get("exists") is not True or row.get("enabled") is not False or row.get("state") != 1:
            raise ValueError("Every existing owner task must be disabled and stopped")


class DeadLock:
    """Hold the existing Windows lock exclusively, with no unlink/create gap."""

    def __init__(self, path: Path, expected_sha: str, dead_pids: list[int]):
        self.path, self.expected_sha, self.dead_pids = path, expected_sha, dead_pids
        self.stream = None

    def __enter__(self):
        if os.name != "nt":
            raise RuntimeError("This recovery requires the Windows exclusive-handle implementation")
        import msvcrt
        from ctypes import wintypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                           wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        self.kernel.CreateFileW.restype = wintypes.HANDLE
        self.kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                         wintypes.LPVOID, wintypes.DWORD]
        self.kernel.SetFileInformationByHandle.restype = wintypes.BOOL
        self.kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                           wintypes.LPVOID, wintypes.DWORD]
        self.kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
        handle = self.kernel.CreateFileW(str(self.path), 0xC0010000, 0, None, 3, 0x00200080, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        self.stream = os.fdopen(msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY), "r+b")
        self.handle = handle
        attributes = (wintypes.DWORD * 2)()  # FILE_ATTRIBUTE_TAG_INFO, class 9.
        if not self.kernel.GetFileInformationByHandleEx(handle, 9, attributes, ctypes.sizeof(attributes)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.stream.close()
            raise error
        if attributes[0] & (0x400 | 0x10):  # Reparse point or directory.
            self.stream.close()
            raise ValueError("Lock must be an ordinary file, not a reparse point")
        original = self.stream.read()
        if (hashlib.sha256(original).hexdigest() != self.expected_sha or not original.isdigit()
                or int(original) not in self.dead_pids):
            self.stream.close()
            raise ValueError("Dead owner lock bytes changed")
        self.original = original
        return self

    def claim(self):
        self.owner = str(os.getpid()).encode()
        self.stream.seek(0)
        self.stream.write(self.owner)
        self.stream.truncate()
        self.stream.flush()
        os.fsync(self.stream.fileno())

    def release(self):
        from ctypes import wintypes
        self.stream.seek(0)
        if self.stream.read() != self.owner:
            raise ValueError("Recovery lock owner changed")
        delete = wintypes.BOOL(True)
        if not self.kernel.SetFileInformationByHandle(self.handle, 4, ctypes.byref(delete), ctypes.sizeof(delete)):
            raise ctypes.WinError(ctypes.get_last_error())

    def __exit__(self, *_):
        self.stream.close()  # A failed operation deliberately retains the claimed lock.


def cancel(request: dict, client, *, validate_ledger, owner_snapshot=windows_owner_snapshot,
           clock=time.time) -> dict:
    """Apply one reviewed cancellation using only provider GET and local state.

    ``validate_ledger`` must be the current controller's checked_bound_ledger.
    ``client`` must implement lambda_gpu_watchdog.Provider's raw envelope API
    (GET /instances returns {"data": [...]}), not control.LambdaClient's API.
    External probes are injectable for deterministic tests, not inferred from a
    prior receipt. A claim or ambiguous failure requires manual reconciliation.
    """
    if request.get("version") != 1 or request.get("kind") != "acephale-cancel-unlaunched-request-v1":
        raise ValueError("Explicit cancellation request required")
    ledger_path, run = Path(request["ledgerPath"]), Path(request["runDirectory"])
    reserved_path, stopped_path = Path(request["reservedReceiptPath"]), Path(request["stoppedReceiptPath"])
    output = Path(request["outputDirectory"])
    pids, tasks = request["stoppedProcessIds"], request["tasks"]
    if (not pids or len(set(pids)) != len(pids) or any(type(pid) is not int or pid <= 0 for pid in pids)
            or not tasks or len({row["name"] for row in tasks}) != len(tasks)
            or not any(row.get("required") is True for row in tasks)
            or any(type(row.get("required")) is not bool or not row.get("name", "").startswith("Acephale-") for row in tasks)):
        raise ValueError("Exact stopped owners and scheduled tasks required")
    if reserved_path.resolve() != (run / "reserved.json").resolve():
        raise ValueError("Reservation must come from the exact run")
    pins = {ledger_path: request["ledgerSha256"], reserved_path: request["reservedReceiptSha256"],
            stopped_path: request["stoppedReceiptSha256"], Path(request["predispatchSourcePath"]): PREDISPATCH_SOURCE_SHA256}
    for row in request["financialFiles"]:
        path = Path(row["path"])
        if path in pins:
            raise ValueError("Duplicate financial input")
        pins[path] = row["sha256"]

    financial_paths, journal = None, None

    def unchanged():
        if any(path.is_symlink() or not path.is_file() or sha(path) != expected for path, expected in pins.items()):
            raise ValueError("A pinned input changed")
        if financial_paths is not None:
            current = {journal, *journal.parent.glob(journal.name + ".*.json"),
                       *ledger_path.parent.glob(ledger_path.name + ".*.json")}
            if not {path.resolve() for path in current}.issubset(financial_paths):
                raise ValueError("A new unpinned authority sidecar appeared")
        if any((run / marker).exists() for marker in MARKERS) or next(run.rglob("*.dispatch.json"), None):
            raise ValueError("A launch or scientific dispatch marker exists")

    unchanged()
    reserved, stopped = read(reserved_path), read(stopped_path)
    ledger = validate_ledger(ledger_path)
    matches = [row for row in ledger["leases"] if row["id"] == request["leaseId"]]
    if (len(matches) != 1 or matches[0] != reserved or reserved.get("status") != "reserved"
            or reserved.get("instanceId") is not None or not reserved.get("studyReservation")
            or reserved.get("ready") is not False or "watchdogs" in reserved):
        raise ValueError("Only an exact funded, unattempted reservation can be cancelled")
    financial_paths = {Path(row["path"]).resolve() for row in request["financialFiles"]}
    journal = Path(ledger["plan"]["studyLedgerPath"])
    required_financial = {journal, *journal.parent.glob(journal.name + ".*.json"),
                          *ledger_path.parent.glob(ledger_path.name + ".*.json")}
    if not {path.resolve() for path in required_financial}.issubset(financial_paths):
        raise ValueError("Original journal and every authority sidecar must remain pinned")
    lock_path = ledger_path.with_name(ledger_path.name + ".lock")
    if (stopped.get("kind") != "acephale-stopped-predispatch-reservation-v1"
            or stopped.get("leaseId") != reserved["id"] or stopped.get("expectedName") != reserved["name"]
            or stopped.get("instanceId") is not None or stopped.get("ledgerStatus") != "reserved"
            or stopped.get("infrastructureSliceSha256") != request["ledgerSha256"]
            or stopped.get("reservedReceiptSha256") != request["reservedReceiptSha256"]
            or stopped.get("stoppedProcessIds") != pids or stopped.get("exactProcessesAndChildrenAbsent") is not True
            or stopped.get("originalStateTransitionRequiresLaunchingBeforeProviderPost") is not True
            or stopped.get("deadline") != reserved["deadline"] or stopped.get("exactProviderMatches") != 0
            or stopped.get("financialMutationPerformed") is not False
            or stopped.get("providerMutationPerformed") is not False
            or stopped.get("providerTerminationClaimed") is not False
            or Path(stopped["crashLockPath"]).resolve() != lock_path.resolve()):
        raise ValueError("Retained stop evidence does not identify this exact reservation")

    def observe():
        local = owner_snapshot(tasks)
        assert_stopped(local, pids, tasks)
        inventory = client.request("GET", "/instances")
        if not isinstance(inventory, dict) or not isinstance(inventory.get("data"), list):
            raise TypeError("Actual provider inventory required")
        if any(not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]
               or not isinstance(row.get("name"), str) or not row["name"]
               or row["name"] == reserved["name"] for row in inventory["data"]):
            raise ValueError("The exact provider name is present or inventory is malformed")
        return {"observedAt": clock(), "ownerSnapshot": local, "providerInventory": inventory}

    initial = observe()
    unchanged()
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "claim.json", {"kind": "acephale-cancel-unlaunched-claim-v1", "leaseId": reserved["id"],
                                      "request": request, "createdAt": clock()})
    with DeadLock(lock_path, stopped["crashLockSha256"], pids) as lock:
        # Recheck process death while the exact original lock is exclusively held.
        assert_stopped(owner_snapshot(tasks), pids, tasks)
        unchanged()
        (output / "dead-owner-lock.original").write_bytes(lock.original)
        lock.claim()
        final = observe()
        unchanged()
        evidence = {"kind": "acephale-undispatched-cancellation-evidence-v1", "leaseId": reserved["id"],
                    "initial": initial, "final": final, "originalLedgerSha256": request["ledgerSha256"],
                    "providerDispatchOccurred": False, "providerTerminationVerified": False,
                    "financialReservationsRetained": True, "originalDeadlinesRetained": True}
        write_new(output / "evidence.json", evidence)
        closed = {**reserved, "status": "terminated", "closureKind": "cancelled_before_provider_dispatch",
                  "providerDispatchOccurred": False, "providerTerminationVerified": False,
                  "cancellationVerifiedAt": clock(), "closureEvidenceHash": sha(output / "evidence.json")}
        changed = {**ledger, "leases": [closed if row["id"] == reserved["id"] else row for row in ledger["leases"]]}
        staging = output / "closed-ledger.json"
        write_new(staging, changed)
        unchanged()
        os.replace(staging, ledger_path)
        if read(ledger_path) != changed or any(sha(Path(row["path"])) != row["sha256"] for row in request["financialFiles"]):
            raise ValueError("Cancellation result requires manual reconciliation")
        receipt = {"kind": "acephale-cancel-unlaunched-result-v1", "leaseId": reserved["id"],
                   "lifecycleStatus": "terminated", "closureKind": closed["closureKind"],
                   "providerDispatchOccurred": False, "providerTerminationVerified": False,
                   "financialReservationsRetained": True, "originalDeadlinesRetained": True,
                   "infrastructureSliceSha256": sha(ledger_path), "evidenceSha256": closed["closureEvidenceHash"]}
        lock.release()
    write_new(output / "result.json", {**receipt, "deadOwnerLockRemoved": True})
    return receipt
