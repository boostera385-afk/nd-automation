import customtkinter as ctk
import threading
import time
from core.services.sheets_service import fetch_pending_nd_accounts, update_nd_account_status
from core.automation.incogniton_manager import (
    is_incogniton_running,
    launch_incogniton,
    start_profile,
    stop_profile,
    wait_for_incogniton_ready,
    ensure_incogniton_ready,
    update_profile_proxy,
    extract_debug_url,
)
from core.automation.profile_builder import get_val
from core.automation.nd_account_creator import run_nd_creation_flow
from gui.ui_helpers import resolve_duplicates_ui
from gui.ui_thread import ThreadSafeViewMixin


class NDAccCreationView(ctk.CTkFrame, ThreadSafeViewMixin):
    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(3, weight=1)

        self.pending_accounts = []
        self.is_processing = False
        self._stop_event = threading.Event()

        # Title
        self.title_label = ctk.CTkLabel(self, text="Nextdoor Account Creation", font=ctk.CTkFont(size=24, weight="bold"))
        self.title_label.grid(row=0, column=0, padx=20, pady=(20, 6), sticky="nw")

        # Info Label
        self.info_label = ctk.CTkLabel(self, text="Automates the Nextdoor Sign Up flow for pending accounts in Google Sheets.", text_color="gray")
        self.info_label.grid(row=1, column=0, padx=20, pady=(0, 12), sticky="nw")

        # Controls Frame
        self.controls_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.controls_frame.grid(row=2, column=0, padx=20, pady=5, sticky="ew")

        self.fetch_btn = ctk.CTkButton(self.controls_frame, text="Fetch Pending Accounts", width=170, command=self.fetch_accounts)
        self.fetch_btn.pack(side="left", padx=(0, 10))

        self.start_btn = ctk.CTkButton(self.controls_frame, text="Start Automation", width=140, fg_color="green", hover_color="darkgreen", command=self.start_creation, state="disabled")
        self.start_btn.pack(side="left", padx=(0, 10))

        self.stop_btn = ctk.CTkButton(self.controls_frame, text="Stop", width=80, fg_color="#B22222", hover_color="#8B0000", command=self.stop_creation, state="disabled")
        self.stop_btn.pack(side="left")

        self.status_label = ctk.CTkLabel(self.controls_frame, text="Ready", text_color="gray")
        self.status_label.pack(side="right", padx=10)

        # Data View
        self.data_box = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Consolas", size=12))
        self.data_box.grid(row=3, column=0, padx=20, pady=(10, 20), sticky="nsew")
        self.data_box.insert("1.0", "Click 'Fetch Pending Accounts' to load data from Google Sheets.")
        self.data_box.configure(state="disabled")

    def fetch_accounts(self):
        if self.is_processing:
            return
        self.clear_log()
        self.set_status("Fetching...", "orange")
        self.log("Connecting to Google Sheets...")

        threading.Thread(target=self._fetch_thread, daemon=True).start()

    def _fetch_thread(self):
        success, result = fetch_pending_nd_accounts()

        if success:
            self.pending_accounts = result
            count = len(self.pending_accounts)

            if count > 0:
                self.log(f"Found {count} pending accounts.")
                for p in self.pending_accounts:
                    # Case-insensitive check for proxy to display in UI
                    lower_p = {str(k).lower().strip(): v for k, v in p.items()}
                    proxy_val = lower_p.get('proxy', lower_p.get('proxy string', ''))

                    proxy_display = f" | Proxy: {proxy_val}" if proxy_val else ""
                    self.log(f"- Row {p['rowNumber']}: {get_val(p, 'profile name', 'name') or 'Unknown'} | Email: {get_val(p, 'email')}{proxy_display}")

                self.set_status(f"Loaded {count} accounts", "green")
                self.set_widget_state(self.start_btn, "normal")
            else:
                self.log("No pending accounts found. (All rows have a Status)")
                self.set_status("No accounts found", "gray")
                self.set_widget_state(self.start_btn, "disabled")
        else:
            self.log(f"ERROR: {result}")
            self.set_status("Fetch Failed", "red")
            self.set_widget_state(self.start_btn, "disabled")

    def start_creation(self):
        if self.is_processing or not self.pending_accounts:
            return

        self.is_processing = True
        self._stop_event.clear()
        self.set_running_controls()
        self.set_status("Running automation...", "orange")
        self.log("\n--- Starting Nextdoor Account Creation ---")

        threading.Thread(target=self._creation_thread, daemon=True).start()

    def stop_creation(self):
        self._stop_event.set()
        self.log("Stop requested. Finishing the current account...")
        self.set_status("Stopping...", "orange")
        self.set_widget_state(self.stop_btn, "disabled")

    def shutdown(self):
        self._stop_event.set()

    def _creation_thread(self):
        try:
            # 1. Check Incogniton (process AND API)
            ready, msg = ensure_incogniton_ready(logger_callback=self.log)
            if not ready:
                self.log(f"ERROR: {msg}")
                self.set_status("Incogniton not ready", "red")
                return

            accounts = self.pending_accounts
            self.log(f"Fetched {len(accounts)} pending accounts. Starting automated creation...")

            success_count = 0
            for i, acc in enumerate(accounts):
                if self._stop_event.is_set():
                    self.log("Stopped before processing the remaining accounts.")
                    break

                profile_name_or_id = get_val(acc, "profile name", "name", "profile") or "Unknown"
                self.log(f"\nProcessing {i+1}/{len(accounts)}: {profile_name_or_id}")

                profile_id = acc.get('id') if acc.get('id') else profile_name_or_id

                # Check if a new proxy is provided in this Google Sheet to update the profile before launching
                new_proxy_str = get_val(acc, "proxy", "proxy string")
                if new_proxy_str and str(new_proxy_str).lower() != "n/a":
                    self.log("Updating proxy in Incogniton before launch...")
                    upd_ok, upd_msg = update_profile_proxy(profile_id, new_proxy_str)
                    if upd_ok:
                        self.log(f"Proxy: {upd_msg}")
                    else:
                        self.log(f"Warning: Failed to update proxy - {upd_msg}")

                # Start Profile
                self.log(f"Starting Incogniton profile: {profile_name_or_id}...")

                started, data = start_profile(
                    profile_id,
                    duplicate_resolver=resolve_duplicates_ui,
                    master=self,
                    logger_callback=self.log,
                )
                if not started:
                    self.log(f"FAILED to start profile: {data}")
                    update_nd_account_status(acc['rowNumber'], f"Failed to start profile: {data}")
                    continue

                debug_url = extract_debug_url(data)
                if not debug_url:
                    self.log("FAILED: Incogniton did not return a debugging URL for this profile.")
                    update_nd_account_status(acc['rowNumber'], "Failed to start profile (no debug URL)")
                    stop_profile(profile_id)
                    continue

                # Run Playwright Flow
                self.log("Profile started. Initializing Playwright...")
                try:
                    success, msg = run_nd_creation_flow(
                        debug_url=debug_url,
                        email=get_val(acc, "email", "email address", "username"),
                        password=get_val(acc, "password", "pass"),
                        full_name=get_val(acc, "full name", "name", "fullname"),
                        logger_callback=self.log
                    )
                except Exception as e:
                    success, msg = False, f"Unexpected error: {e}"

                if success:
                    self.log(f"SUCCESS: {msg}")
                    sheet_success, sheet_msg = update_nd_account_status(acc['rowNumber'], "Account Created")
                    if sheet_success:
                        success_count += 1
                    else:
                        self.log(f"Failed to update sheet: {sheet_msg}")
                else:
                    self.log(f"FAILED: {msg}")
                    update_nd_account_status(acc['rowNumber'], "Not Created")

                # Stop profile
                self.log("Stopping profile...")
                stop_profile(profile_id)
                self._stop_event.wait(3)

            if self._stop_event.is_set():
                self.set_status(f"Stopped after {success_count}/{len(accounts)}", "orange")
            else:
                self.set_status(f"Completed: {success_count}/{len(accounts)} successful", "green")
            self.log("\nFinished processing all accounts automatically.")
        except Exception as e:
            self.log(f"Unexpected error: {e}")
            self.set_status("Error", "red")
        finally:
            self.is_processing = False
            self.pending_accounts = []  # Clear so they must fetch again
            self.set_idle_controls(can_start=False)
