"""Explicit per-user Windows launcher setup; no admin, network download or autorun.

Run interactively, or with --remove to remove only this exact registered launcher.
Does not install/start the monitoring worker or change its credentials/journals.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

from desktop_bridge import config_path, file_hash, local_file, validate_config, verify_publisher
from desktop_bridge import load_config
from worker_connection import validate_connection

REGISTRY_ROOT = r"Software\Classes\nd-automation"


def handler_command():
    interpreter = Path(sys.executable).resolve()
    windowed = interpreter.with_name("pythonw.exe")
    if windowed.is_file():
        interpreter = windowed
    local_file(str(interpreter))
    script = local_file(str(Path(__file__).with_name("desktop_bridge.py").resolve()))
    return subprocess.list2cmdline([str(interpreter), str(script)]) + ' "%1"'


def existing_handler(registry):
    try:
        with registry.OpenKey(registry.HKEY_CURRENT_USER, REGISTRY_ROOT):
            return True
    except FileNotFoundError:
        return False


def install(executable, registry, destination=None, publisher_check=None):
    destination = destination or config_path()
    if existing_handler(registry) or destination.exists():
        raise ValueError("An existing launcher/setup was found; it will not be overwritten")
    executable = local_file(str(executable))
    value = {"version": 1, "executable": str(executable), "sha256": file_hash(executable)}
    validate_config(value)
    (publisher_check or verify_publisher)(executable)
    command = handler_command()
    # Check all existing ancestors; do not follow links into another installation.
    for part in (destination.parent, *destination.parent.parents):
        if part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError("Linked setup directories are not supported")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
    created = []
    try:
        for suffix, values in [("", {"": "URL:ND local launcher", "URL Protocol": ""}),
                               (r"\shell", {}), (r"\shell\open", {}), (r"\shell\open\command", {"": command})]:
            key_name = REGISTRY_ROOT + suffix
            with registry.CreateKeyEx(registry.HKEY_CURRENT_USER, key_name, 0, registry.KEY_WRITE) as key:
                created.append(key_name)
                for name, item in values.items():
                    registry.SetValueEx(key, name, 0, registry.REG_SZ, item)
    except Exception:
        # Only exact keys created by this attempt; unknown subkeys prevent deletion.
        for key_name in reversed(created):
            try:
                registry.DeleteKey(registry.HKEY_CURRENT_USER, key_name)
            except OSError:
                pass
        destination.unlink()
        raise
    return value


def remove(registry, destination=None):
    destination = destination or config_path()
    with registry.OpenKey(registry.HKEY_CURRENT_USER, REGISTRY_ROOT + r"\shell\open\command") as key:
        command, _ = registry.QueryValueEx(key, "")
    if command != handler_command():
        raise ValueError("This is another launcher's registration; nothing was removed")
    # Delete only known keys; unknown children fail closed, never recursive-delete.
    for suffix in (r"\shell\open\command", r"\shell\open", r"\shell", ""):
        registry.DeleteKey(registry.HKEY_CURRENT_USER, REGISTRY_ROOT + suffix)
    if destination.is_symlink():
        raise ValueError("Linked configuration was preserved")
    if destination.exists():
        destination.unlink()


def connect_helper(source, destination=None):
    """User-selected private connection only; never overwrite an existing pairing."""
    if destination is None:
        from worker_state import device_root
        legacy = Path(__file__).resolve().parent / ".monitoring" / "worker.json"
        if legacy.exists(): raise ValueError("Existing checkout connection found; reuse/review it before changing pairing")
        destination = device_root() / "private" / "worker.json"
    value = validate_connection(load_config(source))
    if destination.exists() or destination.is_symlink():
        raise ValueError("A helper connection already exists; review/revoke it before replacement")
    for part in (destination.parent, *destination.parent.parents):
        if part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError("Linked private directories are not supported")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
    except Exception:
        destination.unlink()
        raise
    return "connection_saved"  # Credential acceptance is checked only by a later explicit run.


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if os.name != "nt" or arguments not in ([], ["--remove"], ["--connect-helper"]):
        return 1
    import tkinter as tk
    from tkinter import filedialog, messagebox
    import winreg
    root = tk.Tk(); root.withdraw()
    try:
        if arguments == ["--connect-helper"]:
            selected = filedialog.askopenfilename(title="Select the private helper connection downloaded from your dashboard", filetypes=[("Private connection", "*.json")], parent=root)
            if not selected:
                return 0
            if not messagebox.askyesno("Save this private helper connection?", "Save this credential on this computer for explicitly authorized profile tasks? Existing connections are never replaced. No worker or task starts now.", parent=root):
                return 0
            connect_helper(selected)
            messagebox.showinfo("Connection saved", "Return to the dashboard and click Start profile helper. Confirm its heartbeat before treating it as connected. Delete the extra downloaded credential copy after checking setup; never share it.", parent=root)
        elif arguments == ["--remove"]:
            if messagebox.askyesno("Remove ND launcher?", "Remove this launcher's Windows link and its launch-only settings? Worker credentials, journals, Incogniton and desktop automation are not removed.", parent=root):
                remove(winreg)
        else:
            selected = filedialog.askopenfilename(title="Select your installed Incogniton.exe", filetypes=[("Incogniton", "Incogniton.exe")], parent=root)
            if not selected:
                return 0
            if not messagebox.askyesno("Connect the dashboard launcher?", "Allow the dashboard's Open Incogniton button to request a locally confirmed launch?\n\nNo profile is opened and no worker is started. The installed publisher signature and file hash will be checked.", parent=root):
                return 0
            install(selected, winreg)
            messagebox.showinfo("Launcher connected", "You can now click Open Incogniton in the dashboard. Profile detection and post checks still need the separately connected monitoring helper.", parent=root)
        return 0
    except Exception:
        messagebox.showerror("Setup stopped", "Setup could not finish safely. Existing registrations are never overwritten. Check the installed Incogniton publisher, Python path and any previous launcher setup. Worker state was not changed.", parent=root)
        return 1
    finally:
        root.destroy()


if __name__ == "__main__":
    raise SystemExit(main())
