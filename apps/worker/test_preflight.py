import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import preflight
from test_agent import CONFIG
from test_monitoring import ADAPTER


class PreflightTests(unittest.TestCase):
    def fixture(self, directory):
        connection, adapter = Path(directory) / "worker.json", Path(directory) / "adapter.json"
        connection.write_text(json.dumps(CONFIG), encoding="utf8")
        adapter.write_text(json.dumps(ADAPTER), encoding="utf8")
        return connection, adapter

    @patch("preflight.importlib.import_module", return_value=SimpleNamespace(sync_playwright=lambda: None))
    @patch("preflight.metadata.version", side_effect=lambda name: preflight.DEPENDENCIES[name])
    def test_local_pass_never_claims_live_readiness(self, _version, _import):
        with tempfile.TemporaryDirectory() as directory:
            report = preflight.preflight(*self.fixture(directory))
        self.assertTrue(report["local_setup_ready"])
        self.assertFalse(report["live_ready"])
        for key in ("network_calls", "profiles_opened", "jobs_executed"):
            self.assertEqual(report[key], 0)
        self.assertEqual(sum(check["status"] == "unverified" for check in report["checks"]), 4)
        self.assertNotIn(CONFIG["worker_token"], json.dumps(report))
        self.assertNotIn(CONFIG["supabase_url"], json.dumps(report))

    @patch("preflight.metadata.version", side_effect=RuntimeError("private diagnostic"))
    def test_missing_packages_block_without_private_errors_or_imports(self, _version):
        with patch("preflight.importlib.import_module") as importer:
            report = preflight.preflight("missing-worker.json", "missing-adapter.json")
            importer.assert_not_called()
        self.assertFalse(report["local_setup_ready"])
        self.assertNotIn("private diagnostic", json.dumps(report))

    @patch("preflight.metadata.version", return_value="0.0.0")
    def test_version_drift_does_not_silently_execute(self, _version):
        with self.assertRaisesRegex(ValueError, "runtime is not ready"):
            preflight.require_runtime()

    @patch("preflight.importlib.import_module", side_effect=ImportError("private driver path"))
    @patch("preflight.metadata.version", side_effect=lambda name: preflight.DEPENDENCIES[name])
    def test_import_failure_is_redacted(self, _version, _import):
        checks = preflight.runtime_checks()
        self.assertEqual(checks[-1]["status"], "blocked")
        self.assertNotIn("private driver path", json.dumps(checks))

    def test_private_file_failures_do_not_print_paths_or_contents(self):
        for path in ["https://internal.invalid/private", "\\\\private-host\\secret", "/missing/private.json"]:
            result = preflight.inspect_file(path, lambda value: value, "connection")
            self.assertEqual(result["status"], "blocked")
            self.assertNotIn(path, json.dumps(result))

    def test_empty_selectors_and_extra_credentials_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            connection, adapter = self.fixture(directory)
            connection.write_text(json.dumps({**CONFIG, "password": "private-fixture"}))
            adapter.write_text(json.dumps({**ADAPTER, "post_root": ""}))
            report = preflight.preflight(connection, adapter)
        for name in ("connection", "adapter"):
            self.assertEqual(next(check["status"] for check in report["checks"] if check["id"] == name), "blocked")
        self.assertNotIn("private-fixture", json.dumps(report))

    def test_requirement_pins_match_runtime_guard(self):
        text = (Path(__file__).parent / "requirements-monitoring.txt").read_text()
        pins = dict(line.split("==") for line in text.splitlines() if line and not line.startswith("#"))
        self.assertEqual(pins, preflight.DEPENDENCIES)

    @patch("preflight.runtime_checks", return_value=[])
    def test_cli_is_offline_and_reports_blockers_with_nonzero_exit(self, _checks):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = preflight.main(["--connection", "missing.json", "--adapter", "missing.json"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue())["network_calls"], 0)


if __name__ == "__main__":
    unittest.main()
