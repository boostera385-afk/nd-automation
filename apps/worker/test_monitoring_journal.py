import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from monitoring_journal import MonitoringJournal
from test_agent import CONFIG, JOB, VALUE
from worker_protocol import completion_payload


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "journal.json"
        self.journal = MonitoringJournal(self.path, CONFIG)
        self.payload = completion_payload(VALUE, "b" * 64)

    def test_journal_never_stores_credentials_and_clears_payload_after_receipt(self):
        self.journal.begin(JOB)
        self.journal.record_result(self.payload)
        self.journal.cleanup_complete()
        self.assertNotIn(CONFIG["worker_token"], self.path.read_text())
        self.assertNotIn(CONFIG["publishable_key"], self.path.read_text())
        self.journal.acknowledge()
        self.assertIsNone(self.journal.read()["result"])
        self.assertFalse(self.journal.read()["cleanup_required"])

    def test_changed_project_or_worker_credential_cannot_inherit_pending_state(self):
        self.journal.begin(JOB)
        for connection in [{**CONFIG, "worker_token": "c" * 64}, {**CONFIG, "supabase_url": "https://other.supabase.co"}]:
            with self.assertRaises(ValueError):
                MonitoringJournal(self.path, connection).read()

    def test_replace_failure_preserves_previous_checkpoint(self):
        self.journal.begin(JOB)
        before = self.path.read_bytes()
        with patch("monitoring_journal.os.replace", side_effect=OSError("fixture")):
            with self.assertRaises(OSError):
                self.journal.record_result(self.payload)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob(".monitoring-*")), [])

    def test_unresolved_journal_cannot_be_overwritten_or_acknowledged(self):
        self.journal.begin(JOB)
        with self.assertRaises(ValueError):
            self.journal.begin(JOB)
        with self.assertRaises(ValueError):
            self.journal.acknowledge()
        with self.assertRaises(ValueError):
            self.journal.confirm_cleanup(JOB["job_id"])

    def test_corrupt_or_oversized_journal_fails_closed_without_modifying_it(self):
        for content in ["invalid json", "x" * 1_000_001, json.dumps({"version": 1})]:
            self.path.write_text(content)
            with self.assertRaises((ValueError, json.JSONDecodeError)):
                self.journal.read()
            self.assertEqual(self.path.read_text(), content)

    def test_extra_result_fields_and_duplicate_observations_are_rejected(self):
        self.journal.begin(JOB)
        with self.assertRaises(ValueError):
            self.journal.record_result({**self.payload, "script": "not allowed"})
        self.journal.record_result(self.payload)
        with self.assertRaises(ValueError):
            self.journal.record_result(self.payload)

    def test_acknowledged_clean_state_allows_a_new_checkpoint(self):
        self.journal.begin(JOB)
        self.journal.record_result(self.payload)
        self.journal.cleanup_complete()
        self.journal.acknowledge()
        self.journal.begin(JOB)
        self.assertEqual(self.journal.read()["state"], "claimed")

    def test_missing_result_requires_explicit_exact_operator_attestation(self):
        self.journal.begin(JOB)
        for job_id, confirmed in [(JOB["job_id"], False), ("66666666-6666-4666-8666-666666666666", True)]:
            with self.assertRaises(ValueError):
                self.journal.confirm_reconciled(job_id, confirmed)
        self.journal.confirm_reconciled(JOB["job_id"], True)
        self.assertEqual(self.journal.read()["state"], "operator_reconciled")
        self.assertIsNone(self.journal.read()["result"])
        self.journal.begin(JOB)

    def test_operator_reconciliation_cannot_discard_a_saved_observation(self):
        self.journal.begin(JOB)
        self.journal.record_result(self.payload)
        with self.assertRaises(ValueError):
            self.journal.confirm_reconciled(JOB["job_id"], True)
        self.assertEqual(self.journal.read()["result"], self.payload)

    def test_clean_terminal_metadata_does_not_block_explicit_new_worker_configuration(self):
        self.journal.begin(JOB)
        self.journal.confirm_reconciled(JOB["job_id"], True)
        replacement = MonitoringJournal(self.path, {**CONFIG, "worker_token": "d" * 64})
        self.assertIsNone(replacement.read())
        replacement.begin(JOB)
        self.assertEqual(replacement.read()["state"], "claimed")


if __name__ == "__main__":
    unittest.main()
