from pathlib import Path
import tempfile
import unittest

from worker_lock import monitoring_lock


class LockTests(unittest.TestCase):
    def test_releases_lock_after_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.lock"
            with self.assertRaises(ValueError):
                with monitoring_lock(path):
                    raise ValueError("interrupted")
            with monitoring_lock(path):
                self.assertTrue(path.exists())

    def test_second_lock_fails_while_first_is_held(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.lock"
            with monitoring_lock(path):
                with self.assertRaises(RuntimeError):
                    with monitoring_lock(path):
                        self.fail("Two monitoring processes acquired the lock")


if __name__ == "__main__":
    unittest.main()
