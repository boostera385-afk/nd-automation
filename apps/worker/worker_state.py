"""Stable per-user state across release directories; never silently drop journals."""
import argparse
from contextlib import ExitStack, contextmanager
import hashlib
import json
import os
from pathlib import Path
import tempfile

JOURNALS = {"monitoring-journal.json", "publishing-journal.json", "automation-journal.json", "writeback-journal.json"}


def ordinary_path(path):
    path = Path(path)
    if not path.is_absolute() or str(path).startswith(("\\\\", "//")) or ".." in path.parts:
        raise ValueError("An absolute private local state path is required")
    for part in (path, *path.parents):
        if part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError("Linked state paths are not supported")
    return path


def device_root():
    explicit = os.environ.get("ND_WORKER_HOME")
    if explicit:
        return ordinary_path(explicit)
    base = os.environ.get("LOCALAPPDATA") if os.name == "nt" else str(Path.home() / ".local" / "state")
    if not base:
        raise ValueError("Private worker home unavailable")
    return ordinary_path(Path(base) / "NDAutomation" / "worker")


def atomic_json(path, value):
    ordinary_path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".nd-state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def read_json(path, maximum=100000):
    path = ordinary_path(path)
    with path.open("rb") as stream:
        data = stream.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Private state exceeded its bound")
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value: raise ValueError("Duplicate private state fields")
            value[key] = item
        return value
    return json.loads(data, object_pairs_hook=unique)


def legacy_files(checkout):
    legacy = ordinary_path(Path(checkout) / ".worker-state")
    if not legacy.exists(): return {}
    entries = {}
    for path in legacy.iterdir():
        if path.name.endswith(".lock") or path.name == "shared-state.json": continue
        ordinary_path(path)
        if path.name not in JOURNALS or not path.is_file() or path.stat().st_size > 1_000_000:
            raise ValueError("Unknown legacy state requires operator review")
        entries[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return entries


def state_directory(checkout=None):
    checkout = Path(checkout) if checkout else Path(__file__).resolve().parent
    root = device_root() / "state"
    entries = legacy_files(checkout)
    if entries:
        marker = read_json(checkout / ".worker-state" / "shared-state.json") if (checkout / ".worker-state" / "shared-state.json").exists() else None
        if marker != {"version": 1, "target": str(root), "source_sha256": entries}:
            raise ValueError("Legacy journals require explicit worker_state.py migration; nothing was discarded")
        if any(not (root / name).is_file() for name in entries):
            raise ValueError("Migrated checkpoint missing from shared state")
    return root


@contextmanager
def device_lock(kind="monitor"):
    # Imported lazily so worker_lock remains a small standalone primitive.
    from worker_lock import monitoring_lock
    if kind not in {"monitor", "writeback", "lifecycle"}: raise ValueError("Unknown worker lock")
    with monitoring_lock(ordinary_path(device_root() / (kind + ".lock"))):
        yield


@contextmanager
def execution_lock(path):
    """All new versions share a lock; also exclude old runners in THIS checkout."""
    from worker_lock import monitoring_lock
    kind = "writeback" if Path(path).name == "writeback.lock" else "monitor"
    legacy = Path(__file__).resolve().parent / ".worker-state" / Path(path).name
    with ExitStack() as stack:
        stack.enter_context(device_lock(kind))
        stack.enter_context(monitoring_lock(legacy))
        state_directory()  # Recheck legacy fingerprints AFTER excluding old local runners.
        stack.enter_context(monitoring_lock(path))
        yield


def assert_drained(state):
    for name in JOURNALS:
        path = state / name
        if not path.exists(): continue
        value = read_json(path, 1_000_000)
        if not isinstance(value, dict): raise ValueError("Invalid checkpoint format")
        from automation_journal import AutomationJournal
        from monitoring_journal import MonitoringJournal
        from publishing_journal import PublishingJournal
        from sheet_writeback import WritebackJournal
        classes = {"automation-journal.json": AutomationJournal, "monitoring-journal.json": MonitoringJournal,
                   "publishing-journal.json": PublishingJournal, "writeback-journal.json": WritebackJournal}
        journal = object.__new__(classes[name])
        journal.path, journal.scope = path, value.get("scope")
        journal.read()  # Full existing format validation, no network or credentials.
        # Conservative: unknown formats/states block rather than being "fixed".
        allowed = {"settled"} if name == "writeback-journal.json" else {"acknowledged", "operator_reconciled"}
        if value.get("state") not in allowed or any(
            value.get(flag, False) is not False for flag in ("cleanup_required", "inspection_required")):
            raise ValueError("Resolve all checkpoints before switching worker versions")


def migrate(checkout):
    """Explicit copy + fingerprint marker; originals and ambiguous results survive."""
    from worker_lock import monitoring_lock
    checkout = ordinary_path(checkout)
    target = device_root() / "state"
    with ExitStack() as stack:
        for kind in ("lifecycle", "monitor", "writeback"): stack.enter_context(device_lock(kind))
        for name in ("monitor.lock", "writeback.lock"): stack.enter_context(monitoring_lock(checkout / ".worker-state" / name))
        entries = legacy_files(checkout)
        for name, digest in entries.items():
            source = checkout / ".worker-state" / name
            read_json(source, 1_000_000)  # Well-formed bounded JSON, not an outcome attestation.
            destination = target / name
            if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                raise ValueError("Shared state already differs; reconcile it without overwriting")
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name in entries:
            destination = target / name
            if not destination.exists():
                with destination.open("xb") as stream:
                    stream.write((checkout / ".worker-state" / name).read_bytes()); stream.flush(); os.fsync(stream.fileno())
        atomic_json(checkout / ".worker-state" / "shared-state.json", {"version": 1, "target": str(target), "source_sha256": entries})
    return {"state": "copied_not_reconciled", "journals": len(entries), "originals_preserved": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--migrate-from", type=Path, required=True)
    parser.add_argument("--confirm-stopped-all-old-workers", action="store_true", required=True)
    args = parser.parse_args()
    print(json.dumps(migrate(args.migrate_from)))


if __name__ == "__main__":
    try: main()
    except (ValueError, OSError): raise SystemExit("State migration stopped; preserve all originals and reconcile privately.")
