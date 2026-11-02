import unittest

from build_client_package import allowed_path, secret_findings


class PackageSafetyTests(unittest.TestCase):
    def test_local_secrets_and_customer_artifacts_are_never_paths_to_package(self):
        for name in (".env", "apps/web/.env.local", "apps/worker/.monitoring/worker.json", "backups/source.xlsx",
                     "exports/reviews.csv", "screenshots/account.png", "opencode.json", "config.json", "key.pem",
                     "node_modules/package/index.js", "apps/worker/.venv/lib.py", "../outside.py", "/outside.py"):
            with self.subTest(name=name):
                self.assertFalse(allowed_path(name))

    def test_public_examples_source_assets_and_tests_remain_available(self):
        for name in ("apps/web/.env.example", ".gitignore", "manifest.json", "assets/logo.png", "tests/smoke.test.js",
                     "apps/worker/publishing-adapter.example.json", "requirements.txt", "supabase/migrations/fixture.sql"):
            self.assertTrue(allowed_path(name), name)

    def test_live_tokens_are_reported_without_values(self):
        value = ("sb_secret_" + "x" * 40).encode()
        self.assertEqual(secret_findings("nd-dashboard", "source.ts", value), ["secret_key"])

    def test_fixture_exception_is_exact_not_a_test_directory_bypass(self):
        fixture = ("sb_secret_" + "fixture_not_for_clients").encode()
        self.assertEqual(secret_findings("nd-dashboard", "apps/web/tests/env.test.ts", fixture), [])
        self.assertEqual(secret_findings("nd-dashboard", "other.test.ts", fixture), ["secret_key"])
        self.assertEqual(secret_findings("nd-dashboard", "apps/web/tests/env.test.ts", fixture + b"extra"), ["secret_key"])


if __name__ == "__main__":
    unittest.main()
