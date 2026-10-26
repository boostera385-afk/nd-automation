import customtkinter as ctk

from gui import ui_thread
from gui.views.home_view import HomeView
from gui.views.settings_view import SettingsView
from gui.views.bulk_create_view import BulkCreateView
from gui.views.bulk_cookies_import_view import BulkCookiesImportView
from gui.views.bulk_proxies_import_view import BulkProxiesImportView
from gui.views.nd_acc_creation_view import NDAccCreationView
from gui.views.auto_posting_view import AutoPostingView
from gui.views.auto_listing_view import AutoListingView
from gui.views.auto_warmup_view import AutoWarmupView
from gui.views.auto_random_posting_view import AutoRandomPostingView
from gui.views.script_view import ScriptView


class App(ctk.CTk):
    # (label, key, view class)
    NAV_ITEMS = [
        ("Home", "home", HomeView),
        ("Incognito Acc Creation", "bulk", BulkCreateView),
        ("Bulk Cookies Import", "bulk_cookies_import", BulkCookiesImportView),
        ("Bulk Proxies Import", "bulk_proxies_import", BulkProxiesImportView),
        ("ND Acc Creation", "nd_acc", NDAccCreationView),
        ("Auto Posting", "auto_post", AutoPostingView),
        ("Auto Listing", "auto_list", AutoListingView),
        ("Auto Warmup", "auto_warmup", AutoWarmupView),
        ("Auto Random Posting", "auto_random", AutoRandomPostingView),
        ("Script Builder", "script", ScriptView),
    ]

    def __init__(self):
        super().__init__()

        self.title("Automation App")
        # The old 800x500 window could not fit the sidebar, so buttons were
        # cut off and views had no room for their log boxes.
        self.geometry("1150x740")
        self.minsize(940, 620)

        self._views = {}
        self._nav_buttons = {}
        self._active_key = None

        def _theme_color(key, fallback):
            try:
                value = ctk.ThemeManager.theme["CTkButton"][key]
            except Exception:
                return fallback
            return tuple(value) if isinstance(value, list) else value

        self._default_btn_fg = _theme_color("fg_color", ("#3B8ED0", "#1F6AA5"))
        self._default_btn_hover = _theme_color("hover_color", ("#36719F", "#144870"))
        self._default_btn_text = _theme_color("text_color", ("#DCE4EE", "#DCE4EE"))

        # Grid layout 1x2 (Sidebar, Main content)
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=1)

        self._build_sidebar()

        # --- Main Content Area ---
        self.main_container = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")
        self.main_container.grid(row=0, column=1, sticky="nsew")
        self.main_container.grid_rowconfigure(0, weight=1)
        self.main_container.grid_columnconfigure(0, weight=1)

        # Pump that lets background threads update widgets safely.
        ui_thread.install(self)

        self.protocol("WM_DELETE_WINDOW", self.on_close)

        # Default view
        self.show_view("home")

    # ------------------------------------------------------------------
    # Sidebar
    # ------------------------------------------------------------------
    def _build_sidebar(self):
        self.sidebar_frame = ctk.CTkFrame(self, width=220, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, sticky="nsew")
        self.sidebar_frame.grid_propagate(False)
        self.sidebar_frame.grid_rowconfigure(1, weight=1)
        self.sidebar_frame.grid_columnconfigure(0, weight=1)

        self.logo_label = ctk.CTkLabel(
            self.sidebar_frame, text="Navigation", font=ctk.CTkFont(size=20, weight="bold")
        )
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="ew")

        # Scrollable so every entry stays reachable on small screens.
        self.nav_frame = ctk.CTkScrollableFrame(self.sidebar_frame, fg_color="transparent")
        self.nav_frame.grid(row=1, column=0, sticky="nsew", padx=(6, 2))
        self.nav_frame.grid_columnconfigure(0, weight=1)

        for index, (label, key, _view_class) in enumerate(self.NAV_ITEMS):
            button = ctk.CTkButton(
                self.nav_frame,
                text=label,
                anchor="w",
                height=34,
                command=lambda k=key: self.show_view(k),
            )
            button.grid(row=index, column=0, padx=8, pady=5, sticky="ew")
            self._nav_buttons[key] = button

        # --- bottom block (always visible) ---
        self.bottom_frame = ctk.CTkFrame(self.sidebar_frame, fg_color="transparent")
        self.bottom_frame.grid(row=2, column=0, sticky="ew", padx=14, pady=(10, 16))
        self.bottom_frame.grid_columnconfigure(0, weight=1)

        self.btn_settings = ctk.CTkButton(
            self.bottom_frame, text="Settings", anchor="w", height=34,
            command=lambda: self.show_view("settings"),
        )
        self.btn_settings.grid(row=0, column=0, sticky="ew")
        self._nav_buttons["settings"] = self.btn_settings

        self.appearance_label = ctk.CTkLabel(
            self.bottom_frame, text="Appearance", text_color="gray", anchor="w"
        )
        self.appearance_label.grid(row=1, column=0, sticky="ew", pady=(14, 2))

        self.appearance_menu = ctk.CTkOptionMenu(
            self.bottom_frame,
            values=["System", "Dark", "Light"],
            command=self.change_appearance_mode_event,
        )
        self.appearance_menu.grid(row=2, column=0, sticky="ew")
        self.appearance_menu.set(ctk.get_appearance_mode().capitalize())

    def _highlight_nav(self, active_key):
        for key, button in self._nav_buttons.items():
            try:
                if not button.winfo_exists():
                    continue
                if key == active_key:
                    button.configure(
                        fg_color=self._default_btn_fg,
                        hover_color=self._default_btn_hover,
                        text_color=self._default_btn_text,
                    )
                else:
                    button.configure(
                        fg_color="transparent",
                        hover_color=("gray78", "gray26"),
                        text_color=("gray10", "gray90"),
                    )
            except Exception:
                pass

    # ------------------------------------------------------------------
    # View switching
    # ------------------------------------------------------------------
    def _view_classes(self):
        classes = {key: view_class for _label, key, view_class in self.NAV_ITEMS}
        classes["settings"] = SettingsView
        return classes

    def get_view(self, key):
        """Returns the view for `key`, building it the first time it is shown."""
        if key in self._views:
            return self._views[key]

        view_class = self._view_classes().get(key)
        if view_class is None:
            return None

        view = view_class(self.main_container, fg_color="transparent")
        self._views[key] = view
        return view

    def hide_all_views(self):
        for view in self._views.values():
            try:
                view.grid_forget()
            except Exception:
                pass

    def show_view(self, key):
        view = self.get_view(key)
        if view is None:
            return
        self.hide_all_views()
        view.grid(row=0, column=0, sticky="nsew")
        self._active_key = key
        self._highlight_nav(key)

        if hasattr(view, "on_shown"):
            try:
                view.on_shown()
            except Exception:
                pass

    # Kept so the old entry points keep working.
    def show_home_view(self):
        self.show_view("home")

    def show_bulk_view(self):
        self.show_view("bulk")

    def show_bulk_cookies_import_view(self):
        self.show_view("bulk_cookies_import")

    def show_bulk_proxies_import_view(self):
        self.show_view("bulk_proxies_import")

    def show_nd_acc_view(self):
        self.show_view("nd_acc")

    def show_auto_post_view(self):
        self.show_view("auto_post")

    def show_auto_list_view(self):
        self.show_view("auto_list")

    def show_auto_warmup_view(self):
        self.show_view("auto_warmup")

    def show_auto_random_posting_view(self):
        self.show_view("auto_random")

    def show_script_view(self):
        self.show_view("script")

    def show_settings_view(self):
        self.show_view("settings")

    # ------------------------------------------------------------------
    def change_appearance_mode_event(self, new_appearance_mode: str):
        ctk.set_appearance_mode(new_appearance_mode)
        try:
            from core.config import set_setting
            set_setting("appearance_mode", new_appearance_mode)
        except Exception:
            pass
        # Re-apply the highlight so the inactive buttons pick up the new theme.
        self._highlight_nav(self._active_key)

    def on_close(self):
        """Signals every running automation to stop before the window closes."""
        for view in self._views.values():
            for attr in ("shutdown", "stop_automation"):
                handler = getattr(view, attr, None)
                if callable(handler):
                    try:
                        handler()
                    except Exception:
                        pass
                    break
        ui_thread.shutdown()
        try:
            self.destroy()
        except Exception:
            pass
