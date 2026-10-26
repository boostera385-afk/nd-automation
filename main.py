import os
import sys
import traceback

import customtkinter as ctk

from core.config import PROJECT_ROOT, get_setting, set_setting
from gui.app import App

LOG_PATH = os.path.join(PROJECT_ROOT, "app_errors.log")


def _log_exception(exc_type, exc_value, exc_tb):
    """
    The launcher starts the app with pythonw, so there is no console to print
    a traceback to. Write crashes to a file instead of failing silently.
    """
    text = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as handle:
            import datetime
            handle.write(f"\n--- {datetime.datetime.now():%Y-%m-%d %H:%M:%S} ---\n{text}")
    except OSError:
        pass
    try:
        sys.__stderr__.write(text)
    except Exception:
        pass


def main():
    sys.excepthook = _log_exception

    # Appearance mode is remembered between runs.
    mode = str(get_setting("appearance_mode", "System"))
    if mode.lower() not in ("system", "dark", "light"):
        mode = "System"
    ctk.set_appearance_mode(mode)
    ctk.set_default_color_theme("blue")

    app = App()

    # Errors raised inside Tk callbacks should land in the log too.
    app.report_callback_exception = _log_exception

    app.mainloop()


if __name__ == "__main__":
    main()
