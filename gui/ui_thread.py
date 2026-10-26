"""
Thread-safe GUI plumbing.

Tkinter (and therefore customtkinter) may only be touched from the thread that
created the window. Every automation in this app runs on background threads
that used to call `widget.configure(...)` directly, which is what caused the
random freezes, half-drawn views and hard crashes. Background threads now hand
their work to this module, and the main thread runs it from the Tk event loop.
"""

import queue
import threading
import traceback

_call_queue = queue.Queue()
_root = None
_installed = False

# Keep the log boxes from growing without bound - a very long textbox makes
# the whole window sluggish.
MAX_LOG_LINES = 1500


def install(root, interval_ms=40):
    """Starts the pump that drains queued callbacks on the Tk main thread."""
    global _root, _installed
    _root = root
    if _installed:
        return
    _installed = True

    def pump():
        drained = 0
        while drained < 300:
            try:
                func = _call_queue.get_nowait()
            except queue.Empty:
                break
            drained += 1
            try:
                func()
            except Exception:
                traceback.print_exc()
        try:
            root.after(interval_ms, pump)
        except Exception:
            # Window is gone.
            pass

    root.after(interval_ms, pump)


def post(func, *args, **kwargs):
    """Runs `func` on the Tk main thread (immediately if already on it)."""
    if threading.current_thread() is threading.main_thread():
        try:
            func(*args, **kwargs)
        except Exception:
            traceback.print_exc()
        return

    _call_queue.put(lambda: func(*args, **kwargs))


def shutdown():
    """Drops anything still queued (used while closing the window)."""
    global _installed
    _installed = False
    while True:
        try:
            _call_queue.get_nowait()
        except queue.Empty:
            return


class ThreadSafeViewMixin:
    """
    Shared, thread-safe helpers for the views.

    Expects the view to define `self.data_box` (a CTkTextbox) and, optionally,
    `self.status_label`, `self.fetch_btn`, `self.start_btn` and `self.stop_btn`.
    """

    def ui_post(self, func, *args, **kwargs):
        post(func, *args, **kwargs)

    # --- logging ---------------------------------------------------------
    def log(self, message):
        post(self._append_log, str(message))

    def clear_log(self):
        post(self._clear_log)

    def _append_log(self, message):
        box = getattr(self, "data_box", None)
        if box is None:
            print(message)
            return
        try:
            if not box.winfo_exists():
                return
            box.configure(state="normal")
            box.insert("end", f"\n{message}")

            line_count = int(str(box.index("end-1c")).split(".")[0])
            if line_count > MAX_LOG_LINES:
                box.delete("1.0", f"{line_count - MAX_LOG_LINES}.0")

            box.see("end")
            box.configure(state="disabled")
        except Exception:
            # The view may have been destroyed between the post and the call.
            pass

    def _clear_log(self):
        box = getattr(self, "data_box", None)
        if box is None:
            return
        try:
            if not box.winfo_exists():
                return
            box.configure(state="normal")
            box.delete("1.0", "end")
            box.configure(state="disabled")
        except Exception:
            pass

    # --- status + buttons ------------------------------------------------
    def set_status(self, text, color="gray"):
        post(self._set_status, text, color)

    def _set_status(self, text, color):
        label = getattr(self, "status_label", None)
        if label is None:
            return
        try:
            if label.winfo_exists():
                label.configure(text=text, text_color=color)
        except Exception:
            pass

    def set_widget_state(self, widget, state):
        post(self._set_widget_state, widget, state)

    def _set_widget_state(self, widget, state):
        try:
            if widget is not None and widget.winfo_exists():
                widget.configure(state=state)
        except Exception:
            pass

    def set_idle_controls(self, can_start=True):
        """Back to the 'not running' button layout."""
        self.set_widget_state(getattr(self, "fetch_btn", None), "normal")
        self.set_widget_state(getattr(self, "start_btn", None), "normal" if can_start else "disabled")
        self.set_widget_state(getattr(self, "stop_btn", None), "disabled")

    def set_running_controls(self):
        """The 'automation is running' button layout."""
        self.set_widget_state(getattr(self, "fetch_btn", None), "disabled")
        self.set_widget_state(getattr(self, "start_btn", None), "disabled")
        self.set_widget_state(getattr(self, "stop_btn", None), "normal")
