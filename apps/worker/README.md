# Local worker foundation

## Simple dashboard controls (local follow-up)

See `docs/SIMPLE-COMPUTER-WORKFLOW.md` from the repository root. The optional
Windows launcher supplies fixed **Open Incogniton** and **Start profile helper**
links after one-time local setup. `agent.py --tasks-only` runs only explicitly
queued profile tasks with the same scoped credential, session gates, lock and
durable recovery; no DOM adapter or Playwright is needed for profile detection.
It does not monitor posts or claim publishing/supervised workflows. Neither
installation nor browser/real-account acceptance is established by source tests.

Source **0.1.3** adds separately confirmed bounded sequential publishing/delivery
and due-job polling (maximum 20 operations/eight hours, not a default daemon).
`publisher.py --media-registry` opts into the new media-capable claimant; image
bytes must match immutable approved descriptors on this device, then browser
file hashes/order, preview readiness and final audience are rechecked. Text-only
workers cannot lease image jobs. `stage_media.py` registers local originals;
`import_media.py` imports approved public HTTPS or authorized Drive images with
pinned public-address TLS, strict bounds and no token forwarding. Private paths,
bytes, URLs and credentials are never part of draft descriptors. These are source
implementations; do not enable/configure them before the later acceptance stage.
The working fudge extension is not modified by this code.

The new outbound dashboard agent is `agent.py`. See `docs/WORKER-BRIDGE.md`
from the project root for the applied staging migrations, private pairing
configuration, session authorization and staged acceptance requirements. Actual
worker pairing and live browser acceptance remain deferred.

## Separate Sheet writeback runner (source 0.1.2)

`sheet_writeback.py` is a stdlib-only, opt-in one-intent deliverer, independent of
Incogniton and the monitoring/publishing agent. See
`docs/SHEET-WRITEBACK-SETUP.md` at the project root for exact private configuration,
the separate atomic Apps Script deployment, stable row IDs/revisions and recovery.
Default invocation is offline. Execution requires explicit authorization, a verified
staff session, enabled private configuration and an enabled connector. Password
sign-in prompts locally without saving passwords/refresh tokens; enrolled MFA
requires an MFA-verified token instead. Service/admin keys are forbidden.

The runner journals before claim/acknowledgment, resolves lost commits by receipt
lookup and never writes during `--recover-results`. Literal-string cell updates
and the replay receipt commit together. It does not automatically create outbox
intents from monitoring, run a schedule or deliver a batch. No real Sheet was
written during development; live setup/ownership/permissions/acceptance are pending.

## Durable monitoring recovery (source implementation)

### Separate supervised text publisher (2026-11-02)

`publisher.py` is a separate, explicitly authorized one-job runner for approved
text posts/listings, not an always-on publishing mode in the normal agent. It
requires a locally reviewed exact-account/composer adapter, reads back approved
fields and audience, journals submit intent before its only click, requires exact
new body/author/permalink evidence, and replays saved receipts without repeating
browser actions. The normal agent refuses unresolved publishing checkpoints.
Both runners hold the same device lock and the hosted claimant guard excludes
browser-task leases as well as monitoring/publishing leases.

See `docs/SUPERVISED-PUBLISHING.md` for setup and recovery, and
`publishing-adapter.example.json` (deliberately incomplete/unreviewed). Live DOM,
authorized account and one-post/one-listing acceptance remain necessary; media,
unattended scheduling and account creation are not implemented by this pilot.
`verify_publisher_browser.py --browser <installed-browser-executable>` runs real
Playwright locators against intercepted synthetic HTML in a fresh isolated
browser: it is an integration fixture, not an Incogniton/platform test.

### Browser-task launch safety (2026-11-02; requires the session-gate migration)

Browser tasks are authorized for the exact operator work session that queued
them, not for the next session. Pause blocks new claims; closed/expired sessions
and revoked membership cancel pending authorizations. An in-flight task may
finish, but any outstanding lease still prevents overlap and needs explicit
reconciliation after a crash. The migration is
`supabase/migrations/202611020001_automation_session_gate.sql`; do not enable the
updated UI against an ungated task queue.

The worker rejects short/expired/far-future task leases. Cookie/proxy writes
refuse an active or unknown-state profile; cookie replacement stops if clearing
was not explicitly confirmed. Failure receipts contain a fixed safe message,
never raw local API exceptions or private paths. Inspect the local profile
before retrying a failed write; partial effects are possible and writes are not
automatically replayed. Monitoring's durable journal below does **not** provide
browser-task mutation recovery.

