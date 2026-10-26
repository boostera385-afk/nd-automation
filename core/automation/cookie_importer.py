"""
Bulk cookie import for Incogniton profiles.

Cookies are pushed straight through Incogniton's local REST API
(POST /profile/addCookie), so nothing has to be launched - an import takes
well under a second per profile.
"""

import base64
import binascii
import json
import os

from core.automation.incogniton_manager import (
    _api_request,
    _resp_ok,
    find_profile_matches,
    resolve_profile_id,
)

_TRUTHY = ("true", "1", "yes", "y", "on")


def _to_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return default
    return str(value).strip().lower() in _TRUTHY


def _normalize_same_site(value):
    raw = str(value or "").strip().lower().replace("-", "_")
    if raw in ("none", "no_restriction", "norestriction"):
        return "no_restriction"
    if raw == "lax":
        return "lax"
    if raw == "strict":
        return "strict"
    return "unspecified"


def _normalize_expiry(cookie):
    for key in ("expirationDate", "expirationdate", "expires", "expiry", "expires_utc", "expirationDateMs"):
        if key in cookie and cookie[key] not in (None, "", "null"):
            try:
                value = float(cookie[key])
            except (TypeError, ValueError):
                continue
            if value <= 0:
                return None
            # Some exporters use milliseconds.
            if value > 1e11:
                value = value / 1000.0
            return value
    return None


def _normalize_cookie(raw):
    """Converts one exported cookie into the shape Incogniton stores."""
    if not isinstance(raw, dict):
        return None

    lower = {str(k).strip().lower(): v for k, v in raw.items()}

    name = str(lower.get("name", "")).strip()
    domain = str(lower.get("domain", "") or lower.get("host", "") or lower.get("hostkey", "")).strip()
    if not name or not domain:
        return None

    value = lower.get("value", "")
    value = "" if value is None else str(value)

    path = str(lower.get("path", "") or "/").strip() or "/"
    expiry = _normalize_expiry(lower)

    cookie = {
        "name": name,
        "value": value,
        "domain": domain,
        "path": path,
        "secure": _to_bool(lower.get("secure"), False),
        "httpOnly": _to_bool(lower.get("httponly")),
        "hostOnly": _to_bool(lower.get("hostonly"), not domain.startswith(".")),
        "sameSite": _normalize_same_site(lower.get("samesite")),
        "session": expiry is None,
    }

    if expiry is not None:
        cookie["expirationDate"] = expiry

    return cookie


def _parse_netscape(text):
    """Parses a cookies.txt / Netscape formatted cookie file."""
    cookies = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            # "#HttpOnly_" prefixed lines are real cookies.
            if not stripped.lower().startswith("#httponly_"):
                continue
            stripped = stripped[len("#HttpOnly_"):]
            http_only = True
        else:
            http_only = False

        parts = stripped.split("\t")
        if len(parts) < 7:
            parts = [p for p in stripped.split() if p != ""]
        if len(parts) < 7:
            continue

        domain, host_only_flag, path, secure, expiry, name, value = parts[:7]
        cookies.append({
            "domain": domain,
            "hostOnly": str(host_only_flag).strip().upper() != "TRUE",
            "path": path,
            "secure": str(secure).strip().upper() == "TRUE",
            "expirationDate": expiry,
            "name": name,
            "value": value,
            "httpOnly": http_only,
        })
    return cookies


