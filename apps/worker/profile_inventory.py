"""Validate and minimize an Incogniton profile inventory response.

This module performs no network calls and does not launch or modify profiles.
"""

import json


class InvalidInventory(ValueError):
    """The response cannot safely be interpreted as a profile inventory."""


def parse_inventory(payload):
    if not isinstance(payload, dict) or "profileData" not in payload:
        raise InvalidInventory("Missing profile data")
    profiles = payload["profileData"]
    if isinstance(profiles, str):
        try:
            profiles = json.loads(profiles)
        except (ValueError, RecursionError) as exc:
            raise InvalidInventory("Invalid profile data") from exc
    if not isinstance(profiles, list):
        raise InvalidInventory("Invalid profile data")

    result = []
    seen_ids = set()
    for profile in profiles:
        if not isinstance(profile, dict):
            raise InvalidInventory("Invalid profile record")
        info = profile.get("general_profile_information") or {}
        if not isinstance(info, dict):
            raise InvalidInventory("Invalid profile information")
        profile_id = info.get("browser_id") or profile.get("profile_browser_id")
        name = info.get("profile_name") or profile.get("profile_name")
        group = profile.get("group") or info.get("profile_group") or "Unassigned"
        if not all(isinstance(value, str) and value.strip() for value in (profile_id, name, group)):
            raise InvalidInventory("Profile identity is incomplete")
        profile_id, name, group = (value.strip() for value in (profile_id, name, group))
        if profile_id.casefold() in seen_ids:
            raise InvalidInventory("Duplicate profile ID")
        seen_ids.add(profile_id.casefold())
        result.append({"profile_id": profile_id, "name": name, "group": group})
    return result
