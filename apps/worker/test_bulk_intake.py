import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from automation_tasks import write_text
from bulk_intake import preview, read_staged, stage, validate_text

PROFILE = "11111111-1111-4111-8111-111111111111"
COOKIE = ".example.invalid\tTRUE\t/\tTRUE\t2000000000\tsession\tPRIVATE-FIXTURE-ONLY\n"


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.home = self.root / "worker"
        self.env = patch.dict(os.environ, {"ND_WORKER_HOME": str(self.home)}); self.env.start(); self.addCleanup(self.env.stop)
        self.source = self.root / "source.txt"; self.source.write_bytes(COOKIE.encode())
        self.row = {"profile_id": PROFILE, "kind": "cookie_write", "source": str(self.source), "replace": False}
        self.value = {"version": 1, "rows": [self.row]}

    def test_preview_never_writes_networks_or_returns_paths_in_summary(self):
        rows = preview(self.value)
        self.assertEqual(rows[0]["entries"], 1); self.assertFalse(self.home.exists())

    def test_exact_uuid_duplicate_and_malformed_rows_fail_closed(self):
        for row in ({**self.row, "profile_id": "Profile name"}, {**self.row, "unexpected": "no"}):
            with self.assertRaises(ValueError): preview({"version": 1, "rows": [row]})
        with self.assertRaises(ValueError): preview({"version": 1, "rows": [self.row, self.row]})
        self.source.write_text(COOKIE + "malformed-row")
        with self.assertRaises(ValueError): preview(self.value)

    def test_permission_and_necessity_are_required_before_staging(self):
        with self.assertRaises(ValueError): stage(self.value, "authorized_migration")
        self.assertFalse(self.home.exists())

    def test_stage_encrypts_and_task_must_match_exact_profile_kind_replace(self):
        ciphertext = b"opaque-ciphertext-fixture"
        captured = []
        def encrypt(data): captured.append(data); return ciphertext
        result = stage(self.value, "authorized_migration", True, True, encrypt)
        path = result["rows"][0]["path"]
        self.assertNotIn("PRIVATE-FIXTURE-ONLY", Path(path).read_text())
        with patch("bulk_intake.unprotect", return_value=captured[0]):
            self.assertEqual(write_text({"path": path, "profile_id": PROFILE, "replace": False}, "cookie_write"), COOKIE)
            for profile, kind, replace in [("22222222-2222-4222-8222-222222222222", "cookie_write", False), (PROFILE, "proxy_write", False), (PROFILE, "cookie_write", True)]:
                with self.assertRaises(ValueError): read_staged(path, kind, profile, replace)

    def test_expired_ciphertext_and_wrong_root_are_rejected(self):
        result = stage(self.value, "authorized_recovery", True, True, lambda _: b"encrypted")
        path = result["rows"][0]["path"]
        expired = {"version": 1, "profile_id": PROFILE, "kind": "cookie_write", "replace": False, "text": COOKIE, "expires_at": "2020-01-01T00:00:00+00:00"}
        with self.assertRaises(ValueError): read_staged(path, "cookie_write", PROFILE, False, lambda _: json.dumps(expired).encode())
        with self.assertRaises(ValueError): read_staged(self.source, "cookie_write", PROFILE, False)

    def test_proxy_preview_rejects_multi_line_unknown_scheme_and_ambiguous_credentials(self):
        for text in ("host:1080\nhost2:1080", "unknown://host:1080", "host:1080:user", "host:1080:user:pass:extra", "host:0"):
            with self.assertRaises(ValueError): validate_text("proxy_write", text)
        self.assertEqual(validate_text("proxy_write", "socks5://proxy.example.invalid:1080:user:fixture"), 1)

    def test_no_plaintext_fallback_when_encryption_fails(self):
        def fail(_): raise ValueError("DPAPI unavailable")
        with self.assertRaises(ValueError): stage(self.value, "authorized_recovery", True, True, fail)
        self.assertFalse(self.home.exists()); self.assertEqual(self.source.read_text(), COOKIE)

    @unittest.skipUnless(os.name == "nt", "DPAPI is Windows-only")
    def test_real_current_user_dpapi_round_trip_on_synthetic_bytes(self):
        from private_vault import protect, unprotect
        ciphertext = protect(b"synthetic-dpapi-fixture-no-credentials")
        self.assertNotIn(b"synthetic-dpapi-fixture", ciphertext)
        self.assertEqual(unprotect(ciphertext), b"synthetic-dpapi-fixture-no-credentials")


if __name__ == "__main__": unittest.main()
