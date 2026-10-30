"""Outbound-only dashboard monitoring agent. No posting or account-creation jobs."""

import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler

from local_incogniton import Incogniton, NoRedirect
from monitor import load_json, run_batch
from monitoring import validate_adapter
from monitoring_journal import MonitoringJournal
from worker_protocol import (COMPLETION_RESERVE_SECONDS, completion_payload, remaining_lease,
                             validate_completion, validate_job)
from worker_lock import monitoring_lock
from worker_connection import validate_connection


class BridgeError(RuntimeError):
    pass


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
        return self.submit_result(job, completion_payload(value, fingerprint))

    def submit_result(self, job, value):
        from worker_protocol import validate_result
        validate_job(job)  # Recovery permits an expired lease; the server decides replay vs rejection.
        params = {"job": job["job_id"], "lease": job["lease_token"], "result": validate_result(value)}
        # Completion is idempotent for the same job/lease. Never retry a browser action.
        for attempt in range(3):
            try:
                response = self.rpc("reporting_complete_check", params)
                try:
                    return validate_completion(response)
                except ValueError:
                    raise BridgeError("Monitoring completion receipt was malformed; the result remains unconfirmed") from None
            except BridgeError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)


def validate_claim(job):
    post = validate_job(job)
    remaining_lease(job)
    return post


def recover_result(bridge, journal):
    saved = journal.read()
    if saved is None:
        return "empty"
    if saved["state"] == "claimed":
        raise BridgeError("A claimed job has no durable result; inspect the profile and reconcile its lease. Never rerun it automatically")
    if saved["state"] == "result_ready":
        validate_completion(bridge.submit_result(saved["job"], saved["result"]))
        journal.acknowledge()
    if saved["cleanup_required"]:
        raise BridgeError("Saved result was acknowledged, but local profile cleanup still requires operator confirmation")
    if saved["state"] == "operator_reconciled":
        return "operator_reconciled"
    return "recovered" if saved["state"] == "result_ready" else "settled"


def poll_once(bridge, adapter, api, chromium, journal):
    recover_result(bridge, journal)  # Never claim another job while a result is unresolved.
    bridge.rpc("reporting_worker_heartbeat")
    job = bridge.rpc("reporting_claim_check")
    if job is None:
        return "idle"
    post = validate_claim(job)
    journal.begin(job)  # Persist before even attempting to launch a profile.
    results = []
    fingerprint = hashlib.sha256(json.dumps(adapter, sort_keys=True).encode()).hexdigest()
    failure = None
    def emit(value):
        journal.record_result(completion_payload(value, fingerprint))
        results.append(value)
    try:
        budget = min(480, remaining_lease(job) - COMPLETION_RESERVE_SECONDS)
        run_batch([post], adapter, api, chromium, emit, time.monotonic() + budget)
    except Exception as error:
        failure = error
    if len(results) != 1:
        raise BridgeError("No single reliable result was produced; reconcile the outstanding lease locally")
    if failure is None:
        journal.cleanup_complete()
    saved = journal.read()
    validate_completion(bridge.submit_result(job, saved["result"]))
    journal.acknowledge()
    if failure is not None:
        raise BridgeError("The result was submitted but profile launch/cleanup needs operator review; the agent has stopped") from None
    return "completed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", required=True, help="Private worker JSON saved from the dashboard")
    parser.add_argument("--adapter", help="Locally validated read-only page adapter")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized", action="store_true")
    parser.add_argument("--once", action="store_true", help="Poll at most one job, then exit")
    parser.add_argument("--recover-results", action="store_true", help="Replay a saved result only; never import Playwright or touch a profile")
    parser.add_argument("--confirm-profile-cleanup", metavar="JOB_UUID", help="Attest operator-inspected cleanup for one already-acknowledged job; no dispatch")
    parser.add_argument("--confirm-lease-reconciled", metavar="JOB_UUID", help="Attest the exact claim-without-result lease was reconciled in the dashboard and its profile inspected; no dispatch")
    parser.add_argument("--acknowledge-observation-loss", action="store_true", help="Confirm there is no recoverable observation for the manually reconciled claim")
    args = parser.parse_args()
    from preflight import preflight, require_runtime
    connection = validate_connection(load_json(args.connection))
    recovery_modes = sum(bool(mode) for mode in (args.recover_results, args.confirm_profile_cleanup, args.confirm_lease_reconciled))
    if recovery_modes > 1 or (args.acknowledge_observation_loss and not args.confirm_lease_reconciled):
        parser.error("Choose exactly one recovery mode; observation-loss confirmation belongs only to lease reconciliation")
    state = Path(__file__).resolve().parent / ".worker-state"
    journal = MonitoringJournal(state / "monitoring-journal.json", connection)
    lock = state / "monitor.lock"
    if recovery_modes:
        if not args.confirm_authorized or args.execute:
            parser.error("Recovery/cleanup requires --confirm-authorized, without --execute")
        with monitoring_lock(lock):
            if args.confirm_lease_reconciled:
                journal.confirm_reconciled(args.confirm_lease_reconciled, args.acknowledge_observation_loss)
                print(json.dumps({"state": "operator_reconciled", "observation_recovered": False, "server_state_verified": False, "profiles_opened": 0}))
            elif args.confirm_profile_cleanup:
                journal.confirm_cleanup(args.confirm_profile_cleanup)
                print(json.dumps({"state": "cleanup_confirmed", "profiles_opened": 0}))
            else:
                print(json.dumps({"state": recover_result(WorkerBridge(connection), journal), "profiles_opened": 0}))
        return 0
    if not args.adapter:
        parser.error("--adapter is required for preflight or execution")
    adapter = validate_adapter(load_json(args.adapter))
    if not args.execute:
        report = preflight(args.connection, args.adapter)
        print(json.dumps({**report, "mode": "dry_run", "configuration_valid": True}))
        return 0 if report["local_setup_ready"] else 1
    if not args.confirm_authorized:
        parser.error("Execution requires explicit --confirm-authorized")
    require_runtime()
    from playwright.sync_api import sync_playwright
    bridge = WorkerBridge(connection)
    with monitoring_lock(lock):
        recover_result(bridge, journal)
        with sync_playwright() as playwright:
            deadline = time.monotonic() + 8 * 3600
            while time.monotonic() < deadline:
                status = poll_once(bridge, adapter, Incogniton(), playwright.chromium, journal)
                print(json.dumps({"state": status}), flush=True)
                if args.once:
                    break
                time.sleep(15)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("Agent interrupted. Inspect outstanding leases and local profiles before resuming.")
    except Exception:
        raise SystemExit("Agent stopped safely. Check configuration, outstanding lease and local profile state. Raw errors are withheld.")
