"""Register operator-selected local images and print public descriptors, not paths.

Offline only. No upload, browser, approval, database write or source modification.
The private registry contains paths; store it under the ignored .monitoring folder.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from uuid import uuid4

from publishing_media import MIMES, read_image, validate_media, validate_registry
from sheet_writeback import load_private
from worker_lock import monitoring_lock


def stage(paths, registry_path, rights=False, privacy=False):
    if rights is not True or privacy is not True or not 1 <= len(paths) <= 10:
        raise ValueError("Explicit rights/privacy review and 1–10 local images are required")
    target = Path(registry_path)
    lock = target.with_suffix(".lock")
    if lock.is_symlink() or target.is_symlink() or target.parent.is_symlink():
        raise ValueError("Unsafe registry location")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with monitoring_lock(lock):
        return _stage(paths, target)


def _stage(paths, target):
    registry = validate_registry(load_private(target)) if target.exists() else {"version": 1, "assets": {}}
    result = []
    for raw in paths:
        path = Path(raw)
        data, mime = read_image(path)
        identity = str(uuid4())
        result.append({"id": identity, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "mime": mime,
                       "name": identity + MIMES[mime], "rightsConfirmed": True, "privacyReviewed": True})
        registry["assets"][identity] = str(path)
    validate_media(result)
    validate_registry(registry)
    encoded = json.dumps(registry).encode()
    if len(encoded) > 100000:
        raise ValueError("Registry exceeded its private storage bound")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, name = tempfile.mkstemp(prefix=".media-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--files", nargs="+", required=True)
    parser.add_argument("--confirm-rights", action="store_true")
    parser.add_argument("--confirm-privacy", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(stage(args.files, args.registry, args.confirm_rights, args.confirm_privacy)))
        return 0
    except (ValueError, OSError, TypeError, RuntimeError):
        print(json.dumps({"state": "blocked", "message": "Local media registration failed validation or private storage. No upload or approval occurred; paths and raw errors are withheld."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
