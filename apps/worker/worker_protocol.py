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
    if not isinstance(job, dict) or set(job) != {"job_id", "publication_id", "profile_id", "url", "lease_token", "lease_expires_at"}:
        raise ValueError("Unexpected monitoring job contract")
    for key in ("job_id", "lease_token"):
        if not isinstance(job[key], str) or str(UUID(job[key])) != job[key].lower():
            raise ValueError("A canonical job and lease UUID are required")
    timestamp(job["lease_expires_at"])
    return validate_manifest({"version": 1, "posts": [{key: job[key] for key in ("publication_id", "profile_id", "url")}]})[0]


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
    if not isinstance(value, dict) or set(value) != {"outcome", "reason", "observed_at", "adapter_sha256", "comments"}:
        raise ValueError("Unexpected monitoring result contract")
    if value["outcome"] not in OUTCOMES or not isinstance(value["reason"], str) or not 1 <= len(value["reason"].strip()) <= 2000:
        raise ValueError("Invalid monitoring outcome or reason")
    timestamp(value["observed_at"])
    if not isinstance(value["adapter_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["adapter_sha256"]):
        raise ValueError("Invalid monitoring adapter fingerprint")
    comments = value["comments"]
    if not isinstance(comments, list) or len(comments) > 200 or (value["outcome"] != "alive" and comments):
        raise ValueError("Invalid monitoring comments")
    for comment in comments:
        if not isinstance(comment, dict) or set(comment) != {"external_id", "body"}:
            raise ValueError("Invalid monitoring comment fields")
        for key, limit in (("external_id", 200), ("body", 5000)):
            if not isinstance(comment[key], str) or not 1 <= len(comment[key].strip()) <= limit or "\0" in comment[key]:
                raise ValueError("Invalid monitoring comment bounds")
    return value


def completion_payload(value, fingerprint):
    comments = [{"external_id": item["external_id"], "body": item["body"]} for item in value["comments"]
                if isinstance(item, dict) and isinstance(item.get("external_id"), str) and isinstance(item.get("body"), str)
                and 1 <= len(item["external_id"].strip()) <= 200 and 1 <= len(item["body"].strip()) <= 5000]
    return validate_result({"outcome": value["outcome"], "reason": value["reason"], "observed_at": value["observed_at"],
                            "adapter_sha256": fingerprint, "comments": comments})
