"""Fresh host metadata binding and managed observation child; no science dispatch."""
from __future__ import annotations
import argparse, ast, copy, hashlib, importlib.util, json, math, os, re, signal
import subprocess, time
from pathlib import Path

ALLOWED_SAMPLERS = {
 "bff1975170a737c3fb3d8a07bfb781aeee322e4729d95da5a5beb4fcc4cb4806": "acephale-ec2-local-health-v1",
 "6c7e18d5e132ad40e09e838b2411ad29ab3826142247cbbc41559deb11265c06": "acephale-notebook-local-health-v1",
 "9ed1283e06d4bf520a50a6058c86880b77e33e4958221e59521dd8aa0f6b9656": "acephale-ec2-local-health-v1",
}
CONSUMER = Path("/REQUIRED_BINDINGS/research-root/workspaces/operator/science-source/research/acephale/src/acephale/native_common.py")
CONSUMER_SHA = "f987a03bf4bb352c17ff4e677aaafc0e4216efa18344cc12a1c1c3bd1dea1cd8"
DOCKER = "/usr/bin/docker"
PYTHON = "/usr/bin/python3"
CLEAN_ENV = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
             "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1"}

def need(ok, reason):
    if not ok: raise ValueError(reason)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def checked(ref):
    p = Path(ref["path"])
    need(p.is_absolute() and ".." not in p.parts and p.is_file(), "absolute_regular_input")
    need(not any(x.is_symlink() for x in (p, *p.parents)), "input_symlink")
    st = p.stat()
    need(st.st_uid == 0 and not st.st_mode & 0o022 and st.st_size <= 16_000_000,
         "root_owned_bounded_input")
    raw = p.read_bytes()
    need(digest(raw) == ref["sha256"], "input_hash")
    if "bytes" in ref: need(len(raw) == ref["bytes"], "input_size")
    return raw

def file_ref(p):
    raw = p.read_bytes()
    return {"path": str(p), "sha256": digest(raw), "bytes": len(raw)}

def new_json(p, value):
    raw = (json.dumps(value, sort_keys=True, allow_nan=False, indent=2) + "\n").encode()
    temp = p.with_name(p.name + ".next")
    with temp.open("xb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    os.link(temp, p); temp.unlink()
    fd = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
    return file_ref(p)

def load_sampler(ref):
    need(ref["sha256"] in ALLOWED_SAMPLERS, "unsupported_sampler_source")
    checked(ref)
    spec = importlib.util.spec_from_file_location("bound_sampler_" + ref["sha256"], ref["path"])
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def load_consumer():
    raw = checked({"path": str(CONSUMER), "sha256": CONSUMER_SHA})
    node = next(x for x in ast.parse(raw).body
                if isinstance(x, ast.FunctionDef) and x.name == "observe_host_health")
    ns = dict(Path=Path, json=json, os=os, time=time, math=math, re=re, hashlib=hashlib)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(CONSUMER), "exec"), ns)
    return ns["observe_host_health"]