def _extract_cookie_list(data):
    """Finds the cookie array inside whatever structure was pasted in."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("cookies", "cookieData", "CookieData", "CookieData ", "data", "Cookies"):
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                try:
                    nested = json.loads(value)
                except Exception:
                    continue
                if isinstance(nested, list):
                    return nested
        # A single cookie object.
        if "name" in data or "Name" in data:
            return [data]
    return None


def parse_cookies(raw):
    """
    Accepts a JSON array, a JSON object wrapping an array, a single cookie
    object, Netscape cookies.txt text, a base64 blob of any of those, or a
    path to a file containing any of those.

    Returns (cookies, error_message).
    """
    if raw is None:
        return [], "Cookies cell is empty"

    text = str(raw).strip()
    if not text:
        return [], "Cookies cell is empty"

    # A path to an exported cookie file.
    if len(text) < 400 and ("\\" in text or "/" in text) and "\n" not in text:
        try:
            if os.path.isfile(text):
                with open(text, "r", encoding="utf-8", errors="replace") as handle:
                    text = handle.read().strip()
        except OSError:
            pass

    if not text:
        return [], "Cookies cell is empty"

    candidates = [text]

    # Base64 blob (what most "export cookies" extensions produce).
    if not text.startswith(("[", "{", "#")) and "\t" not in text:
        compact = "".join(text.split())
        try:
            decoded = base64.b64decode(compact + "=" * (-len(compact) % 4), validate=False)
            decoded_text = decoded.decode("utf-8", errors="strict").strip()
            if decoded_text:
                candidates.insert(0, decoded_text)
        except (binascii.Error, UnicodeDecodeError, ValueError):
            pass

    for candidate in candidates:
        if candidate.startswith(("[", "{")):
            try:
                data = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            cookie_list = _extract_cookie_list(data)
            if cookie_list is None:
                continue
            normalized = [c for c in (_normalize_cookie(item) for item in cookie_list) if c]
            if normalized:
                return normalized, ""
            return [], "No usable cookies found (each cookie needs a name and a domain)"

    for candidate in candidates:
        if "\t" in candidate or candidate.lstrip().startswith("#") or "\n" in candidate:
            normalized = [c for c in (_normalize_cookie(item) for item in _parse_netscape(candidate)) if c]
            if normalized:
                return normalized, ""

    return [], "Could not read the cookies (expected JSON array, cookies.txt text, or base64)"


def import_cookies_for_profile(identifier, raw_cookies, group_hint=None, replace=False):
    """
    Imports cookies into the Incogniton profile named (or identified by)
    `identifier`.

    Returns (success, message, cookie_count).
    """
    name = str(identifier or "").strip()
    if not name:
        return False, "Profile Name is empty", 0

    cookies, err = parse_cookies(raw_cookies)
    if err:
        return False, err, 0

    profile_id = resolve_profile_id(name, group_hint=group_hint)
    if not profile_id:
        matches = find_profile_matches(name)
        if len(matches) > 1:
            groups = ", ".join(sorted({str(m.get("group") or "Unassigned") for m in matches}))
            return False, f"Multiple Incogniton profiles named '{name}' (groups: {groups}). Add a Group column or use the profile ID.", 0
        return False, f"No Incogniton profile named '{name}'", 0

    if replace:
        try:
            _api_request("get", f"/profile/deleteCookie/{profile_id}", timeout=30, attempts=1)
        except Exception:
            pass

    payload = {
        "profile_browser_id": str(profile_id),
        "format": "base64json",
        "cookie": base64.b64encode(json.dumps(cookies).encode("utf-8")).decode("ascii"),
    }

    last_err = "Unknown error"
    try:
        resp = _api_request("post", "/profile/addCookie", json=payload, timeout=60, attempts=1)
        ok, msg = _resp_ok(resp)
        if ok:
            return True, f"Imported {len(cookies)} cookies", len(cookies)
        last_err = msg
    except Exception as e:
        last_err = str(e)

    # Fallback: form-urlencoded, like the other profileData endpoints.
    try:
        from core.automation.incogniton_manager import _post_form
        resp = _post_form("/profile/addCookie", payload, timeout=60, attempts=1)
        ok, msg = _resp_ok(resp)
        if ok:
            return True, f"Imported {len(cookies)} cookies", len(cookies)
        last_err = msg
    except Exception as e:
        last_err = str(e)

    return False, f"Incogniton rejected the cookies: {last_err}", len(cookies)


def get_profile_cookies(identifier):
    """Reads back the cookies Incogniton holds for a profile (used for verification)."""
    profile_id = resolve_profile_id(identifier)
    if not profile_id:
        return False, f"No Incogniton profile named '{identifier}'", []

    try:
        resp = _api_request("get", f"/profile/cookie/{profile_id}", timeout=30, attempts=1)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}", []
        data = resp.json()
    except Exception as e:
        return False, str(e), []

    cookie_list = _extract_cookie_list(data if isinstance(data, (dict, list)) else {}) or []
    return True, f"{len(cookie_list)} cookies", cookie_list
