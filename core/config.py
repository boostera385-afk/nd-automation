import json
import os
import tempfile
import threading

# Resolve the config next to the project, not next to the current working
# directory - otherwise settings silently save to the wrong place when the app
# is started from somewhere else.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_FILE = os.path.join(PROJECT_ROOT, "config.json")

_lock = threading.RLock()


def load_config():
    with _lock:
        if not os.path.exists(CONFIG_FILE):
            return {}
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError, UnicodeDecodeError):
            return {}


def save_config(config_data):
    with _lock:
        # Write to a temp file first so a crash cannot leave config.json empty.
        directory = os.path.dirname(CONFIG_FILE) or "."
        handle = None
        temp_path = None
        try:
            fd, temp_path = tempfile.mkstemp(prefix=".config", suffix=".tmp", dir=directory)
            handle = os.fdopen(fd, "w", encoding="utf-8")
            json.dump(config_data, handle, indent=4)
            handle.flush()
            os.fsync(handle.fileno())
            handle.close()
            handle = None
            os.replace(temp_path, CONFIG_FILE)
            temp_path = None
        except OSError:
            # Fall back to a direct write rather than losing the setting.
            try:
                with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(config_data, f, indent=4)
            except OSError:
                pass
        finally:
            if handle is not None:
                try:
                    handle.close()
                except OSError:
                    pass
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass


def get_setting(key, default=None):
    return load_config().get(key, default)


def set_setting(key, value):
    with _lock:
        config = load_config()
        config[key] = value
        save_config(config)