class LocalHost:
    def command(self, argv, timeout=3):
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                           env=CLEAN_ENV, stdin=subprocess.DEVNULL)
        need(r.returncode == 0, "metadata_command_failed")
        need(len(r.stdout) <= 2_000_000, "metadata_output_bound")
        return r.stdout

    def containers(self):
        ids = self.command([DOCKER, "ps", "--quiet", "--no-trunc"]).split()
        need(len(ids) <= 128, "container_inventory_bound")
        return [self.container(cid) for cid in ids]

    def container(self, cid):
        need(re.fullmatch("[a-f0-9]{64}", cid) is not None, "container_id")
        # Selected fields only. Docker Config.Env is neither read nor logged.
        fmt = ('{"id":{{json .Id}},"imageId":{{json .Image}},'
               '"pid":{{.State.Pid}},"running":{{.State.Running}},'
               '"paused":{{.State.Paused}},"restarting":{{.State.Restarting}},'
               '"startedAt":{{json .State.StartedAt}},'
               '"networkMode":{{json .HostConfig.NetworkMode}},'
               '"ports":{{json .NetworkSettings.Ports}}}')
        row = json.loads(self.command([DOCKER, "inspect", "--format", fmt, cid]))
        need(row.get("id") == cid, "container_identity")
        return row

    def stat(self, pid):
        need(type(pid) is int and pid > 1, "process_pid")
        return Path("/proc", str(pid), "stat").read_text()

    def listeners(self, port):
        text = self.command(["/usr/bin/ss", "-H", "-ltnp", "sport = :" + str(port)])
        pids = sorted({int(x) for x in re.findall(r"pid=(\d+)", text)})
        need(pids, "no_owned_listening_process")
        return pids

    def container_addresses(self,cid):
        value=json.loads(self.command([DOCKER,"inspect","--format","{{json .NetworkSettings.Networks}}",cid]))
        return sorted({r["IPAddress"] for r in value.values() if r.get("IPAddress")})
    def unit_pid(self,unit):
        need(re.fullmatch(r"[a-zA-Z0-9_.@-]+",unit) is not None,"literal_relay_unit")
        return int(self.command(["/usr/bin/systemctl","show",unit,"--property=MainPID","--value"]).strip())
    def process_command(self,pid):
        return Path("/proc",str(pid),"cmdline").read_bytes().decode().rstrip("\x00").split("\x00")
    def binary_sha(self,path):
        return digest(Path(path).read_bytes())

def process(host, sampler, pid):
    text = host.stat(pid)
    head, tail = text.rsplit(")", 1); fields = tail.split()
    need(len(fields) > 19 and int(head.split(" ", 1)[0]) == pid, "process_stat")
    return sampler.parse_process(text, {"pid": pid, "startTicks": int(fields[19])})

def running(row):
    return (row.get("running") is True and row.get("paused") is False
            and row.get("restarting") is False and type(row.get("pid")) is int
            and row["pid"] > 1 and type(row.get("startedAt")) is str)

def published(row, port):
    return any(type(binding) is dict
               and binding.get("HostPort") == str(port)
               and binding.get("HostIp", "") in ("", "0.0.0.0", "127.0.0.1", "::", "::1")
               for key, bindings in (row.get("ports") or {}).items()
               if key.endswith("/tcp") for binding in (bindings or []))

def select_container(host, sampler, rows, port):
    matches = [(row, "docker-published-port", []) for row in rows if running(row) and published(row, port)]
    if not matches:
        host_rows = [row for row in rows if running(row) and row.get("networkMode") == "host"]
        if host_rows:
            listeners = host.listeners(port)
            for row in host_rows:
                server = process(host, sampler, row["pid"])
                try:
                    for pid in listeners:
                        sampler.process_ancestry(process(host, sampler, pid), server, host.stat)
                except (ValueError, OSError): continue
                matches.append((row, "host-network-listener-ancestry", listeners))
    need(len(matches) == 1, "ambiguous_or_missing_model_container")
    return matches[0]

