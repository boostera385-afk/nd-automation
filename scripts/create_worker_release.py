"""Build an UNSIGNED offline candidate. Publisher must sign the data manifest.

Never includes credentials, checkpoints, dependencies, test scripts or exports.
This command cannot create a trusted release without a genuine external signer.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "worker"))
from preflight import DEPENDENCIES
from release_lifecycle import MANIFEST, PREFIX, parse_manifest
from build_client_package import secret_findings


def build(destination, version, sequence, python_minor):
    source = ROOT / "apps" / "worker"
    files = {}
    for path in source.iterdir():
        if path.suffix != ".py" and path.name != "requirements-monitoring.txt": continue
        if path.name.startswith(("test_", "verify_")): continue
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)(): raise ValueError("Linked release input")
        data = path.read_bytes()
        if secret_findings("nd-dashboard", "apps/worker/" + path.name, data): raise ValueError("Release input failed secret screening")
        files[path.name] = data
    manifest = {"version": version, "sequence": sequence, "python": python_minor, "dependencies": DEPENDENCIES,
                "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())}}
    signed_data = (PREFIX + base64.b64encode(json.dumps(manifest, sort_keys=True).encode()).decode() + "\r\n").encode()
    parse_manifest(signed_data)
    destination.mkdir(parents=True, exist_ok=False)
    for name, data in {**files, MANIFEST: signed_data}.items():
        with (destination / name).open("xb") as stream: stream.write(data)
    return {"state": "unsigned_candidate", "files": len(files), "live_accepted": False, "requires_external_authenticode_signing": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--python", default="3.13")
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.version, args.sequence, args.python)))
