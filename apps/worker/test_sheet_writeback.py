import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from sheet_writeback import (WritebackError, WritebackJournal, WritebackTransport, canonical, deliver_once,
                            deliver_bounded, intent_hash, load_private, main, validate_config, validate_intent, validate_receipt)

ORG = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
ITEM = "33333333-3333-4333-8333-333333333333"
ROW = "44444444-4444-4444-8444-444444444444"
LEASE = "55555555-5555-4555-8555-555555555555"
CONFIG = {"version": 1, "enabled": True, "supabase_url": "https://abcdefghijklmnopqrst.supabase.co",
          "publishable_key": "sb_publishable_test_fixture_public", "organization_id": ORG, "operator_id": USER,
          "connector_url": "https://script.google.com/macros/s/fixture/exec", "connector_token": "fixture-" + "a" * 40}
INTENT = {"action": "append", "tab": "Auto Posting", "rowRef": None,
          "values": [{"ND Row ID": ROW, "Status": "Filled", "Post Text": "=not a formula 😀"}]}


def job():
    return {"id": ITEM, "seq": 1, "intent": deepcopy(INTENT), "leaseToken": LEASE,
            "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=115)).isoformat(), "attempts": 1}


def receipt(item):
    return {"version": 1, "organizationId": ORG, "operationId": item["id"], "intentHash": intent_hash(item["intent"]),
            "tab": "Auto Posting", "rowCount": 1, "committedAt": datetime.now(timezone.utc).isoformat()}


class FakeTransport:
    def __init__(self):
        self.config = deepcopy(CONFIG)
        self.item = job()
        self.calls = []
        self.committed = None
        self.ack_fail = False
        self.lost_apply = False
        self.claim_fail = False
        self.conflict = None
        self.revoked = False

    def verify_identity(self):
        self.calls.append("auth")

    def rpc(self, method, params):
        if "claim" in method:
            self.calls.append(("claim", params["request_id"]))
            if self.revoked or self.claim_fail:
                self.claim_fail = False
                raise WritebackError("unconfirmed")
            return [deepcopy(self.item)] if self.item else []
        self.calls.append(("ack", deepcopy(params)))
        if self.ack_fail:
            raise WritebackError("lost ack")
        return {"id": ITEM, "status": params["outcome"]}

    def connector(self, item, lookup=False):
        self.calls.append("lookup" if lookup else "apply")
        if self.conflict:
            return {"ok": False, "error": self.conflict}
        if self.committed:
            return {"ok": True, "receipt": self.committed}
        if lookup:
            return {"ok": False, "error": "not_found"}
        self.committed = receipt(item)
        if self.lost_apply:
            self.lost_apply = False
            raise WritebackError("lost response after atomic commit")
        return {"ok": True, "receipt": self.committed}


class WritebackTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "state" / "journal.json"
        self.journal = WritebackJournal(self.path, CONFIG)
        self.transport = FakeTransport()

    def test_disabled_delivery_does_not_even_authenticate(self):
        self.transport.config["enabled"] = False
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        self.assertEqual(self.transport.calls, [])

    def test_one_commit_then_ack_clears_customer_text_and_never_saves_tokens(self):
        self.assertEqual(deliver_once(self.transport, self.journal), "delivered")
        self.assertEqual(self.transport.calls.count("apply"), 1)
        self.assertEqual(self.journal.read()["state"], "settled")
        text = self.path.read_text()
        for private in ("not a formula", CONFIG["connector_token"], "access_token"):
            self.assertNotIn(private, text)

    def test_claim_network_loss_reuses_durable_request_id(self):
        self.transport.claim_fail = True
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        request = self.journal.read()["request"]
        self.assertEqual(deliver_once(self.transport, self.journal), "delivered")
        self.assertTrue(all(c[1] == request for c in self.transport.calls if isinstance(c, tuple) and c[0] == "claim"))

    def test_lost_google_response_is_recovered_by_lookup_without_second_write(self):
        self.transport.lost_apply = True
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        self.assertEqual(self.journal.read()["state"], "claimed")
        self.assertEqual(deliver_once(self.transport, self.journal, recover_only=True), "delivered")
        self.assertEqual(self.transport.calls.count("apply"), 1)

    def test_lost_ack_replays_only_identical_saved_completion(self):
        self.transport.ack_fail = True
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        previous = self.journal.read()
        self.assertEqual(previous["state"], "result_ready")
        self.transport.ack_fail = False
        before = list(self.transport.calls)
        self.assertEqual(deliver_once(self.transport, self.journal, recover_only=True), "delivered")
        new = self.transport.calls[len(before):]
        self.assertFalse(any(c in {"apply", "lookup"} for c in new if isinstance(c, str)))
        acks = [c[1] for c in self.transport.calls if isinstance(c, tuple) and c[0] == "ack"]
        self.assertEqual(acks[0], acks[1])

    def test_recovery_without_checkpoint_cannot_claim(self):
        self.assertEqual(deliver_once(self.transport, self.journal, recover_only=True), "nothing_to_recover")
        self.assertEqual(self.transport.calls, ["auth"])

    def test_recovery_with_unsubmitted_claim_never_writes(self):
        self.transport.lost_apply = True
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        self.transport.committed = None
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal, recover_only=True)
        self.assertEqual(self.transport.calls.count("apply"), 1)

    def test_expired_claim_only_looks_up_receipt(self):
        self.transport.item["expiresAt"] = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        self.assertNotIn("apply", self.transport.calls)
        self.transport.committed = receipt(self.transport.item)
        self.assertEqual(deliver_once(self.transport, self.journal, recover_only=True), "delivered")

    def test_revoked_business_access_blocks_resumed_connector_calls(self):
        self.transport.lost_apply = True
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        self.transport.revoked = True
        before = list(self.transport.calls)
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        self.assertNotIn("lookup", self.transport.calls[len(before):])

    def test_conflicts_are_terminal_and_do_not_claim_delivery(self):
        for error in ("row_identity_conflict", "revision_conflict", "headers_conflict"):
            with self.subTest(error=error):
                self.transport.conflict = error
                self.assertEqual(deliver_once(self.transport, self.journal), "conflict")
        self.assertNotIn("apply", self.transport.calls)

    def test_busy_and_unknown_provider_failures_keep_checkpoint_unconfirmed(self):
        for error in ("busy", "unconfirmed", "PRIVATE_RAW_ERROR"):
            with self.subTest(error=error):
                self.transport.conflict = error
                with self.assertRaises(WritebackError) as caught:
                    deliver_once(self.transport, self.journal)
                self.assertNotIn(error, str(caught.exception))
                self.assertEqual(self.journal.read()["state"], "claimed")

    def test_disk_failure_before_claim_prevents_network_dispatch(self):
        with patch.object(self.journal, "write", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                deliver_once(self.transport, self.journal)
        self.assertEqual(self.transport.calls, ["auth"])

    def test_disk_failure_after_commit_does_not_repeat_the_write(self):
        save = self.journal.write
        def fail_result(value):
            if value["state"] == "result_ready":
                raise OSError("disk")
            return save(value)
        with patch.object(self.journal, "write", side_effect=fail_result):
            with self.assertRaises(OSError):
                deliver_once(self.transport, self.journal)
        self.assertEqual(self.journal.read()["state"], "claimed")
        self.assertEqual(deliver_once(self.transport, self.journal, recover_only=True), "delivered")
        self.assertEqual(self.transport.calls.count("apply"), 1)

    def test_offline_cli_does_not_prompt_authenticate_or_touch_a_sheet(self):
        config_path = Path(self.temp.name) / "connection.json"
        config_path.write_bytes(canonical({**CONFIG, "enabled": False}))
        with patch("sys.argv", ["sheet_writeback.py", "--config", str(config_path)]), patch("builtins.input") as prompt, \
                patch.object(WritebackTransport, "sign_in") as sign_in, patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(main(), 0)
            self.assertEqual(json.loads(output.getvalue())["network_requests"], 0)
            prompt.assert_not_called()
            sign_in.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_cli_refuses_enabled_execution_without_confirmation(self):
        config_path = Path(self.temp.name) / "connection.json"
        config_path.write_bytes(canonical(CONFIG))
        with patch("sys.argv", ["sheet_writeback.py", "--config", str(config_path), "--execute", "--sign-in"]), \
                patch("builtins.input") as prompt, patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit):
                main()
            prompt.assert_not_called()

    def test_empty_claim_settles_without_connector(self):
        self.transport.item = None
        self.assertEqual(deliver_once(self.transport, self.journal), "idle")
        self.assertEqual(self.journal.read()["state"], "settled")
        self.assertNotIn("lookup", self.transport.calls)

    def test_other_business_operator_endpoint_or_secret_cannot_inherit_checkpoint(self):
        self.transport.lost_apply = True
        with self.assertRaises(WritebackError):
            deliver_once(self.transport, self.journal)
        for key, value in (("organization_id", USER), ("operator_id", ORG), ("connector_token", "x" * 40),
                           ("connector_url", "https://script.google.com/macros/s/other/exec")):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    WritebackJournal(self.path, {**CONFIG, key: value}).read()

    def test_receipt_is_exactly_bound_to_org_intent_operation_and_count(self):
        item = job()
        good = receipt(item)
        self.assertEqual(validate_receipt(good, item, CONFIG), good)
        for key, value in (("organizationId", USER), ("operationId", USER), ("intentHash", "0" * 64), ("rowCount", True),
                           ("version", True), ("tab", "Auto Listing"), ("committedAt", "not-a-date")):
            with self.subTest(key=key):
                with self.assertRaises(WritebackError):
                    validate_receipt({**good, key: value}, item, CONFIG)

    def test_configuration_refuses_arbitrary_endpoints_privileged_keys_and_coercions(self):
        self.assertEqual(validate_config(CONFIG), CONFIG)
        for key, value in (("supabase_url", "http://localhost"), ("supabase_url", CONFIG["supabase_url"] + "/other"),
                           ("connector_url", "https://script.google.com.evil.test/macros/s/f/exec"),
                           ("connector_url", CONFIG["connector_url"] + "?token=secret"), ("publishable_key", "sb_secret_" + "x" * 25),
                           ("enabled", 1), ("version", True), ("organization_id", "not-uuid")):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    validate_config({**CONFIG, key: value})

    def test_only_safe_columns_and_stable_update_identity_revision_are_accepted(self):
        self.assertEqual(validate_intent(INTENT), INTENT)
        update = {"action": "update_cells", "tab": "Auto Posting", "rowRef": "id:" + ROW,
                  "values": [{"Status": None, "__expected_revision": "1"}]}
        self.assertEqual(validate_intent(update), update)
        invalid = [dict(update, rowRef="A2"), dict(update, values=[{"Status": "Filled"}]),
                   dict(INTENT, values=[{"ND Row ID": ROW, "Password": "private"}]),
                   dict(INTENT, values=INTENT["values"] * 2), dict(INTENT, values=[{"ND Row ID": ROW, "Status": "a\nb"}])]
        for intent in invalid:
            with self.subTest(intent=intent):
                with self.assertRaises(ValueError):
                    validate_intent(intent)

    def test_duplicate_private_json_keys_are_refused(self):
        self.path.parent.mkdir()
        self.path.write_text('{"enabled":false,"enabled":true}')
        with self.assertRaises(ValueError):
            load_private(self.path)


