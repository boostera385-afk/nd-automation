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


class FakeProfileApi(Incogniton):
    """Replies to /profile/all with a canned body. No network."""

    def __init__(self, reply):
        super().__init__()
        self.reply = reply
        self.calls = []

    def request(self, path, timeout=10, body=None):
        self.calls.append(path)
        if path == "/profile/all":
            return self.reply
        raise AssertionError("Unexpected endpoint " + path)


UUID_A = "44444444-4444-4444-8444-444444444444"
UUID_B = "55555555-5555-4555-8555-555555555555"


class ListProfilesTests(unittest.TestCase):
    def test_desktop_build_shape_with_nested_information(self):
        body = {"status": "done", "profileData": [
            {"general_profile_information": {"browser_id": UUID_A.upper(),
                                             "profile_name": "  Plumber   Pat ",
                                             "profile_group": "Team A"},
             "cookie_description": "must be dropped", "account": "must be dropped"},
        ]}
        found = FakeProfileApi(body).list_profiles()
        self.assertEqual(found, [{"profile_id": UUID_A, "name": "Plumber Pat",
                                 "group_name": "Team A"}])
        found_json = str(found)
        self.assertNotIn("cookie", found_json.lower())
        self.assertNotIn("must be dropped", found_json)

    def test_flat_profiles_shape_is_also_accepted(self):
        body = {"profiles": [{"profile_browser_id": UUID_A, "profile_name": "Fixture", "group": "G1"}]}
        self.assertEqual(FakeProfileApi(body).list_profiles(),
                         [{"profile_id": UUID_A, "name": "Fixture", "group_name": "G1"}])

    def test_a_json_string_list_is_decoded(self):
        body = {"profileData": '[{"general_profile_information": {"browser_id": "' + UUID_B
                               + '", "profile_name": "Slow   Drain", "profile_group": ""}}]'}
        self.assertEqual(FakeProfileApi(body).list_profiles(),
                         [{"profile_id": UUID_B, "name": "Slow Drain", "group_name": "Unassigned"}])

    def test_entries_without_a_uuid_or_name_are_skipped_not_guessed(self):
        body = {"profiles": [
            {"profile_browser_id": "not-a-uuid", "profile_name": "Bad id"},
            {"profile_browser_id": UUID_A},
            {"profile_browser_id": UUID_B, "profile_name": "Real"},
            {"profile_browser_id": UUID_B, "profile_name": "Duplicate"},
            "not-a-dict",
        ]}
        found = FakeProfileApi(body).list_profiles()
        self.assertEqual(found, [{"profile_id": UUID_B, "name": "Real", "group_name": "Unassigned"}])

    def test_unusable_shapes_are_refused(self):
        for body in ({"unexpected": []}, {"profileData": "not json"}, {"profileData": {"nested": True}}, "list"):
            with self.assertRaises(ValueError):
                FakeProfileApi(body).list_profiles()


if __name__ == "__main__":
    unittest.main()
