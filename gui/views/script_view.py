import os

import customtkinter as ctk

from core.config import PROJECT_ROOT

SCRIPT_PATH = os.path.join(PROJECT_ROOT, "core", "assets", "apps_script.js")


class ScriptView(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        # Title
        self.title_label = ctk.CTkLabel(self, text="Google Sheets Setup", font=ctk.CTkFont(size=24, weight="bold"))
        self.title_label.grid(row=0, column=0, padx=20, pady=(20, 6), sticky="nw")

        # Instructions
        instructions = (
            "To connect this app to Google Sheets, deploy the Apps Script below.\n"
            "1. Copy the code using the button below.\n"
            "2. Open your Google Sheet, go to Extensions > Apps Script.\n"
            "3. Paste the code, then run 'setupSheets' once to create every tab\n"
            "   (Incog Profile Creation, ND Acc Creation, Bulk cookies import,\n"
            "   Bulk proxies import, Auto Posting, Auto Listing, Auto Warmup,\n"
            "   Auto Random Posting). An old 'Bulk proxy import' cookie tab is renamed for you.\n"
            "4. Click 'Deploy' > 'New deployment' as a 'Web app' (Execute as: Me, Access: Anyone).\n"
            "5. Copy the Web App URL and paste it into the Settings tab."
        )
        self.desc_label = ctk.CTkLabel(self, text=instructions, text_color="gray", justify="left")
        self.desc_label.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="nw")

        # Textbox for code
        self.code_box = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Consolas", size=12), wrap="none")
        self.code_box.grid(row=2, column=0, padx=20, pady=10, sticky="nsew")

        # Load code from file
        self.load_script_content()

        # Button Frame
        self.btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.btn_frame.grid(row=3, column=0, padx=20, pady=(0, 20), sticky="ew")

        self.copy_btn = ctk.CTkButton(self.btn_frame, text="Copy Code to Clipboard", width=180, command=self.copy_code)
        self.copy_btn.pack(side="left")

        self.reload_btn = ctk.CTkButton(
            self.btn_frame, text="Reload", width=90, fg_color="gray40",
            hover_color="gray30", command=self.load_script_content,
        )
        self.reload_btn.pack(side="left", padx=10)

        self.status_label = ctk.CTkLabel(self.btn_frame, text="", text_color="gray")
        self.status_label.pack(side="left", padx=10)

    def load_script_content(self):
        self.code_box.configure(state="normal")
        self.code_box.delete("1.0", "end")
        try:
            if os.path.exists(SCRIPT_PATH):
                with open(SCRIPT_PATH, "r", encoding="utf-8") as f:
                    self.code_box.insert("1.0", f.read())
            else:
                self.code_box.insert("1.0", f"// Error: apps_script.js not found at {SCRIPT_PATH}")
        except Exception as e:
            self.code_box.insert("1.0", f"// Error loading script: {e}")
        self.code_box.configure(state="disabled")  # Make read-only

    def copy_code(self):
        self.code_box.configure(state="normal")
        code = self.code_box.get("1.0", "end-1c")
        self.code_box.configure(state="disabled")

        copied = False
        try:
            import pyperclip
            pyperclip.copy(code)
            copied = True
        except Exception:
            # Fall back to Tk's own clipboard if pyperclip is missing or has
            # no copy mechanism available on this machine.
            try:
                self.clipboard_clear()
                self.clipboard_append(code)
                self.update_idletasks()
                copied = True
            except Exception:
                copied = False

        if copied:
            self.status_label.configure(text="Copied!", text_color="green")
        else:
            self.status_label.configure(text="Could not access the clipboard", text_color="red")
        self.after(3000, lambda: self.status_label.configure(text=""))