def token(role="authenticated", user=USER):
    payload = base64.urlsafe_b64encode(json.dumps({"role": role, "sub": user}).encode()).decode().rstrip("=")
    return "header." + payload + ".fixture-signature"


class Response(io.BytesIO):
    def __init__(self, value):
        super().__init__(canonical(value))


class Opener:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        value = next(self.responses)
        if isinstance(value, Exception):
            raise value
        return Response(value)


class TransportTests(unittest.TestCase):
    def test_enrolled_mfa_requires_aal2_even_with_a_valid_password_session(self):
        user = {"id": USER, "email_confirmed_at": "2026-11-02", "factors": [{"status": "verified"}]}
        bridge = WritebackTransport(CONFIG, token(), Opener([user]))
        with self.assertRaises(WritebackError):
            bridge.verify_identity()
        payload = base64.urlsafe_b64encode(json.dumps({"role": "authenticated", "sub": USER, "aal": "aal2"}).encode()).decode().rstrip("=")
        bridge = WritebackTransport(CONFIG, "header." + payload + ".signature", Opener([user]))
        bridge.verify_identity()

    def test_password_login_targets_only_the_pinned_project_and_does_not_store_refresh(self):
        opener = Opener([{"token_type": "bearer", "access_token": token(), "refresh_token": "PRIVATE_REFRESH",
                          "user": {"id": USER, "email_confirmed_at": "2026-11-02"}}])
        bridge = WritebackTransport.sign_in(CONFIG, "fixture@example.test", "PRIVATE_PASSWORD", opener)
        self.assertEqual(bridge.token, token())
        self.assertNotIn("PRIVATE_REFRESH", str(vars(bridge)))
        self.assertEqual(opener.requests[0].full_url, CONFIG["supabase_url"] + "/auth/v1/token?grant_type=password")
        self.assertIsNone(opener.requests[0].get_header("Authorization"))

    def test_password_login_refuses_unverified_or_different_operator(self):
        for user in ({"id": ORG, "email_confirmed_at": "2026-11-02"}, {"id": USER}):
            opener = Opener([{"token_type": "bearer", "access_token": token(), "user": user}])
            with self.assertRaises(WritebackError):
                WritebackTransport.sign_in(CONFIG, "fixture@example.test", "PRIVATE_PASSWORD", opener)

    def test_password_login_never_follows_redirects_or_echoes_provider_errors(self):
        redirect = HTTPError(CONFIG["supabase_url"], 302, "PRIVATE_ERROR", {"Location": "https://evil.test"}, io.BytesIO())
        opener = Opener([redirect])
        with self.assertRaises(WritebackError) as caught:
            WritebackTransport.sign_in(CONFIG, "fixture@example.test", "PRIVATE_PASSWORD", opener)
        self.assertEqual(len(opener.requests), 1)
        self.assertNotIn("PRIVATE", str(caught.exception))


