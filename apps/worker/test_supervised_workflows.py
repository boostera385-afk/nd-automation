from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from automation_journal import AutomationJournal
from supervised_workflows import BASE_SELECTORS, EDIT_SELECTORS, POST_SELECTORS, body_hash, execute_workflow, validate_manifest, validate_plan

PROFILE = "33333333-3333-4333-8333-333333333333"
ACCOUNT = "https://nextdoor.com/profile/authorized-fixture"
POST = "https://nextdoor.com/p/owned-fixture"
CONFIG = {"supabase_url": "https://example.supabase.co", "worker_token": "a" * 64}


def plan(operation="account_inspect"):
    manifest = {"version": 1, "operation": operation, "binding_id": "11111111-1111-4111-8111-111111111111", "profile_id": PROFILE,
        "customer_id": "22222222-2222-4222-8222-222222222222", "account_label": "Authorized Person", "account_url": ACCOUNT,
        "target_url": None, "expected_body_sha256": None, "draft_id": None, "draft_revision": None, "consent": True}
    keys = set(BASE_SELECTORS); values = {}
    if operation in {"account_register", "account_login"}:
        keys |= {"form", "email", "password", "submit"}
        values = {"email": "person@example.invalid", "password": "fixture-only-not-a-real-password"}
        if operation == "account_register":
            keys |= {"first_name", "last_name"}; manifest["account_url"] = None
            values.update({"first_name": "Authorized", "last_name": "Person", "genuine_identity_confirmed": True})
    if operation in {"post_edit", "post_delete"}:
        keys |= POST_SELECTORS; manifest["target_url"] = POST; manifest["expected_body_sha256"] = body_hash("Original fixture body")
    if operation == "post_edit":
        keys |= EDIT_SELECTORS; manifest["draft_id"] = "44444444-4444-4444-8444-444444444444"; manifest["draft_revision"] = 2
    if operation in {"post_delete", "account_block"}:
        keys |= {"action_open", "dialog", "dialog_target", "confirm", "result", "result_target"}
    if operation == "account_block":
        manifest["target_url"] = "https://nextdoor.com/profile/explicit-moderation-target"
    return {"manifest": manifest, "reviewed": True, "selectors": {key: "#" + key for key in keys}, "values": values}


def task(spec):
    content = {"kind": "post", "title": "Approved edit", "body": "Approved replacement body", "audience": "neighborhood", "price_cents": None, "category": None} if spec["manifest"]["operation"] == "post_edit" else None
    return {"task_id": "55555555-5555-4555-8555-555555555555", "kind": "supervised_workflow", "payload": {"manifest": deepcopy(spec["manifest"]), "content": content},
        "lease_token": "66666666-6666-4666-8666-666666666666", "lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()}


class WorkflowProtocolTests(unittest.TestCase):
    def test_known_operations_require_their_exact_local_adapters(self):
        for operation in ("account_register", "account_login", "account_inspect", "profile_browse", "post_edit", "post_delete", "account_block"):
            self.assertEqual(validate_plan(plan(operation))["manifest"]["operation"], operation)

    def test_no_remote_secrets_paths_code_or_unknown_operations(self):
        for extra in ({"password": "PRIVATE"}, {"code": "arbitrary"}, {"operation": "mass_block"}, {"consent": False}):
            with self.assertRaises(ValueError):
                validate_manifest({**plan()["manifest"], **extra})

    def test_registration_requires_genuine_identity_no_defaults_or_optional_consent(self):
        for field in ("first_name", "last_name", "genuine_identity_confirmed"):
            spec = plan("account_register"); del spec["values"][field]
            with self.assertRaises(ValueError):
                validate_plan(spec)
        spec = plan("account_register"); spec["values"]["genuine_identity_confirmed"] = False
        with self.assertRaises(ValueError):
            validate_plan(spec)

    def test_rejects_missing_review_and_unbounded_or_extra_selectors(self):
        spec = plan(); spec["reviewed"] = False
        with self.assertRaises(ValueError):
            validate_plan(spec)
        spec = plan(); spec["selectors"]["remote_code"] = "evil"
        with self.assertRaises(ValueError):
            validate_plan(spec)

    def test_exact_local_plan_must_match_the_queued_manifest_before_profile_launch(self):
        spec = plan(); job = task(spec); job["payload"]["manifest"]["account_label"] = "Different"
        api, journal = Mock(), Mock()
        with self.assertRaisesRegex(ValueError, "differs"):
            execute_workflow(job, spec, api, Mock(), journal)
        api.launch.assert_not_called(); journal.begin.assert_not_called()

    def test_storage_failure_prevents_launch(self):
        spec = plan(); api, journal = Mock(), Mock(); journal.begin.side_effect = OSError("disk")
        with self.assertRaises(OSError):
            execute_workflow(task(spec), spec, api, Mock(), journal)
        api.launch.assert_not_called()

    def test_ambiguous_launch_leaves_an_inspection_required_receipt(self):
        with TemporaryDirectory() as temporary:
            journal = AutomationJournal(Path(temporary) / "journal.json", CONFIG)
            spec = plan(); api = Mock(); api.launch.side_effect = RuntimeError("PRIVATE")
            execute_workflow(task(spec), spec, api, Mock(), journal)
            saved = journal.read()
            self.assertEqual(saved["completion"]["result"]["outcome"], "validation_error")
            self.assertTrue(saved["inspection_required"])
            self.assertNotIn("PRIVATE", json_text := journal.path.read_text())
            self.assertNotIn("password", json_text)
            api.stop.assert_not_called()

    def test_interrupt_never_records_success_or_replays_action(self):
        with TemporaryDirectory() as temporary:
            journal = AutomationJournal(Path(temporary) / "journal.json", CONFIG)
            spec = plan(); api = Mock(); api.launch.side_effect = KeyboardInterrupt()
            with self.assertRaises(KeyboardInterrupt):
                execute_workflow(task(spec), spec, api, Mock(), journal)
            self.assertEqual(journal.read()["state"], "claimed")


if __name__ == "__main__":
    unittest.main()
