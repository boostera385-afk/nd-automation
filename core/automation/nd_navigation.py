"""
Shared, diagnosable page navigation for the Nextdoor flows.

The old per-flow `smart_navigate` raised a bare Exception("Failed proxy issue")
for every failure - a dead proxy, a slow page, a blank render, a changed
selector - and because it was an unclassified exception the row failed
permanently with a message that was usually wrong. This module reports what
actually happened and only blames the proxy when Chrome says so.
"""

import re
import time

from core.engine.exceptions import PermanentError, RetryableError

# Elements that mean "a real Nextdoor page rendered".
READY_SELECTOR = ", ".join([
    "nav",
    "header",
    "main",
    '[role="main"]',
    '[data-testid="content"]',
    "#main_content",
    "form",
    '[data-testid="email-address-input"]',
    '[data-testid="signin_button"]',
    '[data-testid="prompt-container"]',
    '[data-testid="composer-text-field"]',
    '[data-testid="composer-submit-button"]',
    '[data-testid="feed"]',
    "footer",
])

# Chrome net errors that really are the proxy's fault.
PROXY_ERROR_CODES = {
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_TUNNEL_CONNECTION_FAILED",
    "ERR_PROXY_AUTH_REQUESTED",
    "ERR_PROXY_AUTH_UNSUPPORTED",
    "ERR_UNEXPECTED_PROXY_AUTH",
    "ERR_SOCKS_CONNECTION_FAILED",
    "ERR_SOCKS_CONNECTION_HOST_UNREACHABLE",
    "ERR_NO_SUPPORTED_PROXIES",
    "ERR_MANDATORY_PROXY_CONFIGURATION_FAILED",
    "ERR_PROXY_CERTIFICATE_INVALID",
}

# Everything else that is a transport problem rather than a page problem.
NETWORK_ERROR_CODES = {
    "ERR_NAME_NOT_RESOLVED",
    "ERR_NAME_RESOLUTION_FAILED",
    "ERR_INTERNET_DISCONNECTED",
    "ERR_CONNECTION_RESET",
    "ERR_CONNECTION_CLOSED",
    "ERR_CONNECTION_REFUSED",
    "ERR_CONNECTION_TIMED_OUT",
    "ERR_CONNECTION_ABORTED",
    "ERR_CONNECTION_FAILED",
    "ERR_EMPTY_RESPONSE",
    "ERR_ADDRESS_UNREACHABLE",
    "ERR_NETWORK_CHANGED",
    "ERR_TIMED_OUT",
    "ERR_SSL_PROTOCOL_ERROR",
    "ERR_HTTP2_PROTOCOL_ERROR",
    "ERR_QUIC_PROTOCOL_ERROR",
    "ERR_TOO_MANY_REDIRECTS",
    "ERR_SSL_VERSION_OR_CIPHER_MISMATCH",
}

_CODE_RE = re.compile(r"ERR_[A-Z0-9_]+")

# Playwright errors that only mean "the page moved while we looked at it".
# These are NOT page failures - the old code reported them as the page state,
# which made a transient hiccup look like a dead proxy.
TRANSIENT_EVAL_ERRORS = (
    "execution context was destroyed",
    "most likely because of a navigation",
    "page is navigating",
    "navigating and changing the content",
    "cannot find context",
    "frame was detached",
)

# A proxy that is not up yet often works a moment later, so hard-refresh and
# wait before declaring it dead (~1 minute in total).
PROXY_RECOVERY_ROUNDS = 2
PROXY_RECOVERY_WAIT = 30.0

READY_JS = """
() => {
  const sel = %r;
  const body = document.body;
  const text = body ? (body.innerText || '').trim() : '';
  return {
    hasEl: !!document.querySelector(sel),
    textLen: text.length,
    snippet: text.slice(0, 160),
    url: location.href,
    title: document.title || ''
  };
}
""" % READY_SELECTOR


def extract_error_code(text):
    """Pulls the Chrome net error code out of an exception message."""
    match = _CODE_RE.search(str(text or ""))
    return match.group(0) if match else ""


def classify_error(text):
    """Returns ('proxy' | 'network' | 'unknown', code)."""
    code = extract_error_code(text)
    if code in PROXY_ERROR_CODES:
        return "proxy", code
    if code in NETWORK_ERROR_CODES:
        return "network", code
    if code:
        return "network", code
    return "unknown", ""


def _is_transient_eval_error(text):
    lowered = str(text or "").lower()
    return any(marker in lowered for marker in TRANSIENT_EVAL_ERRORS)


