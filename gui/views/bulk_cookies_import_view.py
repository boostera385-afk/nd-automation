import customtkinter as ctk

from core.automation.cookie_importer import import_cookies_for_profile, parse_cookies
from gui.views.bulk_sheet_view import BulkSheetImportView

SHEET_NAME = "Bulk cookies import"
# The tab used to be misnamed; keep reading it if it was never renamed.
LEGACY_SHEET_NAMES = ("Bulk proxy import",)


class BulkCookiesImportView(BulkSheetImportView):
    """
    Imports cookies into Incogniton profiles in bulk from the
    'Bulk cookies import' tab (Profile Name | Cookies | Status).

    Nothing is launched - cookies go in over Incogniton's local API, so a
    full sheet imports in seconds.
    """

    TITLE = "Bulk Cookies Import"
    SHEET_NAME = SHEET_NAME
    LEGACY_SHEET_NAMES = LEGACY_SHEET_NAMES
    VALUE_COLUMN = "Cookies"
    VALUE_KEYS = ("cookies", "cookie")
    VALUE_LABEL = "cookies"
    START_LABEL = "Import Cookies"
    DESCRIPTION = (
        f"Imports cookies into Incogniton profiles from the '{SHEET_NAME}' tab "
        "(Profile Name | Cookies | Status).\n"
        "Cookies can be a JSON array, a cookies.txt export, base64, or a path to a cookie file."
    )

    def build_extra_options(self, frame):
        self.replace_var = ctk.BooleanVar(value=False)
        self.replace_check = ctk.CTkCheckBox(
            frame, text="Clear existing cookies first", variable=self.replace_var
        )
        self.replace_check.pack(side="left", padx=(0, 15))

    def collect_options(self):
        return {"replace": bool(self.replace_var.get())}

    def summarize_value(self, raw):
        text = str(raw or "").strip()
        if not text:
            return "empty"
        cookies, err = parse_cookies(text)
        return "unreadable" if err else f"{len(cookies)} cookies"

    def process_row(self, profile_name, raw_value, group_hint, options):
        return import_cookies_for_profile(
            profile_name,
            raw_value,
            group_hint=group_hint,
            replace=bool(options.get("replace")),
        )

    def success_status(self, message, count):
        return f"Imported {count} cookies"
