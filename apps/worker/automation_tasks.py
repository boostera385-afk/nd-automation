"""Bounded browser tasks the dashboard may queue on a paired laptop.

This module deliberately cannot post, create accounts, publish listings, write
cookies or write proxies. It creates an Incogniton profile, reads a preset
inventory, and validates local cookie/proxy files without changing them.
"""

import json
import re
from datetime import datetime, timezone

KINDS = {"profile_create", "preset_snapshot", "cookie_import", "proxy_import",
         "cookie_write", "proxy_write"}
SYSTEMS = {"windows", "mac", "linux"}
MAX_FILE_BYTES = 5_000_000
MAX_ENTRIES = 50_000
_MAX_BYTES = 8_000
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_PROXY_SCHEMES = {"http": "HTTP", "https": "HTTP", "socks4": "SOCKS4", "socks5": "SOCKS5", "socks5h": "SOCKS5"}


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


def profile_target(payload):
    """A write task names exactly one Incogniton profile, by canonical UUID."""
    allowed = {"profile_id", "replace", "path", "note"}
    if set(payload) - allowed:
        raise TaskError("Unexpected import field")
    profile_id = payload.get("profile_id")
    if not isinstance(profile_id, str) or not _UUID.fullmatch(profile_id.strip()):
        raise TaskError("Choose the Incogniton profile to import into before queuing")
    replace = payload.get("replace", False)
    if not isinstance(replace, bool):
        raise TaskError("Replace must be a single yes or no choice")
    return {"profile_id": profile_id.strip().lower(), "replace": replace,
            "path": local_path({"path": payload.get("path")})}


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
    for raw, cookie in _cookie_lines(text):
        if not cookie["domain"]:
            continue
        entries += 1
        domains.add(cookie["domain"].lower().lstrip("."))
        if cookie["value"]:
            with_credentials += 1
        if entries > MAX_ENTRIES:
            raise TaskError("The file has more entries than this check accepts")
    return {"entries": entries, "with_credentials": with_credentials,
            "domains": len(domains), "sample": sorted(domains)[:5]}


def _cookie_lines(text):
    """Netscape cookies.txt parser, field-for-field the desktop importer's:
    same #HttpOnly_ handling, same seven columns, same produced shape."""
    for raw in text.splitlines():
        line = raw.strip()
        http_only = False
        if not line:
            continue
        if line.startswith("#"):
            if not line.lower().startswith("#httponly_"):
                continue
            line = line[len("#HttpOnly_"):]
            http_only = True
        parts = line.split("\t")
        if len(parts) < 7:
            parts = [part for part in line.split() if part]
        if len(parts) < 7:
            continue
        domain, host_only, path, secure, expiry, name, value = parts[:7]
        yield raw, {
            "domain": domain,
            "hostOnly": host_only.strip().upper() != "TRUE",
            "path": path,
            "secure": secure.strip().upper() == "TRUE",
            "expirationDate": expiry,
            "name": name,
            "value": value,
            "httpOnly": http_only,
        }


def parse_cookie_entries(text):
    return [cookie for _, cookie in _cookie_lines(text)]


def parse_proxies(text):
    """host:port or host:port:user:pass. Never echoes a credential."""
    entries = 0
    with_credentials = 0
    sample = []
    for proxy in _proxy_entries(text):
        entries += 1
        if proxy["username"] and proxy["password"]:
            with_credentials += 1
        if len(sample) < 5:
            sample.append(f"{proxy['host']}:{proxy['port']}")
        if entries > MAX_ENTRIES:
            raise TaskError("The file has more entries than this check accepts")
    return {"entries": entries, "with_credentials": with_credentials, "sample": sample}


def _proxy_entries(text):
    """The desktop's parse_proxy, line by line: an optional scheme prefix picks
    the connection type (default SOCKS5), then host:port[:user:pass]."""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        proxy_type = "SOCKS5"
        if "://" in line:
            scheme, line = line.split("://", 1)
            proxy_type = _PROXY_SCHEMES.get(scheme.strip().lower(), "SOCKS5")
        parts = line.split(":")
        if len(parts) < 2:
            continue
        host, port = parts[0].strip(), parts[1].strip()
        if not host or not port.isdigit() or not 1 <= int(port) <= 65535:
            continue
        username = parts[2].strip() if len(parts) >= 4 and parts[2].strip() else ""
        password = parts[3].strip() if len(parts) >= 4 and parts[3].strip() else ""
        yield {"type": proxy_type, "host": host, "port": int(port),
               "username": username, "password": password}


def first_proxy(text):
    """The entry a proxy_write task applies: the first valid line in the file."""
    for proxy in _proxy_entries(text):
        return proxy
    raise TaskError("The file has no usable proxy line (expected host:port or host:port:user:pass)")


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
    if kind == "proxy_import":
        return parse_proxies(_read_text(local_path(payload)))
    if kind == "cookie_write":
        target = profile_target(payload)
        cookies = parse_cookie_entries(_read_text(target["path"]))
        if not cookies:
            raise TaskError("The file has no cookies.txt rows to import")
        if target["replace"]:
            incogniton.delete_cookies(target["profile_id"])
        written = incogniton.add_cookies(target["profile_id"], cookies)
        return {"entries": len(cookies), "written": written, "replaced": target["replace"]}
    # proxy_write: the first valid line in the file is applied to this profile.
    target = profile_target(payload)
    text = _read_text(target["path"])
    proxy = first_proxy(text)
    applied = incogniton.set_proxy(target["profile_id"], proxy)
    return {"entries": parse_proxies(text)["entries"], "applied": applied}
