"""Read-only EC2 host observations; never authorizes science or vendor spend."""
from __future__ import annotations
import argparse, csv, hashlib, importlib.util, json, math, os, signal, subprocess, time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
GUARD = Path("/REQUIRED_BINDINGS/research-root/workspaces/operator/science-source/research/acephale/scripts/local_run_guard.py")
GUARD_SHA = "917ef050de248ce1eda9c6a5ffe77ee301a650434fb3950ae38c6bef46b21fde"
NVIDIA = "/usr/bin/nvidia-smi"

def require(ok, reason):
    if not ok: raise ValueError(reason)

def positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0

def checked(reference):
    p = Path(reference["path"])
    require(p.is_absolute() and ".." not in p.parts and p.is_file(), "regular_absolute_file")
    require(not any(x.is_symlink() for x in (p, *p.parents)), "symlink_refused")
    st = p.stat()
    require(st.st_uid == 0 and not st.st_mode & 0o022, "root_owned_nonwritable_input")
    b = p.read_bytes()
    require(hashlib.sha256(b).hexdigest() == reference["sha256"], "file_hash_changed")
    return b

def heartbeat_class():
    checked({"path": str(GUARD), "sha256": GUARD_SHA})
    spec = importlib.util.spec_from_file_location("frozen_original_local_guard", GUARD)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.Heartbeat

def validate_config(c):
    require(c.get("kind") == "acephale-ec2-local-health-v1", "configuration_kind")
    require(type(c.get("resourceAttemptId")) is str and c["resourceAttemptId"], "resource_identity")
    require(type(c.get("instanceId")) is str and c["instanceId"].startswith("i-")
            and c.get("region") in ("us-east-1", "us-east-2", "us-west-2")
            and type(c.get("slotKey")) is str and c["slotKey"]
            and type(c.get("configurationSha256")) is str and len(c["configurationSha256"]) == 64
            and positive(c.get("hardDeadline")), "ec2_bound_identity")
    require(set(c["roles"]) == {"actor", "predictor"}, "both_model_roles_required")
    for role in c["roles"].values():
        u = urlsplit(role["healthUrl"])
        require(u.scheme == "http" and u.hostname == "127.0.0.1" and u.port
                and not u.username and not u.password and u.path == "/health"
                and not u.query and not u.fragment, "local_health_get_only")
        require(type(role["gpuWorkers"]) is list and role["gpuWorkers"], "gpu_workers_required")
        for item in [role["server"], *role["gpuWorkers"]]:
            require(type(item["pid"]) is int and item["pid"] > 1
                    and type(item["startTicks"]) is int and item["startTicks"] > 0, "observed_process_binding")
        for item in role["gpuWorkers"]:
            require(type(item["gpuUuid"]) is str and item["gpuUuid"].startswith("GPU-"), "exact_gpu_uuid")
    for key in ("outputDirectory", "stopFile"):
        p = Path(c[key]); require(p.is_absolute() and ".." not in p.parts, "absolute_output_and_stop")
        require(not any(x.is_symlink() for x in (p, *p.parents)), "symlink_output_refused")
    require(Path(c["stopFile"]) != Path(c["outputDirectory"]), "distinct_stop_file")

DMI = Path("/sys/devices/virtual/dmi/id/board_asset_tag")

def ec2_identity():
    return DMI.read_text().strip()

def lease_value(c, value, allocation, bootstrap, host_id, now):
    require(value.get("kind") == "acephale-corrective-ec2-observation-lease-v1", "fresh_lease_kind")
    require(value.get("observationOnly") is True, "observation_only_lease")
    require(all(value.get(k) == c[k] for k in ("resourceAttemptId","instanceId","region","slotKey","configurationSha256","hardDeadline")), "lease_configuration_identity")
    row = value["resource"]
    require(row.get("attemptId") == c["resourceAttemptId"] and row.get("pk") == "resource#"+c["resourceAttemptId"]
            and row.get("evidence",{}).get("instanceId") == c["instanceId"] == host_id
            and row.get("region") == c["region"] and row.get("slotKey") == c["slotKey"]
            and row.get("configSha256") == c["configurationSha256"], "actual_allocation_identity")
    require(row.get("providerService") == "ec2" and row.get("status") == "launch-returned"
            and row.get("evidence",{}).get("reservationReleased") is False, "actual_retained_allocation")
    require(value["allocationConfiguration"]["sha256"] == c["configurationSha256"]
            and allocation.get("region") == c["region"] and allocation.get("providerService") == "ec2",
            "allocation_configuration_binding")
    require(bootstrap.get("kind") == "acephale-corrective-worker-bootstrap-ready-v1"
            and bootstrap.get("instanceId") == c["instanceId"]
            and bootstrap.get("resourceAttemptId") == c["resourceAttemptId"]
            and bootstrap.get("configSha256") == c["configurationSha256"]
            and bootstrap.get("region") == c["region"]
            and bootstrap.get("imageId") == allocation.get("ami"), "actual_bootstrap_binding")
    deadline = c["hardDeadline"]
    require(positive(deadline) and now < deadline <= 1795413600
            and deadline == row.get("deadline") == row.get("bootstrapDeadline")
            and deadline == allocation.get("hardDeadline") == bootstrap.get("hardDeadline"),
            "lease_expired_or_invalid")
    return deadline

