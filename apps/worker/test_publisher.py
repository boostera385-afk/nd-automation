"""Publishing acceptance fixtures only: no network, profile or real submission."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from agent import WorkerBridge
from publisher import main, publish_one, recover_publishing
from publishing_journal import PublishingJournal
from publishing_protocol import SELECTORS, require_live_lease, validate_adapter, validate_job, validate_result

CONFIG = {"version": 1, "supabase_url": "https://example.supabase.co", "publishable_key": "sb_publishable_fixture", "worker_token": "d" * 64}
PROFILE = "33333333-3333-4333-8333-333333333333"
ACCOUNT = "https://nextdoor.com/profile/authorized-fixture"


def job(kind="post"):
    return {"job_id": "44444444-4444-4444-8444-444444444444", "draft_id": "55555555-5555-4555-8555-555555555555",
            "draft_revision": 2, "customer_id": "66666666-6666-4666-8666-666666666666", "profile_id": PROFILE,
            "account_label": "Authorized Person", "lease_token": "77777777-7777-4777-8777-777777777777",
            "lease_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "kind": kind, "title": "Authorized fixture title", "body": "Genuine owner-approved fixture content.",
            "audience": "neighborhood", "price_cents": 1250 if kind == "listing" else None,
            "category": "Furniture" if kind == "listing" else None}


def adapter():
    form = {key: key for key in SELECTORS}
    form.update(audiences={key: "option_" + key for key in ("anyone", "nearby", "neighborhood")},
                audience_labels={"anyone": "Anyone", "nearby": "Nearby neighborhoods", "neighborhood": "Your neighborhood"})
    return {"version": 1, "reviewed": True, "account": "account", "login": "login", "verification": "verification",
            "accounts": {PROFILE: {"url": ACCOUNT, "label": "Authorized Person"}},
            "forms": {"post": deepcopy(form), "listing": deepcopy(form)}}


class Nodes:
    def __init__(self, nodes):
        self.nodes = nodes

    def count(self):
        return len(self.nodes)

    @property
    def first(self):
        return self.nodes[0]

    def all(self):
        return self.nodes

    def __getattr__(self, name):
        if len(self.nodes) != 1:
            raise ValueError("ambiguous fixture locator")
        return getattr(self.nodes[0], name)


class Node:
    def __init__(self, page, key, content="", href=None, children=None):
        self.page, self.key, self.content, self.href = page, key, content, href
        self.children = children

    def locator(self, key):
        return Nodes([self.children[key]]) if self.children is not None and key in self.children else self.page.locator(key)

    def is_visible(self):
        return True

    def is_enabled(self):
        return True

    def get_attribute(self, name):
        return self.href if name == "href" else None

    def inner_text(self):
        if self.key == "audience":
            return self.page.audience
        if self.key == "option:checked":
            return self.page.category
        return self.content

    def input_value(self):
        return self.content

    def fill(self, value, **_):
        self.content = value

    def evaluate(self, _):
        return "textarea"

    def select_option(self, label, **_):
        self.page.category = label

    def click(self, **_):
        if self.key.startswith("option_"):
            self.page.audience = "Wrong audience" if self.page.bad_audience else self.page.spec["forms"]["post"]["audience_labels"][self.key[7:]]
        if self.key == "submit":
            self.page.submits += 1
            if self.page.throw_submit:
                raise RuntimeError("ambiguous click response with secret data")
            if self.page.capture:
                self.page.results.append(self.page.result_card())


class Page:
    def __init__(self, value, spec):
        self.value, self.spec = value, spec
        self.url = "https://nextdoor.com/news_feed/"
        self.submits, self.closed = 0, False
        self.bad_audience, self.throw_submit, self.capture = False, False, True
        self.audience, self.category = "Choose audience", ""
        self.results = []
        self.nodes = {key: Node(self, key) for key in SELECTORS | {"account", "option:checked"}}
        self.nodes["account"] = Node(self, "account", value["account_label"], ACCOUNT)
        for key in ("anyone", "nearby", "neighborhood"):
            self.nodes["option_" + key] = Node(self, "option_" + key)

    def result_card(self, author=ACCOUNT):
        kind = "p" if self.value["kind"] == "post" else "for_sale_and_free"
        children = {"result_body": Node(self, "result_body", self.value["body"]),
                    "result_author": Node(self, "result_author", href=author),
                    "result_link": Node(self, "result_link", href=f"https://nextdoor.com/{kind}/new-fixture"),
                    "result_title": Node(self, "result_title", self.value["title"])}
        return Node(self, "card", children=children)

    def locator(self, key):
        if key in {"login", "verification"}:
            return Nodes([])
        if key == "result_root":
            return Nodes(self.results)
        return Nodes([self.nodes[key]])

    def goto(self, *_args, **_kwargs):
        pass

    def set_default_timeout(self, _):
        pass

    def route(self, *_):
        pass

    def wait_for_timeout(self, _):
        pass

    def close(self):
        self.closed = True


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.journal = PublishingJournal(Path(self.directory.name) / "publishing.json", CONFIG)
        self.job, self.spec = job(), adapter()
        self.page = Page(self.job, self.spec)
        self.api = Mock()
        self.api.launch.return_value = {"status": "ok", "puppeteerUrl": "http://127.0.0.1:50001"}
        self.chromium = Mock()
        self.chromium.connect_over_cdp.return_value.contexts = [Mock(new_page=Mock(return_value=self.page))]

    def run_publish(self):
        publish_one(self.job, self.spec, self.api, self.chromium, self.journal)
        return self.journal.read()

    def test_one_submit_has_exact_content_author_link_and_durable_intent(self):
        saved = self.run_publish()
        self.assertEqual(saved["state"], "result_ready")
        self.assertEqual(saved["result"]["outcome"], "submitted")
        self.assertEqual(saved["result"]["post_url"], "https://nextdoor.com/p/new-fixture")
        self.assertEqual(self.page.submits, 1)
        self.assertFalse(saved["cleanup_required"])
        self.api.stop.assert_called_once_with(PROFILE)
        self.assertTrue(self.page.closed)

    def test_listing_reads_back_title_body_price_category_and_matching_url(self):
        self.job = job("listing")
        self.page.value = self.job
        saved = self.run_publish()
        self.assertEqual(saved["result"]["post_url"], "https://nextdoor.com/for_sale_and_free/new-fixture")
        self.assertEqual(self.page.nodes["price"].content, "12.50")
        self.assertEqual(self.page.category, "Furniture")

    def test_wrong_account_never_submits(self):
        self.page.nodes["account"].href = "https://nextdoor.com/profile/wrong-account"
        saved = self.run_publish()
        self.assertEqual(saved["result"]["outcome"], "validation_error")
        self.assertEqual(self.page.submits, 0)

    def test_wrong_audience_never_submits(self):
        self.page.bad_audience = True
        self.assertEqual(self.run_publish()["result"]["outcome"], "validation_error")
        self.assertEqual(self.page.submits, 0)

    def test_composer_rerender_cannot_change_approved_text_before_submit(self):
        original = self.page.nodes["option_neighborhood"].click
        def rerender(**kwargs):
            original(**kwargs)
            self.page.nodes["body"].content = "Unexpected replacement text"
        self.page.nodes["option_neighborhood"].click = rerender
        self.assertEqual(self.run_publish()["result"]["outcome"], "validation_error")
        self.assertEqual(self.page.submits, 0)

    def test_existing_matching_post_is_not_new_submission_evidence(self):
        self.page.results = [self.page.result_card()]
        self.assertEqual(self.run_publish()["result"]["outcome"], "validation_error")
        self.assertEqual(self.page.submits, 0)

    def test_uncertain_click_and_missing_evidence_never_claim_success_or_retry(self):
        self.page.throw_submit = True
        saved = self.run_publish()
        self.assertEqual(saved["result"]["outcome"], "needs_reconciliation")
        self.assertIsNone(saved["result"]["post_url"])
        self.assertEqual(self.page.submits, 1)
        self.assertNotIn("secret", saved["result"]["reason"])

    def test_no_exact_result_link_remains_ambiguous(self):
        self.page.capture = False
        self.assertEqual(self.run_publish()["result"]["outcome"], "needs_reconciliation")
        self.assertEqual(self.page.submits, 1)

    def test_submit_intent_storage_failure_prevents_the_click(self):
        with patch.object(self.journal, "submit_intent", side_effect=OSError("disk error")):
            self.assertEqual(self.run_publish()["result"]["outcome"], "validation_error")
        self.assertEqual(self.page.submits, 0)

    def test_initial_checkpoint_failure_prevents_profile_launch(self):
        with patch.object(self.journal, "write", side_effect=OSError("disk error")), self.assertRaises(OSError):
            self.run_publish()
        self.api.launch.assert_not_called()

    def test_lost_completion_recovers_only_the_result_never_the_browser(self):
        self.run_publish()
        bridge = Mock()
        bridge.complete_publish.side_effect = RuntimeError("offline")
        with self.assertRaises(RuntimeError):
            recover_publishing(bridge, self.journal)
        self.assertEqual(self.journal.read()["state"], "result_ready")
        bridge.complete_publish.side_effect = None
        bridge.complete_publish.return_value = False
        self.assertEqual(recover_publishing(bridge, self.journal), "acknowledged")
        self.assertIsNone(self.journal.read()["result"])
        self.assertNotIn("body", self.journal.read()["job"])
        self.assertNotIn(self.job["body"], self.journal.path.read_text(encoding="utf-8"))
        self.assertEqual(self.page.submits, 1)
        self.api.launch.assert_called_once()

    def test_crash_after_submit_intent_cannot_replay_or_discard_it(self):
        self.journal.begin(self.job)
        self.journal.submit_intent()
        bridge = Mock()
        with self.assertRaises(ValueError):
            recover_publishing(bridge, self.journal)
        bridge.complete_publish.assert_not_called()
        with self.assertRaises(ValueError):
            self.journal.begin(self.job)

    def test_interruption_preserves_submit_intent_and_stops_only_the_owned_profile(self):
        self.page.nodes["submit"].click = Mock(side_effect=KeyboardInterrupt)
        with self.assertRaises(KeyboardInterrupt):
            self.run_publish()
        self.assertEqual(self.journal.read()["state"], "submit_intent")
        self.api.stop.assert_called_once_with(PROFILE)
        with self.assertRaises(ValueError):
            recover_publishing(Mock(), self.journal)

    def test_uncertain_cleanup_blocks_next_work_even_after_receipt(self):
        self.api.stop.side_effect = RuntimeError("unknown cleanup")
        with self.assertRaises(RuntimeError):
            self.run_publish()
        bridge = Mock()
        bridge.complete_publish.return_value = True
        with self.assertRaises(ValueError):
            recover_publishing(bridge, self.journal)
        self.assertEqual(self.journal.read()["state"], "acknowledged")
        with self.assertRaises(ValueError):
            self.journal.begin(self.job)

    def test_changed_credentials_never_inherit_an_unresolved_submit(self):
        self.journal.begin(self.job)
        other = PublishingJournal(self.journal.path, {**CONFIG, "worker_token": "e" * 64})
        with self.assertRaises(ValueError):
            other.read()

    def test_unreviewed_adapter_and_unknown_fields_are_refused(self):
        for spec in ({**self.spec, "reviewed": False}, {**self.spec, "script": "untrusted"}):
            with self.assertRaises(ValueError):
                validate_adapter(spec)
        for value in ({**self.job, "media": ["file:///private"]}, {**self.job, "draft_revision": True},
                      {**self.job, "body": ""}, {**self.job, "kind": "arbitrary"}):
            with self.assertRaises(ValueError):
                validate_job(value)

    def test_expired_lease_cannot_open_a_profile(self):
        self.job["lease_expires_at"] = "2020-01-01T00:00:00Z"
        with self.assertRaises(ValueError):
            require_live_lease(self.job)
        self.api.launch.assert_not_called()

    def test_non_submitted_results_cannot_smuggle_urls(self):
        with self.assertRaises(ValueError):
            validate_result({"outcome": "validation_error", "reason": "fixture", "adapter_sha256": "a" * 64,
                             "post_url": "https://nextdoor.com/p/not-submitted", "published_at": None})

    def test_cli_requires_explicit_execution_authorization(self):
        with patch("publisher.load_json", return_value=CONFIG), patch("publisher.WorkerBridge") as bridge, patch("sys.stderr"):
            with self.assertRaises(SystemExit):
                main(["--connection", "fixture.json", "--adapter", "adapter.json", "--execute"])
            bridge.assert_not_called()

    @patch("agent.time.sleep")
    def test_transport_retries_identical_receipts_only(self, _):
        self.run_publish()
        bridge = WorkerBridge(CONFIG)
        bridge.rpc = Mock(side_effect=[ValueError("bad receipt"), False])
        self.assertIs(bridge.complete_publish(self.job, self.journal.read()["result"]), False)
        self.assertEqual(bridge.rpc.call_args_list[0], bridge.rpc.call_args_list[1])


if __name__ == "__main__":
    unittest.main()
