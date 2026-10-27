# Local worker foundation

The new outbound dashboard agent is `agent.py`. See `docs/WORKER-BRIDGE.md`
from the project root for the applied staging migrations, private pairing
configuration, session authorization and staged acceptance requirements. Actual
worker pairing and live browser acceptance remain deferred.

This is an initial local-only readiness probe, not a connected automation worker.
It does not register with Supabase, receive jobs, enumerate profiles, launch a
browser, or make changes to Incogniton. It sends one HTTP request to the fixed
local Incogniton `/alive` endpoint without using a proxy.

A separate **local monitoring pilot runner** now exists in `monitor.py`; see
[MONITORING.md](MONITORING.md) for its opt-in execution, adapter requirements and
limitations. It is not connected to the dashboard, Supabase or Sheets.

From this directory, run:

```powershell
python worker.py health
python -m unittest test_worker
python -m unittest discover
```

`reachable` means the endpoint returned HTTP 200; it does not verify login,
profile access, browser compatibility or authorization. `unavailable` means the
probe did not get HTTP 200 and is not a diagnosis. Jobs are always disabled.

`profile_inventory.py` is an offline parser for future profile inventory work.
It emits only profile ID, name and group, rejects malformed or duplicate IDs,
and preserves duplicate names for explicit resolution. It is not connected to
Incogniton or the dashboard and does not transmit or store inventory.