def relay_configuration(host, sampler, rows, receipt, config, role, port):
    need(receipt.get("schemaVersion")==1 and receipt.get("leaseId")==config["resourceAttemptId"]
         and receipt.get("deadline")==config["hardDeadline"], "relay_receipt_lease")
    matches=[x for x in receipt.get("relays",[]) if x.get("service")==role]
    need(len(matches)==1, "unique_role_relay")
    r=matches[0]
    need(r.get("mode")=="systemd-socat-loopback" and r.get("listenAddress")=="127.0.0.1"
         and r.get("listenPort")==port and r.get("targetPort")==8000, "exact_local_model_relay")
    containers=[x for x in rows if running(x) and x["id"]==r.get("containerId")]
    need(len(containers)==1, "current_relay_container")
    row=containers[0];address=r["address"]
    need(address in host.container_addresses(row["id"]), "relay_actual_container_address")
    need(type(r.get("pid")) is int and r["pid"]>1 and isinstance(r.get("unit"),str), "relay_process")
    need(host.unit_pid(r["unit"])==r["pid"] and r["pid"] in host.listeners(port), "relay_unit_listener_identity")
    p=process(host,sampler,r["pid"])
    expected=["/usr/bin/socat",f"TCP4-LISTEN:{port},bind=127.0.0.1,reuseaddr,fork",f"TCP4:{address}:8000"]
    need(host.process_command(r["pid"])==expected, "relay_exact_command")
    need(host.binary_sha("/usr/bin/socat")==receipt["socatSha256"], "relay_binary")
    observed={"pid":p["pid"],"startTicks":p["startTicks"],"command":expected,
              "socatSha256":receipt["socatSha256"],"unit":r["unit"],"containerId":row["id"]}
    return row,observed

def stable(host, sampler, observations):
    for row in observations.values():
        current = host.container(row["containerId"])
        expected = row["containerObservation"]
        need(current == expected and running(current), "container_restarted_or_mapping_changed")
        if row.get("relay"):
            relay = row["relay"]
            sampler.parse_process(host.stat(relay["pid"]), relay)
            need(host.process_command(relay["pid"]) == relay["command"] and
                 host.unit_pid(relay["unit"]) == relay["pid"], "relay_restarted_or_changed")
        sampler.parse_process(host.stat(row["server"]["pid"]), row["server"])
        for worker in row["gpuWorkers"]:
            sampler.process_ancestry(worker, row["server"], host.stat)

def bind_configuration(inputs, sampler, host):
    config = json.loads(checked(inputs["configurationTemplate"]))
    need(config.get("kind") == ALLOWED_SAMPLERS[inputs["sampler"]["sha256"]], "template_sampler_kind")
    ports = inputs["rolePorts"]
    need(set(ports) == {"actor", "predictor"} and
         all(type(p) is int and 1 <= p <= 65535 for p in ports.values())
         and len(set(ports.values())) == 2, "distinct_role_ports")
    need(set(config["roles"]) == {"actor", "predictor"}, "template_roles")
    before = copy.deepcopy(config)
    rows = host.containers()
    need(len({r["id"] for r in rows}) == len(rows), "duplicate_container")
    gpu_pairs = sampler.Host().gpu() if not hasattr(host, "gpu") else host.gpu()
    need(gpu_pairs, "no_gpu_processes")
    observations = {}
    for role in ("actor", "predictor"):
        need(config["roles"][role]["healthUrl"] ==
             "http://127.0.0.1:" + str(ports[role]) + "/health", "template_health_port")
        relay = None
        if inputs.get("relayReceipt"):
            receipt = json.loads(checked(inputs["relayReceipt"]))
            declared = [r for r in receipt.get("relays", []) if r.get("service") == role]
            if len(declared) == 1 and declared[0].get("mode") == "systemd-socat-loopback":
                row, relay = relay_configuration(host, sampler, rows, receipt, config, role, ports[role])
                method, listeners = "original-source-bound-loopback-relay", [relay["pid"]]
            else:
                row, method, listeners = select_container(host, sampler, rows, ports[role])
        else:
            row, method, listeners = select_container(host, sampler, rows, ports[role])
        if relay is not None:
            config.setdefault("loopbackRelays", {})[role] = relay
        server = process(host, sampler, row["pid"])
        server = {k: server[k] for k in ("pid", "startTicks")}
        workers = []
        ancestry = []
        for pid, gpu_uuid in sorted(gpu_pairs):
            try:
                worker = process(host, sampler, pid)
                worker = {k: worker[k] for k in ("pid", "startTicks")}
                chain = sampler.process_ancestry(worker, server, host.stat)
            except (ValueError, OSError): continue
            workers.append(dict(worker, gpuUuid=gpu_uuid)); ancestry.append(chain)
        need(workers, "no_descendant_gpu_worker")
        config["roles"][role]["server"] = server
        config["roles"][role]["gpuWorkers"] = workers
        observations[role] = {"containerId": row["id"], "imageId": row["imageId"],
                             "containerObservation": row, "server": server,
                             "gpuWorkers": workers, "ancestry": ancestry,
                             "discoveryMethod": method, "listenerPids": listeners, "relay": relay}
    need(observations["actor"]["containerId"] != observations["predictor"]["containerId"],
         "distinct_role_containers")
    need(not ({x["pid"] for x in observations["actor"]["gpuWorkers"]} &
              {x["pid"] for x in observations["predictor"]["gpuWorkers"]}), "distinct_gpu_workers")
    output = Path(inputs["outputRoot"])
    config["outputDirectory"] = str(output / "heartbeat")
    config["stopFile"] = str(output / "STOP")
    # Only the promised operational fields may differ from the supplied template.
    restored = copy.deepcopy(config)
    for role in ("actor", "predictor"):
        for key in ("server", "gpuWorkers"): restored["roles"][role][key] = before["roles"][role][key]
    for key in ("outputDirectory", "stopFile"): restored[key] = before[key]
    if "loopbackRelays" in before: restored["loopbackRelays"] = before["loopbackRelays"]
    else: restored.pop("loopbackRelays", None)
    need(restored == before, "undeclared_template_change")
    sampler.validate_config(config)
    deadline = sampler.lease(config, time.time())
    sampler.heartbeat_class()
    stable(host, sampler, observations)
    return config, observations, deadline

