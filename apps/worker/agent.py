"""Outbound-only dashboard monitoring agent. No posting or account-creation jobs."""

import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler
from uuid import UUID

from local_incogniton import Incogniton, NoRedirect
from monitor import load_json, run_batch
from monitoring import validate_adapter, validate_manifest
from worker_lock import monitoring_lock


class BridgeError(RuntimeError):
    pass


def validate_connection(value):
    expected = {"version", "supabase_url", "publishable_key", "worker_token"}
    if not isinstance(value, dict) or set(value) != expected or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Invalid worker connection configuration")
    url = urlsplit(value["supabase_url"])
    if (url.scheme != "https" or not url.hostname or not url.hostname.endswith(".supabase.co")
            or url.netloc != url.hostname or url.path not in {"", "/"} or url.query or url.fragment):
        raise ValueError("Worker connection must use a hosted Supabase HTTPS project origin")
    key, token = value["publishable_key"], value["worker_token"]
    if not isinstance(key, str) or not key.startswith("sb_publishable_"):
        raise ValueError("A publishable key is required; secret/service-role keys are forbidden")
    if not isinstance(token, str) or len(token) != 64 or any(char not in "0123456789abcdef" for char in token):
        raise ValueError("Invalid worker credential format")
    return {**value, "supabase_url": value["supabase_url"].rstrip("/")}


class WorkerBridge:
    def __init__(self, connection, opener=None):
        self.connection = validate_connection(connection)
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirect())

    def rpc(self, method, params=None):
        allowed = {"reporting_worker_heartbeat", "reporting_claim_check", "reporting_complete_check"}
        if method not in allowed:
            raise BridgeError("Worker method is not allowed")
        body = {**(params or {}), "credential": self.connection["worker_token"]}
        request = Request(self.connection["supabase_url"] + "/rest/v1/rpc/" + method,
                          data=json.dumps(body).encode(), method="POST",
                          headers={"Content-Type": "application/json", "apikey": self.connection["publishable_key"]})
        try:
            with self.opener.open(request, timeout=25) as response:
                content = response.read(1_000_001)
                if len(content) > 1_000_000:
                    raise BridgeError("Worker API response exceeded the allowed size")
                return json.loads(content)
        except (HTTPError, URLError, ValueError, OSError):
            # Never log server bodies, credentials, request headers or customer data.
            raise BridgeError("Worker API request failed; check connection, credential, migration and lease status") from None

    def complete(self, job, value, fingerprint):
        comments = []
        for comment in value["comments"]:
            if len(comment["external_id"]) <= 200 and len(comment["body"]) <= 5000:
                comments.append({"external_id": comment["external_id"], "body": comment["body"]})
        params = {"job": job["job_id"], "lease": job["lease_token"], "result": {
            "outcome": value["outcome"], "reason": value["reason"], "observed_at": value["observed_at"], "adapter_sha256": fingerprint, "comments": comments}}
        # Completion is idempotent for the same job/lease. Never retry a browser action.
        for attempt in range(3):
            try:
                return self.rpc("reporting_complete_check", params)
            except BridgeError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)


def validate_claim(job):
    if not isinstance(job, dict) or set(job) != {"job_id", "publication_id", "profile_id", "url", "lease_token", "lease_expires_at"}:
        raise ValueError("Unexpected monitoring job contract")
    UUID(job["job_id"])
    UUID(job["lease_token"])
    # Validation accepts only canonical post URLs and exact UUIDs; no remotely supplied code.
    post = {key: job[key] for key in ("publication_id", "profile_id", "url")}
    return validate_manifest({"version": 1, "posts": [post]})[0]


def poll_once(bridge, adapter, api, chromium):
    bridge.rpc("reporting_worker_heartbeat")
    job = bridge.rpc("reporting_claim_check")
    if job is None:
        return "idle"
    post = validate_claim(job)
    results = []
    fingerprint = hashlib.sha256(json.dumps(adapter, sort_keys=True).encode()).hexdigest()
    failure = None
    try:
        run_batch([post], adapter, api, chromium, results.append, time.monotonic() + 480)
    except Exception as error:
        failure = error
    if len(results) != 1:
        raise BridgeError("No single reliable result was produced; reconcile the outstanding lease locally")
    bridge.complete(job, results[0], fingerprint)
    if failure is not None:
        raise BridgeError("The result was submitted but profile launch/cleanup needs operator review; the agent has stopped") from None
    return "completed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", required=True, help="Private worker JSON saved from the dashboard")
    parser.add_argument("--adapter", required=True, help="Locally validated read-only page adapter")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized", action="store_true")
    parser.add_argument("--once", action="store_true", help="Poll at most one job, then exit")
    args = parser.parse_args()
    connection = validate_connection(load_json(args.connection))
    adapter = validate_adapter(load_json(args.adapter))
    if not args.execute:
        print(json.dumps({"mode": "dry_run", "configuration_valid": True, "network_calls": 0, "jobs_executed": 0}))
        return
    if not args.confirm_authorized:
        parser.error("Execution requires explicit --confirm-authorized")
    from playwright.sync_api import sync_playwright
    bridge = WorkerBridge(connection)
    lock = Path(__file__).resolve().parent / ".worker-state" / "monitor.lock"
    with monitoring_lock(lock), sync_playwright() as playwright:
        deadline = time.monotonic() + 8 * 3600
        while time.monotonic() < deadline:
            state = poll_once(bridge, adapter, Incogniton(), playwright.chromium)
            print(json.dumps({"state": state}), flush=True)
            if args.once:
                break
            time.sleep(15)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit("Agent interrupted. Inspect outstanding leases and local profiles before resuming.")
    except Exception:
        raise SystemExit("Agent stopped safely. Check configuration, outstanding lease and local profile state. Raw errors are withheld.")
