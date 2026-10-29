"""Strict private connection contract shared by the agent and offline preflight."""

from urllib.parse import urlsplit


def validate_connection(value):
    expected = {"version", "supabase_url", "publishable_key", "worker_token"}
    if not isinstance(value, dict) or set(value) != expected or type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Invalid worker connection configuration")
    url = urlsplit(value["supabase_url"])
    if (url.scheme != "https" or not url.hostname or not url.hostname.endswith(".supabase.co")
            or url.netloc != url.hostname or url.path not in {"", "/"} or url.query or url.fragment):
        raise ValueError("Worker connection must use a hosted Supabase HTTPS project origin")
    key, token = value["publishable_key"], value["worker_token"]
    if not isinstance(key, str) or not key.startswith("sb_publishable_"):
        raise ValueError("A publishable key is required; secret/service-role keys are forbidden")
    if not isinstance(token, str) or len(token) != 64 or any(char not in "0123456789abcdef" for char in token):
        raise ValueError("Invalid worker credential format")
    return {**value, "supabase_url": value["supabase_url"].rstrip("/")}