class BoundedDeliveryTests(unittest.TestCase):
    def test_default_delivers_only_one_intent(self):
        with patch("sheet_writeback.deliver_once", return_value="delivered") as once:
            self.assertEqual(deliver_bounded(None, None), {"state": "intent_limit_reached", "delivered": 1})
            once.assert_called_once()

    def test_conflict_stops_a_batch_before_the_next_dependency(self):
        with patch("sheet_writeback.deliver_once", side_effect=["delivered", "conflict"]) as once:
            self.assertEqual(deliver_bounded(None, None, maximum=20), {"state": "stopped_on_conflict", "delivered": 1})
            self.assertEqual(once.call_count, 2)

    def test_watch_expires_without_waiting_forever_or_dispatching_after_deadline(self):
        clock = [0]
        def sleep(seconds):
            self.assertLessEqual(seconds, 30); clock[0] += seconds
        with patch("sheet_writeback.deliver_once", return_value="idle") as once:
            self.assertEqual(deliver_bounded(None, None, watch_minutes=1, monotonic=lambda: clock[0], sleep=sleep), {"state": "watch_window_ended", "delivered": 0})
            self.assertEqual(once.call_count, 2)

    def test_unbounded_arguments_never_invoke_delivery(self):
        with patch("sheet_writeback.deliver_once") as once:
            for maximum, minutes in ((21, 0), (1, 481), (True, 0)):
                with self.assertRaises(ValueError):
                    deliver_bounded(None, None, maximum, minutes)
            once.assert_not_called()

