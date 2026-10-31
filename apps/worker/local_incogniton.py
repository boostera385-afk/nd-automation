"""Narrow local Incogniton adapter. Never force-stops or retries a launch."""

import json
import re
from urllib.parse import urlsplit
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
