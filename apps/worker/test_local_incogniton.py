"""Offline tests for the local Incogniton adapter. No network, no browser."""

import unittest

from local_incogniton import Incogniton, ProfileUnavailable


class FakeApi(Incogniton):
    def __init__(self, status, launch=None, stop=None):
        super().__init__()
        self.status = status
        self.launch_reply = launch if launch is not None else {"status": "ok", "puppeteerUrl": "http://127.0.0.1:50166"}
        self.stop_reply = stop if stop is not None else {"status": "ok", "message": "Profile stopped"}
        self.calls = []

    def request(self, path, timeout=10):
        self.calls.append(path)
        if path.startswith("/profile/status/"):
            return self.status
        if path.startswith("/automation/launch/puppeteer/"):
            return self.launch_reply
        if path.startswith("/profile/stop/"):
            return self.stop_reply
        raise AssertionError("Unexpected endpoint")


class StoppedTests(unittest.TestCase):
    def test_incogniton5_ready_is_stopped(self):
        self.assertTrue(FakeApi({"status": "Ready"}).stopped("p"))

    def test_incogniton5_launched_is_not_stopped(self):
        self.assertFalse(FakeApi({"status": "Launched"}).stopped("p"))

    def test_lowercase_ready_is_stopped(self):
        self.assertTrue(FakeApi({"status": " ready "}).stopped("p"))

    def test_legacy_keys_still_supported(self):
        self.assertTrue(FakeApi({"profile_status": "stopped"}).stopped("p"))
        self.assertFalse(FakeApi({"state": "running"}).stopped("p"))

    def test_unknown_shape_is_not_stopped(self):
        self.assertFalse(FakeApi({"unexpected": "ok"}).stopped("p"))
        self.assertFalse(FakeApi("ready").stopped("p"))
        self.assertFalse(FakeApi({}).stopped("p"))


class LaunchTests(unittest.TestCase):
    def test_launch_refused_when_profile_is_running(self):
        api = FakeApi({"status": "Launched"})
        with self.assertRaises(ProfileUnavailable):
            api.launch("p")
        self.assertFalse(any("launch" in call for call in api.calls))

    def test_launch_returns_endpoint_when_ready(self):
        api = FakeApi({"status": "Ready"})
        self.assertEqual(api.launch("p")["puppeteerUrl"], "http://127.0.0.1:50166")

    def test_launch_without_confirmation_fails(self):
        api = FakeApi({"status": "Ready"}, launch={"status": "error"})
        with self.assertRaises(ValueError):
            api.launch("p")


class StopTests(unittest.TestCase):
    def test_stop_accepts_ok_status(self):
        FakeApi({"status": "Ready"}).stop("p")

    def test_stop_rejects_unconfirmed_reply(self):
        with self.assertRaises(ValueError):
            FakeApi({"status": "Launched"}, stop={"status": "error"}).stop("p")


if __name__ == "__main__":
    unittest.main()
