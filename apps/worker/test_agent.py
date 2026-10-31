import unittest
from datetime import datetime, timedelta, timezone
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from agent import BridgeError, WorkerBridge, main, poll_once, recover_result, validate_claim, validate_connection
from monitoring_journal import MonitoringJournal
from test_monitoring import ADAPTER, POST


CONFIG = {"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "sb_publishable_fixture", "worker_token": "a" * 64}
JOB = {**POST, "job_id": "44444444-4444-4444-8444-444444444444", "lease_token": "55555555-5555-4555-8555-555555555555", "lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()}
VALUE = {"outcome": "alive", "reason": "fixture", "comments": [], "observed_at": datetime.now(timezone.utc).isoformat()}


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.journal = MonitoringJournal(Path(self.directory.name) / "journal.json", CONFIG)

    def test_valid_connection(self):
        self.assertEqual(validate_connection(CONFIG), CONFIG)

    def test_rejects_secret_keys_and_arbitrary_api_origins(self):
        for value in ({**CONFIG, "publishable_key": "sb_secret_unsafe"},
                      {**CONFIG, "supabase_url": "https://example.supabase.co.attacker.test"},
                      {**CONFIG, "supabase_url": "http://example.supabase.co"},
                      {**CONFIG, "worker_token": "short"}):
            with self.assertRaises(ValueError):
                validate_connection(value)

    def test_validates_remote_job_before_browser_operations(self):
        self.assertEqual(validate_claim(JOB), POST)
        with self.assertRaises(ValueError):
            validate_claim({**JOB, "url": "https://127.0.0.1/p/private"})
        with self.assertRaises(ValueError):
            validate_claim({**JOB, "script": "arbitrary code"})

    def test_idle_agent_does_not_touch_local_profiles(self):
        bridge, api, chromium = Mock(), Mock(), Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, None]
        self.assertEqual(poll_once(bridge, ADAPTER, api, chromium, self.journal), "idle")
        self.assertEqual(api.mock_calls, [])
        self.assertEqual(chromium.mock_calls, [])

    @patch("agent.run_batch")
    def test_submits_the_single_observation_without_repeating_browser_work(self, run):
        value = VALUE
        run.side_effect = lambda posts, adapter, api, chromium, emit, deadline, **options: emit(value)
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
        bridge.submit_result.return_value = True
        self.assertEqual(poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal), "completed")
        bridge.submit_result.assert_called_once()
        self.assertEqual(self.journal.read()["state"], "acknowledged")
        self.assertIsNone(self.journal.read()["result"])
        run.assert_called_once()

    @patch("agent.run_batch")
    def test_comment_expansion_is_forwarded_only_when_requested(self, run):
        run.side_effect = lambda posts, adapter, api, chromium, emit, deadline, **options: emit(VALUE)
        for requested in (False, True):
            with self.subTest(requested=requested):
                bridge = Mock()
                bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
                bridge.submit_result.return_value = True
                poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal, requested)
                self.assertIs(run.call_args.kwargs.get("allow_expansion"), requested)

    @patch("agent.time.sleep")
    def test_completion_retry_does_not_execute_browser_actions(self, _sleep):
        bridge = WorkerBridge(CONFIG)
        bridge.rpc = Mock(side_effect=[BridgeError("temporary"), True])
        self.assertTrue(bridge.complete(JOB, {"outcome": "needs_review", "reason": "fixture", "comments": [], "observed_at": "2026-10-27T00:00:00Z"}, "b" * 64))
        self.assertEqual(bridge.rpc.call_count, 2)
        self.assertEqual(bridge.rpc.call_args_list[0], bridge.rpc.call_args_list[1])

    def test_rpc_method_is_allowlisted(self):
        bridge = WorkerBridge(CONFIG, Mock())
        with self.assertRaises(BridgeError):
            bridge.rpc("arbitrary_function")

    @patch("agent.run_batch")
    def test_ambiguous_browser_failure_stops_agent_after_submitting_recorded_failure(self, run):
        def fail(posts, adapter, api, chromium, emit, deadline, **options):
            emit({**VALUE, "outcome": "profile_error"})
            raise RuntimeError("unknown launch state")
        run.side_effect = fail
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
        bridge.submit_result.return_value = True
        with self.assertRaises(BridgeError):
            poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal)
        bridge.submit_result.assert_called_once()
        self.assertTrue(self.journal.read()["cleanup_required"])

    def test_invalid_expired_short_and_unbounded_leases_do_not_run_a_browser(self):
        for expiry in ["not-a-timestamp", "2020-01-01T00:00:00Z", "2026-10-30T00:00:00", 123,
                       (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat(),
                       (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()]:
            with self.subTest(expiry=expiry), patch("agent.run_batch") as run:
                bridge, api, chromium = Mock(), Mock(), Mock()
                bridge.rpc.side_effect = [{"enabled": True}, None, {**JOB, "lease_expires_at": expiry}]
                with self.assertRaises(ValueError):
                    poll_once(bridge, ADAPTER, api, chromium, self.journal)
                run.assert_not_called()
                self.assertEqual(api.mock_calls, [])
                self.assertEqual(chromium.mock_calls, [])
                self.assertIsNone(self.journal.read())

    @patch("agent.time.sleep")
    def test_completion_requires_exact_boolean_and_preserves_idempotent_false(self, _sleep):
        for reply in [{"unexpected": True}, None, 1, 0, "true", []]:
            with self.subTest(reply=reply):
                bridge = WorkerBridge(CONFIG)
                bridge.rpc = Mock(return_value=reply)
                with self.assertRaises(BridgeError):
                    bridge.complete(JOB, VALUE, "b" * 64)
                self.assertEqual(bridge.rpc.call_count, 3)
        bridge = WorkerBridge(CONFIG)
        bridge.rpc = Mock(return_value=False)
        self.assertIs(bridge.complete(JOB, VALUE, "b" * 64), False)
        bridge.rpc.assert_called_once()

    @patch("agent.run_batch")
    def test_lost_ack_response_recovers_only_saved_result_without_rerunning_or_claiming(self, run):
        run.side_effect = lambda posts, adapter, api, chromium, emit, deadline, **options: emit(VALUE)
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
        bridge.submit_result.side_effect = BridgeError("offline")
        with self.assertRaises(BridgeError):
            poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal)
        self.assertEqual(self.journal.read()["state"], "result_ready")
        saved_call = bridge.submit_result.call_args
        restarted = MonitoringJournal(self.journal.path, CONFIG)
        bridge.reset_mock()
        bridge.submit_result.side_effect = None
        bridge.submit_result.return_value = False
        self.assertEqual(recover_result(bridge, restarted), "recovered")
        self.assertEqual(bridge.submit_result.call_args, saved_call)
        bridge.rpc.assert_not_called()
        run.assert_called_once()

    @patch("agent.run_batch")
    def test_storage_failure_before_launch_blocks_all_browser_work(self, run):
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
        with patch.object(self.journal, "_write", side_effect=OSError("private storage failure")):
            with self.assertRaises(OSError):
                poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal)
        run.assert_not_called()

    @patch("agent.run_batch")
    def test_crash_after_claim_never_replays_browser_action(self, run):
        self.journal.begin(JOB)
        bridge = Mock()
        with self.assertRaises(BridgeError):
            poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal)
        run.assert_not_called()
        bridge.rpc.assert_not_called()

    @patch("agent.run_batch")
    def test_cleanup_ambiguity_blocks_restart_until_exact_operator_confirmation(self, run):
        def fail(posts, adapter, api, chromium, emit, deadline, **options):
            emit(VALUE)
            raise RuntimeError("cleanup uncertain")
        run.side_effect = fail
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
        bridge.submit_result.return_value = True
        with self.assertRaises(BridgeError):
            poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal)
        with self.assertRaises(BridgeError):
            recover_result(bridge, self.journal)
        with self.assertRaises(ValueError):
            self.journal.confirm_cleanup("66666666-6666-4666-8666-666666666666")
        self.journal.confirm_cleanup(JOB["job_id"])
        self.assertEqual(recover_result(bridge, self.journal), "settled")

    @patch("agent.run_batch")
    def test_malformed_completion_keeps_saved_result_for_reconciliation(self, run):
        run.side_effect = lambda posts, adapter, api, chromium, emit, deadline, **options: emit(VALUE)
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, None, JOB]
        bridge.submit_result.return_value = {"unexpected": True}
        with self.assertRaises(ValueError):
            poll_once(bridge, ADAPTER, Mock(), Mock(), self.journal)
        self.assertEqual(self.journal.read()["state"], "result_ready")

    def test_recovery_cli_needs_no_adapter_or_browser_runtime(self):
        from worker_protocol import completion_payload
        self.journal.begin(JOB)
        self.journal.record_result(completion_payload(VALUE, "b" * 64))
        self.journal.cleanup_complete()
        bridge = Mock()
        bridge.submit_result.return_value = False
        with patch("sys.argv", ["agent.py", "--connection", "fixture.json", "--recover-results", "--confirm-authorized"]), \
                patch("agent.load_json", return_value=CONFIG) as load, \
                patch("agent.MonitoringJournal", return_value=self.journal), \
                patch("agent.WorkerBridge", return_value=bridge), \
                patch("agent.monitoring_lock", return_value=nullcontext()), \
                patch("preflight.require_runtime") as runtime, patch("builtins.print"):
            self.assertEqual(main(), 0)
            runtime.assert_not_called()
            load.assert_called_once_with("fixture.json")
            bridge.rpc.assert_not_called()
        self.assertEqual(self.journal.read()["state"], "acknowledged")

    def test_recovery_without_authorization_never_sends_saved_result(self):
        with patch("sys.argv", ["agent.py", "--connection", "fixture.json", "--recover-results"]), \
                patch("agent.load_json", return_value=CONFIG), patch("agent.WorkerBridge") as bridge, \
                patch("sys.stderr"):
            with self.assertRaises(SystemExit):
                main()
            bridge.assert_not_called()

    def test_operator_reconciliation_cli_never_claims_or_verifies_server_state(self):
        self.journal.begin(JOB)
        with patch("sys.argv", ["agent.py", "--connection", "fixture.json", "--confirm-lease-reconciled", JOB["job_id"],
                                 "--acknowledge-observation-loss", "--confirm-authorized"]), \
                patch("agent.load_json", return_value=CONFIG), patch("agent.MonitoringJournal", return_value=self.journal), \
                patch("agent.WorkerBridge") as bridge, patch("agent.run_batch") as run, \
                patch("agent.monitoring_lock", return_value=nullcontext()), patch("builtins.print") as output:
            self.assertEqual(main(), 0)
            self.assertIn('"server_state_verified": false', output.call_args.args[0])
            self.assertIn('"observation_recovered": false', output.call_args.args[0])
            bridge.assert_not_called()
            run.assert_not_called()
        self.assertEqual(self.journal.read()["state"], "operator_reconciled")

    def test_operator_reconciliation_without_loss_acknowledgment_preserves_claim(self):
        self.journal.begin(JOB)
        with patch("sys.argv", ["agent.py", "--connection", "fixture.json", "--confirm-lease-reconciled", JOB["job_id"], "--confirm-authorized"]), \
                patch("agent.load_json", return_value=CONFIG), patch("agent.MonitoringJournal", return_value=self.journal), \
                patch("agent.WorkerBridge") as bridge, patch("agent.monitoring_lock", return_value=nullcontext()):
            with self.assertRaises(ValueError):
                main()
            bridge.assert_not_called()
        self.assertEqual(self.journal.read()["state"], "claimed")

    @patch("agent.run_batch")
    def test_failed_checkpoint_ack_write_can_replay_without_repeating_browser(self, run):
        from worker_protocol import completion_payload
        self.journal.begin(JOB)
        self.journal.record_result(completion_payload(VALUE, "b" * 64))
        self.journal.cleanup_complete()
        bridge = Mock()
        bridge.submit_result.return_value = True
        with patch.object(self.journal, "acknowledge", side_effect=OSError("fixture")):
            with self.assertRaises(OSError):
                recover_result(bridge, self.journal)
        self.assertEqual(self.journal.read()["state"], "result_ready")
        bridge.submit_result.return_value = False
        self.assertEqual(recover_result(bridge, self.journal), "recovered")
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
