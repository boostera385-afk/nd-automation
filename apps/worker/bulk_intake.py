"""Local-only bounded cookie/proxy intake. Preview never queues or executes tasks.

Stores only DPAPI ciphertext. Apply via the EXISTING one-profile dashboard task
queue, preserving session, ownership, stopped-profile and recovery gates.
No directory watcher, auto-import, proxy evasion or remotely supplied code.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
from uuid import UUID, uuid4

from automation_tasks import MAX_FILE_BYTES, parse_cookie_entries, _proxy_entries
from private_vault import protect, unprotect
from worker_state import device_root, ordinary_path, read_json

MAX_ROWS = 100
MAGIC = b"ND-INTAKE-1\n"


def canonical_id(value):
    if not isinstance(value, str) or str(UUID(value)) != value: raise ValueError("Use exact canonical profile UUIDs, not names")
    return value


def validate_text(kind, text):
    if kind == "cookie_write":
        # Unlike the legacy permissive single-file parser, bulk preview refuses
        # ANY malformed row rather than silently losing cookies/fields.
        meaningful = [line for line in text.splitlines() if line.strip() and (not line.lstrip().startswith("#") or line.startswith("#HttpOnly_"))]
        if not meaningful or len(meaningful) > 5000: raise ValueError("Cookie rows exceed the supported bound")
        for line in meaningful:
            fields = line.removeprefix("#HttpOnly_").split("\t")
            if (len(fields) != 7 or not re.fullmatch(r"\.?[A-Za-z0-9.-]{1,253}", fields[0]) or
                fields[1] not in {"TRUE", "FALSE"} or not fields[2].startswith("/") or
                fields[3] not in {"TRUE", "FALSE"} or not fields[4].isdigit() or not fields[5]):
                raise ValueError("Every cookie row must be valid seven-column Netscape format")
        if len(parse_cookie_entries(text)) != len(meaningful): raise ValueError("Cookie parser mismatch")
        return len(meaningful)
    if kind != "proxy_write": raise ValueError("Only cookie/proxy intake is supported")
    lines = [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    if len(lines) != 1: raise ValueError("Each profile needs exactly one proxy, never first-line guessing")
    line = lines[0].strip()
    if "://" in line:
        scheme, line = line.split("://", 1)
        if scheme not in {"http", "https", "socks4", "socks5", "socks5h"}: raise ValueError("Unsupported proxy type")
    fields = line.split(":")
    if (len(fields) not in {2, 4} or not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", fields[0]) or
        (len(fields) == 4 and (not fields[2] or not fields[3])) or len(list(_proxy_entries(text))) != 1):
        raise ValueError("Invalid proxy format; IPv6/colon-containing credentials need a separate reviewed format")
    return 1


def preview(value):
    if not isinstance(value, dict) or set(value) != {"version", "rows"} or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Invalid local bulk manifest")
    rows = value["rows"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS: raise ValueError("Choose 1–100 explicit profile rows")
    seen, prepared, total = set(), [], 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"profile_id", "kind", "source", "replace"} or type(row["replace"]) is not bool:
            raise ValueError("Unexpected intake row fields")
        profile = canonical_id(row["profile_id"])
        key = (profile, row["kind"])
        if key in seen: raise ValueError("Duplicate profile/type mapping")
        seen.add(key)
        if row["kind"] == "proxy_write" and row["replace"]: raise ValueError("Proxy rows cannot clear cookies")
        path = ordinary_path(row["source"])
        if not path.is_file(): raise ValueError("Intake source must be an ordinary file")
        with path.open("rb") as stream: data = stream.read(MAX_FILE_BYTES + 1)
        total += len(data)
        if len(data) > MAX_FILE_BYTES or total > 20_000_000: raise ValueError("Batch exceeds local byte budget")
        text = data.decode("utf-8-sig")
        count = validate_text(row["kind"], text)
        prepared.append({"profile_id": profile, "kind": row["kind"], "replace": row["replace"], "text": text, "entries": count})
    return prepared


def stage(value, reason, permitted=False, confirmed=False, encrypt=None):
    if not permitted or not confirmed or reason not in {"authorized_migration", "authorized_recovery", "authorized_network_proxy"}:
        raise ValueError("Confirm necessity, permitted use and local protected storage explicitly")
    prepared = preview(value)  # Validate the ENTIRE batch before writing anything.
    root = ordinary_path(device_root() / "private" / "intake" / str(uuid4()))
    expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    encrypted = []
    for row in prepared:
        private = {"version": 1, "profile_id": row["profile_id"], "kind": row["kind"], "replace": row["replace"], "text": row["text"], "expires_at": expires}
        ciphertext = (encrypt or protect)(json.dumps(private).encode())
        encrypted.append(MAGIC + ciphertext)
    root.mkdir(mode=0o700, parents=True)
    result = []
    for number, (row, data) in enumerate(zip(prepared, encrypted), 1):
        path = root / (str(uuid4()) + ".private.bin")
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
        result.append({"row": number, "profile_id": row["profile_id"], "kind": row["kind"], "replace": row["replace"], "entries": row["entries"], "path": str(path)})
    return {"state": "staged_not_queued", "expires_at": expires, "rows": result}


def read_staged(path, kind, profile, replace, decrypt=None):
    path = ordinary_path(path)
    path.relative_to(device_root() / "private" / "intake")
    with path.open("rb") as stream: data = stream.read(6_000_001)
    if not data.startswith(MAGIC) or len(data) > 6_000_000: raise ValueError("Invalid protected intake file")
    value = json.loads((decrypt or unprotect)(data[len(MAGIC):]))
    if (not isinstance(value, dict) or set(value) != {"version", "profile_id", "kind", "replace", "text", "expires_at"} or
        type(value["version"]) is not int or value["version"] != 1 or type(value["replace"]) is not bool or
        value["profile_id"] != profile or value["kind"] != kind or value["replace"] != replace):
        raise ValueError("Protected intake does not match the exact authorized task")
    expires = datetime.fromisoformat(value["expires_at"])
    if expires.tzinfo is None or not datetime.now(timezone.utc) < expires <= datetime.now(timezone.utc) + timedelta(hours=24, minutes=1):
        raise ValueError("Protected intake expired or has an invalid lifetime")
    validate_text(kind, value["text"])
    return value["text"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--stage", action="store_true")
    parser.add_argument("--reason", choices=["authorized_migration", "authorized_recovery", "authorized_network_proxy"])
    parser.add_argument("--confirm-permitted-use", action="store_true")
    parser.add_argument("--confirm-local-protected-storage", action="store_true")
    args = parser.parse_args()
    value = read_json(args.manifest)
    if args.stage:
        result = stage(value, args.reason, args.confirm_permitted_use, args.confirm_local_protected_storage)
    else:
        rows = preview(value)
        result = {"state": "preview_only", "network_calls": 0, "rows": [{key: row[key] for key in ("profile_id", "kind", "replace", "entries")} for row in rows]}
    print(json.dumps(result))


if __name__ == "__main__":
    try: main()
    except (ValueError, OSError, TypeError, KeyError): raise SystemExit("Bulk intake stopped. Review the local manifest privately; no raw credentials or parser errors are printed.")
