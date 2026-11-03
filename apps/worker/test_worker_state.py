from contextlib import nullcontext
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from worker_state import assert_drained, device_lock, device_root, execution_lock, migrate, state_directory


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.home = self.root / "private"
        self.env = patch.dict(os.environ, {"ND_WORKER_HOME": str(self.home)}); self.env.start(); self.addCleanup(self.env.stop)

    def test_distinct_release_directories_use_same_state_and_lock(self):
        self.assertEqual(state_directory(self.root / "v1"), state_directory(self.root / "v2"))
        with device_lock():
            with self.assertRaises(RuntimeError):
                with device_lock(): pass

    def test_legacy_state_must_be_explicitly_copied_and_never_discarded(self):
        checkout = self.root / "v1"; legacy = checkout / ".worker-state"; legacy.mkdir(parents=True)
        source = legacy / "automation-journal.json"; source.write_text(json.dumps({"state": "claimed"}))
        with self.assertRaises(ValueError): state_directory(checkout)
        result = migrate(checkout)
        self.assertTrue(result["originals_preserved"])
        self.assertEqual((state_directory(checkout) / source.name).read_bytes(), source.read_bytes())
        with self.assertRaises(ValueError): assert_drained(state_directory(checkout))
        source.write_text('{"state":"changed by an old worker"}')
        with self.assertRaises(ValueError): state_directory(checkout)

    def test_shared_checkpoint_is_not_overwritten_on_migration(self):
        checkout = self.root / "v1"; legacy = checkout / ".worker-state"; legacy.mkdir(parents=True)
        (legacy / "automation-journal.json").write_text('{"state":"claimed"}')
        target = self.home / "state"; target.mkdir(parents=True)
        path = target / "automation-journal.json"; path.write_text('{"state":"other"}')
        with self.assertRaises(ValueError): migrate(checkout)
        self.assertEqual(path.read_text(), '{"state":"other"}')

    def test_all_journals_must_be_drained_and_writeback_uses_settled(self):
        state = self.home / "state"; state.mkdir(parents=True)
        uid = "11111111-1111-4111-8111-111111111111"
        for name, value in [("automation-journal.json", {"version": 1, "scope": "a"*64, "state": "acknowledged", "inspection_required": False,
                                  "task": None, "reference": {"task_id": uid, "kind": "inventory_scan"}, "completion": None}),
                            ("writeback-journal.json", {"version": 1, "scope": "a"*64, "state": "settled", "request": uid, "ackRequest": uid, "item": None, "result": None})]:
            (state / name).write_text(json.dumps(value))
        assert_drained(state)
        (state / "automation-journal.json").write_text('{"state":"acknowledged","inspection_required":true}')
        with self.assertRaises(ValueError): assert_drained(state)

    def test_relative_or_network_override_is_denied(self):
        for value in ("relative", r"\\server\state", "//server/state"):
            with patch.dict(os.environ, {"ND_WORKER_HOME": value}), self.assertRaises(ValueError): device_root()


if __name__ == "__main__": unittest.main()
