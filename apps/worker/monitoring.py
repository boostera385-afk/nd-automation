"""Read-only monitoring contracts and conservative observation classification."""

from datetime import datetime, timezone
import re
from urllib.parse import urlsplit
from uuid import UUID


HOSTS = {"nextdoor.com", "www.nextdoor.com"}
POST_PATH = re.compile(r"/(p|for_sale_and_free)/([A-Za-z0-9_-]+)/?")
PROXY_CODES = {"ERR_PROXY_CONNECTION_FAILED", "ERR_TUNNEL_CONNECTION_FAILED",
               "ERR_PROXY_AUTH_REQUESTED", "ERR_SOCKS_CONNECTION_FAILED"}
TITLE_LIMIT = 500
TITLE_MIN_CHARS = 20  # Shorter titles cannot identify a post on their own.


def canonical_post_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Invalid post URL")
    url = urlsplit(value)
    if (url.scheme != "https" or url.netloc.lower() not in HOSTS
            or url.username or url.password or not POST_PATH.fullmatch(url.path)):
        raise ValueError("Expected a canonical HTTPS Nextdoor post link")
    return "https://nextdoor.com" + url.path.rstrip("/")


def normalized_title(value):
    """Compare a stored title with on-page text without case, punctuation or spacing noise."""
    if not isinstance(value, str):
        return ""
    compact = re.sub(r"[^a-z0-9 ]+", " ", value.lower())
    return re.sub(r"\s+", " ", compact).strip()[:TITLE_LIMIT]


def validate_manifest(payload):
    """Fail the entire batch before opening any profile if input is invalid."""
    if not isinstance(payload, dict) or set(payload) != {"version", "posts"} or payload["version"] != 1:
        raise ValueError("Unsupported monitoring manifest")
    posts = payload["posts"]
    if not isinstance(posts, list) or not 1 <= len(posts) <= 100:
        raise ValueError("Expected 1 to 100 posts")
    required = {"publication_id", "profile_id", "url"}
    seen, targets, validated = set(), set(), []
    for post in posts:
        if not isinstance(post, dict) or not required <= set(post) or set(post) - required - {"title"}:
            raise ValueError("Unexpected post fields")
        publication_id = str(UUID(post["publication_id"]))
        profile_id = str(UUID(post["profile_id"]))
        url = canonical_post_url(post["url"])
        if publication_id in seen or (profile_id, url) in targets:
            raise ValueError("Duplicate publication or profile/post target")
        seen.add(publication_id)
        targets.add((profile_id, url))
        entry = {"publication_id": publication_id, "profile_id": profile_id, "url": url}
        if "title" in post:
            if not isinstance(post["title"], str):
                raise ValueError("A stored post title must be text")
            title = normalized_title(post["title"])
            if title:
                entry["title"] = title
        validated.append(entry)
    return validated


ADAPTER_REQUIRED = {"version", "post_root", "post_link", "post_body", "comment",
                    "comment_id_attribute", "comment_body", "login", "verification", "removed", "unavailable"}
# Empty means "this build does not offer it". A comment ID selector/prefix and the author and
# count lookups are genuinely absent on some layouts; expansion stays off unless configured.
ADAPTER_OPTIONAL = {"comment_id_selector", "comment_id_prefix", "comment_author",
                    "comment_expand", "comment_total"}


def validate_adapter(value):
    fields = ADAPTER_REQUIRED | ADAPTER_OPTIONAL
    if not isinstance(value, dict) or set(value) != fields or value["version"] != 2:
        raise ValueError("Unsupported monitoring adapter")
    for name in ADAPTER_REQUIRED - {"version"}:
        if not isinstance(value[name], str) or not value[name].strip() or len(value[name]) > 500:
            raise ValueError("Every adapter selector/attribute must be explicitly configured")
    for name in ADAPTER_OPTIONAL:
        if not isinstance(value[name], str) or len(value[name]) > 500:
            raise ValueError("Optional adapter selectors must be text when present")
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*", value["comment_id_attribute"]):
        raise ValueError("Invalid comment ID attribute")
    return value


def result(post, outcome, reason, comments=None, comments_total=None, comments_complete=False):
    return {"publication_id": post["publication_id"], "profile_id": post["profile_id"],
            "url": post["url"], "outcome": outcome, "reason": reason,
            "observed_at": datetime.now(timezone.utc).isoformat(), "source": "auto_check",
            "comments": comments or [], "comments_total": comments_total,
            "comments_complete": comments_complete}


def is_account_disabled(url):
    """True only for Nextdoor's own terminal Account Disabled address."""
    try:
        path = urlsplit(url).path.rstrip("/").lower()
    except (TypeError, ValueError):
        return False
    return path == "/account_disabled"


def classify_snapshot(post, snapshot):
    """Require exact-post identity and an unambiguous visible adapter signal."""
    if snapshot.get("verification"):
        return result(post, "verification_required", "A visible verification prompt needs a person.")
    if snapshot.get("login"):
        return result(post, "login_required", "A visible sign-in prompt prevented checking.")
    if is_account_disabled(snapshot.get("url")):
        return result(post, "needs_review",
                      "Nextdoor redirected to its Account Disabled page; a person must review the account.")
    try:
        same_url = canonical_post_url(snapshot.get("url")) == post["url"]
    except (ValueError, TypeError):
        same_url = False
    if not same_url:
        return result(post, "needs_review", "Navigation did not remain on the exact post.")
    signals = [bool(snapshot.get(key)) for key in ("exact_post", "removed", "unavailable")]
    if sum(signals) != 1:
        return result(post, "needs_review", "The page has missing or conflicting post signals.")
    if snapshot.get("removed"):
        # Deliberately not a confirmed deletion: adapter text needs pilot validation.
        return result(post, "needs_review", "A removal-like notice was detected; review its meaning before confirming removal.")
    if snapshot.get("unavailable"):
        return result(post, "unavailable", "The configured unavailable notice is visible on the exact post page.")
    comments, seen = [], set()
    for comment in snapshot.get("comments", [])[:200]:
        external_id = comment.get("external_id")
        body = comment.get("body")
        author = comment.get("author")
        if not isinstance(external_id, str) or not external_id.strip() or len(external_id) > 300:
            continue
        if not isinstance(body, str) or not body.strip() or len(body) > 10000:
            continue
        if external_id in seen:
            continue
        seen.add(external_id)
        if not isinstance(author, str) or not author.strip() or len(author) > 200:
            author = None
        comments.append({"external_id": external_id, "body": body, "author": author, "created_at": None})
    # A total is only usable when it parses as a non-negative integer. Collection is complete
    # only when the page's own total was read, every item was captured, and no load-more
    # control remained. Anything else stays explicitly incomplete.
    total = snapshot.get("comments_total")
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        total = None
    # Complete only when the page's own total was read, every item was captured, the
    # adapter knows how to open a collapsed thread, and nothing remained to open.
    complete = bool(total is not None and len(comments) == total
                    and snapshot.get("comments_expandable") is True
                    and not snapshot.get("comments_expand_left"))
    return result(post, "alive", "The exact post was identified on its canonical page address (post link or stored title match).",
                  comments, total, complete)


def navigation_failure(post, error):
    code = re.search(r"ERR_[A-Z0-9_]+", str(error))
    outcome = "proxy_issue" if code and code.group() in PROXY_CODES else "network_error"
    return result(post, outcome, "Navigation could not finish; this does not establish post visibility.")
