import customtkinter as ctk
import threading
import time
from core.config import get_setting, set_setting
from core.services.sheets_service import fetch_pending_profiles, update_profile_status
from core.automation.profile_builder import create_incogniton_profile, get_val
from core.automation.incogniton_manager import is_incogniton_running, launch_incogniton, wait_for_incogniton_ready, ensure_incogniton_ready
from gui.ui_thread import ThreadSafeViewMixin
import os


class BulkCreateView(ctk.CTkFrame, ThreadSafeViewMixin):
    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(3, weight=1)

        self.pending_profiles = []
        self.is_processing = False
        self._stop_event = threading.Event()

        # Title
        self.title_label = ctk.CTkLabel(self, text="Bulk Profile Creation", font=ctk.CTkFont(size=24, weight="bold"))
        self.title_label.grid(row=0, column=0, padx=20, pady=(20, 6), sticky="nw")

        # Info Label
        self.info_label = ctk.CTkLabel(self, text="Creates Incogniton profiles from the 'Incog Profile Creation' tab. Set your Apps Script URL in Settings first.", text_color="gray")
        self.info_label.grid(row=1, column=0, padx=20, pady=(0, 12), sticky="nw")

        # Controls Frame
        self.controls_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.controls_frame.grid(row=2, column=0, padx=20, pady=5, sticky="ew")

        self.fetch_btn = ctk.CTkButton(self.controls_frame, text="Fetch Pending Profiles", width=160, command=self.fetch_profiles)
        self.fetch_btn.pack(side="left", padx=(0, 10))

        self.start_btn = ctk.CTkButton(self.controls_frame, text="Start Bulk Creation", width=150, fg_color="green", hover_color="darkgreen", command=self.start_creation, state="disabled")
        self.start_btn.pack(side="left", padx=(0, 10))

        self.stop_btn = ctk.CTkButton(self.controls_frame, text="Stop", width=80, fg_color="#B22222", hover_color="#8B0000", command=self.stop_creation, state="disabled")
        self.stop_btn.pack(side="left")

        self.status_label = ctk.CTkLabel(self.controls_frame, text="Ready", text_color="gray")
        self.status_label.pack(side="right", padx=10)

        # Data View
        self.data_box = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Consolas", size=12))
        self.data_box.grid(row=3, column=0, padx=20, pady=(10, 20), sticky="nsew")
        self.data_box.insert("1.0", "Click 'Fetch Pending Profiles' to load data from Google Sheets.")
        self.data_box.configure(state="disabled")

    def fetch_profiles(self):
        if self.is_processing:
            return
        self.clear_log()
        self.set_status("Fetching...", "orange")
        self.log("Connecting to Google Sheets...")

        # Run in thread to not block UI
        threading.Thread(target=self._fetch_thread, daemon=True).start()

    def _fetch_thread(self):
        success, result = fetch_pending_profiles()

        if success:
            self.pending_profiles = result
            count = len(self.pending_profiles)

            if count > 0:
                self.log(f"Found {count} pending profiles.")
                for p in self.pending_profiles:
                    # Case insensitive lookup for display
                    lower_p = {str(k).lower().strip(): v for k, v in p.items()}
                    name = lower_p.get('name', lower_p.get('profile name', 'Unknown'))
                    proxy = lower_p.get('proxy', lower_p.get('proxy string', 'N/A'))
                    self.log(f"- Row {p['rowNumber']}: {name} (Proxy: {proxy})")

                self.set_status(f"Loaded {count} profiles", "green")
                self.set_widget_state(self.start_btn, "normal")
            else:
                self.log("No pending profiles found. (All rows have a Status)")
                self.set_status("No profiles found", "gray")
                self.set_widget_state(self.start_btn, "disabled")
        else:
            self.log(f"ERROR: {result}")
            self.set_status("Fetch Failed", "red")
            self.set_widget_state(self.start_btn, "disabled")

    def start_creation(self):
        if self.is_processing or not self.pending_profiles:
            return

        self.is_processing = True
        self._stop_event.clear()
        self.set_running_controls()
        self.set_status("Creating profiles...", "orange")
        self.log("\n--- Starting Bulk Creation ---")

        threading.Thread(target=self._creation_thread, daemon=True).start()

    def stop_creation(self):
        self._stop_event.set()
        self.log("Stop requested. Finishing the current profile...")
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

            profiles = self.pending_profiles
            self.log(f"Fetched {len(profiles)} pending profiles. Starting automated creation...")

            success_count = 0
            for i, profile in enumerate(profiles):
                if self._stop_event.is_set():
                    self.log("Stopped before processing the remaining profiles.")
                    break

                name = get_val(profile, "profile name", "name") or "Unknown"
                self.log(f"\nProcessing {i+1}/{len(profiles)}: {name}")

                # Create in Incogniton
                success, message, profile_id = create_incogniton_profile(profile)

                if success:
                    self.log(f"SUCCESS: {message} (ID: {profile_id})")
                    sheet_success, sheet_msg = update_profile_status(profile['rowNumber'], "Created", f"ID: {profile_id}")
                    if sheet_success:
                        success_count += 1
                    else:
                        self.log(f"Failed to update sheet: {sheet_msg}")
                else:
                    self.log(f"FAILED: {message}")
                    update_profile_status(profile['rowNumber'], "Failed", message)

                if self._stop_event.wait(2):
                    self.log("Stopped.")
                    break

            if self._stop_event.is_set():
                self.set_status(f"Stopped after {success_count}/{len(profiles)}", "orange")
            else:
                self.set_status(f"Completed: {success_count}/{len(profiles)} successful", "green")
            self.log("\nFinished processing all profiles automatically.")
        except Exception as e:
            self.log(f"Unexpected error: {e}")
            self.set_status("Error", "red")
        finally:
            self.is_processing = False
            self.pending_profiles = []  # Clear so they must fetch again
            self.set_idle_controls(can_start=False)
