"""Bounded read-only local monitoring pilot; dry-run unless explicitly enabled."""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import time

from local_incogniton import Incogniton, ProfileUnavailable, debug_endpoint
from monitoring import classify_snapshot, navigation_failure, result, validate_adapter, validate_manifest
from worker_lock import monitoring_lock


SNAPSHOT_JS = """({adapter, target, title}) => {
  const visible = el => el && !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const has = selector => [...document.querySelectorAll(selector)].some(visible);
  const clean = value => { try { const u = new URL(value, location.href); u.hash = ''; u.search = ''; return u.pathname.replace(/\\/$/, ''); } catch { return ''; } };
  const same = (a, b) => { try { return clean(a) === b; } catch { return false; } };
  const norm = value => (value || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\\s+/g, ' ').trim();
  const want = clean(target);
  const onTarget = clean(location.href) === want;
  const expect = typeof title === 'string' ? title : '';
  const words = expect.split(' ').filter(word => word.length > 3);
  // Nextdoor post pages never link a card to itself, so a stored title match is the
  // alternative identity signal. It only counts on the canonical post address.
  const matchesTitle = body => {
    if (expect.length < 20) return false;
    if (body.includes(expect.slice(0, 40))) return true;
    if (words.length < 3) return false;
    const tokens = new Set(body.split(' '));
    let shared = 0;
    for (const word of words) if (tokens.has(word)) shared++;
    return shared / words.length >= 0.8;
  };
  const roots = [...document.querySelectorAll(adapter.post_root)].filter(visible).filter(root => {
    const bodies = [...root.querySelectorAll(adapter.post_body)].filter(body => visible(body) && body.innerText.trim());
    if (!bodies.length) return false;
    const linked = [...root.querySelectorAll(adapter.post_link)].some(link => visible(link) &&
      ['https://nextdoor.com', 'https://www.nextdoor.com'].includes(new URL(link.href, location.href).origin) &&
      same(link.href, want));
    // A title match only identifies the target while the page itself is that post.
    return linked || (onTarget && matchesTitle(norm(bodies.map(body => body.innerText).join(' '))));
  });
  const root = roots.length === 1 ? roots[0] : null;
  return {url: location.href, exact_post: !!root,
    login: has(adapter.login), verification: has(adapter.verification),
    removed: has(adapter.removed), unavailable: has(adapter.unavailable),
    comments: root ? [...root.querySelectorAll(adapter.comment)].filter(visible).slice(0, 200).map(el => ({
      external_id: el.getAttribute(adapter.comment_id_attribute),
      body: el.querySelector(adapter.comment_body)?.innerText || ''
    })) : []};
}"""


def check_page(page, post, adapter):
    try:
        response = page.goto(post["url"], wait_until="domcontentloaded", timeout=45000)
        if response and response.status >= 500:
            return navigation_failure(post, "HTTP server failure")
    except Exception as error:
        return navigation_failure(post, error)
    try:
        expect = {"adapter": adapter, "target": post["url"], "title": post.get("title", "")}
        try:
            page.wait_for_function(
                "args => { const s = (" + SNAPSHOT_JS + ")(args); return s.exact_post || s.login || s.verification || s.removed || s.unavailable; }",
                arg=expect, timeout=15000)
        except Exception:
            # Still inspect the final page conservatively; an unknown layout is not a network failure.
            pass
        # Read only DOM state: no click, fill, engagement, expansion or API scraping.
        snapshot = page.evaluate(SNAPSHOT_JS, expect)
        if response and response.status >= 400 and not snapshot.get("login") and not snapshot.get("verification"):
            return result(post, "needs_review", "The post returned an HTTP access error; removal is not established.")
        return classify_snapshot(post, snapshot)
    except Exception:
        return result(post, "needs_review", "The configured page adapter could not interpret this page.")


def run_batch(posts, adapter, api, chromium, emit, deadline):
    groups = defaultdict(list)
    for post in posts:
        groups[post["profile_id"]].append(post)
    for profile_id, targets in groups.items():
        if time.monotonic() >= deadline:
            for post in targets:
                emit(result(post, "needs_review", "Batch time limit reached before this profile started."))
            continue
        launched, browser, page = False, None, None
        try:
            data = api.launch(profile_id)
            launched = True
            endpoint = debug_endpoint(data)
            browser = chromium.connect_over_cdp(endpoint, timeout=30000)
            if not browser.contexts:
                raise ValueError("Profile did not provide a browser context")
            page = browser.contexts[0].new_page()
            def restrict_navigation(route):
                from urllib.parse import urlsplit
                request = route.request
                url = urlsplit(request.url)
                if request.is_navigation_request() and (url.scheme != "https" or url.hostname not in {"nextdoor.com", "www.nextdoor.com"}):
                    route.abort()
                else:
                    route.continue_()
            page.route("**/*", restrict_navigation)
        except Exception as error:
            for post in targets:
                emit(result(post, "profile_error", "Profile was busy, unknown, or could not be opened safely."))
            if not launched and not isinstance(error, ProfileUnavailable):
                raise RuntimeError("Profile launch was not confirmed; inspect Incogniton before another batch") from None
        else:
            for post in targets:
                if time.monotonic() >= deadline:
                    emit(result(post, "needs_review", "Batch time limit reached before this post was checked."))
                else:
                    emit(check_page(page, post, adapter))
        finally:
            if page is not None:
                try:
                    page.close()
                except Exception:
                    pass
            # Do not close browser/context wholesale or touch any pre-existing tabs.
            if launched:
                try:
                    api.stop(profile_id)
                except Exception:
                    raise RuntimeError("A worker-opened profile could not be stopped; no further profiles will run") from None
        time.sleep(4)


def load_json(path):
    with Path(path).open("rb") as stream:
        content = stream.read(1_000_001)
    if len(content) > 1_000_000:
        raise ValueError("Input exceeds 1 MB")
    return json.loads(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized", action="store_true")
    parser.add_argument("--output", help="New local JSONL results file (never overwritten)")
    args = parser.parse_args()
    posts = validate_manifest(load_json(args.manifest))
    if not args.execute:
        print(json.dumps({"mode": "dry_run", "posts": len(posts),
                          "profiles": len({post["profile_id"] for post in posts}), "network_calls": 0}))
        return
    if not args.confirm_authorized or not args.adapter or not args.output:
        parser.error("Execution requires --confirm-authorized, --adapter and --output")
    adapter = validate_adapter(load_json(args.adapter))
    from preflight import require_runtime
    require_runtime()
    from playwright.sync_api import sync_playwright
    # Exclusive creation prevents accidental overwriting; partial results survive interruption.
    lock = Path(__file__).resolve().parent / ".worker-state" / "monitor.lock"
    with monitoring_lock(lock), Path(args.output).open("x", encoding="utf-8") as output:
        def emit(item):
            item["adapter_sha256"] = hashlib.sha256(json.dumps(adapter, sort_keys=True).encode()).hexdigest()
            output.write(json.dumps(item, ensure_ascii=False) + "\n")
            output.flush()
        with sync_playwright() as playwright:
            run_batch(posts, adapter, Incogniton(), playwright.chromium, emit, time.monotonic() + 3600)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit("Monitoring interrupted; review the partial results before restarting.")
    except Exception:
        raise SystemExit("Monitoring could not finish safely. Check configuration and any worker-opened profile; raw errors are withheld.")
