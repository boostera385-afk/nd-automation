"""Narrow local Incogniton adapter. Never force-stops or retries a launch."""

import json
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Local API redirects are not allowed")


class ProfileUnavailable(ValueError):
    """Preflight refused to launch; no launch request was sent."""


class Incogniton:
    def __init__(self):
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, path, timeout=10):
        with self.opener.open("http://127.0.0.1:35000" + path, timeout=timeout) as response:
            data = response.read(2_000_001)
            if len(data) > 2_000_000:
                raise ValueError("Local API response too large")
            return json.loads(data)

    def stopped(self, profile_id):
        data = self.request("/profile/status/" + profile_id)
        if not isinstance(data, dict):
            return False
        states = [data[key].strip().lower() for key in ("profile_status", "state", "profileStatus", "data")
                  if isinstance(data.get(key), str) and data[key].strip()]
        return bool(states) and all(state in {"stopped", "closed", "inactive", "idle"} for state in states)

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
