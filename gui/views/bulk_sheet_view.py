"""
Shared machinery for the bulk-import tabs (cookies, proxies).

A subclass says which sheet and column to read and what to do with each row;
everything else - fetching, the results table, concurrency, auto-import,
logging and writing the Status column back - lives here.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

import customtkinter as ctk

from core.automation.incogniton_manager import ensure_incogniton_ready
from core.automation.profile_builder import get_val
from core.services.sheets_service import fetch_pending_import_rows, update_row_status
from gui.ui_thread import ThreadSafeViewMixin


class BulkSheetImportView(ctk.CTkFrame, ThreadSafeViewMixin):
    # --- subclass configuration ---
    TITLE = "Bulk Import"
    SHEET_NAME = ""
    LEGACY_SHEET_NAMES = ()
    VALUE_COLUMN = "Value"          # sheet header holding the data to import
    VALUE_KEYS = ()                 # case-insensitive row keys to read it from
    VALUE_LABEL = "value"           # used in messages ("Cookies cell is empty")
    DESCRIPTION = ""
    START_LABEL = "Start Import"
    FETCH_LABEL = "Fetch Pending Rows"
    DEFAULT_WORKERS = "5"

    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.pending_rows = []
        self.is_processing = False
        self._stop_event = threading.Event()
        self._auto_job = None
        self._row_widgets = {}

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(4, weight=3)
        self.grid_rowconfigure(5, weight=2)

        # --- header ---
        self.title_label = ctk.CTkLabel(
            self, text=self.TITLE, font=ctk.CTkFont(size=24, weight="bold")
        )
        self.title_label.grid(row=0, column=0, padx=20, pady=(20, 4), sticky="w")

        self.info_label = ctk.CTkLabel(
            self, text=self.DESCRIPTION, text_color="gray", justify="left"
        )
        self.info_label.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="w")

        # --- controls ---
        self.controls_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.controls_frame.grid(row=2, column=0, padx=20, pady=(0, 4), sticky="ew")

        self.fetch_btn = ctk.CTkButton(
            self.controls_frame, text=self.FETCH_LABEL, width=150, command=self.fetch_rows
        )
        self.fetch_btn.pack(side="left", padx=(0, 10))

        self.start_btn = ctk.CTkButton(
            self.controls_frame,
            text=self.START_LABEL,
            width=150,
            fg_color="green",
            hover_color="darkgreen",
            command=self.start_import,
            state="disabled",
        )
        self.start_btn.pack(side="left", padx=(0, 10))

        self.stop_btn = ctk.CTkButton(
            self.controls_frame,
            text="Stop",
            width=80,
            fg_color="#B22222",
            hover_color="#8B0000",
            command=self.stop_import,
            state="disabled",
        )
        self.stop_btn.pack(side="left", padx=(0, 10))

        self.status_label = ctk.CTkLabel(self.controls_frame, text="Ready", text_color="gray")
        self.status_label.pack(side="right", padx=10)

        # --- options ---
        self.options_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.options_frame.grid(row=3, column=0, padx=20, pady=(0, 8), sticky="ew")

        ctk.CTkLabel(self.options_frame, text="Parallel imports:").pack(side="left", padx=(0, 5))
        self.concurrency_entry = ctk.CTkEntry(self.options_frame, width=45)
        self.concurrency_entry.pack(side="left", padx=(0, 15))
        self.concurrency_entry.insert(0, self.DEFAULT_WORKERS)

        self.build_extra_options(self.options_frame)

        self.auto_var = ctk.BooleanVar(value=False)
        self.auto_check = ctk.CTkCheckBox(
            self.options_frame,
            text="Auto-import new rows",
            variable=self.auto_var,
            command=self.on_auto_toggled,
        )
        self.auto_check.pack(side="left", padx=(0, 5))

        ctk.CTkLabel(self.options_frame, text="every").pack(side="left", padx=(0, 5))
        self.interval_entry = ctk.CTkEntry(self.options_frame, width=45)
        self.interval_entry.pack(side="left", padx=(0, 5))
        self.interval_entry.insert(0, "20")
        ctk.CTkLabel(self.options_frame, text="s", text_color="gray").pack(side="left")

        # --- results table ---
        self.table = ctk.CTkScrollableFrame(self, label_text="Rows")
        self.table.grid(row=4, column=0, padx=20, pady=(0, 10), sticky="nsew")
        self.table.grid_columnconfigure(0, weight=2, minsize=150)
        self.table.grid_columnconfigure(1, weight=1, minsize=110)
        self.table.grid_columnconfigure(2, weight=3, minsize=180)

        self._build_table_header()
        self._show_table_placeholder(f"Click '{self.FETCH_LABEL}' to load the sheet.")

        # --- log ---
        self.data_box = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Consolas", size=12))
        self.data_box.grid(row=5, column=0, padx=20, pady=(0, 20), sticky="nsew")
        self.data_box.insert("1.0", "Ready.")
        self.data_box.configure(state="disabled")

    # ------------------------------------------------------------------
    # Subclass hooks
    # ------------------------------------------------------------------
    def build_extra_options(self, frame):
        """Add tab-specific option widgets. Runs on the UI thread."""

    def collect_options(self):
        """Read tab-specific widget values on the UI thread; returns a dict."""
        return {}

    def summarize_value(self, raw):
        """One-word description of a row's value for the table."""
        return "ready" if str(raw or "").strip() else "empty"

    def process_row(self, profile_name, raw_value, group_hint, options):
        """Do the import for one row. Returns (ok, message, count)."""
        raise NotImplementedError

    def success_status(self, message, count):
        """Text written into the sheet's Status column on success."""
        return message

    # ------------------------------------------------------------------
    # Table helpers (main thread only)
    # ------------------------------------------------------------------
    def _build_table_header(self):
        for col, text in enumerate(("Profile Name", self.VALUE_COLUMN, "Status")):
            label = ctk.CTkLabel(self.table, text=text, font=ctk.CTkFont(weight="bold"))
            label.grid(row=0, column=col, padx=(4, 8), pady=(0, 6), sticky="w")

    def _clear_table(self):
        for child in self.table.winfo_children():
            child.destroy()
        self._row_widgets = {}
        self._build_table_header()

    def _show_table_placeholder(self, text):
        label = ctk.CTkLabel(self.table, text=text, text_color="gray")
        label.grid(row=1, column=0, columnspan=3, padx=4, pady=6, sticky="w")

    def _render_rows(self, rows):
        self._clear_table()
        if not rows:
            self._show_table_placeholder("No pending rows. (Every row already has a Status)")
            return

        for index, row in enumerate(rows, start=1):
            name = self._row_name(row) or "(no name)"
            summary = row.get("_value_summary", "")

            name_label = ctk.CTkLabel(self.table, text=name, anchor="w")
            name_label.grid(row=index, column=0, padx=(4, 8), pady=2, sticky="w")

            value_label = ctk.CTkLabel(self.table, text=summary, anchor="w", text_color="gray")
            value_label.grid(row=index, column=1, padx=(4, 8), pady=2, sticky="w")

            status_label = ctk.CTkLabel(self.table, text="Pending", anchor="w", text_color="gray")
            status_label.grid(row=index, column=2, padx=(4, 8), pady=2, sticky="w")

            self._row_widgets[row.get("rowNumber")] = status_label

    def _set_row_status(self, row_number, text, color):
        label = self._row_widgets.get(row_number)
        try:
            if label is not None and label.winfo_exists():
                label.configure(text=text, text_color=color)
        except Exception:
            pass

    def set_row_status(self, row_number, text, color="gray"):
        self.ui_post(self._set_row_status, row_number, text, color)

    # ------------------------------------------------------------------
    # Sheet helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _row_name(row):
        return str(get_val(row, "profile name", "profilename", "name", "profile") or "").strip()

    def _row_value(self, row):
        keys = tuple(self.VALUE_KEYS) or (self.VALUE_COLUMN,)
        for key in keys:
            for variant in (key, key.capitalize(), key.title(), key.lower()):
                if variant in row and str(row[variant] or "").strip():
                    return row[variant]
        wanted = {str(k).strip().lower() for k in keys}
        wanted.add("value")
        for key, value in row.items():
            if str(key).strip().lower() in wanted and str(value or "").strip():
                return value
        return ""

    @staticmethod
    def _row_group(row):
        return str(get_val(row, "group", "profile group", "group name") or "").strip()

    # ------------------------------------------------------------------
    # Fetch
    # ------------------------------------------------------------------
    def fetch_rows(self):
        if self.is_processing:
            return
        self.clear_log()
        self.set_status("Fetching...", "orange")
        self.log(f"Reading the '{self.SHEET_NAME}' tab...")
        threading.Thread(target=self._fetch_thread, daemon=True).start()

    def _fetch_thread(self, announce=True):
        success, result = fetch_pending_import_rows(
            self.SHEET_NAME, self.VALUE_COLUMN, legacy_sheet_names=self.LEGACY_SHEET_NAMES
        )

        if not success:
            if announce:
                self.log(f"ERROR: {result}")
                self.log(
                    f"Make sure the sheet has a tab named '{self.SHEET_NAME}' with the columns "
                    f"Profile Name, {self.VALUE_COLUMN} and Status, and that the Apps Script "
                    "is re-deployed."
                )
                self.set_status("Fetch failed", "red")
                self.set_widget_state(self.start_btn, "disabled")
            return []

        rows = [r for r in result if self._row_name(r)]

        # Summarise on the worker thread so the table draws instantly.
        for row in rows:
            row["_value_summary"] = self.summarize_value(self._row_value(row))

        self.pending_rows = rows
        self.ui_post(self._render_rows, rows)

        if announce:
            if rows:
                self.log(f"Found {len(rows)} pending row(s).")
                self.set_status(f"Loaded {len(rows)} row(s)", "green")
                self.set_widget_state(self.start_btn, "normal")
            else:
                self.log("No pending rows found. (Every row already has a Status)")
                self.set_status("Nothing pending", "gray")
                self.set_widget_state(self.start_btn, "disabled")

        return rows

    # ------------------------------------------------------------------
    # Import
    # ------------------------------------------------------------------
    def start_import(self):
        if self.is_processing or not self.pending_rows:
            return

        self.is_processing = True
        self._stop_event.clear()
        self.set_running_controls()
        self.set_status("Importing...", "orange")
        self.log(f"\n--- Starting {self.TITLE} ---")

        # Widget values are read here (main thread) and passed down.
        threading.Thread(
            target=self._import_thread,
            args=(list(self.pending_rows), False, self.collect_options(), self._concurrency()),
            daemon=True,
        ).start()

    def stop_import(self):
        self._stop_event.set()
        self.log("Stop requested. Finishing the rows already in flight...")
        self.set_status("Stopping...", "orange")

    def _concurrency(self):
        try:
            value = int(self.concurrency_entry.get())
            return max(1, min(value, 20))
        except (ValueError, TypeError):
            return 5

    def _import_thread(self, rows, auto_mode, options=None, workers=5):
        options = options or {}
        try:
            ready, msg = ensure_incogniton_ready(logger_callback=self.log)
            if not ready:
                self.log(f"ERROR: {msg}")
                self.set_status("Incogniton not ready", "red")
                return

            done = {"ok": 0, "failed": 0, "skipped": 0}
            counter_lock = threading.Lock()

            def handle(row):
                if self._stop_event.is_set():
                    return

                row_number = row.get("rowNumber")
                name = self._row_name(row)
                raw_value = self._row_value(row)

                if not str(raw_value or "").strip():
                    if auto_mode:
                        # The row is probably still being filled in - leave the
                        # Status empty so the next poll picks it up.
                        with counter_lock:
                            done["skipped"] += 1
                        self.set_row_status(row_number, f"waiting for {self.VALUE_LABEL}", "orange")
                        return
                    self.set_row_status(row_number, f"No {self.VALUE_LABEL} in the row", "red")
                    self.log(f"[{name}] FAILED: the {self.VALUE_COLUMN} cell is empty.")
                    update_row_status(
                        self.SHEET_NAME, row_number, f"Failed: {self.VALUE_COLUMN} cell is empty"
                    )
                    with counter_lock:
                        done["failed"] += 1
                    return

                self.set_row_status(row_number, "importing...", "orange")
                try:
                    ok, message, count = self.process_row(
                        name, raw_value, self._row_group(row), options
                    )
                except Exception as e:
                    ok, message, count = False, f"Unexpected error: {e}", 0

                if ok:
                    self.log(f"[{name}] {message}")
                    self.set_row_status(row_number, message, "green")
                    update_row_status(self.SHEET_NAME, row_number, self.success_status(message, count))
                    with counter_lock:
                        done["ok"] += 1
                else:
                    self.log(f"[{name}] FAILED: {message}")
                    self.set_row_status(row_number, message, "red")
                    update_row_status(self.SHEET_NAME, row_number, f"Failed: {message}")
                    with counter_lock:
                        done["failed"] += 1

            with ThreadPoolExecutor(max_workers=workers) as pool:
                list(pool.map(handle, rows))

            summary = f"Imported {done['ok']}/{len(rows)}"
            if done["failed"]:
                summary += f", {done['failed']} failed"
            if done["skipped"]:
                summary += f", {done['skipped']} waiting for {self.VALUE_LABEL}"

            self.log(f"--- {summary} ---")
            if self._stop_event.is_set():
                self.set_status("Stopped", "orange")
            else:
                self.set_status(summary, "green" if not done["failed"] else "orange")

        except Exception as e:
            self.log(f"Unexpected error: {e}")
            self.set_status("Error", "red")
        finally:
            self.is_processing = False
            self.pending_rows = []
            self.set_idle_controls(can_start=False)

    # ------------------------------------------------------------------
    # Auto import
    # ------------------------------------------------------------------
    def on_auto_toggled(self):
        if self.auto_var.get():
            self.log(
                f"Auto-import is ON. New rows on '{self.SHEET_NAME}' will be imported automatically."
            )
            self._schedule_auto(initial=True)
        else:
            self.log("Auto-import is OFF.")
            self._cancel_auto()

    def _auto_interval_ms(self):
        try:
            seconds = int(self.interval_entry.get())
        except (ValueError, TypeError):
            seconds = 20
        return max(5, min(seconds, 600)) * 1000

    def _cancel_auto(self):
        if self._auto_job is not None:
            try:
                self.after_cancel(self._auto_job)
            except Exception:
                pass
            self._auto_job = None

    def _schedule_auto(self, initial=False):
        self._cancel_auto()
        if not self.auto_var.get():
            return
        delay = 500 if initial else self._auto_interval_ms()
        try:
            self._auto_job = self.after(delay, self._auto_tick)
        except Exception:
            self._auto_job = None

    def _auto_tick(self):
        self._auto_job = None
        if not self.auto_var.get():
            return
        if self.is_processing:
            self._schedule_auto()
            return
        threading.Thread(
            target=self._auto_cycle,
            args=(self.collect_options(), self._concurrency()),
            daemon=True,
        ).start()

    def _auto_cycle(self, options=None, workers=5):
        try:
            rows = self._fetch_thread(announce=False) or []
            rows = [r for r in rows if str(self._row_value(r) or "").strip()]
            if rows:
                self.is_processing = True
                self._stop_event.clear()
                self.set_running_controls()
                self.set_status(f"Auto-importing {len(rows)} row(s)...", "orange")
                self.log(f"\n--- Auto-import: {len(rows)} new row(s) ---")
                self._import_thread(rows, True, options, workers)
            else:
                self.set_status("Auto-import: watching for new rows", "gray")
        except Exception as e:
            self.log(f"Auto-import error: {e}")
        finally:
            self.ui_post(self._schedule_auto)

    # ------------------------------------------------------------------
    def shutdown(self):
        """Called when the window closes."""
        self._stop_event.set()
        self._cancel_auto()
