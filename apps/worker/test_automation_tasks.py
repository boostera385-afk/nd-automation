import json
import os
import tempfile
import unittest
from uuid import uuid4

import automation_tasks as tasks
from agent import poll_automation


TASK_ID = "11111111-1111-4111-8111-111111111111"
LEASE_ID = "22222222-2222-4222-8222-222222222222"


def task(kind, payload, **overrides):
    base = {"task_id": TASK_ID, "kind": kind, "payload": payload,
            "lease_token": LEASE_ID, "lease_expires_at": "2099-01-01T00:00:00Z"}
    base.update(overrides)
    return base


class FakeIncogniton:
    def __init__(self):
        self.created = []

    def create(self, name, operating_system="windows", group=""):
        self.created.append((name, operating_system, group))
        return "33333333-3333-4333-8333-333333333333"

    def inventory(self):
        return {"profiles": 7, "groups": 2, "launched": 1}


class FakeBridge:
    def __init__(self, claimed):
        self.claimed = claimed
        self.completions = []
        self.calls = []

    def rpc(self, method, params=None):
        self.calls.append(method)
        if method == "reporting_claim_automation_task":
            return self.claimed
        raise AssertionError("unexpected rpc " + method)

    def complete_task(self, task_value, status, result, error):
        self.completions.append((task_value["task_id"], status, result, error))
        return True


def write(text):
    handle = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
    handle.write(text)
    handle.close()
    return os.path.abspath(handle.name)


class TaskContractTests(unittest.TestCase):
    def test_accepts_a_well_formed_task(self):
        self.assertEqual(tasks.validate_task(task("preset_snapshot", {}))["kind"], "preset_snapshot")

    def test_refuses_types_the_dashboard_must_not_execute(self):
        for kind in ("publish_post", "publish_listing", "account_create", "cookie_write", ""):
            with self.assertRaises(tasks.TaskError):
                tasks.validate_task(task(kind, {}))

    def test_refuses_extra_keys_and_bad_identifiers(self):
        with self.assertRaises(tasks.TaskError):
            tasks.validate_task({**task("preset_snapshot", {}), "worker_token": "x"})
        with self.assertRaises(tasks.TaskError):
            tasks.validate_task(task("preset_snapshot", {}, lease_token="nope"))
        with self.assertRaises(tasks.TaskError):
            tasks.validate_task(task("preset_snapshot", {}, lease_expires_at="tomorrow"))

    def test_refuses_an_oversized_payload(self):
        with self.assertRaises(tasks.TaskError):
            tasks.validate_task(task("preset_snapshot", {"note": "x" * 9000}))


class ProfilePayloadTests(unittest.TestCase):
    def test_normalises_a_profile_request(self):
        self.assertEqual(tasks.profile_payload({"name": "  Fixture  ", "os": "mac"}),
                         {"name": "Fixture", "os": "mac", "group": ""})

    def test_refuses_short_names_control_characters_and_unknown_systems(self):
        for payload in ({"name": "a"}, {"name": "ok\x07"}, {"name": "ok", "os": "solaris"},
                        {"name": "ok", "password": "secret"}, {"name": "ok", "group": "x" * 61}):
            with self.assertRaises(tasks.TaskError):
                tasks.profile_payload(payload)


class LocalPathTests(unittest.TestCase):
    def test_accepts_absolute_paths_only(self):
        self.assertTrue(tasks.local_path({"path": "C:\\Exports\\cookies.txt"}).endswith("cookies.txt"))
        self.assertTrue(tasks.local_path({"path": "/home/operator/cookies.txt"}).startswith("/"))
        for value in ("cookies.txt", "./cookies.txt", "C:\\Exports\\..\\secret.txt", ""):
            with self.assertRaises(tasks.TaskError):
                tasks.local_path({"path": value})