def lease(c, now):
    value=json.loads(checked(c["leaseFile"]))
    allocation=json.loads(checked(value["allocationConfiguration"]))
    bootstrap=json.loads(checked(value["bootstrapReady"]))
    return lease_value(c,value,allocation,bootstrap,ec2_identity(),now)


def parse_process(text, expected):
    # /proc/<pid>/stat comm may contain spaces and ')'.
    head, rest = text.rsplit(")", 1); fields = rest.split()
    require(int(head.split(" ", 1)[0]) == expected["pid"], "process_identity")
    require(len(fields) > 19 and fields[0] not in ("Z", "X", "x"), "process_not_running")
    require(int(fields[19]) == expected["startTicks"], "process_reused")
    return {"pid": expected["pid"], "startTicks": int(fields[19]), "state": fields[0], "parentPid": int(fields[1])}

def process_ancestry(worker, server, read_stat):
    pid = worker["pid"]; seen = set(); chain = []
    for _ in range(32):
        require(pid > 1 and pid not in seen, "gpu_worker_not_descended_from_server")
        seen.add(pid); text = read_stat(pid)
        head, tail = text.rsplit(")", 1); fields = tail.split()
        require(len(fields) > 19, "malformed_process_stat")
        observed = {"pid": int(head.split(" ", 1)[0]), "startTicks": int(fields[19])}
        expected = worker if pid == worker["pid"] else server if pid == server["pid"] else observed
        row = parse_process(text, expected); chain.append(row)
        if row["pid"] == server["pid"]: return chain
        pid = row["parentPid"]
    raise ValueError("process_ancestry_too_deep")

def parse_gpu(text):
    result = set()
    for row in csv.reader(text.splitlines()):
        if not row: continue
        require(len(row) == 2 and row[0].strip().isdigit() and row[1].strip().startswith("GPU-"), "malformed_gpu_observation")
        result.add((int(row[0]), row[1].strip()))
    require(result, "no_gpu_processes_observed")
    return result

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("health_redirect_refused")

