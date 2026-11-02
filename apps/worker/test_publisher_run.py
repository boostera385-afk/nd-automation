"""Bounded batch/watch fixtures: no browser, time delay, network or real post."""

import unittest
from unittest.mock import Mock

from publisher_run import run_due_jobs


class PublisherRunTests(unittest.TestCase):
    def setUp(self):
        self.bridge, self.journal = Mock(), Mock()
        self.prepare, self.execute, self.recover = Mock(), Mock(), Mock()
        self.bridge.rpc.return_value = {"job_id": "fixture-job"}
        self.journal.read.return_value = {"state": "result_ready", "job": {"job_id": "fixture-job"}, "result": {"outcome": "submitted"}}

    def run_jobs(self, **kwargs):
        return run_due_jobs(self.bridge, self.journal, self.prepare, self.execute, self.recover, **kwargs)

    def test_default_runs_exactly_one_job_then_settles_before_return(self):
        self.assertEqual(self.run_jobs(), {"state": "job_limit_reached", "completed": 1})
        self.execute.assert_called_once()
        self.recover.assert_called_once()

    def test_explicit_bulk_is_sequential_and_never_exceeds_its_limit(self):
        calls = []
        self.prepare.side_effect = lambda: calls.append("prepare")
        self.execute.side_effect = lambda _job: calls.append("execute")
        self.recover.side_effect = lambda: calls.append("recover")
        self.assertEqual(self.run_jobs(max_jobs=3)["completed"], 3)
        self.assertEqual(calls, ["prepare", "execute", "recover"] * 3)

    def test_idle_exits_without_any_implicit_watch_or_sleep(self):
        self.bridge.rpc.return_value = None
        sleep = Mock()
        self.assertEqual(self.run_jobs(sleep=sleep), {"state": "idle", "completed": 0})
        self.execute.assert_not_called()
        sleep.assert_not_called()

    def test_watch_polling_is_bounded_and_cannot_claim_after_deadline(self):
        self.bridge.rpc.return_value = None
        clock = [0]
        def sleep(seconds):
            self.assertLessEqual(seconds, 30)
            clock[0] += seconds
        self.assertEqual(self.run_jobs(watch_minutes=1, monotonic=lambda: clock[0], sleep=sleep), {"state": "watch_window_ended", "completed": 0})
        self.assertEqual(self.bridge.rpc.call_count, 2)

    def test_uncertain_or_non_submitted_outcome_stops_before_another_claim(self):
        for outcome in ("needs_reconciliation", "verification_required", "login_required", "validation_error"):
            with self.subTest(outcome=outcome):
                self.bridge.reset_mock()
                self.journal.read.return_value["result"]["outcome"] = outcome
                report = self.run_jobs(max_jobs=20)
                self.assertEqual(report["state"], "stopped_on_non_submission")
                self.assertEqual(report["completed"], 1)
                self.bridge.rpc.assert_called_once()

    def test_execution_exception_never_replays_the_job_or_continues_a_batch(self):
        self.execute.side_effect = RuntimeError("ambiguous")
        with self.assertRaises(RuntimeError):
            self.run_jobs(max_jobs=20)
        self.execute.assert_called_once()
        self.recover.assert_not_called()

    def test_unsettled_receipt_or_cleanup_prevents_the_next_claim(self):
        self.recover.side_effect = RuntimeError("unconfirmed")
        with self.assertRaises(RuntimeError):
            self.run_jobs(max_jobs=20)
        self.bridge.rpc.assert_called_once()

    def test_preexisting_checkpoint_blocks_before_claim(self):
        self.prepare.side_effect = RuntimeError("unresolved previous job")
        with self.assertRaises(RuntimeError):
            self.run_jobs()
        self.bridge.rpc.assert_not_called()

    def test_wrong_or_missing_journal_result_is_never_acknowledged(self):
        for value in (None, {"state": "submit_intent"}, {"state": "result_ready", "job": {"job_id": "different"}}):
            self.journal.read.return_value = value
            with self.assertRaises(ValueError):
                self.run_jobs()
        self.recover.assert_not_called()

    def test_invalid_unbounded_inputs_do_not_touch_the_bridge(self):
        for maximum, minutes in ((0, 0), (21, 0), (True, 0), (1, -1), (1, 481), (1, True)):
            with self.assertRaises(ValueError):
                self.run_jobs(max_jobs=maximum, watch_minutes=minutes)
        self.bridge.rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
