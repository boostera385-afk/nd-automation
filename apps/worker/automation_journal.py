"""Private durable task checkpoint: receipt replay only, never mutation replay."""

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from automation_tasks import MAX_SCAN_RESULT_BYTES, validate_task

WORKFLOW_KINDS = frozenset({"supervised_workflow"})
TASK_FAILURE = "Task failed on this device. Inspect the local file and Incogniton state before retrying; raw errors are withheld."
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


# Only scans get the larger durable budget. Leave room for the completion
# envelope and claim metadata without widening other browser-task receipts.
MAX_CHECKPOINT_BYTES = 1_000_000
DEFAULT_CHECKPOINT_BYTES = 100_000
DEFAULT_RECEIPT_BYTES = 66_000


def completion(value, kind=None):
    if not isinstance(value, dict) or set(value) != {"status", "result", "error"}:
        raise ValueError("Invalid saved browser-task completion")
    if value["status"] == "failed":
        if value["result"] is not None or value["error"] != TASK_FAILURE:
            raise ValueError("Only the fixed redacted failure receipt may be stored")
    elif value["status"] == "succeeded":
        if value["error"] is not None or not isinstance(value["result"], dict):
            raise ValueError("A successful browser task needs an explicit result object")
    else:
        raise ValueError("Invalid browser-task status")
    maximum = DEFAULT_RECEIPT_BYTES
    if kind == "inventory_scan":
        maximum = MAX_SCAN_RESULT_BYTES + 2_000
        if len(json.dumps(value["result"], ensure_ascii=False, allow_nan=False).encode()) > MAX_SCAN_RESULT_BYTES:
            raise ValueError("Browser-task receipt exceeded its bound")
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > maximum:
        raise ValueError("Browser-task receipt exceeded its bound")
    return value


