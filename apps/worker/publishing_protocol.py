"""Strict text-only publishing contracts. No browser, network or remote code."""

from datetime import datetime, timezone
import re
from urllib.parse import urlsplit
from uuid import UUID

from monitoring import canonical_post_url
from worker_protocol import timestamp
from publishing_media import validate_media

OUTCOMES = {"submitted", "needs_reconciliation", "login_required", "verification_required",
            "proxy_issue", "network_error", "profile_error", "validation_error"}
COMMON = {"kind", "title", "body", "audience", "price_cents", "category"}
IDENTITY = {"job_id", "draft_id", "draft_revision", "customer_id", "profile_id",
            "account_label", "lease_token", "lease_expires_at"}
SELECTORS = {"open", "root", "body", "audience", "submit", "result_root", "result_link",
             "result_body", "result_author", "title", "price", "category", "result_title"}


def uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value.lower():
        raise ValueError("A canonical publishing UUID is required")
    return value.lower()


def text(value, maximum, minimum=1):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum or "\0" in value:
        raise ValueError("Invalid publishing text")
    return value


def account_url(value):
    text(value, 2048)
    url = urlsplit(value)
    if (url.scheme != "https" or url.netloc not in {"nextdoor.com", "www.nextdoor.com"}
            or url.query or url.fragment or not re.fullmatch(r"/profile/[A-Za-z0-9_-]+/?", url.path)):
        raise ValueError("Expected an exact Nextdoor account profile URL")
    return "https://nextdoor.com" + url.path.rstrip("/")


def validate_job(value):
    if not isinstance(value, dict) or set(value) not in (COMMON | IDENTITY, COMMON | IDENTITY | {"media"}):
        raise ValueError("Unexpected publishing job")
    if "media" in value:
        validate_media(value["media"])
    for key in ("job_id", "draft_id", "customer_id", "profile_id", "lease_token"):
        uuid(value[key])
    if type(value["draft_revision"]) is not int or value["draft_revision"] < 1:
        raise ValueError("Invalid approved revision")
    for key, limit in (("title", 200), ("body", 5000), ("account_label", 200)):
        text(value[key], limit, 3 if key == "title" else 1)
    if value["audience"] not in {"anyone", "nearby", "neighborhood"}:
        raise ValueError("Unsupported audience")
    if value["kind"] == "post":
        if value["category"] is not None or value["price_cents"] is not None:
            raise ValueError("A post cannot carry listing fields")
    elif value["kind"] == "listing":
        text(value["category"], 120)
        if type(value["price_cents"]) is not int or not 0 <= value["price_cents"] <= 1_000_000_000:
            raise ValueError("Invalid listing price")
    else:
        raise ValueError("Unsupported publishing kind")
    timestamp(value["lease_expires_at"])
    return value


def require_live_lease(job):
    remaining = (timestamp(job["lease_expires_at"]) - datetime.now(timezone.utc)).total_seconds()
    if not 360 <= remaining <= 900:
        raise ValueError("Publishing lease has insufficient or untrusted remaining time")
    return remaining


def validate_adapter(value):
    if (not isinstance(value, dict) or set(value) != {"version", "reviewed", "account", "login", "verification", "accounts", "forms"}
            or type(value["version"]) is not int or value["version"] != 1 or value["reviewed"] is not True):
        raise ValueError("A locally reviewed publishing adapter is required")
    for key in ("account", "login", "verification"):
        text(value[key], 500)
    if not isinstance(value["accounts"], dict) or not 1 <= len(value["accounts"]) <= 500:
        raise ValueError("Configure exact authorized account identities locally")
    for profile, identity in value["accounts"].items():
        uuid(profile)
        if not isinstance(identity, dict) or set(identity) != {"url", "label"}:
            raise ValueError("Unexpected account identity")
        account_url(identity["url"])
        text(identity["label"], 200)
    if not isinstance(value["forms"], dict) or not value["forms"] or set(value["forms"]) - {"post", "listing"}:
        raise ValueError("Configure only explicitly supported composer types")
    for kind, form in value["forms"].items():
        expected = SELECTORS | {"audiences", "audience_labels"}
        if not isinstance(form, dict) or set(form) not in (expected, expected | {"media"}):
            raise ValueError("Incomplete publishing form adapter")
        if "media" in form:
            media = form["media"]
            if not isinstance(media, dict) or set(media) != {"input", "preview", "ready", "result"}:
                raise ValueError("Incomplete locally reviewed attachment adapter")
            for selector in media.values():
                text(selector, 500)
        for key in SELECTORS:
            if kind == "post" and key in {"title", "price", "category", "result_title"} and form[key] == "":
                continue
            text(form[key], 500)
        for key in ("audiences", "audience_labels"):
            if not isinstance(form[key], dict) or set(form[key]) != {"anyone", "nearby", "neighborhood"}:
                raise ValueError("Explicit audience selectors and displayed labels are required")
            for label in form[key].values():
                text(label, 500)
    return value


def validate_result(value, kind=None):
    required = {"outcome", "reason", "adapter_sha256", "post_url", "published_at"}
    if not isinstance(value, dict) or set(value) != required or value["outcome"] not in OUTCOMES:
        raise ValueError("Unexpected publishing result")
    text(value["reason"], 2000)
    if not isinstance(value["adapter_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["adapter_sha256"]):
        raise ValueError("Invalid publishing adapter fingerprint")
    if value["outcome"] == "submitted":
        url = canonical_post_url(value["post_url"])
        if url != value["post_url"] or urlsplit(url).query or urlsplit(url).fragment:
            raise ValueError("An exact canonical submission URL is required")
        if kind and ("/p/" if kind == "post" else "/for_sale_and_free/") not in url:
            raise ValueError("Submission URL does not match its content kind")
        timestamp(value["published_at"])
    elif value["post_url"] is not None or value["published_at"] is not None:
        raise ValueError("Only a submitted result carries a publication URL/time")
    return value
