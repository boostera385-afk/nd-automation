"""Opt-in, one-job text publisher. No default publishing, login or blind retries."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
from urllib.parse import urljoin, urlsplit

from agent import WorkerBridge, recover_result
from local_incogniton import Incogniton, ProfileUnavailable, debug_endpoint
from monitor import load_json
from monitoring import canonical_post_url, is_account_disabled
from monitoring_journal import MonitoringJournal
from publishing_journal import PublishingJournal
from publishing_protocol import account_url, require_live_lease, validate_adapter, validate_job, validate_result
from worker_connection import validate_connection
from worker_lock import monitoring_lock
from worker_protocol import validate_completion
from publisher_run import run_due_jobs
from publishing_media import prepare_media, validate_registry
from automation_journal import AutomationJournal, recover_automation

MEDIA_FILES_JS = """async input => Promise.all([...input.files].map(async file => ({
  name:file.name,mime:file.type,bytes:file.size,
  sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))]
    .map(byte=>byte.toString(16).padStart(2,'0')).join('')
})))"""


def verify_media(root, spec, descriptors):
    control = root.locator(spec["input"])
    if control.count() != 1 or control.evaluate("node => node.tagName === 'INPUT' && node.type === 'file'") is not True:
        raise ValueError("Expected exactly one reviewed file input")
    expected = [{key: item[key] for key in ("name", "mime", "bytes", "sha256")} for item in descriptors]
    if control.evaluate(MEDIA_FILES_JS) != expected:
        raise ValueError("Browser-selected media bytes/order differ from the approved fingerprints")
    previews = root.locator(spec["preview"])
    visible = [preview for preview in previews.all() if preview.is_visible()]
    if len(visible) != len(descriptors):
        raise ValueError("Attachment preview count differs from the approved selection")
    for preview in visible:
        one(preview, spec["ready"])


def upload_media(root, spec, descriptors, payloads):
    verify_media(root, spec, [])  # Never replace a pre-existing unapproved attachment set.
    control = root.locator(spec["input"])
    if control.count() != 1 or control.evaluate("node => node.tagName === 'INPUT' && node.type === 'file'") is not True:
        raise ValueError("Expected exactly one reviewed file input")
    control.set_input_files(payloads, timeout=30000)
    if descriptors:
        root.locator(spec["preview"]).nth(len(descriptors) - 1).wait_for(state="visible", timeout=30000)
        for preview in root.locator(spec["preview"]).all():
            if preview.is_visible():
                preview.locator(spec["ready"]).wait_for(state="visible", timeout=30000)
    verify_media(root, spec, descriptors)


def normalized(value):
    return " ".join(str(value or "").split())


def one(scope, selector):
    node = scope.locator(selector)
    if node.count() != 1 or not node.is_visible():
        raise ValueError("The reviewed selector did not identify one visible control")
    return node


def blocked(page, adapter):
    url = urlsplit(page.url)
    if is_account_disabled(page.url):
        return "validation_error"
    if url.scheme != "https" or url.hostname not in {"nextdoor.com", "www.nextdoor.com"}:
        return "validation_error"
    for key, outcome in (("verification", "verification_required"), ("login", "login_required")):
        nodes = page.locator(adapter[key])
        if nodes.count() and nodes.first.is_visible():
            return outcome
    return None


def verify_account(page, adapter, job):
    identity = adapter["accounts"].get(job["profile_id"])
    if not identity or normalized(identity["label"]) != normalized(job["account_label"]):
        raise ValueError("No locally approved exact account identity for this assignment")
    node = one(page, adapter["account"])
    href = account_url(urljoin(page.url, node.get_attribute("href") or ""))
    if href != account_url(identity["url"]) or normalized(node.inner_text()) != normalized(job["account_label"]):
        raise ValueError("The signed-in account does not match the approved target")
    return href


def check_text(root, selector, value):
    node = one(root, selector)
    tag = node.evaluate("element => element.tagName.toLowerCase()")
    actual = node.input_value() if tag in {"textarea", "input"} else node.inner_text()
    if normalized(actual) != normalized(value):
        raise ValueError("Composer text did not match the exact approved revision")


def fill_checked(root, selector, value):
    one(root, selector).fill(value, timeout=10000)
    check_text(root, selector, value)


def result_links(page, form, job, author):
    """Only exact same-card content/author/link evidence; never first-feed-card."""
    roots = page.locator(form["result_root"])
    if roots.count() > 20:
        raise ValueError("Ambiguous result region")
    matches = set()
    for root in roots.all():
        if not root.is_visible():
            continue
        try:
            body = one(root, form["result_body"])
            person = one(root, form["result_author"])
            link = one(root, form["result_link"])
            if normalized(body.inner_text()) != normalized(job["body"]):
                continue
            if account_url(urljoin(page.url, person.get_attribute("href") or "")) != author:
                continue
            if job["kind"] == "listing" and normalized(one(root, form["result_title"]).inner_text()) != normalized(job["title"]):
                continue
            if job.get("media"):
                media = form.get("media")
                if not media or len([node for node in root.locator(media["result"]).all() if node.is_visible()]) != len(job["media"]):
                    continue
            url = canonical_post_url(urljoin(page.url, link.get_attribute("href") or ""))
            if ("/p/" if job["kind"] == "post" else "/for_sale_and_free/") in url:
                matches.add(url)
        except ValueError:
            continue
    return matches


def publish_one(job, adapter, api, chromium, journal, media_registry=None):
    validate_job(job)
    validate_adapter(adapter)
    remaining = require_live_lease(job)
    journal.begin(job)  # Durably record the claim before any launch request.
    fingerprint = hashlib.sha256(json.dumps(adapter, sort_keys=True).encode()).hexdigest()
    deadline = time.monotonic() + min(420, remaining - 180)
    launched, safe_without_launch, page = False, True, None
    form = adapter["forms"].get(job["kind"])
    payloads = []

    def guard():
        if time.monotonic() >= deadline:
            raise ValueError("Publishing execution budget exhausted")

    def record(outcome, reason, url=None):
        journal.record(validate_result({"outcome": outcome, "reason": reason, "adapter_sha256": fingerprint,
                                       "post_url": url, "published_at": datetime.now(timezone.utc).isoformat() if url else None}, job["kind"]))

    try:
        if form is None or job["profile_id"] not in adapter["accounts"]:
            raise ValueError("This content kind/profile has no reviewed local publisher adapter")
        if job.get("media"):
            if media_registry is None or "media" not in form:
                raise ValueError("Media requires an explicitly registered local asset set and reviewed attachment controls")
            payloads = prepare_media(job["media"], media_registry)  # Verify bytes BEFORE launching a profile.
        safe_without_launch = False
        launch = api.launch(job["profile_id"])
        launched = True
        browser = chromium.connect_over_cdp(debug_endpoint(launch), timeout=30000)
        if len(browser.contexts) != 1:
            raise ValueError("The profile did not expose exactly one browser context")
        page = browser.contexts[0].new_page()
        page.set_default_timeout(10000)

        def restrict_navigation(route):
            request = route.request
            url = urlsplit(request.url)
            if request.is_navigation_request() and (url.scheme != "https" or url.hostname not in {"nextdoor.com", "www.nextdoor.com"}):
                route.abort()
            else:
                route.continue_()
        page.route("**/*", restrict_navigation)
        page.goto("https://nextdoor.com/news_feed/", wait_until="domcontentloaded", timeout=30000)
        guard()
        issue = blocked(page, adapter)
        if issue:
            record(issue, "Account access needs a person; no submit was attempted.")
            return
        author = verify_account(page, adapter, job)
        # Existing exact content is not evidence of a new submission, and is a
        # duplicate-risk stop before typing, not a reason to post it again.
        if result_links(page, form, {**job, "media": []}, author):
            record("validation_error", "Matching existing content was visible before composing; review it before any new submission.")
            return
        one(page, form["open"]).click(timeout=10000)
        root = one(page, form["root"])
        fill_checked(root, form["body"], job["body"])
        if job["kind"] == "listing":
            fill_checked(root, form["title"], job["title"])
            fill_checked(root, form["price"], f"{job['price_cents'] // 100}.{job['price_cents'] % 100:02d}")
            category = one(root, form["category"])
            category.select_option(label=job["category"], timeout=10000)
            if normalized(category.locator("option:checked").inner_text()) != normalized(job["category"]):
                raise ValueError("The listing category was not confirmed")
        audience = one(root, form["audience"])
        audience.click(timeout=10000)
        one(page, form["audiences"][job["audience"]]).click(timeout=10000)
        if normalized(one(root, form["audience"]).inner_text()) != normalized(form["audience_labels"][job["audience"]]):
            raise ValueError("The exact approved audience was not confirmed")
        if "media" in form:
            if job.get("media"):
                upload_media(root, form["media"], job["media"], payloads)
            else:
                verify_media(root, form["media"], [])
        guard()
        if blocked(page, adapter):
            raise ValueError("Account access changed before submission")
        verify_account(page, adapter, job)
        # Audience/account controls can re-render the composer. Re-read every
        # approved field at the final boundary, not only immediately after fill.
        check_text(root, form["body"], job["body"])
        if "media" in form:
            verify_media(root, form["media"], job.get("media", []))
        if job["kind"] == "listing":
            check_text(root, form["title"], job["title"])
            check_text(root, form["price"], f"{job['price_cents'] // 100}.{job['price_cents'] % 100:02d}")
            if normalized(one(root, form["category"]).locator("option:checked").inner_text()) != normalized(job["category"]):
                raise ValueError("The listing category changed before submission")
        # Uploads can re-render/reset audience and account controls as well.
        verify_account(page, adapter, job)
        if normalized(one(root, form["audience"]).inner_text()) != normalized(form["audience_labels"][job["audience"]]):
            raise ValueError("The approved audience changed before submission")
        submit = one(root, form["submit"])
        if not submit.is_enabled():
            raise ValueError("Submit control is not enabled")
        guard()
        journal.submit_intent()  # Flush BEFORE the only click; a crash never retries it.
        submit.click(timeout=10000)
        for _ in range(120):
            guard()
            if blocked(page, adapter):
                break
            links = result_links(page, form, job, author)
            if len(links) == 1:
                record("submitted", "Exact new content, account author and canonical link were observed after one submit.", links.pop())
                return
            if len(links) > 1:
                break
            page.wait_for_timeout(500)
        record("needs_reconciliation", "Submit was attempted but one exact new publication could not be confirmed. Do not retry.")
    except ProfileUnavailable:
        safe_without_launch = True
        record("profile_error", "Profile was active or its stopped state was unknown; no launch or submit was attempted.")
    except Exception:
        saved = journal.read()
        if saved and saved["state"] in {"claimed", "submit_intent"}:
            attempted = saved["state"] == "submit_intent"
            record("needs_reconciliation" if attempted else "validation_error",
                   "Submission may have occurred; inspect the exact account and do not retry." if attempted
                   else "The reviewed identity/composer/audience or local profile could not be verified. No submit was attempted; inspect locally.")
        else:
            raise
    finally:
        payloads.clear()  # No temporary media file, no deletion of operator originals.
        page_closed = True
        if page is not None:
            try:
                page.close()
            except Exception:
                page_closed = False
        if launched:
            try:
                api.stop(job["profile_id"])
                # An interruption/storage failure can leave only a claim or
                # submit intent. Preserve that ambiguity, including the original
                # exception, rather than inventing a result to mark cleanup.
                saved = journal.read()
                if saved and saved["state"] == "result_ready":
                    journal.cleanup_complete()
            except Exception:
                raise RuntimeError("Publishing profile cleanup requires operator inspection") from None
        elif safe_without_launch and page_closed:
            saved = journal.read()
            if saved and saved["state"] == "result_ready":
                journal.cleanup_complete()


def recover_publishing(bridge, journal):
    saved = journal.read()
    if saved is None:
        return "empty"
    if saved["state"] in {"claimed", "submit_intent"}:
        raise ValueError("Unresolved publishing claim/submit intent: inspect and reconcile; never replay browser work")
    if saved["state"] == "result_ready":
        validate_completion(bridge.complete_publish(saved["job"], saved["result"]))
        journal.acknowledge()
        saved = journal.read()
    if saved["cleanup_required"]:
        raise ValueError("Publishing result was acknowledged but profile cleanup requires confirmation")
    return saved["state"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", required=True)
    parser.add_argument("--adapter", help="Locally reviewed publisher adapter, not the monitoring adapter")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized", action="store_true")
    parser.add_argument("--recover-results", action="store_true")
    parser.add_argument("--confirm-reconciled", metavar="JOB_UUID")
    parser.add_argument("--max-jobs", type=int, default=1, help="Explicit cap of 1–20 already-authorized jobs; default one")
    parser.add_argument("--watch-minutes", type=int, default=0, help="Opt-in due-job polling for 1–480 minutes, never a background service")
    parser.add_argument("--confirm-batch", action="store_true", help="Separately authorize bounded sequential execution/watching")
    parser.add_argument("--media-registry", help="Explicit private registry enabling approved image jobs; no URLs/downloads")
    args = parser.parse_args(argv)
    if not 1 <= args.max_jobs <= 20 or not 0 <= args.watch_minutes <= 480:
        parser.error("Choose 1–20 jobs and 0–480 watch minutes")
    connection = validate_connection(load_json(args.connection))
    state = Path(__file__).resolve().parent / ".worker-state"
    journal = PublishingJournal(state / "publishing-journal.json", connection)
    recovery = args.recover_results or args.confirm_reconciled
    if (args.recover_results and args.confirm_reconciled) or (recovery and args.execute):
        parser.error("Choose result recovery or operator reconciliation, without execution")
    if recovery and (args.max_jobs != 1 or args.watch_minutes):
        parser.error("Recovery is receipt-only and cannot run/watch a batch")
    if (args.execute or recovery) and not args.confirm_authorized:
        parser.error("Execution/recovery requires explicit --confirm-authorized")
    if recovery:
        with monitoring_lock(state / "monitor.lock"):
            if args.confirm_reconciled:
                journal.reconcile(args.confirm_reconciled)
                print(json.dumps({"state": "operator_attested_reconciliation", "server_verified": False, "profiles_opened": 0}))
            else:
                print(json.dumps({"state": recover_publishing(WorkerBridge(connection), journal), "profiles_opened": 0}))
        return 0
    if not args.adapter:
        parser.error("A reviewed --adapter is required")
    adapter = validate_adapter(load_json(args.adapter))
    media_registry = validate_registry(load_json(args.media_registry)) if args.media_registry else None
    if not args.execute:
        print(json.dumps({"mode": "offline_publishing_preflight", "configuration_valid": True,
                          "live_accepted": False, "network_calls": 0, "submissions": 0,
                          "max_jobs": args.max_jobs, "watch_minutes": args.watch_minutes,
                          "media_capability": media_registry is not None}))
        return 0
    if (args.max_jobs > 1 or args.watch_minutes) and not args.confirm_batch:
        parser.error("Multiple jobs or due-job watching also require explicit --confirm-batch")
    from preflight import require_runtime
    require_runtime()
    from playwright.sync_api import sync_playwright
    bridge = WorkerBridge(connection)
    with monitoring_lock(state / "monitor.lock"):
        def prepare():
            recover_automation(bridge, AutomationJournal(state / "automation-journal.json", connection))
            recover_result(bridge, MonitoringJournal(state / "monitoring-journal.json", connection))
            recover_publishing(bridge, journal)
        with sync_playwright() as playwright:
            report = run_due_jobs(bridge, journal, prepare,
                lambda job: publish_one(job, adapter, Incogniton(), playwright.chromium, journal, media_registry),
                lambda: recover_publishing(bridge, journal), args.max_jobs, args.watch_minutes,
                claim_method="reporting_claim_publish_v2" if media_registry is not None else "reporting_claim_publish")
        print(json.dumps({**report, "visibility_verified": False}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("Publisher interrupted. Preserve its journal and inspect the account before any retry.")
    except Exception:
        raise SystemExit("Publisher stopped safely. Inspect its journal, lease and local profile; raw errors are withheld.")
