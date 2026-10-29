# Local worker foundation

The new outbound dashboard agent is `agent.py`. See `docs/WORKER-BRIDGE.md`
from the project root for the applied staging migrations, private pairing
configuration, session authorization and staged acceptance requirements. Actual
worker pairing and live browser acceptance remain deferred.

## Offline preflight and reproducible runtime

`python preflight.py` requires no configuration to run. It reports missing
dependencies/private files with exit 1 and fixed redacted messages; it never
connects, installs anything, opens profiles or starts Playwright's driver.
`local_setup_ready` is only a local prerequisite result; `live_ready` remains
false because credentials, session/profile ownership, browser compatibility and
DOM accuracy require separate acceptance. The normal agent dry-run now reports
the same distinction. Execution refuses missing/drifted runtime pins before any
worker call or profile launch.

`requirements-monitoring.txt` pins the candidate package set, including
transitive runtime dependencies: Playwright 1.64.1, pyee 14.0.0, greenlet 3.5.6
and typing-extensions 4.16.0. PyPI metadata was checked on 2026-10-29; Python
>=3.12 is required by this set. Pins are reproducibility, not a vulnerability or
live Incogniton compatibility certification. No package/browser was installed by
the implementation. For the **later authorized setup**, use an isolated venv:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-monitoring.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe preflight.py
```

Do not run `playwright install` to substitute a new browser: this worker attaches
only to its explicitly authorized Incogniton profile. Candidate pins must be
reviewed against that browser before a supervised pilot. Private file inputs
remain `.monitoring/worker.json` and `.monitoring/adapter.json`, Git-ignored;
preflight accepts alternate explicit local paths without printing their contents.
The example's empty selectors deliberately fail, never invent a successful check.

Date-cohort dashboard code now queues existing monitoring job types only; its
new SQL is an undeployed draft. It never adds publisher/profile-mutation RPCs to
the agent and never enables monitoring bindings itself.

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
