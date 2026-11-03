"""Validate operator-supplied F01–F36 acceptance records, never manufacture them."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from worker_state import read_json

FEATURES = {f"F{number:02}" for number in range(1, 37)}


def evaluate(value):
    if (not isinstance(value, dict) or set(value) != {"version", "candidate_sha256", "features"} or
        type(value["version"]) is not int or value["version"] != 1 or
        not isinstance(value["candidate_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["candidate_sha256"]) or
        not isinstance(value["features"], dict) or set(value["features"]) != FEATURES):
        raise ValueError("Exactly F01–F36 and an immutable candidate fingerprint are required")
    blockers = []
    for feature, record in sorted(value["features"].items()):
        if not isinstance(record, dict) or set(record) != {"decision", "method", "approved_by", "approved_at", "evidence_sha256"}:
            raise ValueError("Invalid acceptance record")
        if record["decision"] == "pending":
            if any(record[key] is not None for key in ("method", "approved_by", "approved_at", "evidence_sha256")):
                raise ValueError("Pending decisions cannot claim acceptance evidence")
            blockers.append(feature); continue
        if record["decision"] not in {"accepted", "retired_with_approval"}:
            raise ValueError("Explicit acceptance or approved retirement required")
        expected = "user_present" if record["decision"] == "accepted" else "explicit_retirement_approval"
        if (record["method"] != expected or not isinstance(record["approved_by"], str) or
            not re.fullmatch(r"[A-Za-z0-9_-]{2,80}", record["approved_by"]) or
            not isinstance(record["evidence_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", record["evidence_sha256"])):
            raise ValueError("Synthetic tests cannot replace user-present acceptance or retirement approval")
        stamp = datetime.fromisoformat(record["approved_at"].replace("Z", "+00:00"))
        if stamp.tzinfo is None or stamp > datetime.now(timezone.utc): raise ValueError("Invalid approval timestamp")
    return {"state": "blocked" if blockers else "operator_attested", "open_features": blockers,
            "independently_verified": False, "desktop_retirement_authorized_by_tool": False}


def template(candidate):
    return {"version": 1, "candidate_sha256": candidate,
            "features": {feature: {"decision": "pending", "method": None, "approved_by": None, "approved_at": None, "evidence_sha256": None} for feature in sorted(FEATURES)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=Path)
    parser.add_argument("--template-for", help="Actual candidate SHA-256; template is printed, not saved")
    args = parser.parse_args()
    if bool(args.records) == bool(args.template_for): parser.error("Choose records or a pending template")
    if args.template_for:
        value = template(args.template_for); evaluate(value); print(json.dumps(value, indent=2)); return 0
    result = evaluate(read_json(args.records))
    print(json.dumps(result)); return 1 if result["open_features"] else 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except (ValueError, TypeError, OSError, KeyError, AttributeError): raise SystemExit("Acceptance blocked. Review private records; no real-account evidence was inferred.")