class FileParsingTests(unittest.TestCase):
    def test_counts_cookies_without_returning_a_value(self):
        text = "\n".join([
            "# Netscape HTTP Cookie File",
            ".nextdoor.com\tTRUE\t/\tTRUE\t1999999999\tsession\tSECRET-VALUE",
            "#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1999999999\tsid\tSECRET-VALUE",
            "malformed line",
        ])
        parsed = tasks.parse_cookies(text)
        self.assertEqual(parsed["entries"], 2)
        self.assertEqual(parsed["with_credentials"], 2)
        self.assertEqual(parsed["domains"], 2)
        self.assertNotIn("SECRET-VALUE", json.dumps(parsed))

    def test_counts_proxies_without_returning_credentials(self):
        text = "\n".join(["1.2.3.4:8080", "5.6.7.8:3128:user:pass", "bad", "# note"])
        parsed = tasks.parse_proxies(text)
        self.assertEqual(parsed["entries"], 2)
        self.assertEqual(parsed["with_credentials"], 1)
        self.assertNotIn("user", json.dumps(parsed))
        self.assertNotIn("pass", json.dumps(parsed))

    def test_refuses_a_file_that_is_too_large(self):
        path = write("x" * (tasks.MAX_FILE_BYTES + 1))
        try:
            with self.assertRaises(tasks.TaskError):
                tasks.execute(task("cookie_import", {"path": path}), None)
        finally:
            os.unlink(path)


class ExecutionTests(unittest.TestCase):
    def test_profile_creation_returns_the_validated_id(self):
        fake = FakeIncogniton()
        result = tasks.execute(task("profile_create", {"name": "Fixture", "group": "Team A"}), fake)
        self.assertEqual(result, {"profile_id": "33333333-3333-4333-8333-333333333333",
                                  "name": "Fixture", "os": "windows"})
        self.assertEqual(fake.created, [("Fixture", "windows", "Team A")])

    def test_preset_snapshot_is_counts_only(self):
        self.assertEqual(tasks.execute(task("preset_snapshot", {}), FakeIncogniton()),
                         {"profiles": 7, "groups": 2, "launched": 1})

    def test_cookie_import_reads_a_local_file(self):
        path = write(".nextdoor.com\tTRUE\t/\tTRUE\t1999999999\ts\tv\n")
        try:
            result = tasks.execute(task("cookie_import", {"path": path}), None)
            self.assertEqual(result["entries"], 1)
            self.assertEqual(result["sample"], ["nextdoor.com"])
        finally:
            os.unlink(path)

    def test_proxy_import_reads_a_local_file(self):
        path = write("1.2.3.4:8080\n")
        try:
            self.assertEqual(tasks.execute(task("proxy_import", {"path": path}), None)["entries"], 1)
        finally:
            os.unlink(path)


class PollTests(unittest.TestCase):
    def test_idle_returns_none(self):
        bridge = FakeBridge(None)
        self.assertIsNone(poll_automation(bridge, FakeIncogniton()))
        self.assertEqual(bridge.calls, ["reporting_claim_automation_task"])

    def test_success_is_reported_without_repeating_the_action(self):
        bridge = FakeBridge(task("preset_snapshot", {}))
        fake = FakeIncogniton()
        self.assertEqual(poll_automation(bridge, fake), "automation_succeeded")
        self.assertEqual(bridge.completions, [(TASK_ID, "succeeded", {"profiles": 7, "groups": 2, "launched": 1}, None)])

    def test_failure_is_reported_with_a_bounded_reason(self):
        bridge = FakeBridge(task("profile_create", {"name": "Fixture"}))
        class Broken(FakeIncogniton):
            def create(self, name, operating_system="windows", group=""):
                raise ValueError("Incogniton is not running")
        self.assertEqual(poll_automation(bridge, Broken()), "automation_failed")
        self.assertEqual(bridge.completions, [(TASK_ID, "failed", None, "Incogniton is not running")])

    def test_a_malformed_task_is_refused_before_any_action(self):
        bridge = FakeBridge(task("publish_post", {}))
        with self.assertRaises(tasks.TaskError):
            poll_automation(bridge, FakeIncogniton())
        self.assertEqual(bridge.completions, [])


if __name__ == "__main__":
    unittest.main()
