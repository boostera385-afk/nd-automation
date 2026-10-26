import threading

import customtkinter as ctk
import tkinter as tk
from tkinter import filedialog

from core.config import get_setting, set_setting
from gui.ui_thread import post


class SettingsView(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # Title
        self.title_label = ctk.CTkLabel(self, text="Settings", font=ctk.CTkFont(size=24, weight="bold"))
        self.title_label.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="nw")

        # Settings Container
        self.settings_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.settings_frame.grid(row=1, column=0, padx=20, pady=10, sticky="nsew")
        self.settings_frame.grid_columnconfigure(0, weight=1)

        # Incogniton Path Setting
        self.path_label = ctk.CTkLabel(self.settings_frame, text="Incogniton Executable Path:", font=ctk.CTkFont(weight="bold"))
        self.path_label.grid(row=0, column=0, sticky="w", pady=(0, 5))

        self.path_desc = ctk.CTkLabel(self.settings_frame, text="Set this if the app cannot automatically find Incogniton.", text_color="gray")
        self.path_desc.grid(row=1, column=0, sticky="w", pady=(0, 10))

        self.path_input_frame = ctk.CTkFrame(self.settings_frame, fg_color="transparent")
        self.path_input_frame.grid(row=2, column=0, sticky="ew")
        self.path_input_frame.grid_columnconfigure(0, weight=1)

        self.path_entry = ctk.CTkEntry(self.path_input_frame, placeholder_text="C:\\Program Files\\Incogniton\\Incogniton.exe")
        self.path_entry.grid(row=0, column=0, sticky="ew", padx=(0, 10))

        current_path = get_setting("incogniton_path", "")
        if current_path:
            self.path_entry.insert(0, current_path)

        self.browse_btn = ctk.CTkButton(self.path_input_frame, text="Browse", width=80, command=self.on_browse)
        self.browse_btn.grid(row=0, column=1)

        # --- Apps Script URL Setting ---
        self.url_label = ctk.CTkLabel(self.settings_frame, text="Google Apps Script Web App URL:", font=ctk.CTkFont(weight="bold"))
        self.url_label.grid(row=3, column=0, sticky="w", pady=(20, 5))

        self.url_desc = ctk.CTkLabel(self.settings_frame, text="Used to connect to Google Sheets for all automations. It should end in /exec.", text_color="gray")
        self.url_desc.grid(row=4, column=0, sticky="w", pady=(0, 10))

        self.url_entry = ctk.CTkEntry(self.settings_frame, placeholder_text="https://script.google.com/macros/s/.../exec")
        self.url_entry.grid(row=5, column=0, sticky="ew", padx=(0, 0))

        current_url = get_setting("apps_script_url", "")
        if current_url:
            self.url_entry.insert(0, current_url)

        # --- Buttons ---
        self.button_frame = ctk.CTkFrame(self.settings_frame, fg_color="transparent")
        self.button_frame.grid(row=6, column=0, sticky="w", pady=(20, 0))

        self.save_btn = ctk.CTkButton(self.button_frame, text="Save All Settings", width=150, command=self.on_save)
        self.save_btn.pack(side="left", padx=(0, 10))

        self.test_btn = ctk.CTkButton(
            self.button_frame, text="Test Connections", width=140,
            fg_color="gray40", hover_color="gray30", command=self.on_test,
        )
        self.test_btn.pack(side="left")

        self.status_label = ctk.CTkLabel(self.settings_frame, text="", text_color="gray", justify="left")
        self.status_label.grid(row=7, column=0, sticky="w", pady=(10, 0))

    def _set_status(self, text, color="gray"):
        post(self.__set_status, text, color)

    def __set_status(self, text, color):
        try:
            if self.status_label.winfo_exists():
                self.status_label.configure(text=text, text_color=color)
        except Exception:
            pass

    def on_browse(self):
        file_path = filedialog.askopenfilename(
            title="Select Incogniton.exe",
            filetypes=[("Executable Files", "*.exe")]
        )
        if file_path:
            self.path_entry.delete(0, tk.END)
            self.path_entry.insert(0, file_path)

    def on_save(self):
        new_path = self.path_entry.get().strip().strip('"')
        new_url = self.url_entry.get().strip()

        set_setting("incogniton_path", new_path)
        set_setting("apps_script_url", new_url)

        warnings = []
        import os
        if new_path and not os.path.exists(new_path):
            warnings.append("the Incogniton path does not exist")
        if new_url and not new_url.lower().startswith("https://script.google.com/"):
            warnings.append("the Apps Script URL looks unusual")
        elif new_url and not new_url.rstrip("/").endswith("/exec"):
            warnings.append("the Apps Script URL should end in /exec")

        if warnings:
            self._set_status("Saved, but " + " and ".join(warnings) + ".", "orange")
        else:
            self._set_status("Settings saved successfully!", "green")
            self.after(4000, lambda: self.__set_status("", "gray"))

    def on_test(self):
        self.test_btn.configure(state="disabled")
        self._set_status("Testing...", "orange")
        threading.Thread(target=self._test_thread, daemon=True).start()

    def _test_thread(self):
        lines = []
        color = "green"

        try:
            from core.automation.incogniton_manager import is_incogniton_api_ready, get_incogniton_exe
            if is_incogniton_api_ready():
                lines.append("Incogniton API: reachable")
            else:
                exe = get_incogniton_exe()
                lines.append(f"Incogniton API: not responding ({'exe found' if exe else 'exe not found'})")
                color = "orange"
        except Exception as e:
            lines.append(f"Incogniton API: error - {e}")
            color = "red"

        try:
            from core.services.sheets_service import fetch_pending_profiles
            ok, result = fetch_pending_profiles()
            if ok:
                lines.append(f"Google Sheets: connected ({len(result)} pending profile rows)")
            else:
                lines.append(f"Google Sheets: {result}")
                color = "red"
        except Exception as e:
            lines.append(f"Google Sheets: error - {e}")
            color = "red"

        self._set_status("\n".join(lines), color)
        post(self._enable_test_btn)

    def _enable_test_btn(self):
        try:
            if self.test_btn.winfo_exists():
                self.test_btn.configure(state="normal")
        except Exception:
            pass
