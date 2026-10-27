import unittest
from unittest.mock import Mock, patch

from agent import BridgeError, WorkerBridge, poll_once, validate_claim, validate_connection
from test_monitoring import ADAPTER, POST


CONFIG = {"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "sb_publishable_fixture", "worker_token": "a" * 64}
JOB = {**POST, "job_id": "44444444-4444-4444-8444-444444444444", "lease_token": "55555555-5555-4555-8555-555555555555", "lease_expires_at": "2026-10-27T00:00:00Z"}


class AgentTests(unittest.TestCase):
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
        bridge.rpc.side_effect = [{"enabled": True}, None]
        self.assertEqual(poll_once(bridge, ADAPTER, api, chromium), "idle")
        self.assertEqual(api.mock_calls, [])
        self.assertEqual(chromium.mock_calls, [])

    @patch("agent.run_batch")
    def test_submits_the_single_observation_without_repeating_browser_work(self, run):
        value = {"outcome": "alive", "reason": "fixture", "comments": []}
        run.side_effect = lambda posts, adapter, api, chromium, emit, deadline: emit(value)
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, JOB]
        self.assertEqual(poll_once(bridge, ADAPTER, Mock(), Mock()), "completed")
        bridge.complete.assert_called_once()
        run.assert_called_once()

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
        def fail(posts, adapter, api, chromium, emit, deadline):
            emit({"outcome": "profile_error", "reason": "fixture", "comments": []})
            raise RuntimeError("unknown launch state")
        run.side_effect = fail
        bridge = Mock()
        bridge.rpc.side_effect = [{"enabled": True}, JOB]
        with self.assertRaises(BridgeError):
            poll_once(bridge, ADAPTER, Mock(), Mock())
        bridge.complete.assert_called_once()


if __name__ == "__main__":
    unittest.main()
