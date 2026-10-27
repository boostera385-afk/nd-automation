"""Local worker readiness probe. No jobs or browser operations are enabled."""

import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener


INCOGNITON_HEALTH_URL = "http://127.0.0.1:35000/alive"


def check_incogniton(opener=None):
    """Probe only the fixed local health endpoint without using a proxy."""
    opener = opener or build_opener(ProxyHandler({}))
    try:
        with opener.open(INCOGNITON_HEALTH_URL, timeout=5) as response:
            return {"status": "reachable" if response.status == 200 else "unavailable"}
    except (HTTPError, URLError, TimeoutError, OSError):
        return {"status": "unavailable"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["health"])
    parser.parse_args()
    print(json.dumps({"incogniton": check_incogniton(), "jobs_enabled": False}))


if __name__ == "__main__":
    main()
