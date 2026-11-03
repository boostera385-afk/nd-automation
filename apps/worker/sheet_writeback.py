"""Opt-in, one-intent Sheet deliverer using verified staff Auth, never service keys.

Default invocation validates local configuration only. Execution and recovery are
explicit; no daemon, browser profile, password storage or automatic claim loop.
"""

import argparse
import base64
import getpass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import warnings
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler
from uuid import UUID, uuid4

from local_incogniton import NoRedirect
from worker_state import execution_lock as monitoring_lock, state_directory

SAFE_COLUMNS = {"Profile Name", "Post link", "Status", "Post Text", "Title"}
CONFLICTS = {"operation_conflict", "row_identity_conflict", "revision_conflict", "column_not_allowed",
             "headers_conflict", "tab_not_allowed", "invalid_intent", "sheet_bounds", "sheet_not_found"}


class WritebackError(RuntimeError):
    """Safe diagnostic only; never contains remote error bodies or private values."""


def uid(value):
    if not isinstance(value, str):
        raise ValueError("A canonical UUID is required")
    parsed = UUID(value)
    if str(parsed) != value or parsed.variant != "specified in RFC 4122" or parsed.version not in range(1, 9):
        raise ValueError("A canonical UUID is required")
    return value


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def load_private(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 100000:
        raise ValueError("Expected a bounded ordinary private JSON file")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON keys are not allowed")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def validate_config(value):
    keys = {"version", "enabled", "supabase_url", "publishable_key", "organization_id", "operator_id", "connector_url", "connector_token"}
    if not isinstance(value, dict) or set(value) != keys or type(value["version"]) is not int or value["version"] != 1 or type(value["enabled"]) is not bool:
        raise ValueError("Invalid writeback configuration")
    origin = urlsplit(value["supabase_url"])
    if (origin.scheme != "https" or not origin.hostname or not re.fullmatch(r"[a-z0-9]{20}\.supabase\.co", origin.hostname)
            or origin.netloc != origin.hostname or origin.path not in {"", "/"} or origin.query or origin.fragment):
        raise ValueError("A hosted Supabase project HTTPS origin is required")
    endpoint = urlsplit(value["connector_url"])
    if (endpoint.scheme != "https" or endpoint.netloc != "script.google.com" or not re.fullmatch(r"/macros/s/[A-Za-z0-9_-]+/exec", endpoint.path)
            or endpoint.query or endpoint.fragment):
        raise ValueError("A Google Apps Script HTTPS /exec deployment is required")
    if not isinstance(value["publishable_key"], str) or not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{8,200}", value["publishable_key"]):
        raise ValueError("Use a publishable key, never a secret/service-role key")
    token = value["connector_token"]
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,200}", token):
        raise ValueError("A private random connector token of 32+ characters is required")
    uid(value["organization_id"])
    uid(value["operator_id"])
    return {**value, "supabase_url": value["supabase_url"].rstrip("/")}


def validate_intent(intent):
    if not isinstance(intent, dict) or set(intent) != {"action", "tab", "rowRef", "values"}:
        raise ValueError("Invalid writeback intent")
    if intent["action"] not in {"append", "update_cells"} or intent["tab"] not in {"Auto Posting", "Auto Listing"}:
        raise ValueError("Unsupported writeback action or tab")
    values = intent["values"]
    if not isinstance(values, list) or not 1 <= len(values) <= 50:
        raise ValueError("Writeback rows exceed the allowed bound")
    if intent["action"] == "append":
        if intent["rowRef"] is not None:
            raise ValueError("Append does not accept a row reference")
    else:
        ref = intent["rowRef"]
        if not isinstance(ref, str) or not ref.startswith("id:") or len(values) != 1:
            raise ValueError("Updates require one stable id:UUID reference, never an A1 row number")
        uid(ref[3:])
    ids = []
    for row in values:
        if not isinstance(row, dict) or not row or len(row) > 100:
            raise ValueError("Invalid row values")
        special = "ND Row ID" if intent["action"] == "append" else "__expected_revision"
        if special not in row or not (set(row) & SAFE_COLUMNS) or not set(row) <= SAFE_COLUMNS | {special}:
            raise ValueError("Only approved non-secret columns and explicit row identity/revision are supported")
        if intent["action"] == "append":
            ids.append(uid(row[special]))
        elif not isinstance(row[special], str) or not re.fullmatch(r"[1-9][0-9]{0,8}", row[special]):
            raise ValueError("An exact expected row revision is required")
        for cell in row.values():
            if cell is not None and (not isinstance(cell, str) or len(cell) > 4000 or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in cell)):
                raise ValueError("Invalid or oversized text cell")
    if len(set(ids)) != len(ids) or len(canonical(intent)) > 65536:
        raise ValueError("Duplicate row IDs or oversized writeback payload")
    return intent


