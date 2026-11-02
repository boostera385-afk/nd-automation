"""Create a secret-screened source QA archive, never a live-acceptance certificate.

Uses tracked plus non-ignored working files so tested, uncommitted fixes are not
silently omitted. Never copies git history, dependencies, local config or exports.
"""

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

EXCLUDED_DIRS = {".git", ".agents", ".opencode", ".freebuff", ".vercel", ".next", ".venv", "venv",
                 "node_modules", "__pycache__", ".pytest_cache", ".monitoring", ".worker-state",
                 "backups", "exports", "screenshots", "coverage", ".playwright-mcp"}
EXCLUDED_NAMES = {"config.json", "worker.json", "adapter.json", "cookies.txt", "proxies.txt", "opencode.json"}
SOURCE_SUFFIXES = {".py", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".css", ".html", ".gs", ".json", ".md", ".txt",
                   ".toml", ".yml", ".yaml", ".bat", ".ps1", ".sql", ".ini", ".svg", ".png", ".ico", ".woff", ".woff2", ".ttf"}
SPECIAL_NAMES = {".gitignore", ".gitattributes", ".editorconfig", ".vercelignore", ".env.example"}
BINARY_SUFFIXES = {".png", ".ico", ".woff", ".woff2", ".ttf"}
SECRET_PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "secret_key": re.compile(r"\bsb_secret_[A-Za-z0-9_-]{20,}"),
    "management_token": re.compile(r"\bsbp_[A-Za-z0-9]{20,}"),
    "openai_key": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"),
    "private_sheet_link": re.compile(r"https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{30,}"),
}
# Reviewed, intentionally invalid negative-test value; no broad test-file bypass.
FIXTURE_EXCEPTIONS = {("nd-dashboard", "apps/web/tests/env.test.ts", "secret_key", "sb_secret_" + "fixture_not_for_clients")}


def allowed_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or ".." in path.parts or "\\" in name:
        return False
    if any(part.lower() in EXCLUDED_DIRS for part in path.parts[:-1]):
        return False
    base = path.name.lower()
    if base in EXCLUDED_NAMES or ".private." in base or base.endswith((".private", ".key", ".pem", ".p12", ".pfx", ".har", ".log", ".zip", ".crx")):
        return False
    if base.startswith(".env") and base != ".env.example":
        return False
    return base in SPECIAL_NAMES or path.suffix.lower() in SOURCE_SUFFIXES


def secret_findings(component, name, data):
    if PurePosixPath(name).suffix.lower() in BINARY_SUFFIXES:
        return []
    text = data.decode("utf-8", errors="replace")
    findings = []
    for label, pattern in SECRET_PATTERNS.items():
        for match in pattern.finditer(text):
            if (component, name, label, match.group()) not in FIXTURE_EXCEPTIONS:
                findings.append(label)
    return sorted(set(findings))


def git(root, *arguments):
    return subprocess.check_output(["git", *arguments], cwd=root).decode("utf-8").strip()


def source_files(root):
    raw = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root)
    return sorted(set(filter(None, raw.decode("utf-8").split("\0"))))


def checked_file(root, name):
    path = root / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("Archive input must be an ordinary source file: " + name)
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        raise ValueError("Archive input escapes its source root: " + name) from None
    data = path.read_bytes()
    if len(data) > 5_000_000:
        raise ValueError("Unexpectedly large source file; review before distribution: " + name)
    return data


def validate_fudge(files):
    manifest = json.loads(files["manifest.json"])
    config = files["config.js"].decode("utf-8")
    if not re.search(r'\bapiKey\s*:\s*([\'"])\1', config):
        raise ValueError("fudge config.js must have an explicitly empty API key")
    script = files["apps-script.gs"].decode("utf-8")
    if 'const FUDGE_SECRET = "__FUDGE_SECRET__";' not in script:
        raise ValueError("Ship the generic connector template, never an installation's generated secret")
    connector = int(re.search(r"const FUDGE_CONNECTOR_VERSION = (\d+);", script)[1])
    required = int(re.search(r"REQUIRED_CONNECTOR_VERSION = (\d+);", files["sheets.js"].decode("utf-8"))[1])
    if connector != required:
        raise ValueError("Connector template/extension version mismatch")
    backend = files["backend-worker.js"].decode("utf-8")
    if not all(re.search(r"const " + flag + r" = false;", backend) for flag in ("UPLOAD_RELEASED", "CATALOG_DOWNLOAD_RELEASED")):
        raise ValueError("Backend release gates changed; this QA packager requires separate release review")
    references = [manifest["background"]["service_worker"], manifest["side_panel"]["default_path"]]
    references += [name for entry in manifest.get("content_scripts", []) for name in entry.get("js", [])]
    references += list(manifest.get("icons", {}).values())
    for name, data in files.items():
        if name.endswith(".html") and "/" not in name:
            for reference in re.findall(r'(?:src|href)="([^"#]+)"', data.decode("utf-8")):
                if ":" not in reference and not reference.startswith("//"):
                    references.append(reference.split("?")[0])
    missing = sorted(set(name for name in references if name not in files))
    if missing:
        raise ValueError("Packaged extension resource missing: " + ", ".join(missing))
    digest = hashlib.sha256(base64.b64decode(manifest["key"])).hexdigest()[:32]
    extension_id = "".join(chr(97 + int(char, 16)) for char in digest)
    return {"version": manifest["version"], "connectorVersion": connector, "extensionId": extension_id,
            "backendUploadReleased": False, "catalogDownloadReleased": False}


