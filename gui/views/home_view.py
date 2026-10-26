import threading

import customtkinter as ctk

from core.automation.incogniton_manager import (
    is_incogniton_api_ready,
    is_incogniton_running,
    launch_incogniton,
    wait_for_incogniton_ready,
)
from core.config import get_setting
from gui.ui_thread import post


class HomeView(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)
        self._checking = False

        # Title
        self.title_label = ctk.CTkLabel(self, text="Automation Hub", font=ctk.CTkFont(size=24, weight="bold"))
        self.title_label.grid(row=0, column=0, padx=20, pady=(20, 6), sticky="nw")

        # Description
        self.desc_label = ctk.CTkLabel(self, text="Select an automated process from the sidebar.", text_color="gray")
        self.desc_label.grid(row=1, column=0, padx=20, pady=(0, 12), sticky="nw")

        # Welcome Panel
        self.welcome_frame = ctk.CTkFrame(self)
        self.welcome_frame.grid(row=2, column=0, padx=20, pady=(0, 20), sticky="nsew")
        self.welcome_frame.grid_columnconfigure(0, weight=1)

        self.info_label = ctk.CTkLabel(
            self.welcome_frame,
            text="Incogniton is launched automatically when you start an automation task.",
            font=ctk.CTkFont(size=14),
        )
        self.info_label.grid(row=0, column=0, padx=20, pady=(30, 10))

        self.incogniton_label = ctk.CTkLabel(self.welcome_frame, text="Incogniton: checking...", text_color="gray")
        self.incogniton_label.grid(row=1, column=0, padx=20, pady=4)

        self.sheets_label = ctk.CTkLabel(self.welcome_frame, text="Google Sheets URL: checking...", text_color="gray")
        self.sheets_label.grid(row=2, column=0, padx=20, pady=4)

        self.button_row = ctk.CTkFrame(self.welcome_frame, fg_color="transparent")
        self.button_row.grid(row=3, column=0, padx=20, pady=(16, 30))

        self.launch_btn = ctk.CTkButton(self.button_row, text="Open Incogniton", width=150, command=self.on_launch)
        self.launch_btn.pack(side="left", padx=(0, 10))

        self.refresh_btn = ctk.CTkButton(
            self.button_row, text="Refresh", width=100, fg_color="gray40",
            hover_color="gray30", command=self.refresh_status,
        )
        self.refresh_btn.pack(side="left")

        self.refresh_status()

    def on_shown(self):
        self.refresh_status()

    def refresh_status(self):
        if self._checking:
            return
        self._checking = True
        self._set(self.incogniton_label, "Incogniton: checking...", "gray")
        threading.Thread(target=self._status_thread, daemon=True).start()

    def _set(self, label, text, color):
        def apply():
            try:
                if label.winfo_exists():
                    label.configure(text=text, text_color=color)
            except Exception:
                pass
        post(apply)

    def _status_thread(self):
        try:
            if is_incogniton_api_ready():
                self._set(self.incogniton_label, "Incogniton: running, API ready", "green")
            elif is_incogniton_running():
                self._set(self.incogniton_label, "Incogniton: running, but the API is not answering yet", "orange")
            else:
                self._set(self.incogniton_label, "Incogniton: not running", "orange")

            url = get_setting("apps_script_url", "")
            if url:
                self._set(self.sheets_label, "Google Sheets URL: set", "green")
            else:
                self._set(self.sheets_label, "Google Sheets URL: missing - add it in Settings", "red")
        finally:
            self._checking = False

    def on_launch(self):
        self._set(self.incogniton_label, "Incogniton: launching...", "orange")
        threading.Thread(target=self._launch_thread, daemon=True).start()

    def _launch_thread(self):
        ok, msg = launch_incogniton()
        if not ok:
            self._set(self.incogniton_label, f"Incogniton: {msg}", "red")
            return
        ready, rmsg = wait_for_incogniton_ready(timeout=90, logger_callback=lambda m: None)
        if ready:
            self._set(self.incogniton_label, "Incogniton: running, API ready", "green")
        else:
            self._set(self.incogniton_label, f"Incogniton: {rmsg}", "orange")
