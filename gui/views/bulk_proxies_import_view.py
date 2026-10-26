from core.automation.incogniton_manager import update_profile_proxy
from core.automation.profile_builder import parse_proxy
from gui.views.bulk_sheet_view import BulkSheetImportView

SHEET_NAME = "Bulk proxies import"


class BulkProxiesImportView(BulkSheetImportView):
    """
    Sets the proxy on Incogniton profiles in bulk from the
    'Bulk proxies import' tab (Profile Name | Proxy | Status).

    Profiles are not launched - the proxy is written through Incogniton's
    local API, so a full sheet applies in seconds.
    """

    TITLE = "Bulk Proxies Import"
    SHEET_NAME = SHEET_NAME
    VALUE_COLUMN = "Proxy"
    VALUE_KEYS = ("proxy", "proxy string", "proxies")
    VALUE_LABEL = "proxy"
    START_LABEL = "Import Proxies"
    DEFAULT_WORKERS = "5"
    DESCRIPTION = (
        f"Applies proxies to Incogniton profiles from the '{SHEET_NAME}' tab "
        "(Profile Name | Proxy | Status).\n"
        "Accepted formats: host:port, host:port:user:pass, user:pass@host:port, "
        "or with a socks5:// / http:// prefix."
    )

    def summarize_value(self, raw):
        text = str(raw or "").strip()
        if not text:
            return "empty"
        info = parse_proxy(text)
        if not info:
            return "invalid"
        return f"{info['host']}:{info['port']} ({info['type']})"

    def process_row(self, profile_name, raw_value, group_hint, options):
        ok, message = update_profile_proxy(profile_name, raw_value, group_hint=group_hint)
        return ok, message, 1 if ok else 0

    def success_status(self, message, count):
        return message or "Proxy updated"
