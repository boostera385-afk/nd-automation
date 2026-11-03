"""One fixed Windows URI -> locally approved Incogniton application launch only.

No listener, credentials in URLs, arbitrary commands or remotely supplied args.
The URL's caller cannot be authenticated by Windows: require a native confirmation
on every launch, even if the browser remembers its external-app permission.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

OPEN_URI = "nd-automation://open-incogniton"
HELPER_URI = "nd-automation://start-profile-helper"
CONFIG_NAME = "desktop-launch.json"


def normalize_uri(value):
    """Return only a fixed dashboard action.

    Windows/browsers hand `nd-automation://start-profile-helper` to the handler as
    `nd-automation://start-profile-helper/` (empty path normalized to "/"), so one
    trailing slash is tolerated. Everything else - queries, fragments, extra
    segments, encoded text, extra arguments - is refused before any local state
    is read.
    """
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("Only a fixed dashboard action is supported")
    scheme, separator, action = value.partition("://")
    if separator != "://" or scheme.strip().lower() != "nd-automation":
        raise ValueError("Only a fixed dashboard action is supported")
    if action.endswith("/"):
        action = action[:-1]
    candidate = "nd-automation://" + action
    if candidate not in {OPEN_URI, HELPER_URI}:
        raise ValueError("Only a fixed dashboard action is supported")
    return candidate


def local_file(value):
    if not isinstance(value, str) or any(ord(char) < 32 or char == '"' for char in value) or value.startswith(("\\\\", "//")):
        raise ValueError("A local file is required")
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("An exact absolute local file is required")
    for part in (path, *path.parents):
        if part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError("Linked installation paths are not supported")
    if not path.is_file():
        raise ValueError("The configured local file is missing")
    return path


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_config(value):
    if not isinstance(value, dict) or set(value) != {"version", "executable", "sha256"} or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Local launcher setup is incomplete")
    path = local_file(value["executable"])
    if path.name.lower() != "incogniton.exe" or not isinstance(value["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["sha256"]):
        raise ValueError("A reviewed Incogniton executable is required")
    if file_hash(path) != value["sha256"]:
        raise ValueError("Incogniton changed since setup; review the update before reconnecting")
    return path


def verify_publisher(path):
    # Fixed system tool and safely quoted LiteralPath; URI text is never used.
    powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    literal = str(path).replace("'", "''")
    command = ("$s=Get-AuthenticodeSignature -LiteralPath '" + literal + "'; "
               "[pscustomobject]@{status=$s.Status.ToString();subject=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress")
    result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", command],
                            capture_output=True, text=True, timeout=20, check=True, shell=False,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    signature = json.loads(result.stdout.lstrip("\ufeff"))
    if signature.get("status") != "Valid" or not re.search(r"(?:^|,\s*)CN=WorkingGreen B\.V\.(?:,|$)", signature.get("subject", "")):
        raise ValueError("Incogniton must have a valid reviewed WorkingGreen B.V. publisher signature")


def config_path():
    base = os.environ.get("LOCALAPPDATA", "")
    if not base or not Path(base).is_absolute() or base.startswith(("\\\\", "//")):
        raise ValueError("A private local Windows user directory is required")
    return Path(base) / "NDAutomation" / CONFIG_NAME


def load_config(path):
    path = local_file(str(path))
    if path.stat().st_size > 4096:
        raise ValueError("Local launcher configuration is invalid")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate local configuration fields")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def open_incogniton(uri, config, confirm, spawn=None, publisher_check=None):
    if normalize_uri(uri) != OPEN_URI:
        raise ValueError("Only the fixed Open Incogniton action is supported")
    executable = validate_config(config)
    check = publisher_check or verify_publisher
    check(executable)
    if not confirm(executable):
        return "cancelled"
    # Reject a changed executable after the local operator's confirmation.
    executable = validate_config(config)
    check(executable)
    (spawn or subprocess.Popen)([str(executable)], cwd=str(executable.parent), shell=False, close_fds=True)
    return "launch_requested"  # Not a claim of API readiness, login or profile state.


def start_profile_helper(uri, confirm, spawn=None, root=None):
    if normalize_uri(uri) != HELPER_URI:
        raise ValueError("Only the fixed profile-helper action is supported")
    from worker_connection import validate_connection
    if root is None:
        from release_lifecycle import active_release
        from worker_state import device_root
        installed = active_release()
        root = installed or Path(__file__).resolve().parent
        private = device_root() / "private" / "worker.json"
        connection_path = local_file(str(private if private.exists() else Path(__file__).resolve().parent / ".monitoring" / "worker.json"))
    else:
        connection_path = local_file(str(root / ".monitoring" / "worker.json"))
    validate_connection(load_config(connection_path))  # Never display or forward it in a URI.
    script = local_file(str(root / "agent.py"))
    interpreter = Path(sys.executable).with_name("python.exe")
    interpreter = local_file(str(interpreter))
    if not confirm(script):
        return "cancelled"
    (spawn or subprocess.Popen)([str(interpreter), str(script), "--connection", str(connection_path),
        "--tasks-only", "--execute", "--confirm-authorized"], cwd=str(root), shell=False,
        close_fds=True, creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
    return "helper_start_requested"  # Shared lock/recovery gates execute inside agent.py.


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if os.name != "nt" or len(arguments) != 1:
        return 1  # Reject extra arguments/URLs before reading any local state.
    try:
        action = normalize_uri(arguments[0])
    except ValueError:
        return 1
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk(); root.withdraw()
    try:
        if action == HELPER_URI:
            start_profile_helper(action, lambda _script: messagebox.askyesno("Start ND profile helper?",
                "Poll explicitly queued profile tasks for an eight-hour window? A bounded in-flight task may finish afterward.\n\nThis includes profile scans and, only if separately authorized in the dashboard, blank profile creation and cookie/proxy imports. Work-session gates still apply.\n\nNo monitoring browser, publishing or account workflow is started. Close the helper console with Ctrl+C to stop.", parent=root))
        else:
            open_incogniton(action, load_config(config_path()),
                lambda executable: messagebox.askyesno("ND dashboard", "Open your installed Incogniton app on this computer?\n\n"
                    "This does not start profiles, scan accounts or authorize publishing.\n\n" + str(executable), parent=root))
        return 0
    except Exception:
        messagebox.showerror("ND launcher needs attention", "The requested app/helper could not be started safely. Check one-time setup, the private helper connection or a reviewed app update. No success is claimed.", parent=root)
        return 1
    finally:
        root.destroy()


if __name__ == "__main__":
    raise SystemExit(main())