class ObservationHandle:
    def __init__(self, root, process, source, config, observations, deadline, stdout, stderr):
        self.root, self.process, self.source, self.config = root, process, source, config
        self.observations, self.deadline = observations, deadline
        self._streams = (stdout, stderr)
        self.descriptor = None
        self.stop_result = None
    def __enter__(self): return self
    def __exit__(self, *_): stop_observation(self)

def group_members(group):
    result = []
    for p in Path("/proc").iterdir():
        if not p.name.isdigit(): continue
        try:
            fields = (p / "stat").read_text().rsplit(")", 1)[1].split()
            if int(fields[2]) == group and int(fields[3]) == group:
                result.append(int(p.name))
        except (OSError, ValueError, IndexError): continue
    return result

def stop_observation(handle):
    need(isinstance(handle, ObservationHandle), "own_observation_handle_required")
    if handle.stop_result is not None: return handle.stop_result
    proc = handle.process
    forced = False
    if proc.poll() is None:
        try: proc.terminate()
        except ProcessLookupError: pass
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            forced = True
            # Popen child remains unreaped, so this PID cannot have been reused.
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.wait(timeout=5)
    members = group_members(proc.pid)
    for stream in handle._streams: stream.close()
    result = {"kind": "acephale-host-observation-stop-v1", "samplerPid": proc.pid,
              "exitCode": proc.returncode, "forcedKill": forced,
              "ownedProcessGroupRemaining": members, "ownedSamplerDrained": not members,
              "stoppedAtUnixMs": time.time_ns() / 1e6, "modelProcessesSignaled": False,
              "scientificAcceptanceAsserted": False}
    new_json(handle.root / "STOPPED.json", result)
    handle.stop_result = result
    need(not members, "own_sampler_group_not_drained")
    return result