README = """# nd + fudge source QA candidate

This archive contains source and reviewed fixtures, NOT client production acceptance.
Read RELEASE-STATUS.json and each project's implementation-status/setup documents.
There are no production credentials, browser profiles, local libraries, backups,
customer exports, node_modules or Python virtual environments in this archive.
Install dependencies and configure the client's own authorized accounts privately.

fudge: Load the unpacked fudge/ folder in Chrome. For an existing installation,
update its existing directory and Reload; do not remove/re-add and lose local data.
Copy the protected connector from the extension's setup button, not raw apps-script.gs.
Deploy that copy in the client's own Sheet. Keep the generated secret private.
Check model access, then test rephrasing and one authorized collection/Sheet cycle.
Never present another customer's experience as the client's own testimonial.

nd-dashboard: See README.md, apps/worker/README.md and docs/SUPERVISED-PUBLISHING.md.
The deployed dashboard is https://nd-automation-dashboard.vercel.app.
Current source includes the separate Sheet deliverer, automatic mappings, atomic
connector, bounded scheduling/bulk and approved images; see the current status and
docs/SHEET-WRITEBACK-SETUP.md. This source is newer than the last verified
production build (0.1.1); packaging does not deploy, configure or enable anything.
Private pairing, exact profile/customer mapping, Incogniton and authorized live
acceptance are required. Never blindly replay all historical migrations against
an existing database; check its migration history first. Text publishing is a
separate explicitly authorized one-job pilot; no challenge/suspension evasion.

Remaining release gates include real browser/Google/model acceptance, live ND
pilot, access-isolation/recovery/image/rights/schedule/mapping acceptance, remaining
attachment-preserving edits/evidence/bulk-intake/device implementation and unreleased fudge gates.
Do not describe this QA archive as fully production-ready or 100% bug-free.
"""


def build(fudge_root, nd_root, output):
    roots = {"fudge": Path(fudge_root).resolve(), "nd-dashboard": Path(nd_root).resolve()}
    bundle, records, sources = {}, {}, {}
    failures = []
    for component, root in roots.items():
        sources[component] = {"baseCommit": git(root, "rev-parse", "HEAD"), "workingTreeModified": bool(git(root, "status", "--porcelain"))}
        files = {}
        for name in source_files(root):
            if not allowed_path(name):
                continue
            data = checked_file(root, name)
            findings = secret_findings(component, name, data)
            if findings:
                failures.append({"file": component + "/" + name, "kinds": findings})
            files[name] = data
            archive_name = component + "/" + name
            bundle[archive_name] = data
            records[archive_name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        sources[component]["files"] = len(files)
        if component == "fudge":
            sources[component]["release"] = validate_fudge(files)
        else:
            sources[component]["release"] = {"version": json.loads(files["apps/web/package.json"])["version"]}
    if failures:
        raise ValueError("Package refused: possible private content (values withheld): " + json.dumps(failures))
    stamp = datetime.now(timezone.utc)
    manifest = {"formatVersion": 1, "createdAt": stamp.isoformat(), "deliveryState": "qa_candidate",
                "liveAccepted": False, "sources": sources, "files": records,
                "securityScope": "Path exclusions, ordinary-file checks and targeted secret patterns; not proof of complete credential absence."}
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    target = output / ("nd-fudge-source-qa-" + stamp.strftime("%Y%m%dT%H%M%S%fZ") + ".zip")
    with ZipFile(target, "x", ZIP_DEFLATED) as archive:
        for name, data in sorted(bundle.items()):
            archive.writestr(name, data)
        archive.writestr("RELEASE-STATUS.json", json.dumps(manifest, indent=2))
        archive.writestr("START-HERE.md", README)
    with ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError("Archive integrity check failed")
        for name, record in records.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != record["sha256"]:
                raise ValueError("Archive source hash mismatch")
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    # Sidecar contains only a public artifact checksum, never local source paths.
    target.with_suffix(".sha256").write_text(checksum + "  " + target.name + "\n", encoding="utf-8")
    return {"archive": str(target), "sha256": checksum, "files": len(records),
            "deliveryState": "qa_candidate", "liveAccepted": False,
            "versions": {name: value["release"] for name, value in sources.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fudge", required=True, type=Path)
    parser.add_argument("--dashboard", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.fudge, args.dashboard, args.output), indent=2))


if __name__ == "__main__":
    main()
