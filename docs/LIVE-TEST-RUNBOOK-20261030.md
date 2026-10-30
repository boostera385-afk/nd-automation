# Live test runbook — 2026-10-30

This is the operator procedure for the first supervised live test. It covers
**read-only monitoring** and the reporting chain. It does **not** authorize
Fudge uploads, publishing, profile creation or Sheet writeback delivery.

## What is already verified

| Item | Evidence |
| --- | --- |
| Hosted schema | 15 migrations (added `20261030203000 check_claim_identity`); 28 public base tables, all RLS-enabled |
| New protocols | `20261030164030 check_cohort_v1`, `20261030164110 publish_jobs_v1`; both tables empty |
| Connector (live) | `npm run check:sheet` PASS: Auto Posting 69 rows, Auto Listing 111 rows, truncation false, wrong token refused |
| Web validation | typecheck, lint (0 warnings), 805 tests / 57 files, production build PASS |
| Worker unit tests | **80 PASS** (75 + 5 identity/job-contract tests) |
| Worker runtime | Python 3.13 `.venv` with the exact pins; `pip check` clean, `preflight.py` dependencies + Playwright import PASS, wheel SHA-256 verified |
| Test-state cleanup | Old worker `offive laptop` revoked (0 credentials, 0 enabled workers); empty orphan org `ND Posts` deleted; `ND Test` has 0 bindings/publications/sessions |
| First live check | Job `ca03a6b3…50e5` completed `alive` on 2026-10-30 18:52:24Z for `Thomas Gutierrez`; second poll `idle`; profile back to `Ready` |

## Exact-post identity on Nextdoor (read before step 5)

Nextdoor serves a post permalink in a **feed shell**: the title bar still says
*News Feed*, several `feed-item-card` elements render, and **no card ever links
to its own post**. A contract that demands an in-card self-link can never be
satisfied, so the adapter accepts either identity signal:

1. an in-card visible link whose path equals the target post path; or
2. the page address equals the target path **and** the visible body matches the
   publication's stored title (normalized first 40 characters contained in the
   body, or ≥80% of the title's words longer than three letters).

Exactly one matching root is required. Without a stored title only signal 1
applies. Verified live on 2026-10-30: correct title matched with 100% word
overlap while every other card scored 0; wrong title, empty title and a different
target URL all returned `exact_post = false`.

## Hard preconditions (operator actions)

1. **Incogniton must be installed, running and signed in** on whichever machine
   hosts the worker, with the pilot profiles accessible. **Done on this machine
   on 2026-10-30:** Incogniton **5.0.1.5** is installed, signed in (3,220
   profiles / 33 groups) and answering on `127.0.0.1:35000`. The installer
   (`%USERPROFILE%\Downloads\IncognitonSetup-5.0.1.5.exe`, 191,171,088 bytes,
   SHA-256 `2eaad7bf69eb8bf91514bc13d0b3c1014eccb1eb611d0991f841e5581e10d4c4`)
   was verified before use: Authenticode **Valid**, signed by `WorkingGreen B.V.`
   through Sectigo EV code signing. Keep the app running and logged in for every
   test; a closed app makes every claim fail with `profile_error`.
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
5. The old unused worker `offive laptop` has already been revoked (credential
   deleted, jobs cancelled); register a new machine name instead and never reuse
   a credential that was never paired.

### 4. Bind profiles to the right customer

For each pilot profile, create an explicit binding: worker + exact profile UUID
+ customer + account label. The account label must exactly match the label used
on tracked publications. Unknown or ambiguous mappings stay unbound.

### 5. Validate the monitoring adapter

Fill `.monitoring/adapter.json` only from an authorized DOM inspection of a real
post page opened with the pilot profile. The values verified on 2026-10-30 are:

| Field | Verified value | Evidence |
| --- | --- | --- |
| `post_root` | `[data-testid="feed-item-card"]` | 11 cards on the post page, 5 with a body |
| `post_body` | `[data-testid="post-body"]` | 5 visible bodies |
| `post_link` | `a[href*="/p/"]` | never matches the post itself (see identity note) |
| `login` | `[data-testid="email-address-input"]` | absent/not visible while signed in |

`comment`, `comment_id_attribute`, `comment_body`, `removed`, `verification` and
`unavailable` are **deliberately non-matching placeholders**. The current build
exposes no per-comment identity attribute, and the `comment-avatar-container`
inside a post card belongs to the comment *composer*, not to a comment, so
guessing would misattribute text. Consequences, by design:

- comment capture stays empty and is stored as `comments_complete = false`;
- removal, verification and unavailable notices are never auto-confirmed — an
  unrecognized layout yields `needs_review`.

Execution rejects empty or structurally invalid selectors. Do not invent
selectors or copy page content into the repository. Re-derive these values before
relying on a new Incogniton/Nextdoor build.

### Why comment capture stays empty (verified 2026-10-30)

The pilot post and four other tracked post links were scanned at both the
profile's default window and at 1440×900 desktop emulation. In every case
`.comment-list-container` contained **no text**, no `button`, `role="button"` or
link containing the word "comment" was present, and at desktop width the list
container was not rendered at all. Comments only appear after opening a post's
detail view, which the read-only contract forbids (no click, no expansion).

Consequences, by design:

- the `comment`, `comment_body` and `comment_id_attribute` values stay
  non-matching;
- checks store `comments_total = null` and `comments_complete = false`;
- enabling comment capture needs an explicit, separately approved read-only
  expansion step, not an inferred selector.

### Where an undated post appears

Publications imported without a Sheet date are excluded from every dated cohort:
`/dashboard/reports` counts them in **`unknownDates`** with the coverage notice
"… post records have unknown publication dates and are excluded from day
cohorts", and `/dashboard/yesterday` will not list them. Their checks are still
visible on `/dashboard/checks` and in the post ledger. Never invent a date to
make a post appear in a report — import the date from the source or accept the
`unknownDates` accounting.

### 6. Create one work session and authorize monitoring

1. In the dashboard press **Start work** (an 8–10 hour human session).
2. Open **Worker setup** and enable monitoring for exactly the pilot binding.
3. Do not enable other profiles.

### 7. Run the agent in the foreground

```powershell
.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json
.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json --execute --confirm-authorized --once
```

Run the first poll with `--once` and watch it; drop `--once` only after that poll
returns `completed` or `idle`. The agent must claim only jobs for its bound
profile and must stop at login or verification prompts. Keep the machine awake
and the operator present. A `{"state":"idle"}` reply is normal on a second run —
checks are rate-limited to one per publication per 24 hours.

### 8. Queue the first checks

`reporting_claim_check` auto-plans jobs for monitored bindings: any publication
for the bound customer and account label that has no check in the last 24 hours,
including publications whose date is unknown. No cohort run is needed for a
first check. Use **Run automation → Refresh post statuses** (cohort) only when a
prior Pacific business date is known and you want a dated, receipted batch.

### 9. Verify the chain

| Check | Expected | Observed on 2026-10-30 |
| --- | --- | --- |
| `/dashboard/automation` | worker heartbeat and job lease visible; no second concurrent lease | 1 job, `completed`, fingerprint stored |
| `/dashboard/checks` | outcome recorded with source and exact post; proxy/login errors are “could not check” | `alive` / positive / `auto_check` |
| `/dashboard/yesterday` | the prior Pacific business date includes the checked publications | activity on 2026-10-30 18:52 UTC |
| `/dashboard/reports` | snapshot counts match the checks; no invented coverage | `comments_total` null (incomplete), no invented count |
| `/dashboard/run/cohorts` | immutable receipt with per-item dispositions; replayed request creates no new jobs | no cohort used; auto-plan path |

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