def page_state(page, retries=3, settle=1.0):
    """
    Reads what is actually on the page right now.

    If the page is mid-navigation the evaluate throws "Execution context was
    destroyed"; that means "look again in a moment", not "the page is broken",
    so we wait for the navigation to land and retry.
    """
    last_err = ""
    for attempt in range(max(1, retries)):
        try:
            state = page.evaluate(READY_JS)
            state.setdefault("error", "")
            return state
        except Exception as e:
            last_err = str(e)
            if attempt < retries - 1 and _is_transient_eval_error(last_err):
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=15000)
                except Exception:
                    try:
                        page.wait_for_timeout(int(settle * 1000))
                    except Exception:
                        time.sleep(settle)
                continue
            break

    # Fall back to the raw HTML, which does not need an execution context.
    try:
        html = page.content()
        stripped = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
        stripped = re.sub(r"<[^>]+>", " ", stripped)
        text_len = len(" ".join(stripped.split()))
        return {
            "hasEl": bool(re.search(r"<(nav|main|header|footer)\b", html, re.I))
            or 'data-testid="' in html,
            "textLen": text_len,
            "snippet": " ".join(stripped.split())[:160],
            "url": getattr(page, "url", "") or "",
            "title": "",
            "error": "",
        }
    except Exception:
        pass

    return {"hasEl": False, "textLen": 0, "snippet": "", "url": "", "title": "",
            "error": str(last_err)[:160]}


def is_ready(state):
    """A page counts as loaded if it rendered chrome or a meaningful amount of text."""
    if not state:
        return False
    url = str(state.get("url") or "")
    if url.startswith("chrome-error://") or url.startswith("chrome://network-error"):
        return False
    snippet = str(state.get("snippet") or "")
    # Chrome's own interstitial.
    if "ERR_" in snippet and state.get("textLen", 0) < 400:
        return False
    if "site can" in snippet.lower() and "be reached" in snippet.lower():
        return False
    return bool(state.get("hasEl")) or int(state.get("textLen") or 0) > 80


def wait_until_ready(page, timeout=20.0, poll=1.0):
    """Polls the page until it looks rendered. Returns (ok, state)."""
    deadline = time.time() + timeout
    state = {}
    while True:
        state = page_state(page)
        if is_ready(state):
            return True, state
        if time.time() >= deadline:
            return False, state
        try:
            page.wait_for_timeout(int(poll * 1000))
        except Exception:
            time.sleep(poll)


def describe(state):
    """Short, human-readable description of a page that would not load."""
    if not state:
        return "no page state"
    if state.get("error"):
        return f"page unreachable ({state['error']})"
    snippet = " ".join(str(state.get("snippet") or "").split())[:120]
    url = str(state.get("url") or "")[:80]
    if snippet:
        return f"url={url} text='{snippet}'"
    return f"url={url} blank page"


def hard_reload(page, log=None, timeout=60000):
    """
    Forces a cache-bypassing reload (the equivalent of Ctrl+Shift+R).
    Returns True if the reload itself went through.
    """
    client = None
    try:
        client = page.context.new_cdp_session(page)
        try:
            client.send("Network.setCacheDisabled", {"cacheDisabled": True})
        except Exception:
            pass
        client.send("Page.reload", {"ignoreCache": True})
        try:
            page.wait_for_load_state("domcontentloaded", timeout=timeout)
        except Exception:
            pass
        return True
    except Exception:
        try:
            page.reload(wait_until="domcontentloaded", timeout=timeout)
            return True
        except Exception as e:
            if log:
                log(f"Hard refresh failed: {str(e).splitlines()[0][:140]}")
            return False
    finally:
        if client is not None:
            try:
                client.detach()
            except Exception:
                pass


def recover_from_proxy_error(
    page,
    url,
    code,
    log,
    nap,
    goto_timeout=60000,
    ready_timeout=20.0,
    rounds=PROXY_RECOVERY_ROUNDS,
    wait_seconds=PROXY_RECOVERY_WAIT,
):
    """
    A proxy that refuses the first connection is often just not up yet
    (Incogniton wires the proxy up as the browser starts). Wait, hard-refresh,
    and try again a couple of times before blaming the proxy.

    Returns (recovered, last_state).
    """
    state = {}
    for round_no in range(1, max(1, rounds) + 1):
        log(
            f"Proxy error {code}. Waiting {int(wait_seconds)}s then hard-refreshing "
            f"(recovery {round_no}/{rounds})..."
        )
        nap(wait_seconds)

        if hard_reload(page, log=log, timeout=goto_timeout):
            ok, state = wait_until_ready(page, timeout=ready_timeout)
            if ok:
                log(f"Proxy recovered after a hard refresh ({code} cleared).")
                return True, state

        # The error page may not re-request the original URL - go there directly.
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=goto_timeout)
            ok, state = wait_until_ready(page, timeout=ready_timeout)
            if ok:
                log(f"Proxy recovered after reloading {url} ({code} cleared).")
                return True, state
        except Exception as e:
            kind, new_code = classify_error(str(e))
            if new_code:
                code = new_code
            log(f"Proxy still failing ({code}).")

    return False, state


