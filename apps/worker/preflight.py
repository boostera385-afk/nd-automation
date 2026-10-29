"""Offline-only worker prerequisites. No network, profile probe, install or launch."""

import argparse
import importlib
from importlib import metadata
import json
from pathlib import Path
import sys

from monitor import load_json
from monitoring import validate_adapter
from worker_connection import validate_connection


DEPENDENCIES = {"playwright": "1.64.1", "pyee": "14.0.0", "greenlet": "3.5.6", "typing-extensions": "4.16.0"}


def runtime_checks():
    checks = [{"id": "python", "status": "pass" if sys.version_info >= (3, 12) else "blocked",
               "message": "The pinned worker environment requires Python 3.12 or later."}]
    packages_ready = True
    for name, expected in DEPENDENCIES.items():
        try:
            installed = metadata.version(name)
            ok = installed == expected
        except Exception:
            ok = False
        packages_ready = packages_ready and ok
        checks.append({"id": "dependency_" + name.replace("-", "_"), "status": "pass" if ok else "blocked",
                       "message": "Use the exact reviewed dependency pins in requirements-monitoring.txt."})
    usable = False
    if packages_ready:
        try:
            usable = callable(getattr(importlib.import_module("playwright.sync_api"), "sync_playwright", None))
        except Exception:
            pass
    checks.append({"id": "sync_api_import", "status": "pass" if usable else "blocked",
                   "message": "Playwright's sync API must import successfully; this never starts its driver or a browser."})
    return checks


def require_runtime():
    if any(check["status"] != "pass" for check in runtime_checks()):
        raise ValueError("Worker runtime is not ready. Run preflight.py and prepare the pinned isolated environment first.")


def inspect_file(path, validator, check_id):
    try:
        # A preflight file is a user-directed local input, never a remote job path.
        if str(path).startswith(("\\\\", "//")) or "://" in str(path):
            raise ValueError("Local input required")
        validator(load_json(path))
        ok = True
    except Exception:
        ok = False
    message = ("Private connection must match the strict publishable-key/scoped-credential contract."
               if check_id == "connection" else "Every read-only selector/attribute must be explicitly configured; this is not live DOM acceptance.")
    return {"id": check_id, "status": "pass" if ok else "blocked", "message": message}


def preflight(connection_path, adapter_path):
    checks = runtime_checks() + [inspect_file(connection_path, validate_connection, "connection"),
                                 inspect_file(adapter_path, validate_adapter, "adapter")]
    checks.extend({"id": name, "status": "unverified", "message": message} for name, message in [
        ("hosted_credentials", "Actual credential acceptance, current membership and session authorization require separate setup/testing."),
        ("profile_ownership", "Exact profile binding and non-overlapping ownership are not established by local files."),
        ("browser_compatibility", "The installed Incogniton browser/CDP combination needs a supervised pilot."),
        ("selector_live_acceptance", "Structurally valid selectors do not establish exact-post or comment accuracy."),
    ])
    return {"mode": "offline_preflight", "local_setup_ready": not any(check["status"] == "blocked" for check in checks),
            "live_ready": False, "network_calls": 0, "profiles_opened": 0, "jobs_executed": 0, "checks": checks}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    default = Path(__file__).resolve().parent / ".monitoring"
    parser.add_argument("--connection", default=default / "worker.json", type=Path)
    parser.add_argument("--adapter", default=default / "adapter.json", type=Path)
    args = parser.parse_args(argv)
    report = preflight(args.connection, args.adapter)
    print(json.dumps(report))
    return 0 if report["local_setup_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
