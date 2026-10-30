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
  // Comment identity, author and total are read only inside the identified post root.
  const commentId = el => {
    const holder = adapter.comment_id_selector
      ? (el.matches(adapter.comment_id_selector) ? el : el.querySelector(adapter.comment_id_selector))
      : el;
    let value = holder ? holder.getAttribute(adapter.comment_id_attribute) : null;
    if (value && adapter.comment_id_prefix && value.indexOf(adapter.comment_id_prefix) === 0) {
      value = value.slice(adapter.comment_id_prefix.length);
    }
    return value;
  };
  let total = null;
  if (root && adapter.comment_total) {
    const label = root.querySelector(adapter.comment_total);
    const digits = label ? (label.innerText || '').match(/\\d[\\d,]*/) : null;
    if (digits) total = parseInt(digits[0].replace(/,/g, ''), 10);
  }
  return {url: location.href, exact_post: !!root,
    login: has(adapter.login), verification: has(adapter.verification),
    removed: has(adapter.removed), unavailable: has(adapter.unavailable),
    comments_total: Number.isInteger(total) ? total : null,
    comments_expandable: !!adapter.comment_expand,
    comments_expand_left: root && adapter.comment_expand
      ? [...root.querySelectorAll(adapter.comment_expand)].filter(visible).length : 0,
    comments: root ? [...root.querySelectorAll(adapter.comment)].filter(visible).slice(0, 200).map(el => ({
      external_id: commentId(el),
      body: el.querySelector(adapter.comment_body)?.innerText || '',
      author: adapter.comment_author ? (el.querySelector(adapter.comment_author)?.innerText || '') : ''
    })) : []};
}"""

# One read-only expansion per call: it presses the thread's own "show more" control.
# Disabled unless the adapter names the control AND the operator passes --allow-comment-expansion.
EXPAND_JS = """({adapter}) => {
  const visible = el => el && !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const root = [...document.querySelectorAll(adapter.post_root)].filter(visible)[0];
  if (!root || !adapter.comment_expand) return false;
  const control = [...root.querySelectorAll(adapter.comment_expand)].filter(visible)[0];
  if (!control) return false;
  try { control.scrollIntoView({ block: 'center' }); } catch (e) {}
  control.click();
  return true;
}"""

# A hard page load mounts an empty "Comment list". Activating the post's own comment
# control opens the thread the way a reader does. Nothing is typed or submitted; the
# composer that gains focus is never written to.
MOUNT_JS = """({adapter}) => {
  const visible = el => el && !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const root = [...document.querySelectorAll(adapter.post_root)].filter(visible)[0];
  if (!root || !adapter.comment_total) return false;
  if (root.querySelector(adapter.comment)) return false;
  const control = [...root.querySelectorAll(adapter.comment_total)].filter(visible)[0];
  if (!control) return false;
  try { control.scrollIntoView({ block: 'center' }); } catch (e) {}
  control.click();
  return true;
}
"""

MOUNT_WAIT_MS = 12000
MOUNT_POLL_MS = 1500
THREAD_SETTLE_MS = 1800
MAX_EXPANSION_ROUNDS = 12
EXPANSION_SETTLE_MS = 2600
# The next "show more" control can re-render a few seconds after a batch lands, so a
# missing control is only conclusive after several spaced observations.
EXPANSION_MISS_LIMIT = 4


def check_page(page, post, adapter, allow_expansion=False):
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
                "args => { const s = (" + SNAPSHOT_JS + ")(args); return s.exact_post || s.login || s.verification || s.removed || s.unavailable || /account_disabled/.test(location.pathname); }",
                arg=expect, timeout=15000)
        except Exception:
            # Still inspect the final page conservatively; an unknown layout is not a network failure.
            pass
        # Read-only DOM state. The only interaction is the optional, explicitly enabled
        # expansion of the post's own comment thread; no like, reply, share or form input.
        snapshot = page.evaluate(SNAPSHOT_JS, expect)
        if (allow_expansion and adapter.get("comment_expand") and snapshot.get("exact_post")
                and not (snapshot.get("login") or snapshot.get("verification")
                         or snapshot.get("removed") or snapshot.get("unavailable"))):
            # A freshly loaded page mounts an empty thread that rendering alone never fills.
            # Open it once (twice at most) and wait for items; each press is a read-only
            # activation of the post's own comment control, never a typed reply.
            if not snapshot.get("comments") and (snapshot.get("comments_total") or 0) > 0:
                for _ in range(2):
                    if not page.evaluate(MOUNT_JS, {"adapter": adapter}):
                        break
                    waited = 0
                    while waited < MOUNT_WAIT_MS:
                        page.wait_for_timeout(MOUNT_POLL_MS)
                        waited += MOUNT_POLL_MS
                        snapshot = page.evaluate(SNAPSHOT_JS, expect)
                        if snapshot.get("comments"):
                            break
                    if snapshot.get("comments"):
                        break
            # The thread renders its own expand control a moment after its first items.
            page.wait_for_timeout(THREAD_SETTLE_MS)
            snapshot = page.evaluate(SNAPSHOT_JS, expect)
            stagnant = 0
            misses = 0
            previous = len(snapshot.get("comments") or [])
            for _ in range(MAX_EXPANSION_ROUNDS):
                if not page.evaluate(EXPAND_JS, {"adapter": adapter}):
                    misses += 1
                    if misses >= EXPANSION_MISS_LIMIT:
                        break
                    page.wait_for_timeout(EXPANSION_SETTLE_MS // 2)
                    snapshot = page.evaluate(SNAPSHOT_JS, expect)
                    continue
                misses = 0
                page.wait_for_timeout(EXPANSION_SETTLE_MS)
                snapshot = page.evaluate(SNAPSHOT_JS, expect)
                count = len(snapshot.get("comments") or [])
                total = snapshot.get("comments_total")
                if total is not None and count >= total and not snapshot.get("comments_expand_left"):
                    break
                stagnant = stagnant + 1 if count <= previous else 0
                previous = max(previous, count)
                if stagnant >= 3:
                    break
        if response and response.status >= 400 and not snapshot.get("login") and not snapshot.get("verification"):
            return result(post, "needs_review", "The post returned an HTTP access error; removal is not established.")
        return classify_snapshot(post, snapshot)
    except Exception:
        return result(post, "needs_review", "The configured page adapter could not interpret this page.")


def run_batch(posts, adapter, api, chromium, emit, deadline, allow_expansion=False):
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
                    emit(check_page(page, post, adapter, allow_expansion))
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
    parser.add_argument("--allow-comment-expansion", action="store_true",
                        help="Permit the read-only 'show more comments' clicks the adapter names")
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
            run_batch(posts, adapter, Incogniton(), playwright.chromium, emit,
                      time.monotonic() + 3600, args.allow_comment_expansion)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit("Monitoring interrupted; review the partial results before restarting.")
    except Exception:
        raise SystemExit("Monitoring could not finish safely. Check configuration and any worker-opened profile; raw errors are withheld.")
