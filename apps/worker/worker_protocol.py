"""Strict monitoring transport contracts; no network or browser operations."""

from datetime import datetime, timezone
import re
from uuid import UUID

from monitoring import validate_manifest


MIN_EXECUTION_SECONDS = 360
COMPLETION_RESERVE_SECONDS = 180  # Final navigation/cleanup plus three bounded RPC attempts.
MAX_LEASE_SECONDS = 900  # Ten-minute server lease plus bounded clock tolerance.
OUTCOMES = {"alive", "unavailable", "proxy_issue", "login_required", "verification_required",
            "network_error", "profile_error", "needs_review"}


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        raise ValueError("A zoned monitoring timestamp is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("A zoned monitoring timestamp is required")
    return parsed.astimezone(timezone.utc)


def validate_job(job):
    required = {"job_id", "publication_id", "profile_id", "url", "lease_token", "lease_expires_at"}
    if not isinstance(job, dict) or not required <= set(job) or set(job) - required - {"title", "account_label"}:
        raise ValueError("Unexpected monitoring job contract")
    for key in ("job_id", "lease_token"):
        if not isinstance(job[key], str) or str(UUID(job[key])) != job[key].lower():
            raise ValueError("A canonical job and lease UUID are required")
    timestamp(job["lease_expires_at"])
    post = {key: job[key] for key in ("publication_id", "profile_id", "url")}
    # The stored title is optional; without it only an in-card post link can identify a post.
    if "title" in job and job["title"] is not None and not isinstance(job["title"], str):
        raise ValueError("A stored post title must be text")
    if isinstance(job.get("title"), str) and job["title"].strip():
        post["title"] = job["title"]
    return validate_manifest({"version": 1, "posts": [post]})[0]


def remaining_lease(job, now=None):
    remaining = (timestamp(job["lease_expires_at"]) - (now or datetime.now(timezone.utc))).total_seconds()
    if not MIN_EXECUTION_SECONDS <= remaining <= MAX_LEASE_SECONDS:
        raise ValueError("Monitoring lease has insufficient or untrusted remaining time; reconcile without opening a profile")
    return remaining


def validate_completion(value):
    if type(value) is not bool:
        raise ValueError("Monitoring completion acknowledgment must be a boolean")
    # False means the same job/lease was already durably completed.
    return value


def validate_result(value):
    keys = {"outcome", "reason", "observed_at", "adapter_sha256", "comments",
            "comments_total", "comments_complete"}
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("Unexpected monitoring result contract")
    if value["outcome"] not in OUTCOMES or not isinstance(value["reason"], str) or not 1 <= len(value["reason"].strip()) <= 2000:
        raise ValueError("Invalid monitoring outcome or reason")
    timestamp(value["observed_at"])
    if not isinstance(value["adapter_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["adapter_sha256"]):
        raise ValueError("Invalid monitoring adapter fingerprint")
    total = value["comments_total"]
    if total is not None and (not isinstance(total, int) or isinstance(total, bool) or not 0 <= total <= 10_000_000):
        raise ValueError("Invalid comment total")
    if not isinstance(value["comments_complete"], bool):
        raise ValueError("Invalid comment completion flag")
    comments = value["comments"]
    if not isinstance(comments, list) or len(comments) > 200 or (value["outcome"] != "alive" and comments):
        raise ValueError("Invalid monitoring comments")
    if value["comments_complete"] and (total is None or len(comments) != total):
        raise ValueError("A complete collection must match the reported total")
    for comment in comments:
        if not isinstance(comment, dict) or set(comment) != {"external_id", "body", "author"}:
            raise ValueError("Invalid monitoring comment fields")
        for key, limit in (("external_id", 200), ("body", 5000), ("author", 200)):
            text = comment[key]
            if text is None and key == "author":
                continue
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= limit or "\0" in text:
                raise ValueError("Invalid monitoring comment bounds")
    return value


def completion_payload(value, fingerprint):
    comments = []
    for item in value["comments"]:
        if not isinstance(item, dict) or not isinstance(item.get("external_id"), str) or not isinstance(item.get("body"), str):
            continue
        if not 1 <= len(item["external_id"].strip()) <= 200 or not 1 <= len(item["body"].strip()) <= 5000:
            continue
        author = item.get("author")
        if not isinstance(author, str) or not author.strip() or len(author) > 200:
            author = None
        comments.append({"external_id": item["external_id"], "body": item["body"], "author": author})
    total = value.get("comments_total")
    if not isinstance(total, int) or isinstance(total, bool) or not 0 <= total <= 10_000_000:
        total = None
    complete = bool(value.get("comments_complete")) and total is not None and len(comments) == total
    return validate_result({"outcome": value["outcome"], "reason": value["reason"], "observed_at": value["observed_at"],
                            "adapter_sha256": fingerprint, "comments": comments,
                            "comments_total": total, "comments_complete": complete})