def navigate_with_recovery(
    page,
    context,
    url,
    log,
    sleep_fn=None,
    set_state=None,
    page_loading_state=None,
    attempts=3,
    goto_timeout=60000,
    ready_timeout=20.0,
):
    """
    Loads `url`, recovering from blank renders and transient network errors.

    Returns the page that ended up with the URL loaded (may be a new tab).
    Raises PermanentError for a genuinely broken proxy, RetryableError for
    anything else, with a message that says what actually went wrong.
    """
    def nap(seconds):
        if sleep_fn:
            sleep_fn(seconds)
        else:
            time.sleep(seconds)

    last_state = {}
    last_error = ""
    proxy_code = ""
    network_code = ""
    http_status = None

    def try_load(target_page, label):
        """Returns (ok, state). Records diagnostics in the enclosing scope."""
        nonlocal last_error, proxy_code, network_code, http_status, last_state
        try:
            # domcontentloaded instead of the default 'load': a slow proxy can
            # keep sub-resources pending long after the page is usable.
            response = target_page.goto(url, wait_until="domcontentloaded", timeout=goto_timeout)
            if response is not None:
                try:
                    http_status = response.status
                except Exception:
                    pass
        except Exception as e:
            last_error = str(e)
            kind, code = classify_error(last_error)
            if kind == "proxy":
                proxy_code = code
                log(f"{label}: proxy error {code}")
            elif code:
                network_code = code
                log(f"{label}: network error {code}")
            else:
                log(f"{label}: {str(e).splitlines()[0][:160]}")

            # A goto timeout does not mean the DOM is unusable - check it.
            ok, state = wait_until_ready(target_page, timeout=5.0)
            last_state = state
            return ok, state

        ok, state = wait_until_ready(target_page, timeout=ready_timeout)
        last_state = state
        if not ok and http_status and http_status >= 400:
            log(f"{label}: server returned HTTP {http_status}")
        return ok, state

    for attempt in range(1, attempts + 1):
        if attempt > 1:
            log(f"Retrying navigation to {url} ({attempt}/{attempts})...")

        ok, state = try_load(page, f"Navigation attempt {attempt}")
        if ok:
            return page

        # Leave the loop; the proxy gets its hard-refresh recovery below.
        if proxy_code:
            break

        log(f"Page did not render ({describe(state)}). Reloading...")
        try:
            page.reload(wait_until="domcontentloaded", timeout=goto_timeout)
            ok, state = wait_until_ready(page, timeout=ready_timeout)
            last_state = state
            if ok:
                return page
        except Exception as e:
            last_error = str(e)
            kind, code = classify_error(last_error)
            if kind == "proxy":
                proxy_code = code
                break
            if code:
                network_code = code

        nap(3)

    if not proxy_code:
        log("Still failing. Attempting to open a completely new tab...")
        try:
            try:
                page.close()
            except Exception:
                pass
            page = context.new_page()
            page.bring_to_front()
            if set_state and page_loading_state is not None:
                set_state(page_loading_state)
            ok, state = try_load(page, "Fresh tab")
            if ok:
                return page
        except Exception as e:
            last_error = str(e)
            kind, code = classify_error(last_error)
            if kind == "proxy":
                proxy_code = code
            elif code:
                network_code = code

    # Probe the site root so we can tell a dead proxy from a bad page.
    proxy_alive = None
    if not proxy_code:
        try:
            probe = page.goto("https://nextdoor.com/", wait_until="domcontentloaded", timeout=25000)
            ok, _ = wait_until_ready(page, timeout=8.0)
            proxy_alive = bool(ok or (probe is not None and probe.status < 500))
        except Exception as e:
            kind, code = classify_error(str(e))
            if kind == "proxy":
                proxy_code = code
            proxy_alive = False

    if proxy_code:
        # Last chance: the proxy may simply not have been up yet when the
        # profile launched. Hard refresh and wait (~1 minute) before failing.
        recovered, state = recover_from_proxy_error(
            page,
            url,
            proxy_code,
            log=log,
            nap=nap,
            goto_timeout=goto_timeout,
            ready_timeout=ready_timeout,
        )
        if recovered:
            return page
        last_state = state or last_state

        raise PermanentError(
            f"Proxy is not working ({proxy_code}) - check this profile's proxy. "
            f"Tried {PROXY_RECOVERY_ROUNDS} hard refreshes over "
            f"{int(PROXY_RECOVERY_ROUNDS * PROXY_RECOVERY_WAIT)}s without recovering. "
            f"Last page state: {describe(last_state)}"
        )

    if proxy_alive:
        raise RetryableError(
            f"The proxy works but {url} never finished loading. "
            f"Last page state: {describe(last_state)}"
            + (f" HTTP {http_status}" if http_status else "")
        )

    if network_code:
        raise RetryableError(
            f"Network error loading {url}: {network_code}. Last page state: {describe(last_state)}"
        )

    raise RetryableError(
        f"Could not load {url}"
        + (f" (HTTP {http_status})" if http_status else "")
        + f". Last page state: {describe(last_state)}"
        + (f" Last error: {last_error.splitlines()[0][:160]}" if last_error else "")
    )
