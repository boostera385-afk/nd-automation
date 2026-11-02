"""Private write-ahead submit intent. Never replay a browser action from disk."""

import hashlib
import json
import os
import re
from pathlib import Path
import tempfile

from monitor import load_json
from publishing_protocol import uuid, validate_job, validate_result


class PublishingJournal:
    def __init__(self, path, connection):
        self.path = Path(path)
        self.scope = hashlib.sha256((connection["supabase_url"] + "\n" + connection["worker_token"]).encode()).hexdigest()

    def read(self):
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Publishing journal must be an ordinary private local file")
        if not self.path.exists():
            return None
        value = load_json(self.path)
        if (not isinstance(value, dict) or set(value) != {"version", "scope", "state", "job", "result", "cleanup_required"}
                or type(value["version"]) is not int or value["version"] != 1
                or not isinstance(value["scope"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["scope"])
                or value["state"] not in {"claimed", "submit_intent", "result_ready", "acknowledged", "operator_reconciled"}
                or type(value["cleanup_required"]) is not bool):
            raise ValueError("Invalid publishing checkpoint; preserve it for review")
        if value["state"] in {"acknowledged", "operator_reconciled"}:
            terminal = value["job"]
            if (not isinstance(terminal, dict) or set(terminal) != {"job_id", "lease_token", "kind", "profile_id"}
                    or terminal["kind"] not in {"post", "listing"}):
                raise ValueError("Invalid terminal publishing metadata")
            for key in ("job_id", "lease_token", "profile_id"):
                uuid(terminal[key])
        else:
            validate_job(value["job"])
        if value["state"] == "result_ready":
            validate_result(value["result"], value["job"]["kind"])
        elif value["result"] is not None:
            raise ValueError("Unexpected publishing checkpoint result")
        if value["state"] == "operator_reconciled" and value["cleanup_required"]:
            raise ValueError("Operator reconciliation requires completed cleanup")
        if value["scope"] != self.scope:
            if value["state"] in {"acknowledged", "operator_reconciled"} and not value["cleanup_required"]:
                return None
            raise ValueError("Unresolved publishing state belongs to another credential")
        return value

    def write(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Unsafe publishing checkpoint location")
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        if len(content) > 100_000:
            raise ValueError("Publishing checkpoint exceeds its bound")
        descriptor, name = tempfile.mkstemp(prefix=".publishing-", dir=self.path.parent)
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
            raise ValueError("Publishing checkpoint requires recovery/reconciliation")
        validate_job(job)
        self.write({"version": 1, "scope": self.scope, "state": "claimed", "job": job,
                    "result": None, "cleanup_required": True})

    def submit_intent(self):
        value = self.read()
        if not value or value["state"] != "claimed":
            raise ValueError("Submit can be attempted exactly once per claim")
        self.write({**value, "state": "submit_intent"})

    def record(self, result):
        value = self.read()
        if not value or value["state"] not in {"claimed", "submit_intent"}:
            raise ValueError("Exactly one publishing result may be recorded")
        validate_result(result, value["job"]["kind"])
        if result["outcome"] == "submitted" and value["state"] != "submit_intent":
            raise ValueError("Submission requires a durable prior submit intent")
        self.write({**value, "state": "result_ready", "result": result})

    def cleanup_complete(self):
        value = self.read()
        if not value or value["state"] != "result_ready":
            raise ValueError("Record an outcome before recording cleanup")
        self.write({**value, "cleanup_required": False})

    def acknowledge(self):
        value = self.read()
        if not value or value["state"] != "result_ready":
            raise ValueError("No publishing result awaits acknowledgment")
        self.write({**value, "state": "acknowledged", "result": None,
                    "job": self.terminal_job(value["job"])})

    @staticmethod
    def terminal_job(job):
        # Retain only reconciliation identifiers after durable server receipt.
        # Approved text, audience, price/category and account label are cleared.
        return {key: job[key] for key in ("job_id", "lease_token", "kind", "profile_id")}

    def reconcile(self, job_id):
        value = self.read()
        if not value or value["job"]["job_id"] != job_id:
            raise ValueError("Attest the exact outstanding publishing job")
        if value["state"] == "acknowledged" and value["cleanup_required"]:
            self.write({**value, "cleanup_required": False})
        elif value["state"] in {"claimed", "submit_intent"}:
            self.write({**value, "state": "operator_reconciled", "cleanup_required": False,
                        "job": self.terminal_job(value["job"])})
        else:
            raise ValueError("A saved result must be delivered, not discarded")
