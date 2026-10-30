"""One private durable monitoring checkpoint, never an executable job source."""

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from monitor import load_json
from worker_protocol import validate_job, validate_result


class MonitoringJournal:
    def __init__(self, path, connection):
        self.path = Path(path)
        self.scope = hashlib.sha256((connection["supabase_url"] + "\n" + connection["worker_token"]).encode()).hexdigest()

    def read(self):
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Monitoring journal must be an ordinary private local file")
        if not self.path.exists():
            return None
        value = load_json(self.path)
        if not isinstance(value, dict) or set(value) != {"version", "scope", "state", "job", "result", "cleanup_required"}:
            raise ValueError("Invalid monitoring journal; preserve it for operator review")
        if (type(value["version"]) is not int or value["version"] != 1 or not isinstance(value["scope"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", value["scope"])
                or value["state"] not in {"claimed", "result_ready", "acknowledged", "operator_reconciled"}
                or type(value["cleanup_required"]) is not bool):
            raise ValueError("Monitoring journal scope/state could not be verified")
        validate_job(value["job"])
        if value["state"] == "result_ready":
            validate_result(value["result"])
        elif value["result"] is not None:
            raise ValueError("Unexpected journal payload")
        if value["state"] == "operator_reconciled" and value["cleanup_required"]:
            raise ValueError("Operator reconciliation requires completed local cleanup")
        if value["scope"] != self.scope:
            if value["state"] in {"acknowledged", "operator_reconciled"} and not value["cleanup_required"]:
                # A newly configured worker can replace clean terminal metadata,
                # but can never read/inherit another credential's pending result.
                return None
            raise ValueError("Pending monitoring journal belongs to another project or worker credential")
        return value

    def _write(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.parent.is_symlink() or self.path.is_symlink():
            raise ValueError("Monitoring journal location is not safe")
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        if len(content) > 1_000_000:
            raise ValueError("Monitoring journal exceeded its private storage bound")
        # Write and flush a sibling before replacing the last checkpoint. If any
        # storage step fails, callers stop rather than executing/repeating a read.
        descriptor, name = tempfile.mkstemp(prefix=".monitoring-", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def begin(self, job):
        previous = self.read()
        if previous and (previous["state"] not in {"acknowledged", "operator_reconciled"} or previous["cleanup_required"]):
            raise ValueError("Outstanding monitoring checkpoint requires recovery or operator reconciliation")
        validate_job(job)
        self._write({"version": 1, "scope": self.scope, "state": "claimed", "job": job, "result": None, "cleanup_required": True})

    def record_result(self, result):
        value = self.read()
        if not value or value["state"] != "claimed":
            raise ValueError("Exactly one observation may be saved for a claimed job")
        validate_result(result)
        self._write({**value, "state": "result_ready", "result": result})

    def cleanup_complete(self):
        value = self.read()
        if not value or value["state"] != "result_ready":
            raise ValueError("A saved result is required before recording cleanup")
        self._write({**value, "cleanup_required": False})

    def acknowledge(self):
        value = self.read()
        if not value or value["state"] != "result_ready":
            raise ValueError("No saved result is awaiting acknowledgment")
        # Backend receipt is now authoritative; do not retain comment text locally.
        self._write({**value, "state": "acknowledged", "result": None})

    def confirm_cleanup(self, job_id):
        value = self.read()
        if not value or value["state"] != "acknowledged" or value["job"]["job_id"] != job_id or not value["cleanup_required"]:
            raise ValueError("Only the exact acknowledged job can have its local cleanup confirmed")
        self._write({**value, "cleanup_required": False})

    def confirm_reconciled(self, job_id, observation_loss_confirmed=False):
        value = self.read()
        if (not value or value["state"] != "claimed" or value["job"]["job_id"] != job_id
                or observation_loss_confirmed is not True):
            raise ValueError("Attest the exact claimed job's dashboard reconciliation, inspected profile and missing observation")
        # This is an explicit human attestation, not proof of server state or a
        # recovered observation. Never use it to discard a saved result.
        self._write({**value, "state": "operator_reconciled", "cleanup_required": False})