Profile discovery returns at most 500 entries and at most 45,000 UTF-8 JSON
bytes, with a total and a truthful partial flag. It is not pagination: repeated
scans refresh the same leading list. Use the existing CSV inventory import for
the remaining profiles. No scan opens a browser or reads cookie/proxy fields.

The agent rejects malformed/expired leases, leases with less than six minutes
remaining, and leases more than fifteen minutes ahead of the local UTC clock.
Keep the machine clock synchronized. Its browser-start budget reserves three
minutes for the final bounded navigation, cleanup and completion attempts; this
does not provide a hard kill of an in-flight browser/API operation.

Before profile launch, the agent atomically writes and flushes a private
journal under the shared per-user state root (`ND_WORKER_HOME`, else
`%LOCALAPPDATA%/NDAutomation/worker/state`; a legacy checkout
`.worker-state/monitoring-journal.json` must be migrated explicitly with
`worker_state.py --migrate-from <checkout> --confirm-stopped-all-old-workers`
— nothing is copied or discarded silently). It saves the bounded observation
before backend submission, accepts only a boolean completion receipt (false is
a valid idempotent replay), and clears saved comment text after
acknowledgment. A restart replays only the saved result, never a browser
action. Both normal execution and the result-only command use the same
exclusive local lock, shared across all future release directories and with
old checkouts. See `docs/WORKER-RELEASE-LIFECYCLE.md`.

To replay an existing result without importing Playwright, loading selectors or
touching Incogniton, after explicit authorization:

```powershell
python agent.py --connection .monitoring/worker.json --recover-results --confirm-authorized
```

Failed/expired/revoked result submissions retain the checkpoint and block new
claims; repair/reconciliation is required, not a fresh browser run. If the
backend acknowledged the result but profile cleanup was uncertain, inspect and
close only the worker-owned profile, then explicitly attest that exact saved
job UUID (this command itself never closes a browser or dispatches work):

```powershell
python agent.py --connection .monitoring/worker.json --confirm-profile-cleanup <exact-job-uuid> --confirm-authorized
```

A `claimed` checkpoint without an observation is never automatically replayed.
Stop the old agent, inspect/close only its owned profile and explicitly reconcile
the expired lease in the dashboard. Only after those actual operator steps,
attest the exact job and the missing observation:

```powershell
python agent.py --connection .monitoring/worker.json --confirm-lease-reconciled <exact-job-uuid> --acknowledge-observation-loss --confirm-authorized
```

This stores `operator_reconciled`, not `completed`; it cannot discard a saved
observation, makes no backend call, and does not verify server state or perform
cleanup itself. It dispatches nothing. A future explicit execution may proceed
only after the human prerequisite steps; do not use the attestation to bypass
them. Changed credentials cannot inherit an unresolved checkpoint. Clean terminal
metadata may be replaced by a separately configured worker. A corrupt journal
fails closed; do not delete it to force another claim. Power-loss/filesystem
guarantees, OS ACLs, restore and real operator recovery still need acceptance.
The file uses
private creation permissions where supported, inherits Windows directory ACLs,
is not encrypted, contains customer data while pending and must never be shared
or committed. Credential tokens are not stored in the journal.

This is monitoring-result recovery only, not a publisher submit journal,
complete backup/restore, or proof of live browser compatibility.

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
live Incogniton compatibility certification. The runtime was installed on
2026-10-30 in `apps/worker/.venv` (Python 3.13) with these exact pins; `pip check`
is clean, `preflight.py` passes the dependency and Playwright-import checks, and
the worker unit tests pass under it. That install does not prove browser
compatibility. For a fresh authorized setup, use an isolated venv:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-monitoring.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe preflight.py
```

If the PyPI CDN is unreachable, a mirror is acceptable **only** when the wheel
hash is verified against the digest published by PyPI (`pypi.org/pypi/<name>/<version>/json`)
before install; never install an unverified build.

Do not run `playwright install` to substitute a new browser: this worker attaches
only to its explicitly authorized Incogniton profile. Candidate pins must be
reviewed against that browser before a supervised pilot. Private file inputs
remain `.monitoring/worker.json` and `.monitoring/adapter.json`, Git-ignored;
preflight accepts alternate explicit local paths without printing their contents.
The example's empty selectors deliberately fail, never invent a successful check.

Date-cohort dashboard code now queues existing monitoring job types only; its
protocol is applied as hosted `20261030164030 check_cohort_v1`. It never adds
publisher/profile-mutation RPCs to the agent and never enables monitoring
bindings itself.

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
