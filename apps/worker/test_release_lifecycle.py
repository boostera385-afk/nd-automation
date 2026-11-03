import base64
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from preflight import DEPENDENCIES
from release_lifecycle import MANIFEST, PREFIX, installed_pointer, parse_manifest, read_release, switch_release, verify_signature
from worker_state import atomic_json, device_lock

PIN = "A" * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.home = self.root / "worker"
        self.env = patch.dict(os.environ, {"ND_WORKER_HOME": str(self.home)}); self.env.start(); self.addCleanup(self.env.stop)
        self.signature, self.runtime = Mock(), Mock()
        isolated = patch("release_lifecycle.state_directory", return_value=self.home / "state")
        isolated.start(); self.addCleanup(isolated.stop)
        # Never acquire/modify the real checkout's compatibility locks in unit tests.
        from worker_lock import monitoring_lock
        original_lock = monitoring_lock
        def isolated_lock(path):
            path = Path(path)
            if ".worker-state" in path.parts: path = self.home / "legacy-test" / path.name
            return original_lock(path)
        locks = patch("worker_lock.monitoring_lock", side_effect=isolated_lock)
        locks.start(); self.addCleanup(locks.stop)

    def candidate(self, seq=1, files=None):
        path = self.root / ("candidate-" + str(seq)); path.mkdir()
        payload = {name: b"# synthetic fixture, never executed\n" for name in ("agent.py", "worker_state.py", "release_lifecycle.py", "preflight.py", "requirements-monitoring.txt")}
        payload.update(files or {})
        value = {"version": f"0.1.{seq}", "sequence": seq, "python": "3.13", "dependencies": DEPENDENCIES,
                 "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in payload.items()}}
        manifest = (PREFIX + base64.b64encode(json.dumps(value).encode()).decode() + "\n# Mocked signature fixture\n").encode()
        for name, data in {**payload, MANIFEST: manifest}.items(): (path / name).write_bytes(data)
        return path

    def install(self, path, **kwargs): return switch_release(path, PIN, signature_check=self.signature, runtime_check=self.runtime, **kwargs)

    def test_unsigned_or_untrusted_release_is_not_installed(self):
        path = self.candidate()
        def reject(*_): raise ValueError("Untrusted fixture")
        with self.assertRaises(ValueError): switch_release(path, PIN, signature_check=reject)
        self.assertIsNone(installed_pointer())

    def test_install_switches_atomically_and_keeps_state_outside_releases(self):
        path = self.candidate(); result = self.install(path)
        self.assertEqual(result["state"], "installed"); self.assertFalse(result["live_accepted"])
        pointer = installed_pointer(); self.assertEqual(pointer["highest_sequence"], 1)
        self.assertTrue((self.home / "releases" / pointer["active"] / "agent.py").exists())
        self.signature.assert_called(); self.runtime.assert_called_once()

    def test_tampering_unlisted_paths_and_executable_manifest_fail(self):
        path = self.candidate(); (path / "agent.py").write_bytes(b"tampered")
        with self.assertRaises(ValueError): read_release(path, PIN, self.signature)
        path2 = self.candidate(2); (path2 / "worker.private.json").write_text("private")
        with self.assertRaises(ValueError): read_release(path2, PIN, self.signature)
        data = (path / MANIFEST).read_bytes() + b"Write-Host 'not allowed'\n"
        with self.assertRaises(ValueError): parse_manifest(data)

    def test_busy_worker_and_unresolved_checkpoint_refuse_switch(self):
        path = self.candidate()
        with device_lock():
            with self.assertRaises(RuntimeError): self.install(path)
        state = self.home / "state"; state.mkdir()
        atomic_json(state / "automation-journal.json", {"state": "claimed"})
        with self.assertRaises(ValueError): self.install(path)
        self.assertIsNone(installed_pointer())

    def test_update_rollback_replay_and_publisher_rotation_are_explicit(self):
        first, second = self.candidate(), self.candidate(2)
        self.install(first); original = installed_pointer()["active"]
        self.install(second)
        with self.assertRaises(ValueError): self.install(first)
        self.install(None, rollback=True)
        self.assertEqual(installed_pointer()["active"], original)
        self.assertEqual(installed_pointer()["highest_sequence"], 2)
        with self.assertRaises(ValueError): switch_release(second, "B" * 40, signature_check=self.signature, runtime_check=self.runtime)

    def test_runtime_failure_and_interrupted_pointer_write_keep_previous_version(self):
        self.install(self.candidate()); original = installed_pointer()
        second = self.candidate(2)
        with patch("release_lifecycle.atomic_json", side_effect=OSError("fixture interrupt")), self.assertRaises(OSError): self.install(second)
        self.assertEqual(installed_pointer(), original)
        # Completed but inactive staging can be verified/reused on explicit retry.
        self.install(second); self.assertEqual(installed_pointer()["highest_sequence"], 2)

    def test_default_verifier_demands_valid_authenticode_and_pinned_signer(self):
        path = self.candidate() / MANIFEST
        for value in ({"status": "NotSigned", "thumbprint": PIN}, {"status": "Valid", "thumbprint": "B" * 40}):
            with patch("release_lifecycle.os.name", "nt"), patch("release_lifecycle.subprocess.run", return_value=Mock(stdout=json.dumps(value))), self.assertRaises(ValueError):
                verify_signature(path, PIN)


if __name__ == "__main__": unittest.main()
