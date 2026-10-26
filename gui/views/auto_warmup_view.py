import customtkinter as ctk
import threading
import time
from core.engine.automation_engine import AutomationEngine
import concurrent.futures
from core.services.sheets_service import fetch_pending_rows, update_row_status
from core.automation.incogniton_manager import start_profile, stop_profile, is_incogniton_running, launch_incogniton, wait_for_incogniton_ready, ensure_incogniton_ready, update_profile_proxy
from core.automation.profile_builder import get_val
from core.automation.auto_warmup import run_auto_warmup_flow
from gui.ui_thread import ThreadSafeViewMixin

SHEET_NAME = "Auto Warmup"


class AutoWarmupView(ctk.CTkFrame, ThreadSafeViewMixin):
    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.pending_posts = []
        self.is_processing = False
        self.engine = None

        # Grid layout - the log box is the part that should grow.
        self.grid_rowconfigure(3, weight=1)
        self.grid_columnconfigure(0, weight=1)

        # Header
        self.header_label = ctk.CTkLabel(self, text="Auto Warmup", font=ctk.CTkFont(size=24, weight="bold"))
        self.header_label.grid(row=0, column=0, padx=20, pady=(20, 6), sticky="w")

        self.desc_label = ctk.CTkLabel(self, text=f"Warms up Nextdoor accounts (browsing, scrolling, reactions) from Google Sheets.\nSheet must be named '{SHEET_NAME}'.", justify="left")
        self.desc_label.grid(row=1, column=0, padx=20, pady=(0, 12), sticky="w")

        # Controls
        self.controls_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.controls_frame.grid(row=2, column=0, padx=20, pady=0, sticky="ew")

        self.fetch_btn = ctk.CTkButton(self.controls_frame, text="Fetch Pending Posts", width=150, command=self.fetch_posts)
        self.fetch_btn.pack(side="left", padx=(0, 10))

        self.concurrency_label = ctk.CTkLabel(self.controls_frame, text="Concurrent Profiles:")
        self.concurrency_label.pack(side="left", padx=(10, 5))

        self.concurrency_entry = ctk.CTkEntry(self.controls_frame, width=45)
        self.concurrency_entry.pack(side="left", padx=(0, 10))
        self.concurrency_entry.insert(0, "3")

        self.start_btn = ctk.CTkButton(self.controls_frame, text="Start Automation", width=140, fg_color="green", hover_color="darkgreen", command=self.start_posting, state="disabled")
        self.start_btn.pack(side="left", padx=(0, 10))

        self.stop_btn = ctk.CTkButton(self.controls_frame, text="Stop", width=80, fg_color="#B22222", hover_color="#8B0000", command=self.stop_automation, state="disabled")
        self.stop_btn.pack(side="left")

        self.status_label = ctk.CTkLabel(self.controls_frame, text="Ready", text_color="gray")
        self.status_label.pack(side="right", padx=10)

        # Data View
        self.data_box = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Consolas", size=12))
        self.data_box.grid(row=3, column=0, padx=20, pady=(10, 20), sticky="nsew")
        self.data_box.insert("1.0", f"Click 'Fetch Pending Posts' to load data from the '{SHEET_NAME}' sheet.")
        self.data_box.configure(state="disabled")

    def fetch_posts(self):
        if self.is_processing:
            return
        self.clear_log()
        self.set_status("Fetching...", "orange")
        self.log("Connecting to Google Sheets...")

        threading.Thread(target=self._fetch_thread, daemon=True).start()

    def _fetch_thread(self):
        success, result = fetch_pending_rows(SHEET_NAME)

        if success:
            self.pending_posts = result
            count = len(self.pending_posts)

            if count > 0:
                self.log(f"Found {count} pending profiles.")
                for p in self.pending_posts:
                    lower_p = {str(k).lower().strip(): v for k, v in p.items()}
                    proxy_val = lower_p.get('proxy', lower_p.get('proxy string', ''))

                    proxy_display = f" | Proxy: {proxy_val}" if proxy_val else ""
                    self.log(f"- Row {p['rowNumber']}: {get_val(p, 'profile name', 'name') or 'Unknown'}{proxy_display}")

                self.set_status(f"Loaded {count} profiles", "green")
                self.set_widget_state(self.start_btn, "normal")
            else:
                self.log("No pending rows found. (All rows have a Status)")
                self.set_status("Nothing pending", "gray")
                self.set_widget_state(self.start_btn, "disabled")
        else:
            self.log(f"ERROR: {result}")
            self.log(f"Please ensure your Google Sheet has a tab named '{SHEET_NAME}', and has columns: ID, Profile Name, Status.")
            self.set_status("Fetch Failed", "red")
            self.set_widget_state(self.start_btn, "disabled")

    def start_posting(self):
        if self.is_processing or not self.pending_posts:
            return

        self.is_processing = True
        self.set_running_controls()
        self.set_status("Running automation...", "orange")
        self.log("\n--- Starting Nextdoor Auto Warmup ---")

        threading.Thread(target=self._warmup_thread, args=(self._concurrency(),), daemon=True).start()

    def _concurrency(self):
        try:
            value = int(self.concurrency_entry.get())
            return max(1, min(value, 20))
        except (ValueError, TypeError):
            self.log("Warning: Invalid concurrency value. Defaulting to 3.")
            return 3

    def stop_automation(self):
        if self.engine:
            self.engine.stop(self.log)
            self.set_status("Stopping...", "orange")
            self.set_widget_state(self.stop_btn, "disabled")

    def shutdown(self):
        self.stop_automation()

    def _warmup_thread(self, concurrency):
        ready, msg = ensure_incogniton_ready(logger_callback=self.log)
        if not ready:
            self.log(f"ERROR: {msg}")
            self.set_status("Incogniton not ready", "red")
            self.is_processing = False
            self.set_idle_controls(can_start=bool(self.pending_posts))
            return

        posts = self.pending_posts

        self.success_count = 0
        self.total_count = len(posts)

        self.engine = AutomationEngine(max_workers=concurrency)

        def flow_wrapper(debug_url, post, logger, state_callback=None, stop_event=None):
            from core.automation.profile_builder import get_val
            email_val = get_val(post, "Email", "email address", "login", "username")
            password_val = get_val(post, "Password", "pass")

            # The flow returns True, msg
            success, msg = run_auto_warmup_flow(
                debug_url=debug_url,
                logger_callback=logger,
                state_callback=state_callback,
                stop_event=stop_event,
                email_val=email_val,
                password_val=password_val
            )

            return success, msg

        def completion_callback(post, success):
            if success:
                self.success_count += 1

        def on_engine_finished():
            self.set_status(f"Completed: {self.success_count}/{self.total_count} successful", "green")
            self.log("\nFinished processing automatically.")
            self.is_processing = False
            self.pending_posts = []
            self.engine = None
            self.set_idle_controls(can_start=False)

        self.engine.start(
            task_type=SHEET_NAME,
            posts=posts,
            flow_wrapper_function=flow_wrapper,
            logger_callback=self.log,
            completion_callback=completion_callback,
            master_ui_context=self,
            on_finished_callback=on_engine_finished
        )
