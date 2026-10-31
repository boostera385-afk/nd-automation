"""Narrow local Incogniton adapter. Never force-stops or retries a launch."""

import base64
import json
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Local API redirects are not allowed")


class ProfileUnavailable(ValueError):
    """Preflight refused to launch; no launch request was sent."""


def _profile_id(data):
    """Accept only an explicit UUID from a creation response; never guess."""
    candidates = []
    if isinstance(data, dict):
        for key in ("profile_id", "profileId", "id"):
            candidates.append(data.get(key))
        if isinstance(data.get("data"), dict):
            for key in ("profile_id", "profileId", "id"):
                candidates.append(data["data"].get(key))
    for value in candidates:
        if isinstance(value, str) and _UUID.fullmatch(value.strip()):
            return value.strip().lower()
    return None


class Incogniton:
    def __init__(self):
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, path, timeout=10, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request("http://127.0.0.1:35000" + path, data=data, method="POST" if data else "GET",
                          headers={"Content-Type": "application/json"} if data else {})
        with self.opener.open(request, timeout=timeout) as response:
            content = response.read(2_000_001)
            if len(content) > 2_000_000:
                raise ValueError("Local API response too large")
            return json.loads(content)

    def all_profiles(self):
        data = self.request("/profile/all")
        profiles = data.get("profiles") if isinstance(data, dict) else data
        if not isinstance(profiles, list):
            raise ValueError("Local API did not return a profile list")
        return profiles

    def all_groups(self):
        data = self.request("/group/all")
        groups = data.get("groups") if isinstance(data, dict) else data
        if not isinstance(groups, list):
            raise ValueError("Local API did not return a group list")
        return groups

    def inventory(self):
        """Counts only: no profile names, cookies, proxies or account labels."""
        profiles = self.all_profiles()
        groups = self.all_groups()
        launched = 0
        for profile in profiles:
            if isinstance(profile, dict):
                state = str(profile.get("status") or profile.get("profile_status") or "").strip().lower()
                if state in {"launched", "running", "active", "in use"}:
                    launched += 1
        return {"profiles": len(profiles), "groups": len(groups), "launched": launched}

    def create(self, name, operating_system="windows", group=""):
        """Create one profile. The response shape is validated before it is trusted.

        The dashboard never sends a proxy, cookie, password or account label here.
        """
        body = {"profileName": name, "os": operating_system}
        if group:
            body["groupName"] = group
        data = self.request("/profile/create", timeout=60, body=body)
        profile_id = _profile_id(data)
        if not profile_id:
            raise ValueError("Profile creation was not confirmed by the local API")
        return profile_id

    def stopped(self, profile_id):
        data = self.request("/profile/status/" + profile_id)
        if not isinstance(data, dict):
            return False
        # Incogniton 5 reports {"status": "Ready"} when idle and {"status":
        # "Launched"} while running; older builds use the other keys. Any
        # unknown or ambiguous shape stays "not stopped" so launch is refused.
        states = [data[key].strip().lower() for key in ("status", "profile_status", "state", "profileStatus", "data")
                  if isinstance(data.get(key), str) and data[key].strip()]
        return bool(states) and all(state in {"stopped", "closed", "inactive", "idle", "ready"} for state in states)

    def launch(self, profile_id):
        if not self.stopped(profile_id):
            raise ProfileUnavailable("Profile is active or its state is unknown")
        data = self.request("/automation/launch/puppeteer/" + profile_id, timeout=180)
        if not isinstance(data, dict) or data.get("status") not in {"ok", "success"}:
            raise ValueError("Profile launch was not confirmed")
        return data

    def stop(self, profile_id):
        data = self.request("/profile/stop/" + profile_id, timeout=30)
        if not isinstance(data, dict) or (data.get("status") not in {"ok", "success"} and data.get("success") is not True):
            raise ValueError("Profile stop was not confirmed")

    def post_form(self, path, fields, timeout=30):
        """Incogniton's profileData endpoints expect form fields whose value is a
        JSON *string*; the desktop sends exactly this shape, so the worker does
        too instead of guessing a second wire format."""
        request = Request("http://127.0.0.1:35000" + path, data=urlencode(fields).encode("utf-8"),
                          method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
        with self.opener.open(request, timeout=timeout) as response:
            content = response.read(2_000_001)
            if len(content) > 2_000_000:
                raise ValueError("Local API response too large")
            text = content.decode("utf-8", "replace")
        try:
            return json.loads(text), text
        except ValueError:
            return None, text

    @staticmethod
    def _confirmed(data, text):
        """The success shapes Incogniton actually returns, per the desktop adapter."""
        if isinstance(data, dict):
            status = str(data.get("status", "")).strip().lower()
            if status in {"ok", "success", "true"} or data.get("success") is True:
                return True
            return False
        lowered = (text or "").strip().lower()
        return "ok" in lowered or "success" in lowered

    def add_cookies(self, profile_id, cookies):
        """Write cookies into one profile: POST /profile/addCookie, base64json,
        the same payload the desktop's working importer sends. Attempted once."""
        body = {
            "profile_browser_id": str(profile_id),
            "format": "base64json",
            "cookie": base64.b64encode(json.dumps(cookies).encode("utf-8")).decode("ascii"),
        }
        data = self.request("/profile/addCookie", timeout=60, body=body)
        if isinstance(data, dict):
            text = json.dumps(data)
            if not self._confirmed(data, text):
                raise ValueError("Incogniton rejected the cookies: "
                                 + str(data.get("message") or data.get("error") or data)[:300])
        elif not isinstance(data, str) or "ok" not in data.lower():
            raise ValueError("Incogniton rejected the cookies")
        return len(cookies)

    def delete_cookies(self, profile_id):
        """Clear a profile's cookies before a replace-import. Failure is ignored:
        the desktop ignores it the same way, because a profile with no cookies
        yet has nothing to delete."""
        try:
            self.request("/profile/deleteCookie/" + profile_id, timeout=30)
        except (OSError, ValueError):
            pass

    def set_proxy(self, profile_id, proxy):
        """Set one profile's proxy. The payload mirrors the desktop updater:
        form-encoded, profileData a JSON string of primitive fields only.
        Attempted once per known-good wire format."""
        clean = {
            "connection_type": str(proxy["type"]).upper(),
            "proxy_url": f"{proxy['host']}:{proxy['port']}",
            "proxy_username": str(proxy.get("username") or ""),
            "proxy_password": str(proxy.get("password") or ""),
        }
        variants = [
            {"profileData": json.dumps({"profile_browser_id": profile_id, "Proxy": clean})},
            {"profileData": json.dumps({"profile_browser_id": profile_id, "proxy": clean})},
            {"profile_browser_id": profile_id,
             "profileData": json.dumps({"profile_browser_id": profile_id, "Proxy": clean})},
        ]
        last_error = "Local API did not confirm the proxy update"
        for fields in variants:
            data, text = self.post_form("/profile/update", fields, timeout=30)
            if self._confirmed(data, text):
                return f"{proxy['host']}:{proxy['port']}"
            if isinstance(data, dict):
                last_error = str(data.get("message") or data.get("error") or data)[:300]
        raise ValueError("Incogniton rejected the proxy: " + last_error)


def debug_endpoint(data):
    if not isinstance(data, dict):
        raise ValueError("Missing debugging endpoint")
    for key in ("puppeteerUrl", "webSocketDebuggerUrl", "url", "wsUrl", "debuggerUrl", "ws_endpoint"):
        value = data.get(key)
        if not isinstance(value, str) or not value:
            continue
        url = urlsplit(value)
        if (url.scheme not in {"http", "ws"} or url.hostname not in {"127.0.0.1", "localhost", "::1"}
                or url.username or url.password or not url.port):
            raise ValueError("Debugging endpoint must use loopback without credentials")
        return value
    if isinstance(data.get("data"), dict):
        return debug_endpoint(data["data"])
    port = data.get("port")
    if isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535:
        return f"http://127.0.0.1:{port}"
    raise ValueError("Missing debugging endpoint")
