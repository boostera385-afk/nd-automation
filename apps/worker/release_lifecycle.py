"""Offline, user-invoked signed releases. Never downloads or executes a manifest.

Release signing is an external publisher operation. There is NO unsigned bypass
in the CLI. Trust the publisher thumbprint through a separate reviewed channel.
"""
import argparse
import base64
from contextlib import ExitStack
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from uuid import uuid4

from worker_state import (assert_drained, atomic_json, device_lock, device_root,
                          ordinary_path, read_json, state_directory)

MANIFEST = "release-manifest.ps1"
PREFIX = "# ND-RELEASE-V1 "
PIN = re.compile(r"[A-F0-9]{40}")
HASH = re.compile(r"[a-f0-9]{64}")


def thumbprint(value):
    if not isinstance(value, str) or not PIN.fullmatch(value):
        raise ValueError("An exact uppercase reviewed publisher certificate thumbprint is required")
    return value


def verify_signature(path, trusted):
    thumbprint(trusted)
    if os.name != "nt": raise ValueError("Authenticode release verification requires Windows")
    system = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    literal = str(ordinary_path(path)).replace("'", "''")
    command = ("$s=Get-AuthenticodeSignature -LiteralPath '" + literal + "'; "
               "[pscustomobject]@{status=$s.Status.ToString();thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress")
    result = subprocess.run([str(system), "-NoProfile", "-NonInteractive", "-Command", command],
                            capture_output=True, text=True, check=True, timeout=30, shell=False,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    value = json.loads(result.stdout.lstrip("\ufeff"))
    if value.get("status") != "Valid" or value.get("thumbprint") != trusted:
        raise ValueError("Release signature/publisher trust failed")


def parse_manifest(data):
    if len(data) > 150000: raise ValueError("Release manifest too large")
    lines = data.decode("utf-8-sig").splitlines()
    if not lines or not lines[0].startswith(PREFIX): raise ValueError("Invalid release manifest")
    # Everything is a comment, including Authenticode's signature block. Even
    # trusted manifests are DATA ONLY and never passed to -File/Invoke-Expression.
    if any(line.strip() and not line.startswith("#") for line in lines[1:]):
        raise ValueError("Executable manifest content is forbidden")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError("Duplicate release fields")
            result[key] = value
        return result
    value = json.loads(base64.b64decode(lines[0][len(PREFIX):], validate=True), object_pairs_hook=unique)
    if (not isinstance(value, dict) or set(value) != {"version", "sequence", "python", "dependencies", "files"} or
        not isinstance(value["version"], str) or not re.fullmatch(r"[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}", value["version"]) or
        type(value["sequence"]) is not int or not 1 <= value["sequence"] <= 2**31-1 or
        not isinstance(value["python"], str) or not re.fullmatch(r"3\.(1[2-9]|[2-9][0-9])", value["python"])):
        raise ValueError("Invalid release identity/runtime")
    from preflight import DEPENDENCIES
    if value["dependencies"] != DEPENDENCIES: raise ValueError("Dependency pins require a bootstrap review, not silent drift")
    files = value["files"]
    if not isinstance(files, dict) or not 5 <= len(files) <= 100 or not {"agent.py", "worker_state.py", "release_lifecycle.py", "requirements-monitoring.txt", "preflight.py"} <= files.keys():
        raise ValueError("Incomplete worker release")
    for name, record in files.items():
        if (not re.fullmatch(r"[a-z][a-z0-9_]*\.py|requirements-monitoring\.txt", name) or name.startswith(("test_", "verify_")) or
            not isinstance(record, dict) or set(record) != {"bytes", "sha256"} or type(record["bytes"]) is not int or
            not 1 <= record["bytes"] <= 1_000_000 or not isinstance(record["sha256"], str) or not HASH.fullmatch(record["sha256"])):
            raise ValueError("Release contains unapproved paths/size/hash")
    return value


def read_release(source, trusted, signature_check=None):
    source = ordinary_path(source)
    path = ordinary_path(source / MANIFEST)
    data = path.read_bytes()
    manifest = parse_manifest(data)
    # Verify a private immutable snapshot, not a source path that could be swapped
    # after signature verification. No candidate code is imported during checks.
    with tempfile.TemporaryDirectory(prefix="nd-release-") as directory:
        snapshot = Path(directory) / MANIFEST
        snapshot.write_bytes(data)
        (signature_check or verify_signature)(snapshot, thumbprint(trusted))
    names = set()
    for child in source.iterdir():
        ordinary_path(child)
        if not child.is_file(): raise ValueError("Unexpected release directory")
        names.add(child.name)
    if names != set(manifest["files"]) | {MANIFEST}: raise ValueError("Unlisted files in release")
    payload = {MANIFEST: data}
    for name, expected in manifest["files"].items():
        path = ordinary_path(source / name)
        with path.open("rb") as stream: content = stream.read(1_000_001)
        if len(content) != expected["bytes"] or hashlib.sha256(content).hexdigest() != expected["sha256"]:
            raise ValueError("Release file integrity mismatch")
        payload[name] = content
    return manifest, payload


def require_release_runtime(manifest):
    if manifest["python"] != f"{sys.version_info.major}.{sys.version_info.minor}": raise ValueError("Use the release's reviewed Python minor version")
    for name, expected in manifest["dependencies"].items():
        if metadata.version(name) != expected: raise ValueError("Pinned runtime is not installed; no automatic package installation")


def installed_pointer():
    path = device_root() / "active-release.json"
    if not path.exists(): return None
    value = read_json(path)
    if (not isinstance(value, dict) or set(value) != {"version", "publisher", "active", "previous", "highest_sequence"} or
        value["version"] != 1 or type(value["highest_sequence"]) is not int or
        not isinstance(value["active"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["active"]) or
        (value["previous"] is not None and (not isinstance(value["previous"], str) or not HASH.fullmatch(value["previous"])) )):
        raise ValueError("Invalid installed-release pointer")
    thumbprint(value["publisher"])
    return value


def switch_release(source=None, trusted=None, rollback=False, signature_check=None, runtime_check=None):
    with ExitStack() as stack:
        for kind in ("lifecycle", "monitor", "writeback"): stack.enter_context(device_lock(kind))
        from worker_lock import monitoring_lock
        for name in ("monitor.lock", "writeback.lock"):
            stack.enter_context(monitoring_lock(Path(__file__).resolve().parent / ".worker-state" / name))
        state = state_directory()
        assert_drained(state)
        current = installed_pointer()
        if current and trusted != current["publisher"]: raise ValueError("Publisher change requires an explicit bootstrap trust review")
        if rollback:
            if not current or not current["previous"]: raise ValueError("No prior installed release to roll back to")
            source = device_root() / "releases" / current["previous"]
        manifest, payload = read_release(source, trusted, signature_check)
        (runtime_check or require_release_runtime)(manifest)
        identity = hashlib.sha256(payload[MANIFEST]).hexdigest()
        if rollback:
            if identity != current["previous"]: raise ValueError("Rollback release changed")
        elif current and manifest["sequence"] <= current["highest_sequence"]:
            raise ValueError("Stale/replayed release sequence; use explicit rollback to the previous installed release")
        target = ordinary_path(device_root() / "releases" / identity)
        if target.exists():
            # A partial installation is never executed or silently overwritten.
            read_release(target, trusted, signature_check)
        else:
            staging = ordinary_path(device_root() / "releases" / ("staging-" + uuid4().hex))
            staging.mkdir(mode=0o700, parents=True)
            for name, content in payload.items():
                with (staging / name).open("xb") as stream:
                    stream.write(content); stream.flush(); os.fsync(stream.fileno())
            read_release(staging, trusted, signature_check)
            os.replace(staging, target)
        # Atomic pointer is the ONLY switch. State/credentials stay outside releases.
        pointer = {"version": 1, "publisher": thumbprint(trusted), "active": identity,
                   "previous": current["active"] if current else None,
                   "highest_sequence": max(manifest["sequence"], current["highest_sequence"] if current else 0)}
        atomic_json(device_root() / "active-release.json", pointer)
        return {"state": "rolled_back" if rollback else "installed", "version": manifest["version"], "live_accepted": False}


def active_release():
    current = installed_pointer()
    if not current: return None
    source = ordinary_path(device_root() / "releases" / current["active"])
    manifest, payload = read_release(source, current["publisher"])
    if hashlib.sha256(payload[MANIFEST]).hexdigest() != current["active"]: raise ValueError("Active release identity changed")
    require_release_runtime(manifest)
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--trusted-publisher", required=True, help="Public certificate thumbprint verified out of band, never a private key")
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--confirm-stopped-all-old-workers", action="store_true")
    args = parser.parse_args()
    if args.install and args.rollback: parser.error("Choose install or rollback")
    if args.install or args.rollback:
        if not args.confirm_stopped_all_old_workers: parser.error("Stop all old checkouts/runners explicitly before switching")
        result = switch_release(args.source, args.trusted_publisher, args.rollback)
    else:
        manifest, _ = read_release(args.source, args.trusted_publisher)
        require_release_runtime(manifest)
        result = {"state": "verified_offline", "version": manifest["version"], "live_accepted": False}
    print(json.dumps(result))


if __name__ == "__main__":
    try: main()
    except (ValueError, OSError, TypeError, KeyError, subprocess.SubprocessError, metadata.PackageNotFoundError):
        raise SystemExit("Release blocked; preserve state and inspect signature, runtime, active workers and checkpoints. No unsigned fallback.")
