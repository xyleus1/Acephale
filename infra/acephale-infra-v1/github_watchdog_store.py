"""Bounded GitHub Contents API port with compare-and-swap, no redirects/retries."""
from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from github_watchdog_protocol import canonical
from lambda_gpu_watchdog import require


class GitHubFailure(RuntimeError):
    def __init__(self, status=None):
        self.status = status
        super().__init__("GitHub control operation failed; credentials and response omitted")


class GitHubStore:
    def __init__(self, repository, token, *, write_branch=None, clock=time.time):
        require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository or "")
                and isinstance(token, str) and token.strip(), "Explicit repository credential required")
        self.repository, self.token, self.write_branch = repository, token, write_branch
        self.clock, self.retry_not_before = clock, 0

    def request(self, method, suffix, value=None):
        if self.clock() < self.retry_not_before:
            raise GitHubFailure(429)
        require(method in {"GET", "PUT"} and suffix.startswith("/") and ".." not in suffix,
                "Unsupported GitHub operation")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise GitHubFailure()
        request = urllib.request.Request("https://api.github.com/repos/" + self.repository + suffix,
            data=canonical(value) if value is not None else None, method=method,
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
                     "User-Agent": "Acephale-Exact-Lease-Watchdog/1.0", "Cache-Control": "no-cache"})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=6) as response:
                raw = response.read(2_000_001)
                require(len(raw) <= 2_000_000, "Oversized GitHub response")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code in {403, 429}:
                headers = error.headers or {}
                wait_until = self.clock() + 60
                try:
                    if headers.get("Retry-After"):
                        wait_until = max(wait_until, self.clock() + float(headers["Retry-After"]))
                    if headers.get("X-RateLimit-Remaining") == "0" and headers.get("X-RateLimit-Reset"):
                        wait_until = max(wait_until, float(headers["X-RateLimit-Reset"]) + 1)
                except (ValueError, OverflowError):
                    pass
                self.retry_not_before = wait_until
            raise GitHubFailure(error.code) from None
        except (OSError, ValueError, TypeError, GitHubFailure):
            raise GitHubFailure() from None

    def read(self, branch, path):
        value = self.request("GET", "/contents/" + urllib.parse.quote(path, safe="/")
                             + "?ref=" + urllib.parse.quote(branch, safe=""))
        require(value.get("type") == "file" and value.get("encoding") == "base64"
                and re.fullmatch(r"[a-f0-9]{40}", value.get("sha", "")), "Expected exact Git blob")
        raw = base64.b64decode(value["content"], validate=False)
        require(len(raw) <= 256_000, "Oversized control record")
        return json.loads(raw), value["sha"]

    def cas(self, branch, path, value, prior_sha=None):
        require(branch == self.write_branch and re.fullmatch(r"[A-Za-z0-9_./-]+", path)
                and ".." not in path, "GitHub write outside assigned branch")
        require(prior_sha is None or re.fullmatch(r"[a-f0-9]{40}", prior_sha), "Invalid previous blob SHA")
        body = {"message": "Record exact lease watchdog evidence", "branch": branch,
                "content": base64.b64encode(canonical(value)).decode()}
        if prior_sha is not None:
            body["sha"] = prior_sha
        result = self.request("PUT", "/contents/" + urllib.parse.quote(path, safe="/"), body)
        sha = result.get("content", {}).get("sha", "")
        require(re.fullmatch(r"[a-f0-9]{40}", sha), "GitHub write returned no blob SHA")
        return sha
