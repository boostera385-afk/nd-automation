import unittest
from unittest.mock import Mock, patch

from local_incogniton import Incogniton, ProfileUnavailable, debug_endpoint
from monitor import EXPAND_JS, MOUNT_JS, check_page, run_batch
from monitoring import (canonical_post_url, classify_snapshot, is_account_disabled, navigation_failure, normalized_title,
                        validate_adapter, validate_manifest)
from worker_protocol import validate_job


POST = {"publication_id": "11111111-1111-4111-8111-111111111111",
        "profile_id": "22222222-2222-4222-8222-222222222222", "url": "https://nextdoor.com/p/example"}
ADAPTER = {"version": 2, "post_root": "article", "post_link": "a[href]", "post_body": ".post-body", "comment": "[data-comment-id]",
           "comment_id_attribute": "data-comment-id", "comment_body": ".body", "login": "#login",
           "verification": "#verify", "removed": "#removed", "unavailable": "#unavailable",
           "comment_id_selector": "", "comment_id_prefix": "", "comment_author": "",
           "comment_expand": "", "comment_total": ""}


class ContractTests(unittest.TestCase):
    def test_canonicalizes_supported_links(self):
        self.assertEqual(canonical_post_url("https://www.nextdoor.com/p/example/?track=x#frag"), POST["url"])

    def test_disallows_arbitrary_targets(self):
        for value in ("http://nextdoor.com/p/x", "https://nextdoor.com.attacker.test/p/x", "https://nextdoor.com/login",
                      "https://user:pass@nextdoor.com/p/x", "https://127.0.0.1/p/x", "https://nextdoor.com:443/p/x"):
            with self.assertRaises(ValueError):
                canonical_post_url(value)

    def test_manifest_validates_before_launch(self):
        self.assertEqual(validate_manifest({"version": 1, "posts": [POST]}), [POST])
        for posts in ([], [POST, POST], [{**POST, "password": "secret"}], [{**POST, "profile_id": "ambiguous name"}]):
            with self.assertRaises((ValueError, TypeError)):
                validate_manifest({"version": 1, "posts": posts})

    def test_stored_title_is_normalized_for_identity_matching(self):
        self.assertEqual(normalized_title("  Hello,   WORLD!! "), "hello world")
        self.assertEqual(normalized_title(None), "")
        self.assertEqual(len(normalized_title("x" * 900)), 500)

    def test_manifest_carries_an_optional_title_only(self):
        self.assertEqual(validate_manifest({"version": 1, "posts": [{**POST, "title": " Big   News, Today "}]}),
                         [{**POST, "title": "big news today"}])
        self.assertEqual(validate_manifest({"version": 1, "posts": [{**POST, "title": "   "}]}), [POST])
        for title in (123, ["news"], {"text": "news"}):
            with self.assertRaises(ValueError):
                validate_manifest({"version": 1, "posts": [{**POST, "title": title}]})

    def test_adapter_requires_explicit_configuration(self):
        self.assertEqual(validate_adapter(ADAPTER), ADAPTER)
        with self.assertRaises(ValueError):
            validate_adapter({**ADAPTER, "removed": ""})
        with self.assertRaises(ValueError):
            validate_adapter({k: v for k, v in ADAPTER.items() if k != "comment_expand"})
        with self.assertRaises(ValueError):
            validate_adapter({**ADAPTER, "version": 1})
        # An optional selector must be absent-by-empty, never a non-text value.
        with self.assertRaises(ValueError):
            validate_adapter({**ADAPTER, "comment_author": None})

    def test_alive_requires_exact_post(self):
        self.assertEqual(classify_snapshot(POST, {"url": POST["url"], "exact_post": True})["outcome"], "alive")
        for snapshot in ({"url": POST["url"]}, {"url": "https://nextdoor.com/p/other", "exact_post": True},
                         {"url": POST["url"], "exact_post": True, "removed": True}):
            self.assertEqual(classify_snapshot(POST, snapshot)["outcome"], "needs_review")

    def test_access_failures_take_precedence(self):
        for signal, outcome in (("login", "login_required"), ("verification", "verification_required")):
            self.assertEqual(classify_snapshot(POST, {"url": POST["url"], "exact_post": True, signal: True})["outcome"], outcome)

    def test_removal_like_notice_is_not_confirmed_deletion(self):
        self.assertEqual(classify_snapshot(POST, {"url": POST["url"], "removed": True})["outcome"], "needs_review")

    def test_account_disabled_redirect_is_reported_plainly(self):
        value = classify_snapshot(POST, {"url": "https://nextdoor.com/account_disabled/",
                                         "exact_post": False, "comments": [
                                             {"external_id": "x", "body": "must not be stored"}]})
        self.assertEqual(value["outcome"], "needs_review")
        self.assertIn("Account Disabled", value["reason"])
        self.assertEqual(value["comments"], [])
        # A post whose slug merely contains the words stays an ordinary URL.
        for url in ("https://nextdoor.com/p/account_disabled", "https://nextdoor.com/p/account_disabled/X"):
            self.assertFalse(is_account_disabled(url))

    def test_comments_are_scoped_deduplicated_and_incomplete(self):
        snapshot = {"url": POST["url"], "exact_post": True, "comments": [
            {"external_id": "c1", "body": "Example"}, {"external_id": "c1", "body": "Example"},
            {"external_id": None, "body": "No stable ID"}]}
        value = classify_snapshot(POST, snapshot)
        self.assertEqual(len(value["comments"]), 1)
        self.assertIsNone(value["comments"][0]["created_at"])
        self.assertIsNone(value["comments_total"])
        self.assertFalse(value["comments_complete"])

    def test_author_is_optional_but_bounded(self):
        base = {"url": POST["url"], "exact_post": True}
        with_author = classify_snapshot(POST, {**base, "comments": [
            {"external_id": "c1", "body": "Example", "author": "A Neighbor"}]})
        self.assertEqual(with_author["comments"][0]["author"], "A Neighbor")
        for author in (None, "", "   ", "x" * 201):
            value = classify_snapshot(POST, {**base, "comments": [
                {"external_id": "c1", "body": "Example", "author": author}]})
            self.assertIsNone(value["comments"][0]["author"])

    def test_completion_requires_a_matching_total_and_nothing_left_to_load(self):
        comments = [{"external_id": "c1", "body": "One", "author": "A"},
                    {"external_id": "c2", "body": "Two", "author": "B"}]
        base = {"url": POST["url"], "exact_post": True, "comments": comments}
        complete = classify_snapshot(POST, {**base, "comments_total": 2, "comments_expandable": True,
                                           "comments_expand_left": 0})
        self.assertEqual(complete["comments_total"], 2)
        self.assertTrue(complete["comments_complete"])
        # A count alone is never completion.
        for extra in ({"comments_total": 2, "comments_expandable": True, "comments_expand_left": 1},
                      {"comments_total": 3, "comments_expandable": True, "comments_expand_left": 0},
                      {"comments_total": 2, "comments_expand_left": 0},
                      {"comments_total": 2, "comments_expandable": False, "comments_expand_left": 0},
                      {"comments_total": 2}):
            self.assertFalse(classify_snapshot(POST, {**base, **extra})["comments_complete"])
        # An unreadable or absurd total is dropped rather than trusted.
        for total in (None, -1, True, "2", 2.0):
            self.assertIsNone(classify_snapshot(POST, {**base, "comments_total": total})["comments_total"])

    def test_navigation_errors_do_not_imply_removal_or_leak_details(self):
        value = navigation_failure(POST, "ERR_PROXY_CONNECTION_FAILED secret")
        self.assertEqual(value["outcome"], "proxy_issue")
        self.assertNotIn("secret", str(value))
        self.assertEqual(navigation_failure(POST, "ERR_SOCKS_CONNECTION_FAILED")["outcome"], "proxy_issue")
        self.assertEqual(navigation_failure(POST, "ERR_TUNNEL_CONNECTION_FAILED")["outcome"], "proxy_issue")
        self.assertEqual(navigation_failure(POST, "timeout")["outcome"], "network_error")

    def test_debug_endpoint_is_loopback_only(self):
        self.assertEqual(debug_endpoint({"data": {"puppeteerUrl": "ws://127.0.0.1:9222/devtools/browser/test"}}),
                         "ws://127.0.0.1:9222/devtools/browser/test")
        for value in ("ws://attacker.test:9222/x", "http://user:pass@localhost:9222/x", "file:///x"):
            with self.assertRaises(ValueError):
                debug_endpoint({"url": value})

    def test_launch_fails_closed_for_unknown_or_running_status(self):
        api = Incogniton()
        for payload in ({}, {"state": "running"}, {"state": "stopped", "profile_status": "running"}):
            api.request = Mock(return_value=payload)
            with self.assertRaises(ValueError):
                api.launch(POST["profile_id"])
            self.assertEqual(api.request.call_count, 1)


