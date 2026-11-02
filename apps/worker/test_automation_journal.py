"""Crash/replay tests exercise durable boundaries, never real browser actions."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from automation_journal import AutomationJournal, TASK_FAILURE, recover_automation
from agent import poll_automation
from test_automation_tasks import task

CONFIG = {"supabase_url": "https://example.supabase.co", "worker_token": "a" * 64}


class AutomationJournalTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "journal.json"
        self.journal = AutomationJournal(self.path, CONFIG)
        self.task = task("profile_create", {"name": "Fixture", "os": "windows"})
        self.bridge = Mock()
        self.bridge.complete_task.return_value = True
        self.bridge.rpc.return_value = self.task

    def test_checkpoint_failure_prevents_the_action(self):
        with patch.object(self.journal, "write", side_effect=OSError("disk")), patch("agent.execute_task") as execute:
            with self.assertRaises(OSError):
                poll_automation(self.bridge, Mock(), self.journal)
            execute.assert_not_called()

    def test_interruption_leaves_claim_and_never_replays_action(self):
        with patch("agent.execute_task", side_effect=KeyboardInterrupt) as execute:
            with self.assertRaises(KeyboardInterrupt):
                poll_automation(self.bridge, Mock(), self.journal)
            with self.assertRaisesRegex(ValueError, "unresolved"):
                poll_automation(self.bridge, Mock(), self.journal)
            execute.assert_called_once()
        self.assertEqual(self.journal.read()["state"], "claimed")

    def test_lost_ack_replays_only_identical_result_then_discards_private_payload(self):
        self.bridge.complete_task.side_effect = [RuntimeError("lost"), False]
        result = {"profile_id": "11111111-1111-4111-8111-111111111111", "name": "Fixture", "os": "windows"}
        with patch("agent.execute_task", return_value=result) as execute:
            with self.assertRaises(RuntimeError):
                poll_automation(self.bridge, Mock(), self.journal)
            self.assertEqual(self.journal.read()["state"], "result_ready")
            self.assertEqual(recover_automation(self.bridge, self.journal), "acknowledged")
            execute.assert_called_once()
        self.assertEqual(self.bridge.complete_task.call_args_list[0], self.bridge.complete_task.call_args_list[1])
        self.assertIsNone(self.journal.read()["task"])
        self.assertIsNone(self.journal.read()["completion"])

    def test_malformed_ack_keeps_result_for_reconciliation(self):
        self.journal.begin(self.task); self.journal.record("succeeded", {"profile_id": "fixture"})
        self.bridge.complete_task.return_value = {"success": True}
        with self.assertRaisesRegex(ValueError, "unconfirmed"):
            recover_automation(self.bridge, self.journal)
        self.assertEqual(self.journal.read()["state"], "result_ready")

    def test_uncertain_mutation_is_acknowledged_but_blocks_all_new_work_until_inspected(self):
        with patch("agent.execute_task", side_effect=ValueError("PRIVATE_SECRET")):
            with self.assertRaisesRegex(ValueError, "inspection"):
                poll_automation(self.bridge, Mock(), self.journal)
        self.assertNotIn("PRIVATE_SECRET", self.path.read_text())
        self.assertEqual(self.bridge.complete_task.call_args.args[3], TASK_FAILURE)
        with self.assertRaises(ValueError):
            self.journal.attest_inspected("wrong-task")
        self.journal.attest_inspected(self.task["task_id"])
        self.assertEqual(recover_automation(self.bridge, self.journal), "acknowledged")

    def test_exact_claim_reconciliation_requires_explicit_attestation(self):
        self.journal.begin(self.task)
        with self.assertRaises(ValueError):
            self.journal.reconcile_claim(self.task["task_id"])
        self.journal.reconcile_claim(self.task["task_id"], confirmed=True)
        self.assertEqual(recover_automation(self.bridge, self.journal), "operator_reconciled")
        self.bridge.complete_task.assert_not_called()

    def test_changed_credentials_cannot_inherit_unresolved_action(self):
        self.journal.begin(self.task)
        other = AutomationJournal(self.path, {**CONFIG, "worker_token": "b" * 64})
        with self.assertRaisesRegex(ValueError, "another worker"):
            other.read()

    def test_duplicate_json_and_oversized_checkpoint_are_refused(self):
        self.path.write_text('{"state":"claimed","state":"acknowledged"}')
        with self.assertRaises(ValueError):
            self.journal.read()
        self.path.write_text(" " * 100001)
        with self.assertRaises(ValueError):
            self.journal.read()

    def test_failed_atomic_replace_preserves_original_checkpoint(self):
        self.journal.begin(self.task); before = self.path.read_bytes()
        with patch("automation_journal.os.replace", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                self.journal.record("succeeded", {})
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])


if __name__ == "__main__":
    unittest.main()
