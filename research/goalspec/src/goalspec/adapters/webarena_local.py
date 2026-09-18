"""Trusted local Docker reset and fingerprint-fenced browser snapshot ownership.

Only reset-equivalent backends are reusable. Arbitrary live database cloning is
not claimed: once the authoritative state differs from the reset baseline,
speculation fails closed until the next explicit reset.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import subprocess
import threading
from pathlib import Path
from urllib.parse import urlparse

REVISION = "dce04686a56253aefba7b18a4fa0937cf1dc987b"
SITES = ("shopping", "shopping_admin", "gitlab", "forum")


def execute(argv, payload=None, timeout=10):
    if not isinstance(argv, list) or not argv or any(not isinstance(part, str) or not part for part in argv):
        raise ValueError("Trusted command must be a nonempty argv list")
    result = subprocess.run(argv, input=None if payload is None else json.dumps(payload), text=True, capture_output=True,
                            timeout=timeout, check=False, shell=False)
    if result.returncode or len(result.stdout) > 1_000_000:
        raise RuntimeError("Trusted local backend command failed")
    return result.stdout.strip()


class LocalWebArenaController:
    def __init__(self, configuration, command=execute):
        self.config, self.command = configuration, command
        self.lock = threading.RLock()
        self.lease = None
        self.baseline = None
        self.epoch = 0
        if configuration.get("sourceRevision") != REVISION or configuration.get("site") not in SITES:
            raise ValueError("Unpinned or unsupported local WebArena configuration")
        for stack in ["authoritative", "snapshot"]:
            origin = urlparse(configuration["origins"][stack])
            if (origin.scheme != "http" or origin.hostname != "127.0.0.1" or origin.path or origin.query or origin.fragment
                    or origin.username is not None or origin.password is not None or origin.port is None):
                raise ValueError("Website origins must be canonical local loopback origins")
        if configuration["origins"]["authoritative"] == configuration["origins"]["snapshot"]:
            raise ValueError("Browser contexts against one backend are not isolated snapshots")
        if not configuration.get("fingerprintCommand") or not configuration.get("verifierCommand"):
            raise ValueError("Audited complete-state fingerprint and native verifier commands are required")

    def _fingerprint(self, stack):
        argv = [part.replace("{stack}", stack) for part in self.config["fingerprintCommand"]]
        value = json.loads(self.command(argv, timeout=3))
        if not re.fullmatch(r"[a-f0-9]{64}", value.get("stateHash", "")) or value.get("completeDatabaseProjection") is not True:
            raise ValueError("A complete audited database fingerprint is required")
        return value["stateHash"]

    def _audit(self):
        names = {stack: [f"goalspec-webarena-{stack}-{site}" for site in SITES] for stack in ["authoritative", "snapshot"]}
        inspected = {stack: json.loads(self.command(["docker", "inspect", *containers])) for stack, containers in names.items()}
        ids, mounts, networks = {}, {}, {}
        for stack, containers in inspected.items():
            if len(containers) != 4 or any(not container["State"]["Running"] for container in containers):
                raise ValueError("Every isolated website backend must be running")
            ids[stack] = {container["Id"] for container in containers}
            mounts[stack] = {mount["Source"] for container in containers for mount in container["Mounts"] if mount.get("RW")}
            networks[stack] = {network for container in containers for network in container["NetworkSettings"]["Networks"]}
            if any(container["Config"]["Labels"].get("goalspec.stack") != stack for container in containers):
                raise ValueError("Container ownership label mismatch")
        if ids["authoritative"] & ids["snapshot"] or mounts["authoritative"] & mounts["snapshot"] or networks["authoritative"] & networks["snapshot"]:
            raise ValueError("Independent backend container, storage and network ownership was not established")
        return hashlib.sha256(json.dumps({"ids": {key: sorted(value) for key, value in ids.items()}, "epoch": self.epoch}, sort_keys=True).encode()).hexdigest()

    def reset(self):
        with self.lock:
            if self.lease:
                raise ValueError("Release browser reads before resetting their backends")
            revision = self.command(["git", "-C", self.config["checkout"], "rev-parse", "HEAD"])
            if revision != REVISION:
                raise ValueError("Native WebArena checkout revision mismatch")
            self.baseline = None
            for stack in ["authoritative", "snapshot"]:
                project = f"goalspec-webarena-{stack}"
                path = str(Path(self.config["deploymentDirectory"]) / f"{stack}.compose.json")
                self.command(["docker", "compose", "-p", project, "-f", path, "down", "--volumes"], timeout=120)
                self.command(["docker", "compose", "-p", project, "-f", path, "up", "-d", "--pull", "never", "--force-recreate"], timeout=120)
                for argv in self.config.get("postResetCommands", {}).get(stack, []):
                    self.command(argv, timeout=120)
            self.epoch += 1
            self._audit()
            left, right = self._fingerprint("authoritative"), self._fingerprint("snapshot")
            if left != right:
                raise ValueError("Reset states are not logically equivalent")
            self.baseline = left
            return {"reset": True, "stateVersion": f"{self.epoch}:{left}"}

    def acquire(self):
        with self.lock:
            if self.lease or self.baseline is None:
                raise ValueError("No verified, unleased reset snapshot is available")
            audit = self._audit()
            if self._fingerprint("authoritative") != self.baseline or self._fingerprint("snapshot") != self.baseline:
                raise ValueError("Backend changed after reset; current-state cloning is not available")
            self.lease = {"id": secrets.token_hex(24), "origin": self.config["origins"]["snapshot"],
                          "stateVersion": f"{self.epoch}:{self.baseline}", "isolationAudit": audit}
            return dict(self.lease)

    def fresh(self, snapshot):
        with self.lock:
            return (self.lease is not None and snapshot == self.lease and self._audit() == self.lease["isolationAudit"]
                    and self._fingerprint("authoritative") == self.baseline and self._fingerprint("snapshot") == self.baseline)

    def release(self, snapshot):
        with self.lock:
            if snapshot != self.lease:
                raise ValueError("Unknown browser snapshot lease")
            self.lease = None
            return {"released": True}

    def verify(self, expected):
        with self.lock:
            if self.lease:
                raise ValueError("Drain browser speculation before independent evaluation")
            if not isinstance(expected, dict) or set(expected) != {"taskId"} or expected["taskId"] not in self.config["tasks"]:
                raise ValueError("Native evaluation requires a preregistered task ID")
            registration = self.config["tasks"][expected["taskId"]]
            result = json.loads(self.command(self.config["verifierCommand"], {**registration, "checkout": self.config["checkout"],
                                            "sourceRevision": REVISION, "authoritativeOrigin": self.config["origins"]["authoritative"]}, timeout=120))
            if type(result.get("passed")) is not bool or "evidence" not in result:
                raise ValueError("Malformed independent native verdict")
            return result