class AutomationJournal:
    def __init__(self, path, connection=None, scope=None):
        self.path = Path(path)
        self.scope = scope if scope is not None else hashlib.sha256((connection["supabase_url"] + "\n" + connection["worker_token"]).encode()).hexdigest()
        if not isinstance(self.scope, str) or not re.fullmatch(r"[a-f0-9]{64}", self.scope):
            raise ValueError("Invalid private checkpoint scope")

    def read(self):
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Unsafe browser-task checkpoint location")
        if not self.path.exists():
            return None
        if self.path.stat().st_size > MAX_CHECKPOINT_BYTES:
            raise ValueError("Browser-task checkpoint exceeded its bound")
        def unique(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError("Duplicate checkpoint fields")
                value[key] = item
            return value
        with self.path.open("rb") as stream:
            data = stream.read(MAX_CHECKPOINT_BYTES + 1)
        if len(data) > MAX_CHECKPOINT_BYTES:
            raise ValueError("Browser-task checkpoint exceeded its bound")
        value = json.loads(data, object_pairs_hook=unique)
        if (not isinstance(value, dict) or set(value) != {"version", "scope", "state", "task", "reference", "completion", "inspection_required"}
                or type(value["version"]) is not int or value["version"] != 1 or not isinstance(value["scope"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", value["scope"]) or type(value["inspection_required"]) is not bool
                or value["state"] not in {"claimed", "result_ready", "acknowledged", "operator_reconciled"}):
            raise ValueError("Browser-task checkpoint format/state conflict")
        reference = value["reference"]
        if (not isinstance(reference, dict) or set(reference) != {"task_id", "kind"} or not isinstance(reference["task_id"], str)
                or not UUID.fullmatch(reference["task_id"]) or not isinstance(reference["kind"], str)):
            raise ValueError("Invalid browser-task checkpoint reference")
        if reference["kind"] != "inventory_scan" and len(data) > DEFAULT_CHECKPOINT_BYTES:
            raise ValueError("Browser-task checkpoint exceeded its bound")
        if value["scope"] != self.scope:
            if value["state"] in {"acknowledged", "operator_reconciled"} and not value["inspection_required"]:
                return None
            raise ValueError("Pending browser task belongs to another worker/project credential")
        if value["state"] in {"claimed", "result_ready"}:
            validate_task(value["task"], check_lease=False, extra_kinds=WORKFLOW_KINDS)
            if reference != {"task_id": value["task"]["task_id"], "kind": value["task"]["kind"]}:
                raise ValueError("Browser-task reference changed")
        elif value["task"] is not None:
            raise ValueError("Terminal browser-task checkpoint retains unexpected payload")
        if value["state"] == "result_ready":
            completion(value["completion"], reference["kind"])
        elif value["completion"] is not None:
            raise ValueError("Unexpected browser-task completion")
        if value["state"] == "operator_reconciled" and value["inspection_required"]:
            raise ValueError("Uninspected browser task cannot be reconciled locally")
        return value

    def write(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Unsafe browser-task checkpoint location")
        data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        maximum = MAX_CHECKPOINT_BYTES if value.get("reference", {}).get("kind") == "inventory_scan" else DEFAULT_CHECKPOINT_BYTES
        if len(data) > maximum:
            raise ValueError("Browser-task checkpoint exceeded its bound")
        descriptor, name = tempfile.mkstemp(prefix=".browser-task-", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def begin(self, task):
        previous = self.read()
        if previous and (previous["state"] not in {"acknowledged", "operator_reconciled"} or previous["inspection_required"]):
            raise ValueError("Resolve the outstanding browser-task checkpoint before any new task")
        validate_task(task, extra_kinds=WORKFLOW_KINDS)
        self.write({"version": 1, "scope": self.scope, "state": "claimed", "task": task,
                    "reference": {"task_id": task["task_id"], "kind": task["kind"]}, "completion": None, "inspection_required": True})

    def record(self, status, result, error=None, inspection_required=False):
        saved = self.read()
        if not saved or saved["state"] != "claimed" or type(inspection_required) is not bool:
            raise ValueError("One durable result is required for the exact outstanding task")
        value = completion({"status": status, "result": result, "error": error}, saved["reference"]["kind"])
        self.write({**saved, "state": "result_ready", "completion": value, "inspection_required": inspection_required})

    def acknowledge(self):
        saved = self.read()
        if not saved or saved["state"] != "result_ready":
            raise ValueError("No browser-task result awaits acknowledgment")
        self.write({**saved, "state": "acknowledged", "task": None, "completion": None})

    def attest_inspected(self, task_id):
        saved = self.read()
        if not saved or saved["state"] != "acknowledged" or saved["reference"]["task_id"] != task_id or not saved["inspection_required"]:
            raise ValueError("Attest inspection of the exact acknowledged task only")
        self.write({**saved, "inspection_required": False})

    def reconcile_claim(self, task_id, confirmed=False):
        saved = self.read()
        if not saved or saved["state"] != "claimed" or saved["reference"]["task_id"] != task_id or confirmed is not True:
            raise ValueError("Attest the exact unresolved claim's server reconciliation and inspected local state")
        self.write({**saved, "state": "operator_reconciled", "task": None, "inspection_required": False})


def recover_automation(bridge, journal):
    saved = journal.read()
    if saved is None:
        return "empty"
    if saved["state"] == "claimed":
        raise ValueError("An unresolved browser-task claim may have mutated local/platform state; inspect and reconcile, never replay it")
    if saved["state"] == "result_ready":
        value = saved["completion"]
        acknowledged = bridge.complete_task(saved["task"], value["status"], value["result"], value["error"])
        if type(acknowledged) is not bool:
            raise ValueError("Browser-task acknowledgment is unconfirmed; preserve its result")
        journal.acknowledge()
        saved = journal.read()
    if saved["inspection_required"]:
        raise ValueError("Task receipt was recorded but local/platform inspection is still required")
    return saved["state"]
