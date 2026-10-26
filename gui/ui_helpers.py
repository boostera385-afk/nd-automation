import threading

import customtkinter as ctk

from gui.ui_thread import post

# Never block an automation thread forever if the dialog cannot be shown.
DUPLICATE_PROMPT_TIMEOUT = 300


def resolve_duplicates_ui(master, identifier, matches, timeout=DUPLICATE_PROMPT_TIMEOUT):
    """
    Asks the user which Incogniton profile to use when several share a name.
    Safe to call from a worker thread; returns the chosen browser_id or None.
    """
    if not matches:
        return None
    if master is None:
        return None

    selected_id = [None]
    event = threading.Event()

    def show():
        try:
            dialog = ctk.CTkToplevel(master)
        except Exception:
            event.set()
            return

        dialog.title("Duplicate Profiles")
        dialog.geometry("480x340")
        dialog.minsize(380, 240)
        dialog.attributes("-topmost", True)

        # Center over the main window instead of the top-left corner.
        try:
            dialog.update_idletasks()
            root = master.winfo_toplevel()
            x = root.winfo_rootx() + max(0, (root.winfo_width() - 480) // 2)
            y = root.winfo_rooty() + max(0, (root.winfo_height() - 340) // 2)
            dialog.geometry(f"480x340+{x}+{y}")
        except Exception:
            pass

        dialog.grid_columnconfigure(0, weight=1)
        dialog.grid_rowconfigure(1, weight=1)

        lbl = ctk.CTkLabel(
            dialog,
            text=f"Multiple profiles are named '{identifier}'.\nPick the right one by its group:",
            font=ctk.CTkFont(weight="bold"),
            justify="left",
        )
        lbl.grid(row=0, column=0, padx=14, pady=(14, 6), sticky="w")

        scroll = ctk.CTkScrollableFrame(dialog)
        scroll.grid(row=1, column=0, padx=14, pady=6, sticky="nsew")
        scroll.grid_columnconfigure(0, weight=1)

        def finish(browser_id):
            selected_id[0] = browser_id
            try:
                dialog.destroy()
            except Exception:
                pass
            event.set()

        for index, match in enumerate(matches):
            group_name = match.get('group') or 'Unassigned'
            browser_id = match.get('browser_id')
            short_id = str(browser_id or "")[:8]

            btn = ctk.CTkButton(
                scroll,
                text=f"Group: {group_name}   (id {short_id}...)",
                anchor="w",
                command=lambda b=browser_id: finish(b),
            )
            btn.grid(row=index, column=0, padx=8, pady=5, sticky="ew")

        cancel_btn = ctk.CTkButton(
            dialog, text="Skip this profile", fg_color="gray40", hover_color="gray30",
            command=lambda: finish(None),
        )
        cancel_btn.grid(row=2, column=0, padx=14, pady=(6, 14), sticky="e")

        dialog.protocol("WM_DELETE_WINDOW", lambda: finish(None))

        try:
            dialog.focus_force()
        except Exception:
            pass

    post(show)

    if not event.wait(timeout):
        print(f"[Warning] Duplicate-profile prompt for '{identifier}' timed out.")
        return None

    return selected_id[0]
