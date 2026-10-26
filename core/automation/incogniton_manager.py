import threading
import subprocess
import psutil
import os
import json
import time
import requests

_launch_lock = threading.Lock()
from core.config import get_setting, set_setting
from core.utils.path_finder import find_incogniton_path

INCOGNITON_API = "http://127.0.0.1:35000"

from core.engine.retry_manager import RetryManager
from core.engine.exceptions import RetryableError, PermanentError

_api_retry = RetryManager(max_attempts=3, backoff_seconds=2.0)

# Incogniton gets unstable if several profiles are launched at the exact same
# moment, so launches are serialized and spaced out by this many seconds.
LAUNCH_COOLDOWN_SECONDS = 4.0
_last_launch_ts = 0.0

# Profiles this app launched and has not stopped yet. Used so a second row that
# points at the same profile does not kill a browser that is mid-automation.
_active_launches = set()
_active_lock = threading.Lock()

# profile name (normalized) -> browser_id, filled in as we resolve names.
_name_cache = {}
_name_cache_lock = threading.Lock()


def _api_request(method, endpoint, timeout=15, attempts=None, **kwargs):
    """Calls the local Incogniton REST API with retries on connection errors."""
    import requests
    url = f"{INCOGNITON_API}{endpoint}"

    def _do_req():
        try:
            if method.lower() == "get":
                resp = requests.get(url, timeout=timeout, **kwargs)
            else:
                resp = requests.post(url, timeout=timeout, **kwargs)

            if resp.status_code in [429, 500, 502, 503, 504]:
                raise RetryableError(f"Incogniton API {resp.status_code}")

            return resp
        except requests.exceptions.RequestException as e:
            raise RetryableError(f"Incogniton Connection Error: {str(e)}")

    if attempts is not None and attempts <= 1:
        # Single shot (used when probing payload formats - retrying every
        # format 3 times would make the UI look frozen).
        return _do_req()

    retry = _api_retry if attempts is None else RetryManager(max_attempts=attempts, backoff_seconds=2.0)
    return retry.execute_with_retry(_do_req)


