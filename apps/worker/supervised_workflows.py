"""Separate one-step supervised account/content runner. Never a monitoring job.

Local plans pin exact reviewed manifests and selectors. Identity/location/OTP
challenges stop for a person; passwords, identity data and selectors stay local.
Each mutation is attempted at most once. A durable claim blocks crash replay.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit

from agent import WorkerBridge, recover_result
from automation_journal import AutomationJournal, recover_automation
from automation_tasks import validate_task
from local_incogniton import Incogniton, ProfileUnavailable, debug_endpoint
from monitoring import canonical_post_url, is_account_disabled
from monitoring_journal import MonitoringJournal
from publishing_journal import PublishingJournal
from publishing_protocol import account_url, uuid, validate_job as validate_publish_job
from publisher import normalized, one, fill_checked, check_text
from sheet_writeback import load_private
from worker_connection import validate_connection
from worker_lock import monitoring_lock

OPERATIONS = {"account_register", "account_login", "account_inspect", "profile_browse", "post_edit", "post_delete", "account_block"}
MANIFEST = {"version", "operation", "binding_id", "profile_id", "customer_id", "account_label", "account_url",
            "target_url", "expected_body_sha256", "draft_id", "draft_revision", "consent"}
BASE_SELECTORS = {"account", "login", "challenge", "disabled"}
POST_SELECTORS = {"post_root", "post_link", "post_author", "post_body", "post_media"}
EDIT_SELECTORS = {"edit_open", "edit_root", "body", "title", "price", "category", "audience", "submit",
                  "result_title", "result_price", "result_category", "result_audience"}


def body_hash(text):
    return hashlib.sha256(normalized(text).encode()).hexdigest()


def validate_manifest(value):
    if not isinstance(value, dict) or set(value) != MANIFEST or type(value["version"]) is not int or value["version"] != 1 or value["consent"] is not True:
        raise ValueError("Exact reviewed workflow manifest required")
    operation = value["operation"]
    if not isinstance(operation, str) or operation not in OPERATIONS:
        raise ValueError("Unsupported workflow operation")
    for key in ("binding_id", "profile_id", "customer_id"):
        if uuid(value[key]) != value[key]:
            raise ValueError("Lowercase canonical workflow UUID required")
    if not isinstance(value["account_label"], str) or not 1 <= len(value["account_label"].strip()) <= 120:
        raise ValueError("Exact account label required")
    if operation == "account_register":
        if value["account_url"] is not None:
            raise ValueError("An uncreated account has no verified profile URL")
    elif account_url(value["account_url"]) != value["account_url"].rstrip("/") or not value["account_url"].startswith("https://nextdoor.com/"):
        raise ValueError("Canonical exact account identity required")
    if operation in {"post_edit", "post_delete"}:
        if canonical_post_url(value["target_url"]) != value["target_url"] or not re.fullmatch(r"[a-f0-9]{64}", value["expected_body_sha256"] or ""):
            raise ValueError("Exact publication and reviewed source fingerprint required")
    elif operation == "account_block":
        if account_url(value["target_url"]) != value["target_url"].rstrip("/") or account_url(value["target_url"]) == account_url(value["account_url"]):
            raise ValueError("Exact distinct moderation target required")
        if value["expected_body_sha256"] is not None:
            raise ValueError("Unexpected source-body fingerprint")
    elif value["target_url"] is not None or value["expected_body_sha256"] is not None:
        raise ValueError("Unexpected workflow target")
    if operation == "post_edit":
        uuid(value["draft_id"])
        if type(value["draft_revision"]) is not int or not 1 <= value["draft_revision"] <= 999999999:
            raise ValueError("Exact approved edit revision required")
    elif value["draft_id"] is not None or value["draft_revision"] is not None:
        raise ValueError("Unexpected draft revision")
    return value


def validate_plan(plan):
    if not isinstance(plan, dict) or set(plan) != {"manifest", "reviewed", "selectors", "values"} or plan["reviewed"] is not True:
        raise ValueError("A private locally reviewed workflow plan is required")
    manifest = validate_manifest(plan["manifest"])
    operation = manifest["operation"]
    expected = set(BASE_SELECTORS)
    if operation in {"account_register", "account_login"}:
        expected |= {"form", "email", "password", "submit"}
        if operation == "account_register":
            expected |= {"first_name", "last_name"}
        values = plan["values"]
        fields = {"email", "password"} | ({"first_name", "last_name", "genuine_identity_confirmed"} if operation == "account_register" else set())
        if not isinstance(values, dict) or set(values) != fields:
            raise ValueError("Supply only genuine local identity fields for this exact operation")
        if operation == "account_register" and values["genuine_identity_confirmed"] is not True:
            raise ValueError("Genuine identity confirmation required; no fallback names, dates or residence")
        for key in fields - {"genuine_identity_confirmed"}:
            if not isinstance(values[key], str) or not 1 <= len(values[key]) <= (256 if key == "password" else 254) or any(ord(c) < 32 for c in values[key]):
                raise ValueError("Invalid local identity fields")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["email"]):
            raise ValueError("An operator-supplied email is required")
    elif plan["values"] != {}:
        raise ValueError("This operation accepts no local credential or identity values")
    if operation in {"post_edit", "post_delete"}:
        expected |= POST_SELECTORS
    if operation == "post_edit":
        expected |= EDIT_SELECTORS
    if operation in {"post_delete", "account_block"}:
        expected |= {"action_open", "dialog", "dialog_target", "confirm", "result", "result_target"}
    selectors = plan["selectors"]
    if not isinstance(selectors, dict) or set(selectors) != expected:
        raise ValueError("Incomplete reviewed workflow adapter")
    for selector in selectors.values():
        if not isinstance(selector, str) or not 1 <= len(selector) <= 500 or "\0" in selector:
            raise ValueError("Only bounded local selectors are supported")
    return plan


def visible(page, selector):
    nodes = page.locator(selector)
    if nodes.count() > 30:
        raise ValueError("Ambiguous adapter state")
    return any(node.is_visible() for node in nodes.all())


def exact_account(page, selectors, manifest):
    node = one(page, selectors["account"])
    if account_url(urljoin(page.url, node.get_attribute("href") or "")) != account_url(manifest["account_url"]) or normalized(node.inner_text()) != normalized(manifest["account_label"]):
        raise ValueError("Signed-in account differs from the exact authorized identity")


def exact_post(page, selectors, manifest, expected_body=None):
    root = one(page, selectors["post_root"])
    if canonical_post_url(urljoin(page.url, one(root, selectors["post_link"]).get_attribute("href") or "")) != manifest["target_url"]:
        raise ValueError("The selected post URL does not match")
    if account_url(urljoin(page.url, one(root, selectors["post_author"]).get_attribute("href") or "")) != account_url(manifest["account_url"]):
        raise ValueError("The selected post does not belong to the authorized account")
    body = one(root, selectors["post_body"]).inner_text()
    if (body_hash(body) != manifest["expected_body_sha256"] if expected_body is None else normalized(body) != normalized(expected_body)):
        raise ValueError("The selected post content changed after review")
    return root


def execute_workflow(task, plan, api, chromium, journal):
    validate_task(task, extra_kinds={"supervised_workflow"})
    if task["kind"] != "supervised_workflow" or set(task["payload"]) != {"manifest", "content"}:
        raise ValueError("Unexpected supervised task")
    validate_plan(plan)
    manifest = validate_manifest(task["payload"]["manifest"])
    if manifest != plan["manifest"]:
        raise ValueError("Queued authorization differs from the locally reviewed plan")
    content = task["payload"]["content"]
    if manifest["operation"] == "post_edit":
        if not isinstance(content, dict) or content.get("media"):
            raise ValueError("Only approved text edits are supported by this adapter")
        validate_publish_job({**content, "job_id": task["task_id"], "draft_id": manifest["draft_id"], "draft_revision": manifest["draft_revision"],
            "customer_id": manifest["customer_id"], "profile_id": manifest["profile_id"], "account_label": manifest["account_label"],
            "lease_token": task["lease_token"], "lease_expires_at": task["lease_expires_at"]})
    elif content is not None:
        raise ValueError("Unexpected queued content")
    # Only the public manifest/approved content enter the journal, never values.
    journal.begin(task)
    selectors, operation = plan["selectors"], manifest["operation"]
    fingerprint = hashlib.sha256(json.dumps(selectors, sort_keys=True).encode()).hexdigest()
    deadline = time.monotonic() + 240
    attempted, launched, cleanup, page = False, False, True, None
    outcome = "validation_error"

    def guard(allow_login=False):
        if time.monotonic() >= deadline:
            raise ValueError("Workflow execution budget exhausted")
        if visible(page, selectors["disabled"]) or is_account_disabled(page.url):
            raise ValueError("Account unavailable; human review required")
        if visible(page, selectors["challenge"]) or (not allow_login and visible(page, selectors["login"])):
            return False
        return True

    try:
        cleanup = False
        launch = api.launch(manifest["profile_id"]); launched = True
        browser = chromium.connect_over_cdp(debug_endpoint(launch), timeout=30000)
        if len(browser.contexts) != 1:
            raise ValueError("Expected one owned browser context")
        page = browser.contexts[0].new_page(); page.set_default_timeout(10000)
        def restrict(route):
            url = urlsplit(route.request.url)
            if route.request.is_navigation_request() and (url.scheme != "https" or url.hostname not in {"nextdoor.com", "www.nextdoor.com"}):
                route.abort()
            else:
                route.continue_()
        page.route("**/*", restrict)
        url = manifest["target_url"] or ("https://nextdoor.com/join/" if operation == "account_register" else "https://nextdoor.com/login/" if operation == "account_login" else "https://nextdoor.com/news_feed/")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if not guard(allow_login=operation in {"account_register", "account_login"}):
            outcome = "handoff_required"
        elif operation in {"account_register", "account_login"}:
            if visible(page, selectors["account"]):
                if operation == "account_register":
                    raise ValueError("An account is already signed in; registration refused")
                exact_account(page, selectors, manifest); outcome = "verified"
            else:
                form = one(page, selectors["form"])
                for field in ("first_name", "last_name", "email", "password") if operation == "account_register" else ("email", "password"):
                    fill_checked(form, selectors[field], plan["values"][field])
                for field in ("first_name", "last_name", "email", "password") if operation == "account_register" else ("email", "password"):
                    if one(form, selectors[field]).input_value() != plan["values"][field]:
                        raise ValueError("Local identity fields changed before submission")
                if not guard(allow_login=True):
                    outcome = "handoff_required"
                else:
                    attempted = True
                    one(form, selectors["submit"]).click(timeout=10000)
                    # Signup is deliberately one genuine-data step. No invented
                    # birth date/location, OTP entry, consent or preference clicks.
                    outcome = "handoff_required"
                    if operation == "account_login":
                        for _ in range(40):
                            if not guard(allow_login=True):
                                break
                            if visible(page, selectors["account"]):
                                exact_account(page, selectors, manifest); outcome = "verified"; break
                            page.wait_for_timeout(250)
        else:
            exact_account(page, selectors, manifest)
            if operation in {"account_inspect", "profile_browse"}:
                outcome = "verified"  # Account identity only, not post visibility.
                if operation == "profile_browse":
                    for _ in range(60):
                        if not guard():
                            outcome = "handoff_required"; break
                        exact_account(page, selectors, manifest)
                        page.wait_for_timeout(500)  # Bounded review only; no synthetic engagement.
            else:
                root = exact_post(page, selectors, manifest) if operation in {"post_edit", "post_delete"} else page
                if operation == "post_edit":
                    if visible(root, selectors["post_media"]):
                        raise ValueError("Existing attachments require a separately reviewed edit adapter")
                    one(root, selectors["edit_open"]).click(timeout=10000)
                    form = one(page, selectors["edit_root"])
                    fill_checked(form, selectors["body"], content["body"])
                    if content["kind"] == "listing":
                        fill_checked(form, selectors["title"], content["title"])
                        fill_checked(form, selectors["price"], f"{content['price_cents'] // 100}.{content['price_cents'] % 100:02d}")
                        one(form, selectors["category"]).select_option(label=content["category"])
                    # Preserve the exact reviewed audience; never broaden it.
                    one(form, selectors["audience"]).select_option(value=content["audience"])
                    check_text(form, selectors["body"], content["body"])
                    if one(form, selectors["audience"]).input_value() != content["audience"]:
                        raise ValueError("Edit audience changed")
                    if content["kind"] == "listing":
                        check_text(form, selectors["title"], content["title"])
                        check_text(form, selectors["price"], f"{content['price_cents'] // 100}.{content['price_cents'] % 100:02d}")
                        if normalized(one(form, selectors["category"]).locator("option:checked").inner_text()) != normalized(content["category"]):
                            raise ValueError("Edit category changed")
                    exact_account(page, selectors, manifest)
                    exact_post(page, selectors, manifest)
                    if not guard():
                        outcome = "handoff_required"
                    else:
                        attempted = True; one(form, selectors["submit"]).click(timeout=10000)
                        outcome = "needs_reconciliation"
                        for _ in range(40):
                            if not guard():
                                break
                            try:
                                result = exact_post(page, selectors, manifest, content["body"])
                                if normalized(one(result, selectors["result_audience"]).inner_text()) != content["audience"]:
                                    raise ValueError("Result audience mismatch")
                                if content["kind"] == "listing":
                                    for field, expected in (("result_title", content["title"]), ("result_category", content["category"]),
                                                            ("result_price", f"{content['price_cents'] // 100}.{content['price_cents'] % 100:02d}")):
                                        if normalized(one(result, selectors[field]).inner_text()) != normalized(expected):
                                            raise ValueError("Listing result differs")
                                outcome = "verified"; break
                            except ValueError:
                                page.wait_for_timeout(250)
                else:
                    if visible(page, selectors["result"]):
                        raise ValueError("Pre-existing result is not evidence of a new action")
                    one(root, selectors["action_open"]).click(timeout=10000)
                    dialog = one(page, selectors["dialog"])
                    target = urljoin(page.url, one(dialog, selectors["dialog_target"]).get_attribute("href") or "")
                    canonical = canonical_post_url if operation == "post_delete" else account_url
                    if canonical(target) != canonical(manifest["target_url"]):
                        raise ValueError("Destructive confirmation names a different target")
                    exact_account(page, selectors, manifest)
                    if operation == "post_delete":
                        exact_post(page, selectors, manifest)
                    if not guard():
                        outcome = "handoff_required"
                    else:
                        attempted = True; one(dialog, selectors["confirm"]).click(timeout=10000)
                        outcome = "needs_reconciliation"
                        for _ in range(40):
                            if not guard():
                                break
                            if visible(page, selectors["result"]):
                                result = one(page, selectors["result"])
                                if canonical(urljoin(page.url, one(result, selectors["result_target"]).get_attribute("href") or "")) == canonical(manifest["target_url"]):
                                    outcome = "verified"; break
                            page.wait_for_timeout(250)
    except ProfileUnavailable:
        cleanup = True; outcome = "profile_error"
    except Exception:
        outcome = "needs_reconciliation" if attempted else "validation_error"
    finally:
        if page is not None:
            try:
                page.close()
            except Exception:
                pass
        if launched:
            try:
                api.stop(manifest["profile_id"])
                cleanup = api.stopped(manifest["profile_id"]) is True
            except Exception:
                cleanup = False
    # KeyboardInterrupt/SystemExit skip this receipt, leaving claimed state.
    result = {"operation": operation, "outcome": outcome, "action_attempted": attempted, "cleanup_confirmed": cleanup,
              "adapter_sha256": fingerprint, "observed_at": datetime.now(timezone.utc).isoformat()}
    journal.record("succeeded", result, inspection_required=not cleanup or outcome == "needs_reconciliation")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized", action="store_true")
    parser.add_argument("--confirm-destructive", action="store_true")
    args = parser.parse_args(argv)
    connection = validate_connection(load_private(args.connection))
    plan = validate_plan(load_private(args.plan))
    if not args.execute:
        print(json.dumps({"mode": "offline_workflow_preflight", "operation": plan["manifest"]["operation"], "network_calls": 0, "live_accepted": False}))
        return 0
    if not args.confirm_authorized or (plan["manifest"]["operation"] in {"post_delete", "account_block"} and not args.confirm_destructive):
        parser.error("Execution requires explicit local authorization and destructive-target confirmation when applicable")
    from playwright.sync_api import sync_playwright
    state = Path(__file__).resolve().parent / ".worker-state"
    bridge = WorkerBridge(connection); journal = AutomationJournal(state / "automation-journal.json", connection)
    with monitoring_lock(state / "monitor.lock"):
        recover_automation(bridge, journal)
        recover_result(bridge, MonitoringJournal(state / "monitoring-journal.json", connection))
        saved = PublishingJournal(state / "publishing-journal.json", connection).read()
        if saved and (saved["state"] not in {"acknowledged", "operator_reconciled"} or saved["cleanup_required"]):
            raise ValueError("Resolve the publishing journal before a supervised workflow")
        task = bridge.rpc("reporting_claim_supervised_workflow")
        if task is None:
            print(json.dumps({"state": "idle"})); return 0
        with sync_playwright() as playwright:
            result = execute_workflow(task, plan, Incogniton(), playwright.chromium, journal)
        recover_automation(bridge, journal)
        print(json.dumps({"state": result["outcome"], "action_attempted": result["action_attempted"], "live_accepted": False}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError):
        print(json.dumps({"state": "blocked", "message": "Workflow stopped. Preserve checkpoints and inspect the exact task; private data and raw errors are withheld."}))
        raise SystemExit(1)
