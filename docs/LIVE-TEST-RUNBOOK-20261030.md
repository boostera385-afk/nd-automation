# Live test runbook — 2026-10-30

This is the operator procedure for the first supervised live test. It covers
**read-only monitoring** and the reporting chain. It does **not** authorize
Fudge uploads, publishing, profile creation or Sheet writeback delivery.

## What is already verified

| Item | Evidence |
| --- | --- |
| Hosted schema | 14 migrations; 28 public base tables, all RLS-enabled |
| New protocols | `20261030164030 check_cohort_v1`, `20261030164110 publish_jobs_v1`; both tables empty |
| Connector (live) | `npm run check:sheet` PASS: Auto Posting 69 rows, Auto Listing 111 rows, truncation false, wrong token refused |
| Web validation | typecheck, lint (0 warnings), 805 tests / 57 files, production build PASS |
| Worker unit tests | 65 PASS |
| Worker runtime | Python 3.13 `.venv` with the exact pins; `pip check` clean, `preflight.py` dependencies + Playwright import PASS, wheel SHA-256 verified |

## Hard preconditions (operator actions)

1. **Incogniton must be installed and running** on whichever machine hosts the
   worker, with the pilot profiles accessible. On this machine
   `python worker.py health` reports `unavailable`; there is no
   `%LOCALAPPDATA%\Incogniton`, no `Program Files` install, no running process,
   no uninstall entry and nothing listening on `127.0.0.1:35000`. The desk-side
   app therefore has to be installed (or the worker moved to the machine that
   already has it) before any browser check can run.
2. **A verified staff sign-in** to the dashboard for the `ND Test` workspace
   (`b59489ca-c7c3-4e1a-b2ae-ec9da429f415`). Live checks cannot be authorized
   from this session.
3. **Explicit pilot profiles.** Do not reuse a profile that the legacy desktop
   tool is currently using.

## Ordered setup

### 1. Confirm the runtime

From `apps/worker`:

```powershell
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe preflight.py
python -m unittest discover
```

`preflight.py` must report Python, the four pinned packages and the Playwright
sync-API import as `pass` (already confirmed in this environment). The connection,
adapter and hosted-credential checks stay blocked until steps 3–5.

### 2. Import profile inventory

1. Export the Incogniton profile inventory for the pilot profiles (ID, name,
   group only — never cookies, proxies or passwords).
2. Sign in to the dashboard, select **ND Test**, open **Profiles**, preview the
   CSV and import it.
3. Review every UUID/name/group claim. Do not guess a duplicate name.

### 3. Register and pair the worker

1. Open **Worker setup** (`/dashboard/automation`).
2. Register the real machine name and confirm the authorization checkbox.
3. Copy the private connection JSON **once** and save it as
   `apps/worker/.monitoring/worker.json`.
4. Never commit, paste into chat or share this file. It can claim assigned jobs.
5. If an old unused worker exists (`offive laptop`), leave it disabled; do not
   reuse a credential that was never paired.

### 4. Bind profiles to the right customer

For each pilot profile, create an explicit binding: worker + exact profile UUID
+ customer + account label. The account label must exactly match the label used
on tracked publications. Unknown or ambiguous mappings stay unbound.

### 5. Validate the monitoring adapter

Copy `monitoring-adapter.example.json` to `.monitoring/adapter.json` and fill
every selector only after inspecting an authorized post page with the pilot
profile. Required signals:

- exactly one visible post root containing the exact permalink and body;
- stable comment IDs and comment body inside that root;
- distinct login, verification, removed and unavailable notices.

Execution rejects empty or structurally invalid selectors. Do not invent
selectors or copy page content into the repository.

### 6. Create one work session and authorize monitoring

1. In the dashboard press **Start work** (an 8–10 hour human session).
2. Open **Worker setup** and enable monitoring for exactly the pilot binding.
3. Do not enable other profiles.

### 7. Run the agent in the foreground

```powershell
.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json
.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json --execute --confirm-authorized
```

The agent must claim only jobs for its bound profile and must stop at login or
verification prompts. Keep the machine awake and the operator present.

### 8. Queue the first checks

Use **Run automation → Refresh post statuses** (cohort) for one prior business
date, or wait for due checks. The cohort is capped at 500 publications and
requires the active session from step 6.

### 9. Verify the chain

| Check | Expected |
| --- | --- |
| `/dashboard/automation` | worker heartbeat and job lease visible; no second concurrent lease |
| `/dashboard/checks` | outcome recorded with source and exact post; proxy/login errors are “could not check” |
| `/dashboard/yesterday` | the prior Pacific business date includes the checked publications |
| `/dashboard/reports` | snapshot counts match the checks; no invented coverage |
| `/dashboard/run/cohorts` | immutable receipt with per-item dispositions; replayed request creates no new jobs |

## Stop and rollback

1. Stop the agent (Ctrl+C) and confirm the profile it opened is closed.
2. Press **End work** to close the session; pending checks for a closed session
   are cancelled by the next claim.
3. Disable monitoring for the pilot binding.
4. Revoke the worker if the credential may have been exposed.

Do not delete jobs, reset the database or retry an ambiguous submission.

## Still gated after this test

- Fudge `UPLOAD_RELEASED` / `CATALOG_DOWNLOAD_RELEASED` remain false.
- No publish adapter or enqueue action; the publish queue stays empty.
- No Sheet writeback delivery; the outbox remains queue-only.
- No automatic report archive or email delivery.