def _start(inputs, host, popen, consumer):
    need(inputs.get("kind") == "acephale-host-observation-binding-inputs-v1", "inputs_kind")
    sampler = load_sampler(inputs["sampler"])
    root = Path(inputs["outputRoot"])
    need(root.is_absolute() and ".." not in root.parts and root.parent.is_dir()
         and not root.exists(), "new_absolute_output_root")
    need(not any(p.is_symlink() for p in (root, *root.parents)), "output_symlink")
    st = root.parent.stat()
    need(st.st_uid == 0 and not st.st_mode & 0o022, "root_owned_output_parent")
    config, observations, deadline = bind_configuration(inputs, sampler, host)
    root.mkdir(mode=0o700)
    fd = os.open(root.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
    new_json(root / "INPUTS.json", inputs)
    config_ref = new_json(root / "configuration.json", config)
    discovery_ref = new_json(root / "discovery.json", {
        "kind": "acephale-live-host-observation-binding-v1",
        "observedAtUnixMs": time.time_ns() / 1e6, "roles": observations,
        "sampler": inputs["sampler"], "template": inputs["configurationTemplate"],
        "leaseDeadline": deadline, "historicalPidsUsed": False,
        "modelRequestsPerformed": False, "dockerEnvironmentRead": False})
    checked(inputs["sampler"]); checked(inputs["configurationTemplate"])
    sampler.lease(config, time.time()); stable(host, sampler, observations)
    stdout = (root / "sampler.stdout").open("xb"); stderr = (root / "sampler.stderr").open("xb")
    try:
        proc = popen([PYTHON, "-I", "-B", inputs["sampler"]["path"],
                      "--configuration", config_ref["path"], "--sha256", config_ref["sha256"]],
                     cwd=str(root), env=dict(CLEAN_ENV), stdin=subprocess.DEVNULL,
                     stdout=stdout, stderr=stderr, start_new_session=True)
    except BaseException:
        stdout.close(); stderr.close(); raise
    handle = ObservationHandle(root, proc, inputs["sampler"], config_ref,
                               observations, deadline, stdout, stderr)
    try:
        wait_deadline = time.monotonic() + min(15, max(0, deadline - time.time()))
        first = None
        while time.monotonic() < wait_deadline:
            need(proc.poll() is None, "sampler_exited_before_ready")
            sample = consumer("before_native", status_path=config["outputDirectory"])
            if sample.get("healthy") is True:
                stable(host, sampler, observations)
                sampler.lease(config, time.time())
                first = sample; break
            if Path(config["outputDirectory"]).exists() and list(Path(config["outputDirectory"]).glob("*.json")):
                raise ValueError("first_heartbeat_unhealthy")
            time.sleep(0.1)
        need(first is not None, "fresh_healthy_heartbeat_timeout")
        descriptor = {"kind": "acephale-managed-host-observation-ready-v1",
                      "sampler": inputs["sampler"], "configuration": config_ref,
                      "discovery": discovery_ref, "samplerPid": proc.pid,
                      "environmentAppend": {"ACEPHALE_HOST_STATUS_FILE": config["outputDirectory"]},
                      "existingEnvironmentPreserved": True, "firstActualHealthySample": first,
                      "hardDeadline": deadline, "qualificationAsserted": False,
                      "scientificDispatchAuthorized": False, "vendorFundingAuthorized": False,
                      "readyAtUnixMs": time.time_ns() / 1e6}
        new_json(root / "READY.json", descriptor)
        handle.descriptor = descriptor
        return handle
    except BaseException:
        stop_observation(handle)
        raise

def start_observation(inputs):
    need(os.geteuid() == 0, "root_owner_required")
    return _start(inputs, LocalHost(), subprocess.Popen, load_consumer())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    inputs = json.loads(checked({"path": args.inputs, "sha256": args.sha256}))
    handle = start_observation(inputs)
    stopped = [False]
    def signal_stop(*_): stopped[0] = True
    signal.signal(signal.SIGTERM, signal_stop); signal.signal(signal.SIGINT, signal_stop)
    print(json.dumps(handle.descriptor, sort_keys=True), flush=True)
    try:
        while not stopped[0] and handle.process.poll() is None and time.time() < handle.deadline:
            time.sleep(0.2)
    finally: stop_observation(handle)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