def intent_hash(intent):
    return hashlib.sha256(canonical(validate_intent(intent))).hexdigest()


def validate_claim(item):
    if not isinstance(item, dict) or set(item) != {"id", "seq", "intent", "leaseToken", "expiresAt", "attempts"}:
        raise ValueError("Invalid writeback claim")
    uid(item["id"])
    uid(item["leaseToken"])
    if type(item["seq"]) is not int or item["seq"] < 1 or type(item["attempts"]) is not int or not 1 <= item["attempts"] <= 5:
        raise ValueError("Invalid writeback sequence/attempts")
    stamp = datetime.fromisoformat(item["expiresAt"].replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("Writeback lease needs an explicit timezone")
    validate_intent(item["intent"])
    return item


def remaining(item):
    return (datetime.fromisoformat(item["expiresAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds()


def validate_receipt(value, item, config):
    keys = {"version", "organizationId", "operationId", "intentHash", "tab", "rowCount", "committedAt"}
    if (not isinstance(value, dict) or set(value) != keys or type(value["version"]) is not int or value["version"] != 1
            or value["organizationId"] != config["organization_id"] or value["operationId"] != item["id"]
            or value["intentHash"] != intent_hash(item["intent"]) or value["tab"] != item["intent"]["tab"]
            or type(value["rowCount"]) is not int or value["rowCount"] != len(item["intent"]["values"])):
        raise WritebackError("Connector receipt does not match this exact intent; preserve its checkpoint")
    try:
        stamp = datetime.fromisoformat(value["committedAt"].replace("Z", "+00:00"))
        if stamp.tzinfo is None or (stamp - datetime.now(timezone.utc)).total_seconds() > 60:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise WritebackError("Connector receipt timestamp is invalid") from None
    return value


class WritebackTransport:
    @classmethod
    def sign_in(cls, config, email, password, opener=None):
        config = validate_config(config)
        if not isinstance(email, str) or not 3 <= len(email) <= 320 or "@" not in email or not isinstance(password, str) or not 1 <= len(password) <= 4096:
            raise WritebackError("Enter valid operator credentials in the private local terminal")
        opener = opener or build_opener(ProxyHandler({}), NoRedirect())
        request = Request(config["supabase_url"] + "/auth/v1/token?grant_type=password", method="POST",
                          headers={"Content-Type": "application/json", "apikey": config["publishable_key"]},
                          data=canonical({"email": email, "password": password}))
        try:
            with opener.open(request, timeout=25) as response:
                raw = response.read(100001)
                if len(raw) > 100000:
                    raise ValueError()
                session = json.loads(raw)
            if (not isinstance(session, dict) or session.get("token_type") != "bearer" or
                    not isinstance(session.get("user"), dict) or session["user"].get("id") != config["operator_id"] or
                    not session["user"].get("email_confirmed_at")):
                raise ValueError()
            # Only the short-lived access token survives in process memory. Never
            # write passwords/refresh tokens, extract browser sessions, or bypass MFA.
            return cls(config, session["access_token"], opener)
        except (HTTPError, URLError, OSError, ValueError, KeyError, TypeError):
            raise WritebackError("Sign-in was not verified; check credentials, email verification or required MFA with your administrator") from None

    def __init__(self, config, access_token, opener=None):
        self.config = validate_config(config)
        if not isinstance(access_token, str) or not 32 <= len(access_token) <= 8192 or any(c.isspace() for c in access_token) or access_token.startswith(("sb_secret_", "sbp_")):
            raise WritebackError("A private staff access token is required in the named environment variable")
        try:
            payload = access_token.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if claims.get("role") != "authenticated" or claims.get("sub") != config["operator_id"]:
                raise ValueError()
        except (ValueError, IndexError, TypeError, AttributeError):
            raise WritebackError("Use the configured operator's authenticated user token, never a service token") from None
        self.token = access_token
        self.aal = claims.get("aal", "aal1")
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirect())

    def request(self, url, data=None, auth=False, connector=False):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers.update({"apikey": self.config["publishable_key"], "Authorization": "Bearer " + self.token})
        request = Request(url, data=canonical(data) if data is not None else None, headers=headers, method="POST" if data is not None else "GET")
        try:
            try:
                response = self.opener.open(request, timeout=25)
            except HTTPError as error:
                # Apps Script ContentService redirects to a response-only URL.
                # Never forward the POST, token or Auth headers to that URL.
                location = error.headers.get("Location", "")
                target = urlsplit(location)
                if (not connector or error.code not in {302, 303} or target.scheme != "https"
                        or target.netloc != "script.googleusercontent.com" or target.path != "/macros/echo" or target.fragment):
                    error.close()
                    raise WritebackError("Writeback transport rejected an HTTP response/redirect; outcome is unconfirmed") from None
                error.close()
                response = self.opener.open(Request(location, method="GET"), timeout=25)
            with response:
                raw = response.read(100001)
                if len(raw) > 100000:
                    raise WritebackError("Writeback response exceeded its bound")
                return json.loads(raw)
        except (HTTPError, URLError, OSError, ValueError):
            raise WritebackError("Writeback request failed; preserve the checkpoint and reconcile before retrying") from None

    def verify_identity(self):
        user = self.request(self.config["supabase_url"] + "/auth/v1/user", auth=True)
        if not isinstance(user, dict) or user.get("id") != self.config["operator_id"] or not user.get("email_confirmed_at"):
            raise WritebackError("The configured verified operator could not be authenticated")
        factors = user.get("factors", [])
        if not isinstance(factors, list) or any(not isinstance(factor, dict) for factor in factors):
            raise WritebackError("The operator's MFA state could not be verified")
        if any(factor.get("status") == "verified" for factor in factors) and self.aal != "aal2":
            raise WritebackError("An MFA-verified user token is required; password-only sign-in is insufficient")
        # Every claim/ack additionally enforces current verified staff membership
        # for the pinned organization in the existing database RPCs.

    def rpc(self, method, params):
        if method not in {"reporting_claim_sheet_writeback_v1", "reporting_ack_sheet_writeback_v1"}:
            raise WritebackError("Writeback RPC is not allowlisted")
        return self.request(self.config["supabase_url"] + "/rest/v1/rpc/" + method,
                            {**params, "org": self.config["organization_id"]}, auth=True)

    def connector(self, item, lookup=False):
        return self.request(self.config["connector_url"], {"version": 1, "action": "lookupWrite" if lookup else "applyWrite",
            "token": self.config["connector_token"], "organizationId": self.config["organization_id"],
            "operationId": item["id"], "intentHash": intent_hash(item["intent"]), "intent": item["intent"]}, connector=True)


class WritebackJournal:
    def __init__(self, path, config):
        self.path = Path(path)
        self.scope = hashlib.sha256(canonical({key: config[key] for key in ("supabase_url", "organization_id", "operator_id", "connector_url", "connector_token")})).hexdigest()

    def read(self):
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Unsafe writeback checkpoint location")
        if not self.path.exists():
            return None
        value = load_private(self.path)
        if (not isinstance(value, dict) or set(value) != {"version", "scope", "state", "request", "item", "result", "ackRequest"}
                or type(value["version"]) is not int or value["version"] != 1 or value["scope"] != self.scope
                or value["state"] not in {"requesting", "claimed", "result_ready", "settled"}):
            raise ValueError("Writeback checkpoint scope/state conflict; preserve the file")
        uid(value["request"])
        uid(value["ackRequest"])
        if value["state"] in {"claimed", "result_ready"}:
            validate_claim(value["item"])
        elif value["item"] is not None:
            raise ValueError("Unexpected writeback checkpoint content")
        if value["state"] == "result_ready":
            result = value["result"]
            if not isinstance(result, dict) or set(result) != {"outcome", "receipt", "detail"} or result["outcome"] not in {"delivered", "conflict"}:
                raise ValueError("Invalid writeback checkpoint result")
            if result["outcome"] == "conflict" and (result["receipt"] is not None or result["detail"] not in CONFLICTS):
                raise ValueError("Invalid writeback conflict result")
        elif value["result"] is not None:
            raise ValueError("Unexpected writeback result")
        return value

    def write(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError("Unsafe writeback checkpoint location")
        data = canonical(value)
        if len(data) > 100000:
            raise ValueError("Writeback checkpoint exceeded its bound")
        descriptor, name = tempfile.mkstemp(prefix=".writeback-", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def settle(self, value):
        # Remove customer text after authoritative acknowledgment; retain only
        # request/scope metadata. Access/connector tokens were never stored here.
        self.write({**value, "state": "settled", "item": None, "result": None})


def deliver_once(transport, journal, recover_only=False):
    config = transport.config
    if config["enabled"] is not True:
        raise WritebackError("Writeback delivery is disabled in the private local configuration")
    saved = journal.read()
    transport.verify_identity()
    if not saved or saved["state"] == "settled":
        if recover_only:
            return "nothing_to_recover"
        saved = {"version": 1, "scope": journal.scope, "state": "requesting", "request": str(uuid4()),
                 "item": None, "result": None, "ackRequest": str(uuid4())}
        journal.write(saved)  # Claim request ID is durable BEFORE the network call.
    if saved["state"] == "requesting":
        claimed = transport.rpc("reporting_claim_sheet_writeback_v1", {"batch_limit": 1, "request_id": saved["request"]})
        if not isinstance(claimed, list) or len(claimed) > 1:
            raise WritebackError("Writeback claim response is invalid; preserve its request checkpoint")
        if not claimed:
            journal.settle(saved)
            return "idle"
        # A legacy, unsupported intent stays checkpointed for human reconciliation.
        # Never silently skip a pending row and process a later one instead.
        validate_claim(claimed[0])
        saved = {**saved, "state": "claimed", "item": claimed[0]}
        journal.write(saved)
    item = saved["item"]
    if saved["state"] == "claimed":
        # Recheck current verified staff membership even when resuming a saved
        # claim; /auth/user alone does not establish business authorization.
        replay = transport.rpc("reporting_claim_sheet_writeback_v1", {"batch_limit": 1, "request_id": saved["request"]})
        if replay != [item]:
            raise WritebackError("Claim replay differs from the durable checkpoint; stop for reconciliation")
        response = transport.connector(item, lookup=True)
        if response == {"ok": False, "error": "not_found"}:
            # Allow enough time for the connector's bounded lock/network work and
            # the acknowledgment. Old claims may LOOK UP a receipt, never write.
            if not 65 <= remaining(item) <= 150:
                raise WritebackError("The unconfirmed claim lease cannot safely authorize another write; reconcile it")
            if recover_only:
                raise WritebackError("No committed receipt exists; recovery never performs a Sheet write")
            response = transport.connector(item)
        if not isinstance(response, dict):
            raise WritebackError("Connector response is invalid; outcome is unconfirmed")
        if set(response) == {"ok", "receipt"} and response["ok"] is True:
            result = {"outcome": "delivered", "receipt": validate_receipt(response["receipt"], item, config), "detail": None}
        elif set(response) == {"ok", "error"} and response["ok"] is False and response["error"] in CONFLICTS:
            result = {"outcome": "conflict", "receipt": None, "detail": response["error"]}
        else:
            raise WritebackError("Connector did not confirm a commit or bounded conflict; preserve the checkpoint")
        saved = {**saved, "state": "result_ready", "result": result}
        journal.write(saved)  # Completion is durable BEFORE acknowledging upstream.
    result = saved["result"]
    if result["outcome"] == "delivered":
        validate_receipt(result["receipt"], item, config)
        if result["detail"] is not None:
            raise WritebackError("Invalid saved delivery result")
    ack = transport.rpc("reporting_ack_sheet_writeback_v1", {"item_id": item["id"], "lease_token": item["leaseToken"],
        **result, "request_id": saved["ackRequest"]})
    if not isinstance(ack, dict) or ack != {"id": item["id"], "status": result["outcome"]}:
        raise WritebackError("Writeback acknowledgment is unconfirmed; only replay this saved result")
    journal.settle(saved)
    return result["outcome"]


def deliver_bounded(transport, journal, maximum=1, watch_minutes=0, monotonic=time.monotonic, sleep=time.sleep):
    if type(maximum) is not int or not 1 <= maximum <= 20 or type(watch_minutes) is not int or not 0 <= watch_minutes <= 480:
        raise ValueError("Delivery must be bounded to 1–20 intents and at most eight hours")
    deadline = monotonic() + watch_minutes * 60 if watch_minutes else None
    delivered = 0
    while delivered < maximum:
        if deadline is not None and monotonic() >= deadline:
            return {"state": "watch_window_ended", "delivered": delivered}
        state = deliver_once(transport, journal)
        if state == "conflict":
            return {"state": "stopped_on_conflict", "delivered": delivered}
        if state == "idle":
            if deadline is None:
                return {"state": "idle", "delivered": delivered}
            pause = min(30, max(0, deadline - monotonic()))
            if pause:
                sleep(pause)
        else:
            delivered += 1
    return {"state": "intent_limit_reached", "delivered": delivered}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Private local configuration; never commit it")
    parser.add_argument("--access-token-env", default="ND_WRITEBACK_ACCESS_TOKEN", help="Name of an environment variable, never its value")
    parser.add_argument("--sign-in", action="store_true", help="Prompt locally for staff email/password; never saved or passed as command arguments")
    parser.add_argument("--execute", action="store_true", help="Deliver at most one explicitly queued intent")
    parser.add_argument("--recover-results", action="store_true", help="Lookup/replay a saved receipt only, never write a Sheet")
    parser.add_argument("--confirm-authorized", action="store_true")
    parser.add_argument("--max-intents", type=int, default=1, help="Explicit cap 1–20; each claim is still exactly one intent")
    parser.add_argument("--watch-minutes", type=int, default=0, help="Opt-in bounded polling for 0–480 minutes")
    parser.add_argument("--confirm-batch", action="store_true")
    args = parser.parse_args()
    try:
        config = validate_config(load_private(args.config))
        if not 1 <= args.max_intents <= 20 or not 0 <= args.watch_minutes <= 480:
            parser.error("Choose 1–20 intents and 0–480 watch minutes")
        if args.execute and args.recover_results:
            parser.error("Choose execution or receipt-only recovery, not both")
        if args.recover_results and (args.max_intents != 1 or args.watch_minutes):
            parser.error("Receipt-only recovery cannot run/watch a batch")
        if not args.execute and not args.recover_results:
            print(json.dumps({"mode": "offline_preflight", "configuration_valid": True, "enabled": config["enabled"], "network_requests": 0, "sheet_writes": 0}))
            return 0
        if not args.confirm_authorized:
            parser.error("Execution/recovery requires explicit --confirm-authorized")
        if (args.max_intents > 1 or args.watch_minutes) and not args.confirm_batch:
            parser.error("Multiple intents or watching also require --confirm-batch")
        if config["enabled"] is not True:
            raise WritebackError("Delivery is disabled; no sign-in was attempted")
        state = state_directory()
        with monitoring_lock(state / "writeback.lock"):
            if args.sign_in:
                # Refuse getpass's echoing fallback in terminals that cannot hide
                # input. A password must never become visible in terminal logs.
                with warnings.catch_warnings():
                    warnings.simplefilter("error", getpass.GetPassWarning)
                    email = input("Verified staff email: ").strip()
                    password = getpass.getpass("Password (not saved): ")
                try:
                    transport = WritebackTransport.sign_in(config, email, password)
                finally:
                    password = None  # Not a guarantee of zeroization in Python.
            else:
                transport = WritebackTransport(config, os.environ.get(args.access_token_env, ""))
            journal = WritebackJournal(state / "writeback-journal.json", config)
            result = ({"state": deliver_once(transport, journal, recover_only=True)} if args.recover_results
                      else deliver_bounded(transport, journal, args.max_intents, args.watch_minutes))
        print(json.dumps({**result, "browser_operations": 0}))
        return 0
    except (ValueError, TypeError, KeyError, OSError, EOFError, getpass.GetPassWarning, WritebackError):
        # Config paths, raw exceptions and server bodies may contain private data.
        print(json.dumps({"state": "blocked", "message": "Writeback is unconfirmed or configuration/authorization is invalid. Preserve the private checkpoint, review the setup guide and reconcile before retrying."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