class JobContractTests(unittest.TestCase):
    JOB = {"job_id": "55555555-5555-4555-8555-555555555555",
           "publication_id": POST["publication_id"], "profile_id": POST["profile_id"], "url": POST["url"],
           "lease_token": "66666666-6666-4666-8666-666666666666",
           "lease_expires_at": "2026-10-30T20:00:00+00:00"}

    def job(self, **extra):
        return {**self.JOB, **extra}

    def test_claim_forwards_an_optional_normalized_title(self):
        self.assertEqual(validate_job(self.job()), POST)
        self.assertEqual(validate_job(self.job(title="Hello, World"))["title"], "hello world")
        self.assertEqual(validate_job(self.job(title=None)), POST)
        self.assertEqual(validate_job(self.job(title="  ")), POST)
        self.assertEqual(validate_job(self.job(account_label="Example account")), POST)

    def test_claim_still_rejects_unknown_fields(self):
        for extra in ({"selector": "x"}, {"title": 5}, {"title": ["news"]}):
            with self.assertRaises(ValueError):
                validate_job(self.job(**extra))


class RunnerTests(unittest.TestCase):
    def test_check_page_passes_the_stored_title_to_the_adapter(self):
        page = Mock()
        page.goto.return_value.status = 200
        page.evaluate.return_value = {"url": POST["url"], "exact_post": True}
        check_page(page, {**POST, "title": "big news today"}, ADAPTER)
        self.assertEqual(page.evaluate.call_args[0][1]["title"], "big news today")
        self.assertEqual(page.evaluate.call_args[0][1]["target"], POST["url"])

    def test_expansion_is_off_unless_the_operator_asks_for_it(self):
        expanding = {**ADAPTER, "comment_expand": "[data-testid=more]"}
        page = Mock()
        page.goto.return_value.status = 200
        page.evaluate.return_value = {"url": POST["url"], "exact_post": True,
                                      "comments": [], "comments_total": 2, "comments_expand_left": 1}
        value = check_page(page, POST, expanding, allow_expansion=False)
        self.assertEqual(page.evaluate.call_count, 1)
        self.assertFalse(value["comments_complete"])

    def _page(self, snapshots, mount=False, expand=None):
        """Mock page that answers SNAPSHOT/MOUNT/EXPAND by script identity."""
        page = Mock()
        page.goto.return_value.status = 200
        pending = list(snapshots)
        expands = list(expand or [])

        def evaluate(js, arg=None):
            if js is MOUNT_JS:
                return mount
            if js is EXPAND_JS:
                return expands.pop(0) if expands else False
            return pending.pop(0) if len(pending) > 1 else pending[0]

        page.evaluate.side_effect = evaluate
        return page

    def test_empty_thread_is_opened_and_expanded(self):
        expanding = {**ADAPTER, "comment_expand": "[data-testid=more]",
                     "comment_total": "[data-testid=count]"}
        empty = {"url": POST["url"], "exact_post": True, "comments": [], "comments_total": 2,
                 "comments_expand_left": 0, "comments_expandable": True}
        opened = {**empty, "comments_expand_left": 1,
                  "comments": [{"external_id": "c1", "body": "One", "author": "A"}]}
        loaded = {"url": POST["url"], "exact_post": True, "comments_total": 2,
                  "comments_expand_left": 0, "comments_expandable": True,
                  "comments": [{"external_id": "c1", "body": "One", "author": "A"},
                               {"external_id": "c2", "body": "Two", "author": "B"}]}
        # The thread mounts asynchronously: the first poll still shows nothing.
        page = self._page([empty, empty, opened, opened, loaded], mount=True, expand=[True])
        value = check_page(page, POST, expanding, allow_expansion=True)
        self.assertTrue(value["comments_complete"])
        self.assertEqual(value["comments_total"], 2)
        self.assertEqual(len(value["comments"]), 2)

    def test_a_post_with_no_comments_is_never_clicked(self):
        expanding = {**ADAPTER, "comment_expand": "[data-testid=more]",
                     "comment_total": "[data-testid=count]"}
        zero = {"url": POST["url"], "exact_post": True, "comments": [], "comments_total": 0,
                "comments_expand_left": 0, "comments_expandable": True}
        page = self._page([zero], mount=True)
        value = check_page(page, POST, expanding, allow_expansion=True)
        self.assertTrue(value["comments_complete"])
        self.assertEqual(value["comments_total"], 0)
        self.assertNotIn(MOUNT_JS, [call.args[0] for call in page.evaluate.call_args_list])

    def test_expansion_stops_when_the_thread_is_fully_loaded(self):
        expanding = {**ADAPTER, "comment_expand": "[data-testid=more]"}
        loaded = {"url": POST["url"], "exact_post": True, "comments_total": 2, "comments_expand_left": 0,
                  "comments_expandable": True,
                  "comments": [{"external_id": "c1", "body": "One", "author": "A"},
                               {"external_id": "c2", "body": "Two", "author": "B"}]}
        page = self._page([loaded], expand=[True])
        value = check_page(page, POST, expanding, allow_expansion=True)
        self.assertTrue(value["comments_complete"])
        self.assertEqual(value["comments_total"], 2)

    @patch("monitor.time.sleep")
    def test_profiles_are_grouped_and_only_worker_page_is_closed(self, _sleep):
        api, chromium, emit = Mock(), Mock(), Mock()
        api.launch.return_value = {"url": "http://127.0.0.1:9222"}
        page = Mock()
        page.goto.return_value.status = 200
        page.evaluate.return_value = {"url": POST["url"], "exact_post": True}
        browser = chromium.connect_over_cdp.return_value
        browser.contexts = [Mock()]
        browser.contexts[0].new_page.return_value = page
        second = {**POST, "publication_id": "33333333-3333-4333-8333-333333333333"}
        run_batch([POST, second], ADAPTER, api, chromium, emit, float("inf"))
        api.launch.assert_called_once_with(POST["profile_id"])
        api.stop.assert_called_once_with(POST["profile_id"])
        page.close.assert_called_once()
        browser.close.assert_not_called()
        self.assertEqual(emit.call_count, 2)

    @patch("monitor.time.sleep")
    def test_busy_profile_is_not_stopped_or_attached(self, _sleep):
        api, chromium = Mock(), Mock()
        api.launch.side_effect = ProfileUnavailable("busy")
        results = []
        run_batch([POST], ADAPTER, api, chromium, results.append, float("inf"))
        self.assertEqual(results[0]["outcome"], "profile_error")
        api.stop.assert_not_called()
        chromium.connect_over_cdp.assert_not_called()

    def test_unconfirmed_launch_aborts_instead_of_opening_more_profiles(self):
        api, chromium = Mock(), Mock()
        api.launch.side_effect = TimeoutError("launch request timed out")
        second = {**POST, "profile_id": "44444444-4444-4444-8444-444444444444"}
        with self.assertRaises(RuntimeError):
            run_batch([POST, second], ADAPTER, api, chromium, lambda value: None, float("inf"))
        self.assertEqual(api.launch.call_count, 1)
        api.stop.assert_not_called()

    def test_deadline_prevents_profile_launch(self):
        api, chromium, results = Mock(), Mock(), []
        run_batch([POST], ADAPTER, api, chromium, results.append, 0)
        api.launch.assert_not_called()
        self.assertEqual(results[0]["outcome"], "needs_review")

    @patch("monitor.time.sleep")
    def test_failed_cleanup_stops_batch(self, _sleep):
        api, chromium = Mock(), Mock()
        api.launch.return_value = {"url": "http://127.0.0.1:9222"}
        chromium.connect_over_cdp.side_effect = RuntimeError("attach failed")
        api.stop.side_effect = RuntimeError("stop failed")
        with self.assertRaises(RuntimeError):
            run_batch([POST], ADAPTER, api, chromium, lambda value: None, float("inf"))

    def test_adapter_failure_is_not_a_network_or_removal_result(self):
        page = Mock()
        page.goto.return_value.status = 200
        page.evaluate.side_effect = RuntimeError("bad selector")
        self.assertEqual(check_page(page, POST, ADAPTER)["outcome"], "needs_review")


if __name__ == "__main__":
    unittest.main()