class Host:
    def health(self, url):
        with build_opener(NoRedirect()).open(Request(url, method="GET"), timeout=0.35) as r:
            return r.status
    def process(self, expected):
        return parse_process(Path("/proc", str(expected["pid"]), "stat").read_text(), expected)
    def ancestry(self, worker, server):
        return process_ancestry(worker, server, lambda pid: Path("/proc", str(pid), "stat").read_text())
    def gpu(self):
        r = subprocess.run([NVIDIA, "--query-compute-apps=pid,gpu_uuid", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=0.65, check=True)
        return parse_gpu(r.stdout)

    def relay(self,expected):
        self.process(expected)
        command=Path("/proc",str(expected["pid"]),"cmdline").read_bytes().decode().rstrip("\x00").split("\x00")
        require(command==expected["command"],"relay_command_changed")
        require(Path("/proc",str(expected["pid"]),"exe").resolve()==Path("/usr/bin/socat").resolve(),"relay_executable_changed")
        require(hashlib.sha256(Path("/usr/bin/socat").read_bytes()).hexdigest()==expected["socatSha256"],"relay_binary_changed")
        return {"pid":expected["pid"],"startTicks":expected["startTicks"],"sameCommand":True}

    def network(self):
        # Actual local OS route/link state; not a claim of external API reachability.
        for line in Path("/proc/net/route").read_text().splitlines()[1:]:
            f = line.split()
            if len(f) >= 4 and f[1] == "00000000" and int(f[3], 16) & 1:
                name = f[0]
                if name != "lo" and Path("/sys/class/net", name, "operstate").read_text().strip() == "up":
                    return {"connected": True, "source": "linux_default_route_and_link", "destinationReachabilityVerified": False}
        return {"connected": False, "source": "linux_default_route_and_link", "destinationReachabilityVerified": False}

def observations(c, host, now):
    reasons = []; evidence = {"endpoints": {}, "processes": {}, "gpuProcesses": []}
    try: evidence["leaseDeadline"] = lease(c, now)
    except Exception as e: reasons.append("lease_unavailable:" + type(e).__name__)
    try: network = host.network(); require(type(network.get("connected")) is bool, "network_observation")
    except Exception as e: network = {"connected": False, "source": "unavailable"}; reasons.append("network_unavailable:" + type(e).__name__)
    try: gpus = host.gpu()
    except Exception as e: gpus = set(); reasons.append("gpu_unavailable:" + type(e).__name__)
    for name, relay in c.get("loopbackRelays", {}).items():
        try: evidence.setdefault("loopbackRelays", {})[name] = host.relay(relay)
        except Exception as e: reasons.append(name + "_relay_down:" + type(e).__name__)
    for name, role in c["roles"].items():
        try:
            status = host.health(role["healthUrl"]); evidence["endpoints"][name] = {"httpStatus": status}
            require(type(status) is int and status == 200, "health_not_200")
        except Exception as e: reasons.append(name + "_health_down:" + type(e).__name__)
        for position, item in enumerate([role["server"], *role["gpuWorkers"]]):
            key = name + ":" + str(position)
            try: evidence["processes"][key] = host.process(item)
            except Exception as e: reasons.append(key + "_process_down:" + type(e).__name__)
        for item in role["gpuWorkers"]:
            present = (item["pid"], item["gpuUuid"]) in gpus
            observation = {"role": name, "pid": item["pid"], "gpuUuid": item["gpuUuid"], "observed": present}
            try: observation["processAncestry"] = host.ancestry(item, role["server"])
            except Exception as e: reasons.append(name + "_gpu_ancestry_unavailable:" + type(e).__name__)
            evidence["gpuProcesses"].append(observation)
            if not present: reasons.append(name + "_gpu_process_absent")
    return network, reasons, evidence

def make_status(heartbeat, c, host, *, clock=time.time_ns, monotonic=time.monotonic_ns):
    started = clock(); network, reasons, evidence = observations(c, host, started / 1e9)
    finished = clock()
    if finished - started > 2_000_000_000 or finished < started: reasons.append("observation_span_invalid")
    if finished / 1e9 >= evidence.get("leaseDeadline", 0): reasons.append("lease_expired")
    status = heartbeat.sample(finished, monotonic(), network, "local_observation_failed" if reasons else None)
    status.update({"kind": "acephale-ec2-local-health-v1", "resourceAttemptId": c["resourceAttemptId"],
                   "sampleStartedAtUnixMs": started / 1e6, "observations": evidence, "currentFailureReasons": reasons,
                   "qualificationClaimed": False, "scientificDispatchAuthorized": False, "vendorFundingAuthorized": False})
    return status

def publish(directory, status):
    number = status["heartbeatSequence"]
    require(type(number) is int and 0 < number < 10**16, "heartbeat_sequence")
    tmp = directory / f"{number:016d}.next"; target = directory / f"{number:016d}.json"
    b = (json.dumps(status, sort_keys=True, allow_nan=False) + "\n").encode()
    with tmp.open("xb") as f: f.write(b); f.flush(); os.fsync(f.fileno())
    os.link(tmp, target)  # Atomic complete publication, refuses an existing sequence.
    tmp.unlink()
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--configuration", required=True); parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    c = json.loads(checked({"path": args.configuration, "sha256": args.sha256}))
    validate_config(c); deadline = lease(c, time.time())
    Heartbeat = heartbeat_class(); heartbeat = Heartbeat(gap_seconds=5.0, max_status_age_ms=3000)
    output = Path(c["outputDirectory"]); output.mkdir(exist_ok=False)
    stopped = [False]
    def stop(*_): stopped[0] = True
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    host = Host()
    try:
        while not stopped[0] and not Path(c["stopFile"]).exists() and time.time() < deadline:
            tick = time.monotonic()
            status = make_status(heartbeat, c, host)
            if stopped[0] or Path(c["stopFile"]).exists():
                status = heartbeat.sample(time.time_ns(), time.monotonic_ns(), {"connected": False}, "owner_stop")
            publish(output, status)
            time.sleep(max(0, 1.0 - (time.monotonic() - tick)))
    finally:
        status = heartbeat.sample(time.time_ns(), time.monotonic_ns(), {"connected": False}, "sampler_stopped")
        status.update({"resourceAttemptId": c["resourceAttemptId"], "qualificationClaimed": False,
                       "scientificDispatchAuthorized": False, "vendorFundingAuthorized": False})
        publish(output, status)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
