from contextlib import nullcontext
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from agent import BridgeError, TaskOnlyBridge, main, run_tasks_only

CONNECTION = {"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "sb_publishable_fixture", "worker_token": "a" * 64}


class ProfileHelperTests(unittest.TestCase):
    def test_rpc_allowlist_excludes_monitoring_publishing_and_supervised_claims(self):
        bridge = TaskOnlyBridge(CONNECTION)
        for method in ("reporting_claim_check", "reporting_complete_check", "reporting_claim_publish", "reporting_claim_supervised_workflow"):
            with self.assertRaises(BridgeError): bridge.rpc(method)

    def test_offline_mode_needs_no_dom_adapter_network_or_playwright(self):
        with patch("sys.argv", ["agent.py", "--connection", "local.json", "--tasks-only"]), patch("agent.load_json", return_value=CONNECTION), patch("agent.TaskOnlyBridge") as bridge:
            self.assertEqual(main(), 0)
            bridge.assert_not_called()

    def test_execution_requires_explicit_authorization(self):
        with patch("sys.argv", ["agent.py", "--connection", "local.json", "--tasks-only", "--execute"]), patch("agent.load_json", return_value=CONNECTION), patch("agent.run_tasks_only") as run:
            with self.assertRaises(SystemExit): main()
            run.assert_not_called()

    def test_one_poll_never_claims_monitoring_and_uses_shared_recovery_lock(self):
        with patch("agent.TaskOnlyBridge") as bridge, patch("agent.monitoring_lock", return_value=nullcontext()) as lock, \
             patch("agent.MonitoringJournal") as monitoring, patch("publishing_journal.PublishingJournal") as publishing, \
             patch("agent.AutomationJournal"), patch("agent.recover_automation"), patch("agent.Incogniton"), patch("agent.poll_automation", return_value=None) as poll:
            monitoring.return_value.read.return_value = None; publishing.return_value.read.return_value = None
            self.assertEqual(run_tasks_only(CONNECTION, once=True, state=Path("fixture-state")), 0)
            lock.assert_called_once_with(Path("fixture-state/monitor.lock"))
            bridge.return_value.rpc.assert_called_once_with("reporting_worker_heartbeat")
            poll.assert_called_once()

    def test_unresolved_monitoring_or_publishing_checkpoint_blocks_profile_work(self):
        for which in ("monitoring", "publishing"):
            with patch("agent.TaskOnlyBridge"), patch("agent.monitoring_lock", return_value=nullcontext()), \
                 patch("agent.MonitoringJournal") as monitoring, patch("publishing_journal.PublishingJournal") as publishing, \
                 patch("agent.AutomationJournal"), patch("agent.poll_automation") as poll:
                monitoring.return_value.read.return_value = None; publishing.return_value.read.return_value = None
                (monitoring if which == "monitoring" else publishing).return_value.read.return_value = {"state": "claimed", "cleanup_required": False}
                with self.assertRaises(BridgeError): run_tasks_only(CONNECTION, once=True, state=Path("fixture-state"))
                poll.assert_not_called()

    def test_failure_stops_without_polling_another_task_or_sleeping(self):
        with patch("agent.TaskOnlyBridge"), patch("agent.monitoring_lock", return_value=nullcontext()), \
             patch("agent.MonitoringJournal") as monitoring, patch("publishing_journal.PublishingJournal") as publishing, \
             patch("agent.AutomationJournal"), patch("agent.recover_automation"), patch("agent.Incogniton"), \
             patch("agent.poll_automation", return_value="automation_failed") as poll, patch("agent.time.sleep") as sleep:
            monitoring.return_value.read.return_value = None; publishing.return_value.read.return_value = None
            self.assertEqual(run_tasks_only(CONNECTION, state=Path("fixture-state")), 1)
            poll.assert_called_once(); sleep.assert_not_called()

    def test_no_new_claims_after_eight_hour_window(self):
        with patch("agent.TaskOnlyBridge"), patch("agent.monitoring_lock", return_value=nullcontext()), \
             patch("agent.MonitoringJournal") as monitoring, patch("publishing_journal.PublishingJournal") as publishing, \
             patch("agent.AutomationJournal"), patch("agent.recover_automation"), patch("agent.Incogniton"), \
             patch("agent.poll_automation", return_value=None) as poll, patch("agent.time.monotonic", side_effect=[0, 0, 8 * 3600 + 1]), patch("agent.time.sleep") as sleep:
            monitoring.return_value.read.return_value = None; publishing.return_value.read.return_value = None
            self.assertEqual(run_tasks_only(CONNECTION, state=Path("fixture-state")), 0)
            poll.assert_called_once(); sleep.assert_called_once_with(15)


if __name__ == "__main__": unittest.main()