class TransportBoundaryTests(unittest.TestCase):
    def test_privileged_or_wrong_user_token_cannot_be_sent(self):
        for value in (token("service_role"), token(user=ORG), "sb_secret_" + "x" * 40):
            with self.assertRaises(WritebackError):
                WritebackTransport(CONFIG, value)

    def test_auth_user_is_checked_live_not_trusted_from_jwt(self):
        opener = Opener([{"id": ORG, "email_confirmed_at": "2026-11-02"}])
        bridge = WritebackTransport(CONFIG, token(), opener)
        with self.assertRaises(WritebackError):
            bridge.verify_identity()
        self.assertEqual(opener.requests[0].get_header("Authorization"), "Bearer " + token())

    def test_only_google_response_redirect_is_followed_without_body_or_headers(self):
        location = "https://script.googleusercontent.com/macros/echo?user_content_key=fixture"
        redirect = HTTPError(CONFIG["connector_url"], 302, "redirect", {"Location": location}, io.BytesIO())
        opener = Opener([redirect, {"ok": False, "error": "not_found"}])
        transport = WritebackTransport(CONFIG, token(), opener)
        transport.connector(job(), lookup=True)
        self.assertEqual(opener.requests[1].full_url, location)
        self.assertEqual(opener.requests[1].method, "GET")
        self.assertIsNone(opener.requests[1].data)
        self.assertIsNone(opener.requests[1].get_header("Authorization"))
        self.assertNotIn(CONFIG["connector_token"], str(opener.requests[1].headers))

    def test_redirects_to_unknown_hosts_and_supabase_redirects_are_refused(self):
        for location in ("https://evil.test/echo", "http://script.googleusercontent.com/macros/echo", "https://script.googleusercontent.com/other"):
            redirect = HTTPError(CONFIG["connector_url"], 302, "redirect", {"Location": location}, io.BytesIO())
            opener = Opener([redirect])
            with self.assertRaises(WritebackError):
                WritebackTransport(CONFIG, token(), opener).connector(job())
            self.assertEqual(len(opener.requests), 1)

    def test_raw_provider_bodies_do_not_escape_errors(self):
        error = HTTPError("https://fixture.invalid", 403, "PRIVATE", {}, io.BytesIO(b"PRIVATE_KEY"))
        transport = WritebackTransport(CONFIG, token(), Opener([error]))
        with self.assertRaises(WritebackError) as caught:
            transport.verify_identity()
        self.assertNotIn("PRIVATE", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
