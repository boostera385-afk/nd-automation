"""Bounded browser tasks the dashboard may queue on a paired laptop.

This module deliberately cannot post, create accounts, publish listings, write
cookies or write proxies. It creates an Incogniton profile, reads a preset
inventory, and validates local cookie/proxy files without changing them.
"""

import json
import re
from datetime import datetime, timezone

KINDS = {"profile_create", "preset_snapshot", "cookie_import", "proxy_import"}
SYSTEMS = {"windows", "mac", "linux"}
MAX_FILE_BYTES = 5_000_000
MAX_ENTRIES = 50_000
_MAX_BYTES = 8_000


class TaskError(ValueError):
    """A queued task cannot be executed as written."""


def _text(value, field, low=1, high=200):
    if not isinstance(value, str):
        raise TaskError(f"{field} must be text")
    value = value.strip()
    if not low <= len(value) <= high or any(ord(char) < 32 for char in value):
        raise TaskError(f"{field} must be {low}-{high} printable characters")
    return value


def _timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        raise TaskError("A zoned task timestamp is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise TaskError("A zoned task timestamp is required")
    return parsed.astimezone(timezone.utc)


def validate_task(task):
    required = {"task_id", "kind", "payload", "lease_token", "lease_expires_at"}
    if not isinstance(task, dict) or set(task) != required:
        raise TaskError("Unexpected browser task contract")
    if not re.fullmatch(r"[0-9a-f-]{36}", str(task["task_id"]).lower()):
        raise TaskError("A canonical task UUID is required")
    if not re.fullmatch(r"[0-9a-f-]{36}", str(task["lease_token"]).lower()):
        raise TaskError("A canonical lease UUID is required")
    if task["kind"] not in KINDS:
        raise TaskError("This task type is not executable by the worker")
    if not isinstance(task["payload"], dict):
        raise TaskError("The task payload must be an object")
    if len(json.dumps(task["payload"]).encode("utf-8")) > _MAX_BYTES:
        raise TaskError("The task payload is too large")
    _timestamp(task["lease_expires_at"])
    return task


def profile_payload(payload):
    allowed = {"name", "group", "os", "note"}
    if set(payload) - allowed:
        raise TaskError("Unexpected profile field")
    name = _text(payload.get("name"), "Profile name", 2, 60)
    operating_system = payload.get("os", "windows")
    if operating_system not in SYSTEMS:
        raise TaskError("Choose windows, mac or linux")
    group = ""
    if payload.get("group") not in (None, ""):
        group = _text(payload["group"], "Group", 1, 60)
    return {"name": name, "os": operating_system, "group": group}


def local_path(payload):
    allowed = {"path", "note"}
    if set(payload) - allowed:
        raise TaskError("Unexpected import field")
    path = _text(payload.get("path"), "File path", 3, 400)
    if not (re.match(r"^[A-Za-z]:[\\/]", path) or path.startswith("/") or path.startswith("\\\\")):
        raise TaskError("Enter an absolute path on the worker machine")
    if ".." in path.split("/") or ".." in path.split("\\"):
        raise TaskError("The path must not traverse upwards")
    return path


def _read_text(path):
    with open(path, "rb") as handle:
        data = handle.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise TaskError("The file is larger than 5 MB; split it before importing")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def parse_cookies(text):
    """Netscape cookie format. Counts and domains only; never a cookie value."""
    entries = 0
    with_credentials = 0
    domains = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) < 7:
            continue
        domain = fields[0].strip().lower().lstrip(".")
        if not domain:
            continue
        entries += 1
        domains.add(domain)
        if fields[6].strip():
            with_credentials += 1
        if entries > MAX_ENTRIES:
            raise TaskError("The file has more entries than this check accepts")
    return {"entries": entries, "with_credentials": with_credentials,
            "domains": len(domains), "sample": sorted(domains)[:5]}


def parse_proxies(text):
    """host:port or host:port:user:pass. Never echoes a credential."""
    entries = 0
    with_credentials = 0
    sample = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        body = line.split("://", 1)[1] if "://" in line else line
        parts = body.split(":")
        if len(parts) < 2:
            continue
        host, port = parts[0].strip(), parts[1].strip()
        if not host or not port.isdigit() or not 1 <= int(port) <= 65535:
            continue
        entries += 1
        if len(parts) >= 4 and parts[2].strip() and parts[3].strip():
            with_credentials += 1
        if len(sample) < 5:
            sample.append(f"{host}:{port}")
        if entries > MAX_ENTRIES:
            raise TaskError("The file has more entries than this check accepts")
    return {"entries": entries, "with_credentials": with_credentials, "sample": sample}


def execute(task, incogniton):
    """Run one validated task and return the bounded result object."""
    validate_task(task)
    payload = task["payload"]
    kind = task["kind"]
    if kind == "profile_create":
        spec = profile_payload(payload)
        profile_id = incogniton.create(spec["name"], spec["os"], spec["group"])
        return {"profile_id": profile_id, "name": spec["name"], "os": spec["os"]}
    if kind == "preset_snapshot":
        if set(payload) - {"note"}:
            raise TaskError("Unexpected snapshot field")
        return incogniton.inventory()
    if kind == "cookie_import":
        return parse_cookies(_read_text(local_path(payload)))
    return parse_proxies(_read_text(local_path(payload)))