def _post_form(endpoint, form_data, timeout=30, attempts=1):
    """
    POSTs application/x-www-form-urlencoded data.

    Incogniton's Java backend reads `profileData` as a String for several
    endpoints. Sending it as a nested JSON object makes it throw
    "class java.util.LinkedHashMap cannot be cast to class java.lang.String",
    so those endpoints must be called with form data holding a JSON *string*.
    """
    return _api_request(
        "post",
        endpoint,
        timeout=timeout,
        attempts=attempts,
        data=form_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def _resp_ok(resp):
    """True if the API response reports success."""
    if resp is None or resp.status_code != 200:
        return False, f"HTTP {getattr(resp, 'status_code', '?')}: {str(getattr(resp, 'text', ''))[:300]}"
    try:
        data = resp.json()
    except Exception:
        # Some endpoints answer with plain text ("OK").
        text = str(resp.text).strip().lower()
        return ("ok" in text or "success" in text), str(resp.text)[:300]

    if isinstance(data, dict):
        status = str(data.get("status", "")).strip().lower()
        if status in ("ok", "success", "true") or data.get("success") is True:
            return True, str(data.get("message", "ok"))
        return False, str(data.get("message") or data.get("error") or data)[:300]
    return False, str(data)[:300]


def api_alive():
    """Fast check of the local REST API (used instead of scanning processes)."""
    try:
        resp = _api_request("get", "/alive", timeout=5, attempts=1)
        return resp.status_code == 200
    except Exception:
        return False


def is_incogniton_running():
    """Checks if Incogniton is already running."""
    # The API answering is the only thing that actually matters to us.
    if api_alive():
        return True
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name'] and 'incogniton' in proc.info['name'].lower():
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return False


def is_incogniton_api_ready():
    """Checks if the Incogniton local REST API is responding."""
    if api_alive():
        return True
    try:
        resp = _api_request("get", "/profile/all", timeout=10, attempts=1)
        return resp.status_code == 200
    except Exception:
        return False


def wait_for_incogniton_ready(timeout=60, logger_callback=print):
    """
    Waits for Incogniton process and its API to become responsive.
    Polls every 2-3 seconds up to timeout (default 60 seconds).
    Returns (True, message) when ready, (False, message) if timed out.
    """
    start_time = time.time()
    logger_callback(f"Waiting for Incogniton API to initialize (up to {timeout}s)...")

    last_log_time = 0
    while time.time() - start_time < timeout:
        elapsed = int(time.time() - start_time)
        if is_incogniton_api_ready():
            logger_callback(f"Incogniton is ready! (Initialized in {elapsed}s)")
            return True, "Incogniton is ready."

        time.sleep(2)
        if elapsed > 0 and elapsed - last_log_time >= 10:
            last_log_time = elapsed
            logger_callback(f"Still waiting for Incogniton to load... ({elapsed}s/{timeout}s)")

    return False, f"Incogniton did not become ready within {timeout} seconds."


def get_incogniton_exe():
    """Gets the path to the Incogniton executable, trying config first, then auto-discovery."""
    saved_path = get_setting("incogniton_path")
    if saved_path and os.path.exists(saved_path):
        return saved_path

    discovered_path = find_incogniton_path()
    if discovered_path:
        set_setting("incogniton_path", discovered_path)
        return discovered_path

    return None


def launch_incogniton():
    """Launches Incogniton if it's not already running."""
    if is_incogniton_running():
        return True, "Incogniton is already running."

    exe_path = get_incogniton_exe()
    if not exe_path:
        return False, "Incogniton executable not found. Please set it in Settings."

    try:
        # Use Popen to start it detached from our script
        subprocess.Popen([exe_path])
        return True, "Incogniton launched successfully."
    except Exception as e:
        return False, f"Failed to launch: {str(e)}"


def ensure_incogniton_ready(timeout=90, logger_callback=print):
    """
    Makes sure Incogniton is running AND its API answers.

    The old code only waited for the API when it had to start Incogniton
    itself, so a freshly opened (still loading) Incogniton made profile
    launches fail at random.
    """
    if is_incogniton_api_ready():
        return True, "Incogniton is ready."

    if not is_incogniton_running():
        logger_callback("Incogniton is not running. Launching it automatically...")
        ok, msg = launch_incogniton()
        if not ok:
            return False, msg
    else:
        logger_callback("Incogniton is running but its API is not answering yet...")

    return wait_for_incogniton_ready(timeout=timeout, logger_callback=logger_callback)


# --------------------------------------------------------------------------
# Profile lookup
# --------------------------------------------------------------------------

def _norm(value):
    return " ".join(str(value or "").split()).strip().lower()


def _looks_like_uuid(value):
    value = str(value).strip()
    return len(value) >= 32 and "-" in value and " " not in value


def list_profiles():
    """Returns the raw profileData list from Incogniton (empty list on error)."""
    try:
        resp = _api_request("get", "/profile/all", timeout=30)
        if resp.status_code != 200:
            return []
        data = resp.json()
        profiles = data.get("profileData", [])
        if isinstance(profiles, str):
            # Some builds hand back a JSON string instead of a list.
            try:
                profiles = json.loads(profiles)
            except Exception:
                return []
        return profiles if isinstance(profiles, list) else []
    except Exception:
        return []


def find_profile_matches(identifier):
    """
    Finds every profile whose name or browser_id matches `identifier`.
    Matching is whitespace/case insensitive, which is what trips up most
    sheet rows (a trailing space used to mean "profile not found").
    """
    target = _norm(identifier)
    if not target:
        return []

    matches = []
    for p in list_profiles():
        if not isinstance(p, dict):
            continue
        info = p.get("general_profile_information", {}) or {}
        browser_id = info.get("browser_id") or p.get("profile_browser_id") or ""
        name = info.get("profile_name") or p.get("profile_name") or ""

        if _norm(browser_id) == target or _norm(name) == target:
            group_name = p.get("group") or info.get("profile_group") or "Unassigned"
            matches.append({
                "browser_id": browser_id,
                "group": group_name,
                "profile_name": name,
                "record": p,
            })
    return matches


def resolve_profile_id(identifier, duplicate_resolver=None, master=None, group_hint=None):
    """Resolves a profile name to its browser_id (UUID). Returns the original identifier if already a UUID."""
    profile_id = str(identifier).strip()
    if not profile_id:
        return None

    if _looks_like_uuid(profile_id):
        return profile_id

    cache_key = _norm(profile_id)
    # A name resolved with a group hint is only valid for that same hint, so
    # it is remembered under its own key.
    hint_key = f"{cache_key}|{_norm(group_hint)}" if group_hint else None

    with _name_cache_lock:
        if hint_key and hint_key in _name_cache:
            return _name_cache[hint_key]
        if not group_hint and cache_key in _name_cache:
            return _name_cache[cache_key]

    def remember(browser_id, ambiguous):
        if not browser_id:
            return
        with _name_cache_lock:
            if hint_key:
                _name_cache[hint_key] = browser_id
            if not ambiguous:
                _name_cache[cache_key] = browser_id
            elif not hint_key:
                _name_cache[cache_key] = browser_id

    try:
        matches = find_profile_matches(profile_id)

        if len(matches) == 1:
            browser_id = matches[0]["browser_id"]
            remember(browser_id, ambiguous=False)
            return browser_id

        if len(matches) > 1:
            if group_hint:
                # A "Group" column in the sheet is enough to disambiguate.
                narrowed = [m for m in matches if _norm(m.get("group")) == _norm(group_hint)]
                if len(narrowed) == 1:
                    browser_id = narrowed[0]["browser_id"]
                    remember(browser_id, ambiguous=True)
                    return browser_id

            if duplicate_resolver and master is not None:
                print(f"[Warning] Multiple profiles found for '{profile_id}'. Prompting user...")
                selected_id = duplicate_resolver(master, profile_id, matches)
                if selected_id:
                    remember(selected_id, ambiguous=True)
                    return selected_id
                print(f"User canceled duplicate resolution for '{profile_id}'.")
                return None
            print(f"[Warning] Multiple Incogniton profiles found with name '{profile_id}'. Please use the specific Profile ID in Google Sheets instead.")
            return None

        return None
    except Exception:
        return None


def get_profile_record(identifier):
    """Returns (browser_id, raw profile dict) or (None, None)."""
    matches = find_profile_matches(identifier)
    if len(matches) == 1:
        return matches[0]["browser_id"], matches[0]["record"]
    if len(matches) > 1:
        return None, None
    return None, None


# --------------------------------------------------------------------------
# Launching / stopping
# --------------------------------------------------------------------------

def extract_debug_url(data):
    """
    Pulls the CDP/websocket endpoint out of a launch response.
    Incogniton has used several key names for it across versions.
    """
    if not isinstance(data, dict):
        return ""

    debug_url = ""
    for key in ("puppeteerUrl", "webSocketDebuggerUrl", "url", "wsUrl", "debuggerUrl", "ws_endpoint"):
        value = data.get(key)
        if value and isinstance(value, str) and value.strip():
            debug_url = value.strip()
            break

    if not debug_url:
        nested = data.get("data")
        if isinstance(nested, dict):
            return extract_debug_url(nested)

    if not debug_url and data.get("port"):
        debug_url = f"http://127.0.0.1:{data.get('port')}"

    if debug_url and not debug_url.startswith("http") and not debug_url.startswith("ws"):
        debug_url = f"ws://{debug_url}"

    return debug_url


def _status_is_running(text):
    value = _norm(text)
    if not value:
        return False
    if any(word in value for word in ("not ", "stop", "idle", "closed", "off", "inactive")):
        return False
    return any(word in value for word in ("run", "active", "start", "launch", "open", "busy"))


def get_profile_status(profile_id):
    """Returns the raw status string Incogniton reports for a profile ('' if unknown)."""
    try:
        resp = _api_request("get", f"/profile/status/{profile_id}", timeout=10, attempts=1)
        if resp.status_code != 200:
            return ""
        try:
            data = resp.json()
        except Exception:
            return str(resp.text)[:200]
        if isinstance(data, dict):
            for key in ("profile_status", "state", "profileStatus", "message", "data"):
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return ""
    except Exception:
        return ""


def force_stop_profile(profile_id):
    """Force-stops a profile, ignoring any error."""
    for endpoint in (f"/profile/force-stop/{profile_id}", f"/profile/stop/{profile_id}"):
        try:
            resp = _api_request("get", endpoint, timeout=30, attempts=1)
            if resp.status_code == 200:
                return True
        except Exception:
            continue
    return False


def _respect_launch_cooldown():
    """Keeps a gap between consecutive launches (caller holds _launch_lock)."""
    global _last_launch_ts
    wait = LAUNCH_COOLDOWN_SECONDS - (time.time() - _last_launch_ts)
    if wait > 0:
        time.sleep(wait)


def start_profile(identifier, duplicate_resolver=None, master=None, max_retries=3, logger_callback=None):
    """
    Starts an Incogniton profile for automation and returns the debugging WebSocket URL.
    Uses: /automation/launch/puppeteer/{profile_id}
    identifier can be a UUID or the profile name.
    """
    global _last_launch_ts
    log = logger_callback or (lambda m: None)

    # A half-initialized Incogniton was the most common reason profiles
    # "sometimes" refused to open, so make sure the API answers first.
    if not is_incogniton_api_ready():
        ok, msg = ensure_incogniton_ready(logger_callback=log if logger_callback else print)
        if not ok:
            return False, msg

    profile_id = resolve_profile_id(identifier, duplicate_resolver, master)
    if not profile_id:
        matches = find_profile_matches(identifier)
        if len(matches) > 1:
            return False, (f"Multiple Incogniton profiles are named '{identifier}'. "
                           f"Put the profile ID in the sheet instead.")
        return False, f"Could not find profile with name/id: {identifier}"

    with _active_lock:
        already_ours = profile_id in _active_launches
    if already_ours:
        return False, f"Profile '{identifier}' is already running in another task of this app."

    with _launch_lock:
        last_err = "Unknown error"
        for attempt in range(max_retries):
            try:
                _respect_launch_cooldown()

                # A profile left open (crashed run, manual open) cannot be
                # launched again - close it first instead of failing.
                if _status_is_running(get_profile_status(profile_id)):
                    log(f"Profile is still open in Incogniton. Closing it before launch...")
                    force_stop_profile(profile_id)
                    time.sleep(3)

                _last_launch_ts = time.time()
                response = _api_request(
                    "get", f"/automation/launch/puppeteer/{profile_id}", timeout=180, attempts=1
                )
                _last_launch_ts = time.time()

                if response.status_code != 200:
                    last_err = f"Failed to start profile. Status: {response.status_code}"
                else:
                    try:
                        data = response.json()
                    except Exception:
                        data = {}
                        last_err = f"Unreadable launch response: {str(response.text)[:200]}"

                    if data:
                        status = str(data.get("status", "")).strip().lower()
                        if status in ("ok", "success"):
                            if not extract_debug_url(data):
                                last_err = f"Incogniton launched the profile but returned no debugging URL: {data}"
                            else:
                                with _active_lock:
                                    _active_launches.add(profile_id)
                                return True, data
                        else:
                            last_err = f"Incogniton returned error: {data}"

                if attempt < max_retries - 1:
                    log(f"Launch attempt {attempt + 1}/{max_retries} failed ({last_err}). Resetting profile and retrying...")
                    force_stop_profile(profile_id)
                    time.sleep(5)

            except Exception as e:
                last_err = str(e)
                if attempt < max_retries - 1:
                    log(f"Launch attempt {attempt + 1}/{max_retries} errored ({last_err}). Retrying...")
                    force_stop_profile(profile_id)
                    time.sleep(5)

        return False, last_err


def stop_profile(identifier):
    """
    Stops an Incogniton profile.
    Uses: /profile/stop/{profile_id}
    """
    profile_id = resolve_profile_id(identifier)
    if not profile_id:
        return False

    try:
        resp = _api_request("get", f"/profile/stop/{profile_id}", timeout=30, attempts=1)
        stopped = resp.status_code == 200
    except Exception:
        stopped = False

    if not stopped:
        stopped = force_stop_profile(profile_id)

    with _active_lock:
        _active_launches.discard(profile_id)

    return stopped


# --------------------------------------------------------------------------
# Proxy update
# --------------------------------------------------------------------------

def update_profile_proxy(profile_id, proxy_str, group_hint=None):
    """
    Updates the proxy of an existing Incogniton profile before launching.

    `group_hint` (a Group column in the sheet) disambiguates profiles that
    share a name.
    """
    if not proxy_str or str(proxy_str).strip() == "" or str(proxy_str).lower() == "n/a":
        return False, "No valid proxy provided"

    # We must import parse_proxy here to avoid circular imports if any
    from core.automation.profile_builder import parse_proxy
    proxy_info = parse_proxy(proxy_str)
    if not proxy_info:
        return False, "Invalid proxy format (expected host:port:user:pass)"

    try:
        actual_browser_id, profile_data = get_profile_record(profile_id)

        if not profile_data and group_hint:
            resolved = resolve_profile_id(profile_id, group_hint=group_hint)
            if resolved:
                actual_browser_id, profile_data = get_profile_record(resolved)

        if not profile_data:
            matches = find_profile_matches(profile_id)
            if len(matches) > 1:
                return False, f"Multiple Incogniton profiles are named '{profile_id}'"
            return False, f"Profile not found for update: {profile_id}"

        connection_type = str(proxy_info.get("type") or "SOCKS5").upper()
        target_url = f"{proxy_info['host']}:{proxy_info['port']}".strip()
        target_user = str(proxy_info.get("username") or "").strip()
        target_pass = str(proxy_info.get("password") or "").strip()

        # Check if existing proxy already matches
        existing_proxy = profile_data.get("Proxy", profile_data.get("proxy", {}))
        if isinstance(existing_proxy, dict):
            existing_url = str(existing_proxy.get("proxy_url", "")).strip()
            existing_user = str(existing_proxy.get("proxy_username", "")).strip()
            existing_pass = str(existing_proxy.get("proxy_password", "")).strip()
            existing_type = str(existing_proxy.get("connection_type", "")).strip().upper()

            if (existing_url == target_url and
                    existing_user == target_user and
                    existing_pass == target_pass and
                    existing_type == connection_type):
                return True, "Proxy is already up to date"

        # Only primitive strings - Incogniton's backend casts these to String.
        clean_proxy = {
            "connection_type": connection_type,
            "proxy_url": target_url,
            "proxy_username": target_user,
            "proxy_password": target_pass,
        }

        browser_id = str(actual_browser_id or profile_id)

        # Incogniton expects form-urlencoded data whose `profileData` field is
        # a JSON *string*. Posting it as a JSON object is what produced
        # "class java.util.LinkedHashMap cannot be cast to class java.lang.String".
        form_variants = [
            {"profileData": json.dumps({"profile_browser_id": browser_id, "Proxy": clean_proxy})},
            {"profileData": json.dumps({"profile_browser_id": browser_id, "proxy": clean_proxy})},
            {
                "profile_browser_id": browser_id,
                "profileData": json.dumps({"profile_browser_id": browser_id, "Proxy": clean_proxy}),
            },
        ]

        last_err = "Unknown error"
        for form_data in form_variants:
            try:
                resp = _post_form("/profile/update", form_data, timeout=30, attempts=1)
                ok, msg = _resp_ok(resp)
                if ok:
                    return True, "Proxy updated successfully"
                last_err = msg
            except Exception as ex:
                last_err = str(ex)

        # Last resort: the plain JSON body shape (older builds accepted it).
        for json_payload in (
            {"profile_browser_id": browser_id, "Proxy": clean_proxy},
            {"profileData": {"profile_browser_id": browser_id, "Proxy": clean_proxy}},
        ):
            try:
                resp = _api_request("post", "/profile/update", json=json_payload, timeout=30, attempts=1)
                ok, msg = _resp_ok(resp)
                if ok:
                    return True, "Proxy updated successfully"
                last_err = msg
            except Exception as ex:
                last_err = str(ex)

        return False, f"API Error: {last_err}"

    except Exception as e:
        return False, f"Error updating proxy: {str(e)}"
