# Implementation status

## 2-step Master Sheet connection (2026-11-05)

The Sheet setup shrank from six panels — ending in "copy three env var values into
Vercel and redeploy" — to **two steps, once per workspace**, matching the worker
("check") credential model the team already uses:

- **Step 1 — Google (unchanged):** paste the Sheet URL, create the small
  read-only Apps Script connector, add `SHEET_ID` + `SYNC_TOKEN` Script
  properties, deploy as a Web app. The connector code itself is untouched.
- **Step 2 — Dashboard:** paste the `/exec` URL and the private token →
  **Save connection**, then **Test saved connection**. No hosting settings,
  restart or redeploy. A disclosure-folded **Disconnect** and an **Advanced:
  hosted environment settings** fallback (the old env-var path, which still
  takes precedence when present) live in the same panel.

**Storage.** New hosted migration `20261105220000_sheet_sync_settings.sql`:
`private_reporting.sheet_sync_settings` (one row per workspace; sheet id, `/exec`
endpoint and token formats enforced as CHECK constraints) behind three narrow
staff RPCs — `reporting_save_sheet_sync`, `reporting_get_sheet_sync`,
`reporting_clear_sheet_sync`. The table has no API grants (verified: anon and
customer members get `permission denied`); the token is stored, not hashed,
because the server must present it to Google on each read — it protects a
READ-ONLY metadata projection only and never re-renders on any page. Hosted
environment values win over the saved row so a deployment override cannot be
blocked by the database.

**Server resolution.** `sheet-sync.ts` resolves the connector env-first, then
the workspace row; every Sheet read (`fetchSheetRows`, `fetchMasterRows`,
`fetchMasterLayout`, `fetchMasterSections`) uses that chain. Pages and badges
now use `await sheetConnectionConfigured(org)` (env OR saved row); the legacy
sync `sheetSyncConfigured` remains as the env-only signal.

**Validation.** New PGlite suite `sheet-sync-settings-db.test.ts` (6 tests):
staff save/replace/read/clear, in-place upsert with `updated_by` audit, format
enforcement at the database (including Postgres `RE_DUP_MAX` learned the hard
way: `{24,256}` rejected → bounded-length + charset checks), and no API
reachability of the raw table. Transport suite extended (5 tests): saved-row
resolution, env override precedence, malformed rows never contacting Google,
no-db callers never crashing, badge semantics. Action suite extended (4 tests):
save validation gating (Sheet from step 1, `/exec` URL, token shape,
confirmation), friendly error mapping, refresh of every gated view. Setup
guide and Settings page text updated to the 2-step flow with env vars as the
advanced option.

## Gap-closure tranche: edge outcomes, self-healing leases, paged job history (2026-11-05)

Three reviewed gaps closed under explicit user direction; nothing else was
claimed as done and publishing stays gated.

**1. Edge-outcome coverage (worker).** The page states that previously had
only a synthetic `needs_review` behind them now have check_page-level fixtures
in `apps/worker/test_monitoring.py`: removal-like notice → `needs_review` (never
`deleted_from_nd`), `unavailable` notice → `unavailable`, login wall →
`login_required`, verification wall → `verification_required`, HTTP 4xx →
`needs_review`, HTTP 5xx → `network_error`, `ERR_PROXY_CONNECTION_FAILED` →
`proxy_issue`, navigation timeout → `network_error`, `/account_disabled`
redirect → `needs_review`, and a page with no post signal → `needs_review`.
Worker suite: **40 tests, PASS** (was 30). Real-page proof of these states is
still unexercised and remains in the runbook.

**2. Self-healing expired leases (database, hosted).** One crashed run used to
pin the laptop's queue until a person clicked "Reconcile expired lease".
`reporting_claim_check` and `private_reporting.claim_browser_task` now cancel
this worker's expired check/task leases — exactly the state the manual buttons
write (`status='cancelled'`, token cleared; tasks also get `completed_at` and a
release note), then return null for that call. The expired claim is **not**
retried automatically; the next poll (~15 s) plans and claims fresh due work.
Publish leases stay manual (`needs_reconciliation` requires an operator). It
took three iterations the same day, recorded honestly in the migration files:
- `20261105200000_expired_lease_self_heal.sql` (v1) claimed fresh work in the
  same call — crossed the no-automatic-retry contract.
- `20261105203000_expired_lease_self_heal_v2.sql` (v2) fixed the retry rule but
  replayed the pre-supervised-workflows task body.
- `20261105210000_expired_lease_self_heal_v3.sql` (v3, **current**) patches the
  real private claimant and restores both public wrappers.
Hosted verification: function bodies inspected via `pg_proc` — self-heal
present in `reporting_claim_check` and `claim_browser_task`, the supervised
gates (`workflow_target_current`) intact, both wrappers back to one-line SQL.
New acceptance test keeps the contract explicit: an expired lease releases at
the next claim, is cancelled, never retried in that call, and a follow-up
claim plans fresh work with a new job id.

**3. Job history paging (web).** Automation control showed only the latest 100
jobs. It now pages `?jobs_page=n` (100 per page, `min 0 / max 999`), with
Newer/Older links and an honest "beyond history" empty state. Unrelated to the
"latest-100-per-profile" cohort policy, which stays deliberately separate.

| Validation | Result |
|---|---|
| `python -m unittest test_monitoring` | **40/40 PASS** |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS, 0 warnings |
| `npm.cmd test` | **87 files, 1159 tests PASS** (incl. four lease/task/check DB suites, 193/193) |
| `npm.cmd run build` | PASS — Next.js 16.4.3, 14 static pages, 44 dynamic routes |

Still unproven: real-page edge outcomes (deleted post, logged-out session,
proxy failure) on live Nextdoor; publishing; profile/cookie/proxy workflows.

Deployed to production with the user's explicit approval (commit `d459aaa`):

| Item | Value |
|---|---|
| Deployment id | `dpl_CbniKeieokUg68JevSuiY7LUcvZN` |
| Immutable URL | `https://nd-automation-dashboard-aoiut1kjh-jelly-bean2.vercel.app` |
| Production alias | `https://nd-automation-dashboard.vercel.app` |
| State | `READY`, target `production` |
| `check:deployment` | PASS — 5 of 5 route checks; authenticated readiness unverified |
## Production deploy of the monitoring fixes (2026-11-04)

Commit `c156fc3` (pushed to `main`) carried the bounded CDP attach, the
identity-based comment open/expand scripts, the author-link fix and the dynamic
"Comments on page" counts. Deployed from `apps/web` with explicit user approval:

| Item | Value |
|---|---|
| Deployment id | `dpl_DsBQYHVqoc6rapcxaAZ65GarvwYY` |
| Immutable URL | `https://nd-automation-dashboard-j4a6n4elo-jelly-bean2.vercel.app` |
| Production alias | `https://nd-automation-dashboard.vercel.app` |
| State | `READY`, target `production` |
| `check:deployment` | PASS — 5 of 5 route checks; authenticated readiness unverified |

Deploying the web app does not push worker code to the laptop; the helper still
runs its locally installed `monitor.py`.

## First live read-only post check on the employee laptop (2026-11-04)

Goal: prove the prepared employee laptop can open one real Nextdoor post through
the local helper, read it, and have the outcome recorded in the hosted database —
without any write action. Target was publication
`a4b9cf83-1708-41ab-9e4a-fc4f03a6dc4b` (`https://nextdoor.com/p/YbqRxq7_y_8J`,
workspace `ND Test`), binding `b4330e39-d6ae-4059-9ca1-31221fe25e2b`, worker
`Haseeb ND PC`, Incogniton profile `Melvin James` (group `Austin`), adapter
`monitoring-adapter.json` version 2 (read-only selectors).

**Defect found and fixed: `connect_browser` in `apps/worker/monitor.py`.** The
runner attached with a single `chromium.connect_over_cdp(endpoint, timeout=30000)`
call immediately after Incogniton returned its `puppeteerUrl`. Incogniton answers
before Chrome is listening on that port, so the attach intermittently raised
`connect ECONNREFUSED 127.0.0.1:<port>` and `run_batch` reported the generic
`profile_error` ("Profile was busy, unknown, or could not be opened safely") even
though the browser had opened normally. Traced live: `/profile/status` returned
`Ready`, `/automation/launch/puppeteer/<id>` returned `ok` after 8.5 s, and the
failure happened only at the CDP attach. The new helper retries the attach for a
bounded **45 s** (2 s spacing) and then waits for the default browser context
before returning. It never retries a navigation or page action, and a permanently
dead port still raises after the deadline, so real profile failures stay visible.
`run_batch` now calls `connect_browser(chromium, endpoint)` instead of the inline
attach/context check. Nothing else in the runner, claim, or adapter contract
changed.

**Live result: `alive`.** Job `7ce17e26-4c7f-4e50-9cb7-953e0c625f1a` completed in
**55 s** and recorded **`needs_review`** — the correct verdict at that moment,
because the publication title was the 17-character placeholder
`Test post YbqRxq7` and the identity matcher refuses titles under
`TITLE_MIN_CHARS = 20` before comparing anything, so no card could match.

A supervised read-only DOM capture then proved the target was present: card
index 0, author `ATX Handyman`, `data-testid="post-body"` carrying
"TV mounting Service in South Austin, from $100 flat rate…", and
`self_links: []` on every card — confirming again that Nextdoor never renders a
self-link inside a post card, so the stored-title rule is the only usable
identity signal. A corrected title (the post's real opening text, 57 characters)
was written to the publication; **no selector or matcher code changed**.

Job `17bbf2e6-439d-43eb-8487-3b2932cbf939` then completed in **47 s** and
recorded **`alive`** — check `fdeb868a-7310-4f8e-b965-8f569a0c80d7`, tone
`positive`, observation `23cff2d4-3cad-42fb-a785-8cbe12128cb0`, publication
`visibility = live`. This is the first verified end-to-end read-only check on the
employee laptop: real profile launch, real CDP attach, real page read, result
stored in the hosted database. Four earlier jobs (`ad94c760…`, `7b40bd67…`,
`e1d71bbe…`, `f0b4e916…`) had ended in `profile_error` before the attach fix.
Verified afterwards: 0 pending/leased check jobs, publish jobs and automation
tasks; no Nextdoor write of any kind.

**App-planned run, no manual job rows.** Because every earlier job had been
inserted by the operator, the daily path itself was still unproven. It was then
exercised for real: the employee session `1bc51648-e9af-4dee-9b03-0b8d7c691cd0`
was started, the **Run automation** page enabled due checks for `ATX Handyman`
(binding `b4330e39…` then pointed at that active session), and the helper was
polled four times. No job row was inserted by hand. Both qualifying publications
were planned **inside one `reporting_claim_check` transaction** — identical
`created_at 20:52:19.869439` — which only the server planner can produce:

| Job | Target | Outcome |
|---|---|---|
| `15ba91e2-d247-48b7-af66-96b382672d13` | real post, `www.` host | **`alive`**, observation `e48c81c5-872c-4bed-89bd-b25eab0bc1bf`, 45 s |
| `ebf36b91-a0bd-4fb2-80b5-5c1ac2949182` | synthetic non-existent post | **`needs_review`**, "Navigation did not remain on the exact post", 61 s |

Leases ran 20:52:19 → 20:53:05 and 20:53:15 → 20:54:16 with no overlap — one
profile at a time. Polls 3 and 4 returned `idle`, proving the queue drained and
that finished posts are not re-planned inside 24 hours. The synthetic target kept
`visibility = not_checked`, because nothing about it was ever confirmed. Session
closed at 20:55:54 UTC; 0 active sessions and 0 open checks, publishes or tasks
afterwards. The synthetic negative-test publication `545734f2…` was later removed
together with its job and its negative check (deletion requires removing the job
first: `reporting_check_jobs` is `NO ACTION`). The `f536f84c…` publication
(`www.` host of the same real post) was deliberately kept, because it is the only
database record showing the server planner acting on a real post.

**Comment collection was unproven at that point — now proven (2026-11-04 21:49 UTC).**
The earlier capture looked at the feed shell only, where no comment list is
mounted; comments live in a thread that opens on a click. A supervised capture of
the opened thread confirmed the adapter selectors were already correct and found
two worker defects, both fixed in `apps/worker/monitor.py`:

1. `comment_author` matched the comment avatar link first, whose text is empty,
   so every author would have been stored as "Author not collected". The
   extractor now takes the first matching link that actually has text.
2. The thread open/expand scripts acted on the first post card rather than the
   uniquely identified one. They now reuse the snapshot's title/link identity
   rule and refuse to click when the card is not unique.

Session `850dc336-f3a1-4d94-98ac-0e9453f3800b` then ran one app-planned job,
`7c575ec4-1441-43c3-8750-1c660d596878`, against publication `8cd5d871…` (the same
drywall post on its `www.` host, because the original was inside its 24-hour
window). The helper was started **before** checks were enabled, in continuous mode
with `--allow-comment-expansion`. The job was planned at 21:49:27.055788 and
leased 28 ms later by the already-running loop, then completed in 61 s:

| Result | Value |
|---|---|
| Outcome | **`alive`** |
| Comments stored | **14 of 14** |
| Authors captured | **14 of 14** |
| `comments_total` | 14 |
| `comments_complete` | **true** |
| Notification | "all 14 comments captured" |

All 14 rows are `source = auto_check` and share one check timestamp, so they came
from a single read of one thread. This also settles the continuous-loop question:
the claim came from a poller that was already waiting, not from a command started
after the job appeared. Session closed 21:51:06 UTC; 0 open jobs, 0 active
sessions.

**Multi-post batch added (2026-11-04 21:17 UTC).** Session
`b12e83f7-4c84-4c5b-b59d-e14112f753c0` ran three distinct real posts, each
tracked with its exact on-page opening text: jobs `17cd9352…` (dimmer switches,
53 s), `2f557623…` (drywall cracks, 55 s) and `2f67dba7…` (TV wall mounting,
50 s) — all **`alive`**, all `visibility = live`. The three jobs shared one
`created_at` (`21:17:27.82403`), proving a single server-side planning
transaction, and were leased strictly in sequence with no overlap
(21:17:27→21:18:20, 21:18:30→21:19:25, 21:19:35→21:20:25). The two posts already
checked inside 24 hours were not re-queued. Session closed at 21:20:58 UTC;
0 open jobs and 0 active sessions afterwards. Still unproven: real page-level
edge outcomes (deleted post, logged-out session, proxy failure).

Validation after the comment changes: `python -m py_compile monitor.py` PASS,
`python -m unittest test_monitoring` **30 tests PASS** (the new test asserts both
interactive scripts receive the same target and title), and Node `--check`
accepted all three rewritten JS functions. The gallery-wide worker suite was not
rerun; no web code changed. Posting, onboarding, cookie/proxy writes and Sheet
writes remain untouched and gated.

**Dashboard accuracy fix and full validation (2026-11-04).** The Results table
was showing Nextdoor's own comment counter under a column headed "Comments",
which read as "11 comments saved" when 0 comments are stored. The header is now
**"Comments on page"**. The cell always says "reported by Nextdoor", and adds
"· N saved" only when stored comments were loaded for that post. It says
"· none saved" only when a zero count is positively known, and makes no saved
claim when the caller did not load comments. The platform value is unchanged and
still `null` when nothing was read. The same counts are passed on the dashboard,
posts, sessions and Results views; a new fixture test
(`tests/publication-table-ui.test.tsx`) covers all four label states.
Validation from `apps/web` on the final code state, all four run:

| Command | Result |
|---|---|
| `npm.cmd run typecheck` | PASS (no output, exit 0) |
| `npm.cmd run lint` | PASS, 0 warnings |
| `npm.cmd test` | PASS — 87 files, 1158 tests |
| `npm.cmd run build` | PASS — Next.js 16.4.3, 14 static pages, 44 dynamic routes |

## Admin-managed setup / employee daily workflow (2026-11-04 device date)

The operator requested central admin configuration so employees sign in with
their added email and run daily work on a laptop prepared once with admin help.
The current runbook is **`docs/ADMIN-EMPLOYEE-WORKFLOW.md`**; it records the exact
responsibility split, one-time prerequisites/pairing, daily routine and next live
acceptance gates. Private employee emails are intentionally not recorded here.

Implemented locally (not deployed to Vercel):
- Owner/admin setup gates on real server actions for customer creation, helper
  registration/revocation/replacement, profile mapping, inventory import/archive.
  Verified identity, live membership and stale-form workspace guards still run;
  submitted role claims are never trusted.
- Operator Home/Profiles/Settings/computer help no longer require repeated
  detection/import/customer mapping or expose credential-registration controls.
  Shared saved inventory/mappings remain visible, and daily session/task controls
  remain available. Direct setup actions are denied even without using the UI.
- Full inventory loading pages below the Data API's row cap (up to 5,000 rows),
  checks pagination/count consistency, and labels larger windows as partial.
  Search and 50-row table pages cover all loaded profiles, not just the first
  API response. Multiple helpers show short IDs and require deliberate selection.

**Approved hosted database enforcement:** `supabase/proposals/admin_managed_setup.sql`
preserves six existing setup RPC implementations behind client-denied private
functions, adds verified owner/admin wrappers, and restricts customer INSERT /
UPDATE RLS while leaving SELECT and daily execution unchanged. After explicit
approval it was applied as **`admin_managed_setup_v1`**, hosted record
**`20261103204414`** (33 migration records). Live verification PASS: all six
original function bodies preserved by fingerprint, private implementations
anon/authenticated-denied, public wrappers anon-denied/authenticated-executable,
all SECURITY DEFINER / empty search path; customer SELECT unchanged and
INSERT/UPDATE now owner/admin-only. Security adviser classes/counts unchanged
(private credentials no-policy INFO; worker anon-executable 9, guarded
authenticated-executable 44, existing leaked-password-protection WARN).

Validation: `npm.cmd run typecheck` PASS; `npm.cmd run lint` PASS; full
`npm.cmd test` PASS, **1,115 tests / 84 files**. Targeted UI/guard/database checks
also PASS (77 tests), including operator setup denial, verified-admin checks,
shared reads, retained daily dispatch, full 3,135-row API pagination and 50-row
searchable rendering. `npm.cmd run build` PASS (Next.js 16.4.3, webpack;
compilation, TypeScript, page generation and build traces completed).

Employee login acceptance is still pending: the operator reported a hydration
attribute warning at local `/login`. An isolated Playwright visit to that same
URL loaded with **zero console errors/warnings**. No credentials were entered.
The issue is not yet reproduced; compare a fresh Chrome Incognito window and
the expanded client/server attribute diff before changing rendering or broadly
suppressing warnings. Browser extension/profile interference is a possibility,
not a confirmed cause. No Auth/RLS changes were made for this warning.

**User-present employee view PASS (screenshots, same developer computer):** the
operator subsequently signed in with the existing employee account; screenshots
show the simplified daily Home, **ND Test / Operator**, shared inventory
**3,135 of 3,135** (page 1 of 63), search, and the existing customer mapping.
No admin import/mapping controls appear in the shown operator view. This is
browser evidence of login/shared views, not an employee-laptop execution test.
The earlier dev hydration issue indicator remains visible and unresolved.
The mapped helper is shown offline/stale. The first fresh MCP attempt failed on
transient DNS; one retry succeeded and confirmed the employee is operator in
the team workspace, **3,135 inventory rows**, **zero open employee sessions**,
and helper heartbeat about **38 minutes stale**. Helper startup and a new
employee-authorized task remain the next gates; no new automation was claimed.

**Employee-role read-only execution PASS (same developer computer):** after the
user started the helper and an operator work session, the employee explicitly
queued `inventory_scan`. Hosted verification confirms correct creator/session
ownership and operator role, claim at **2026-11-03 21:09:13 UTC**, completion at
**21:09:20 UTC**, **3,135 detected / 3,135 stored**, `truncated=false`, no error,
and a fresh helper heartbeat. Existing inventory/mappings were not reimported or
changed. The user ended the employee session; hosted verification confirms
`closed` at **2026-11-03 21:11:45 UTC**, **7.6 minutes** elapsed and **zero open
automation tasks**. The same-device employee login/shared-view/session/scan pilot
is complete. Physical employee-laptop setup and platform-action pilots remain
separate acceptance gates.

**Master Sheet read-only checkpoint (same operator session, now closed):** the
user opened Master Sheet and Auto Posting showed no recognized task metadata.
`apps/web`: `npm.cmd run check:sheet` PASS against the configured connector:
Auto Posting returned **0 records**, Auto Listing **111 records**, both HTTP 200
and not truncated; an invalid token was refused. Row contents, connector URL and
secret token were not printed. This verifies the existing `getPostRecords` read
path and token enforcement, not successful importing, publishing or platform
visibility. The operator clarified that they have **not connected their intended
Sheet yet**. The check used pre-existing local configuration; its source must not
be assumed to be the intended customer/master Sheet. Pause sync/import until the
admin verifies/configures the intended source. No sync/import or Sheet write was
performed by this check; intended-Sheet acceptance is still pending.

**Intended ND Master layout identified from user screenshot:** the user already
has a cleaned operational workbook with date details and named regional/work
tabs. The shown tab has a date banner in row 1 and business headers in row 2,
including Services, Content, Date Posted, Final Rephrasing, Post Type, Pictures,
Areas, State and Post Links. This is not the legacy row-1 Auto Posting / Auto
Listing contract used by `reporting-sync.gs`. Do not require another spreadsheet,
rename existing tabs, overwrite the Fudge script, or treat the earlier configured
development connector's records as this source. A read-only layout review and
explicit field/tab/date mapping are required before connecting/importing this
workbook. The exact account/profile identity field and actual-posted versus
planned/banner dates are not established by the screenshot; never infer them
from phone numbers, areas, row order or a date banner. No Sheet edits or adapter
implementation are claimed at this checkpoint; private workbook links stay out
of repository docs.

**Read-only layout inspection of the operator's linking workbook (2026-11-04):**
anonymous, read-only access to the one shared tab returned a single date banner in
**row 1** (`11/4/2026 Wednesday`) and headers in **row 2** across **17 used
columns** (A–Q): `Services FUDGE`, `Content`, `Date Posted`, `Finding Keywords`,
`Numbers`, `Final Rephrasing`, `Post Type`, `Pictures`, `Areas`, `State`,
`Issues`, `Post Status`, `Account Name`, `Ranking`, (blank), `Remarks`, and a
stray data value `Fudge Row= 941` occupying the Q header cell. **123 data rows**
exist under that banner. Only A, B, D, E, F, G, H, I, J and M are populated;
`Date Posted`, `Issues`, `Post Status`, `Ranking`, `Remarks` and Q are empty in
this window. **No post-link column exists in that tab**, so the Nextdoor link the
operator mentioned is either on another tab or added after posting. The anonymous
view exposed one tab only; the full tab list is not visible without the workbook's
own Apps Script. `Account Name` holds persona names (e.g. one person-style name),
which may correspond to Incogniton profile names but is **not yet verified** against
the 3,135 imported profiles.

Consequence: the legacy `getPostRecords`/`getTaskRows` contract (headers in row 1,
`Profile Name`/`Post link`/`Status`) **cannot read this workbook**. Nothing was
imported, synced, written or mapped, and no planned date was treated as a
publication timestamp.

**New read-only capability (implemented, unit-tested, not deployed):** the
connector gained `getMasterLayout`, which reports tab names, row/column counts, the
detected header row, a planned calendar date from a row-1 banner, and column
labels matching an allowlist. Unrecognised header text is counted, never returned;
no data cell, credential value, URL or token is emitted. `apps/web` gained
`npm.cmd run check:master-layout` (optional `SHEET_PROBE_URL` / `SHEET_PROBE_TOKEN`
override so a probe never edits the saved workspace connection). Targeted tests
`tests/apps-script.test.ts`, `tests/sheet-setup.test.ts` and
`tests/sheet-transport.test.ts` PASS (**55 tests**, including exact-range reads,
date-banner parsing, credential-value exclusion, 30-tab and 40-column caps, and
token refusal). The generated connector artifact was regenerated. This is
structure discovery only; workbook sync still needs explicit tab, identity and
link-column confirmation.

Validation on the 2026-11-04 device date: `npm.cmd run typecheck` PASS,
`npm.cmd run lint` PASS (0 warnings), full `npm.cmd test` PASS **1,119 tests /
84 files**, `npm.cmd run build` PASS. Live probe
`npm.cmd run check:master-layout` against the saved development connector:
reachable (HTTP 200) but the deployed Apps Script predates this action and
refused it with `invalid_action`, so **no workbook structure was discovered
remotely**. That is expected until the current script is redeployed against the
intended workbook; the deployed connector was not modified and no Sheet cell was
read as data or written.

**Re-inspection after the operator added a full test day (same workbook, still
read-only):** the workbook is now a **multi-section** layout, not one table:

| Section | Banner (row) | Header row | Task rows | Nextdoor `/p/` links | Status marked |
|---|---|---|---|---:|---:|
| 1 | `11/4/2026` (1) | 2 | 3–125 (123) | **0** | 0 |
| 2 | `11/3/2026` (126) | 127 | 128–250 (123) | **85** | 116 |
| — | `11/4/2026` (251) | none | none | 0 | 0 |

Verified facts: the **Nextdoor post links live in column K**, whose header still
reads `Issues`; all 85 are unique `nextdoor.com/p/…` URLs, none duplicated (26 of
them carried a query string, which is why the reader tolerates and strips one).
All 85 also carry a status, but **31 further rows marked `Posted`/`posted` have no
link**; `Date Posted` (column C) is empty in every row, so the only date is the
section banner (a plan date, not a publication timestamp). Status text is
inconsistent (`Posted` 91 / `posted` 25). The **top `11/4` section is the fresh
plan** (0 links, 0 statuses, **53 of its 123 rows have no `Account Name`**); the
`11/3` section holds the completed day. The trailing `11/4/2026` banner at row 251
has no header row or data and looks accidental. Identity check against hosted
inventory: of **38 distinct `Account Name` values, 37 match an active inventory
profile exactly** (punctuation-tolerant check gives the same 37); **one
10-character name matches nothing**, so that persona cannot be mapped or launched
yet. Only counts were queried; no name, phone, link or content value was printed or
stored. Because a section repeats the header row, the legacy row-1 contract and any
naive "headers in row 1/2" reader would mis-read this file; a section-aware
mapping is required. No Sheet edit, import, mapping, sync or write was performed,
and the public link exposure noted above still applies.

**Read-consistency note:** one narrow Google `gviz` range read initially returned a
stale snapshot that placed the 85 links in the top section. A full-grid read plus
two independent runs of the shipped connector agreed on the arrangement above, so
those are the recorded numbers. The public `gviz` endpoint is not a consistency
API; the Apps Script connector is the authoritative read path, and the workbook is
being edited during testing, so every count is a snapshot.

**Dated-plan reader implemented (read-only, local, not deployed):** the connector
now has `getMasterSections`, which reads a tab as dated sections (column-A banner,
repeated header row, rows beneath) and returns only mapped safe fields —
Account/Profile Name, status, one-line title, service, area, state and an
**exact Nextdoor link**. Decisions taken, all on the side of refusing rather than
guessing:

- **Link column is never inferred from data.** It must carry a recognised header
  (`Post link`/`Nextdoor link`/…) or be declared with `SHEET_MASTER_LINK_HEADER`.
  For this workbook the declared value is `Issues`. Without a declaration the
  reader returns `link_column_missing` and no links, so a real issues column can
  never be mistaken for links.
- **Links are rebuilt, not trusted.** Only `https://…nextdoor.com|co.uk/p|for_sale_and_free/ID`
  survives; query strings and fragments are stripped, and anything else (including
  `javascript:`) is dropped and counted in `rejectedLinks`. 26 of the 85 real
  links carried query strings, so tolerance plus normalisation was required.
- **Plan date comes from the banner**, never from `Date Posted` (empty in every
  row). The `11/3` section keeps its own date instead of being assumed to be
  "yesterday".
- **Only mapped columns are fetched**: phone (E), pictures (H), remarks (P),
  content body and every credential column are never read. The one-line title is
  taken from `Final Rephrasing` (priority) or `Content`.
- **Bounds:** 4,000 scanned rows, 8 sections, 2,400 returned rows, with honest
  `truncated` flags.

Web side: `apps/web/src/lib/master-sections.ts` (strict zod schema that rejects an
extra field such as `phone`, plus a counts-only summary that keeps a `Posted`
claim separate from a verified observation), `fetchMasterSections` in
`lib/sheet-sync.ts` behind the same workspace/token gate and an older-connector
message, and `npm.cmd run check:master-sections -- "<tab>"` (counts only; no name,
phone, content, link or token printed).

Validation: `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS (0 warnings),
full `npm.cmd test` PASS **1,138 tests / 85 files**, `npm.cmd run build` PASS. The
new tests cover section detection with two banners, header-priority title
selection, exact-range reads proving phone/pictures/remarks are never fetched,
link normalisation and rejection, the no-guess link rule, missing declared header,
token refusal, strict schema rejection of an extra field, and the summary's
posted-with/without-link split. The live check available at that point refused
`invalid_action` because the then-saved deployment ran the older script, so no real
section was read through that deployment; the real read came later, once the
owner's deployment was correct.

**Real-workbook verification of the shipped connector code:** the repository's
unmodified `reporting-sync.gs` was executed in a local VM against the live,
publicly readable workbook (read-only Google `gviz` fetch, no credentials). Result:
246 projected rows over two sections; the `11/3` section produced **85 exact
Nextdoor links with 31 posted-without-link rows**, the top `11/4` plan produced
**no links**, the detected columns were `profile M, link K (declared), status L,
title F, service A, area I, state J`, and `warnings` was empty. Omitting the
declaration returned `link_column_missing` and **zero link values**, proving the
reader does not guess. Every returned link was a canonical Nextdoor URL; phone,
content and remarks values did not appear in the output. This validates the reader
logic against real data, not the deployed Apps Script (which was still older at
that point) and not any import or publication.

**Connector connected to the owner's real workbook (2026-11-04):** the owner
created a separate Apps Script project and deployed it as a Web app. Three
deployment attempts failed for deployment-side reasons, recorded so the failure
modes are not repeated: a restricted deployment answered `403 Access denied`; a
stale or archived deployment id answered `401 Page not found`; and a deployment
still set to *Anyone with a Google account* answered an anonymous request with a
Google sign-in page. The working deployment answers an anonymous `GET` with
`{"ok":false,"error":"post_only"}`, which is the correct read-only response. The
first token check returned `not_configured`, which is the script's own guard for a
missing `SHEET_ID`/`SYNC_TOKEN` script property — not a token mismatch. Server
configuration lives only in the git-ignored `apps/web/.env.local`
(`SHEET_SYNC_URL`, rotated `SHEET_SYNC_TOKEN`, unchanged
`SHEET_SYNC_ORGANIZATION_ID`, plus `SHEET_MASTER_LINK_HEADER=Issues`); the token was
never printed, committed or pasted into chat, and the temporary local copy was
deleted after use. The previous development endpoint was replaced, so the legacy
desktop tab previews now fail honestly with "that tab does not exist" against this
workbook instead of showing another workbook's rows.

**Live read of the real workbook through the deployed connector (read-only,
counts only):** the plan tab is named **`Sheet1`**, not `New Optimize Structure` —
253 rows, 17 columns, header on row 2, one tab in the workbook. `getMasterLayout`
returned the expected labels (services, content, date posted, keywords, phone,
final rephrasing, post type, pictures, area, state, issues, post status, account
name, ranking, remarks) and recognised one unlabelled header. `getMasterSections`
with the declared `Issues` link header returned `ok: true`, `truncated: false`,
zero warnings, `linkColumnSource: declared` and columns `A service, F title,
I area, J state, K link, L status, M profile` — the same mapping the offline
verification predicted. Snapshot of the two dated sections:

| Plan date | Header row | Task rows | Tasks | Links | Posted claim + link | Posted claim, no link | No Account Name |
|---|---|---:|---:|---:|---:|---:|---:|
| `2026-11-04` | 2 | 3–126 | 123 | 0 | 0 | 0 | **53** |
| `2026-11-03` | 128 | 129–252 | 123 | **85** | **85** | **31** | 0 |

No cell was written, no row was imported or mapped, and the check printed counts
only — no name, phone, content, link or token.

**Dated plan view delivered (`/dashboard/master-sheet/plan`):** a read-only server
page that reads structure first (`fetchMasterLayout`), selects the only populated
tab automatically, and refuses to guess when several tabs hold data — it shows an
explicit tab chooser instead. It renders one panel per dated section with the
counts above, a table of sheet row, account, status, post title, service,
area/state and saved link, plus honest notices for a missing Account Name, refused
link cells, a truncated read and a section with no banner (whose date stays
unknown rather than being assumed to be today). A `Posted` label is shown as
**"Posted (Sheet claim)"** and is never presented as a verified observation.
Unrecognised status text is listed verbatim so nothing is silently reclassified.
The tab name comes from the workbook's structure, never from a hardcoded guess, and
`fetchMasterLayout`'s strict schema rejects any payload carrying cell text the
connector was not asked to return.

**Validation for the plan-view slice:** `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS (0 warnings), `npm.cmd test` PASS **1,154 tests / 86 files**, `npm.cmd run build` PASS with `/dashboard/master-sheet/plan` in the route manifest. New coverage: 12 plan-page tests (single-tab auto-selection, several-tab choice instead of a guess, claim wording, missing Account Name, refused link cells, truncated read, no-banner date, unconfigured connector message, wrong-tab repair, and proof that no phone/remarks/pictures/credential column is ever requested) and 4 transport tests (structure-only layout request, strict rejection of a payload carrying cell text, the missing-script-property message, and a token that never appears in an error).

**Production deployment of the dated plan (owner-approved, 2026-11-04):** the tree
containing the connector, the plan page and the worker/admin work was committed as
`3cb6075` and pushed to `origin/main`; a pre-commit scan confirmed no credential
path, no `AKfycb…` deployment id, no JWT, no `sb_secret_`/`sbp_` key and no
48-character token in the staged diff (the six previously flagged lines are
documentation placeholders and test literals). Vercel CLI authentication was
completed by the owner through a device-code link; the resulting token was never
read, printed or pasted. Four production variables were added by piping values
straight from the git-ignored `apps/web/.env.local` into `vercel env add` —
`SHEET_SYNC_URL`, `SHEET_SYNC_TOKEN`, `SHEET_SYNC_ORGANIZATION_ID` and
`SHEET_MASTER_LINK_HEADER=Issues`. `vercel env ls` confirms all four exist for
**Production only** with hidden values; none was added to Preview or Development,
so a later `vercel env pull` cannot write the token into a developer's working
copy. The four pre-existing variables (`APP_URL`,
`SUPABASE_EXPECTED_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) were left untouched.

Production deployment **`dpl_CbuYK8nkfbvBjcdUE3LdwD4oVoV6`** is READY and aliased
to `https://nd-automation-dashboard.vercel.app`; the served page reports that exact
deployment id, so the alias is not pointing at an older build.
`npm.cmd run check:deployment -- https://nd-automation-dashboard.vercel.app`
returned `anonymousRouteChecksPassed: true` (`/login` 200; `/workspaces`,
`/verify-email`, `/dashboard`, `/dashboard/run/cohorts` all 307).
`/dashboard/master-sheet` and `/dashboard/master-sheet/plan` both answer 307 to an
anonymous request, which confirms the routes exist in the deployed build and are
auth-gated rather than public. A defensive `trim()` was then added to the
organisation-id read in `settings()`, because a hosting dashboard can store a
trailing newline with a pasted value and a strict UUID parse would have turned
that into a misleading "not configured" for the employee; the redeploy above
carries that change (`typecheck` PASS, `lint` PASS, 38 targeted tests PASS).

**Deliberately not verified:** `vercel env pull` returns the literal
`[SENSITIVE]` placeholder for every secret-typed variable, so the stored values
could not be compared byte-for-byte against the local ones — that check was
attempted and is honestly reported as inconclusive, not passed. No authenticated
read of the production plan page has been performed by the agent: it needs a
signed-in session, and real-account operations require the owner present. The
owner's own check of the production page is therefore the outstanding proof that
production can read the workbook. Nothing was written to the Sheet, no publication
was imported or queued, and no browser was launched.

**Not claimed:** no link import into publications, no profile/customer mapping, no
sync, no queueing, no publishing, and the legacy desktop tab previews remain
unavailable against this one-tab workbook (they report the missing tab and link to
the plan view). The 31 `Posted`-without-link rows, the 53 plan rows without an
Account Name and the single unmatched persona remain data-quality items for the
operator, not automation output. Production serves the plan as a **read-only
view**; posting tomorrow is still the desktop flow.

**Employee membership correction (explicitly approved):** investigation found
the designated employee was the sole owner of a separate, unused workspace,
not an owner inside the team's workspace. An attempted ordinary role change
stopped without changes because the acting team owner did not belong there.
The operator closed the employee's work (20:41:14 UTC), then separately approved
removing that unused workspace and joining the existing verified account to
the team as operator. One transaction rechecked every public workspace-scoped
table and the existing open-work guard, removed only the approved unused
workspace (one closed session + notification-read state + sole membership), and
called the existing add-member RPC. Auth identity/password/email confirmation
were preserved. The employee now has one membership, **operator**, in the team's
workspace. No private email is written into repository docs.

Hosted authenticated-role smoke PASS (rolled back, no new data): employee can
read all **3,135 inventory rows** and the **one mapping**, `is_setup_admin=false`,
and all six direct setup RPCs return permission denial. This is SQL/RLS
verification, not a claim of browser/password login acceptance.

Next acceptance prerequisites: employee refreshes/signs in to receive the new
workspace context. Local role-separated web changes have not been deployed to
Vercel. Each laptop
needs its own private pairing and access to the exact local Incogniton profiles.
Existing mappings remain tied to their exact helper. Per-user helper ACLs and
cryptographic proof that a browser is on a given laptop are **not implemented**;
helpers remain workspace-scoped and explicit named selection is required.

## Owner-device pilot and scan recovery regression (2026-11-04 device date)

The owner completed the narrow launcher/pairing/session/scan/import/mapping/end
pilot (2026-11-03 UTC): 3,135 profiles detected, 410 stored/imported under the
original byte budget, one customer mapping saved, and the work session closed
after about 28.7 minutes. This is **not** acceptance of publishing, monitoring,
account onboarding, cookie/proxy writes, or full desktop parity. Employee-device
acceptance remains outstanding.

Operator-approved hosted migration `inventory_scan_cap_v2` was applied as record
`20261103195418` (32 hosted records). The private completion implementation now
allows up to 5,000 scan rows / 1,000,000 JSONB bytes. Previous verification found
the private function client-denied, the public receipt wrapper unchanged, and
SECURITY DEFINER / empty search path preserved. Local worker/web changes remain
uncommitted and are not a new Vercel deployment.

The first expanded live scan exposed a missed **local durable receipt** bound:
`automation_journal.py` still limited completions to 66,000 bytes and journals
to 100,000 bytes. The local checkpoint remains `claimed` with no saved result;
subsequent helper startups correctly refuse to replay that unfinished action.
Read-only hosted inspection confirmed its lease had expired before recovery.

Local fix: only `inventory_scan` receipts get the worker's 900,000-byte result
budget plus a small completion envelope and a 1,000,000-byte checkpoint ceiling.
Other receipt/checkpoint bounds remain 66,000 / 100,000 bytes. Reads are bounded
before decoding; credential scope, exact task reference, atomic persistence,
inspection gates, and receipt-only recovery remain enforced.

Validation for this recovery fix:
- New synthetic 3,135-row lost-ack recovery and 5,000-row durable-save tests
  reproduced the old failure (2 errors before the fix).
- `apps/worker`: `.venv\\Scripts\\python.exe -m unittest
  test_automation_journal test_profile_helper test_worker_state` PASS, **26 tests**.
  Includes receipt-only replay, oversized-receipt preservation, kind-specific
  limits, and unresolved-claim refusal.
- Full worker `.venv\\Scripts\\python.exe -m unittest discover` PASS,
  **294 tests** (27.961 seconds).
- Prior web validation for the cap work: typecheck/lint PASS and **1,090 tests /
  80 files PASS**. No web code changed in this recovery fix; a fresh production
  build and expanded live scan/import acceptance remain deferred.

**Explicitly approved recovery:** the operator selected "Recover this scan".
Only the matching expired read-only scan was reconciled using the existing staff
RPC after checking its exact task, worker, original verified owner and expiry.
Hosted status is now `cancelled`, lease cleared, no invented result. The original
local claim was backed up in the device's private recovery directory, then the
existing `--confirm-browser-reconciled` command settled that exact checkpoint.
Local gate verification PASS (`operator_reconciled`, zero network calls/browser
operations). Hosted verification shows 410 inventory rows, one mapping, and no
pending/leased automation task on this helper. No profiles or mappings deleted;
no new scan was dispatched.

**Expanded live scan PASS:** owner restarted the helper (hosted heartbeat fresh)
and authorized a new scan during the active work session. Hosted read-only
verification at 2026-11-03 20:17 UTC confirms `succeeded`, **3,135 detected /
3,135 stored**, `truncated=false`, no error. This verifies the expanded durable
result path against the owner's real installation. **Full inventory import also
PASS:** after the owner checked the import confirmation and saved, hosted
read-only verification confirms **3,135 active inventory rows**, all 3,135 scan
rows matched by exact UUID/name/group, and the existing single customer mapping
preserved. The owner ended the second session; hosted verification confirms
`closed` at **2026-11-03 20:22:21 UTC** after **24.1 minutes**. The expanded
owner-device scan/import/session pilot is complete. Employee-device acceptance,
a fresh production build, and deployment of these local web/worker changes
remain pending. Do not manufacture results for the cancelled scan or clear
unrelated tasks, credentials, or journals.

## Workspace members and one-click employee setup (2026-11-03)

Closes the missing workspace-membership flow (the browser-side gap in the
onboarding plan). Employees are added **by email of an already-registered,
confirmed account** — the memberships FK to `auth.users` forbids pre-signup
invites, so no invite-email flow exists. Order: teammate signs up and confirms
their email → owner adds that exact email under the new
**Settings → Workspace members** page → the member sees the business data and
automations immediately (verified through RLS). One-workspace-per-person stays
enforced; `/workspaces` no-access copy now explains the order and that creating
your own workspace is permanent.

Delivered, all tested against PGlite exactly like the hosted database:

- **`supabase/proposals/workspace_members.sql`** (local candidate, not applied
  to the hosted DB yet): `reporting_list_workspace_members`,
  `reporting_add_workspace_member`, `reporting_set_member_role`,
  `reporting_remove_workspace_member`, plus shared guard
  `private_reporting.member_has_open_work`
  (open session OR queued automation task by `created_by` OR pending/leased
  check or publish job joined via the member's session; helpers are org-level
  with no user attribution, so they never block). All SECURITY DEFINER,
  `search_path=''`, revoke from public/anon/authenticated, grant to
  authenticated only. Owner-only role changes (no self-change, last-owner
  defense), admin removes only operator/customer, no self-removal, ≤50
  members, advisory-locked. plpgsql keyword collisions found and avoided:
  parameter named `address` (not `email`), variable named `existing_role`
  (not `current_role`) — both were real test failures.
- **`apps/web/tests/members.test.ts`**: 9/9 PASS (adds/listing/RLS access,
  privilege + direct-write denial, rank rules, 50-cap, verified-target rule,
  one-workspace rule, role-change rules, open-work guards for automation
  task/check job/publish job/open session, `reporting_customer_access`
  cascade, cross-workspace isolation).
- **Web layer:** `app/actions/members.ts` (3 form actions, all
  `requireWorkspace(true, form)`, error-message mapper), new
  `components/members-panel.tsx` (3 forms, each one `<WorkspaceField />`), new
  `/dashboard/settings/members` page (staff-only roster via RPC with
  `z.strictObject` verification; customers get a view-only panel; RPC
  failure shows the honest "apply the `workspace_members` proposal
  (hosted: `workspace_members_v1`)" notice instead of an empty list), static
  link in Settings, boundary-test module lists updated (guarded count
  43→46).
- **`apps/worker/Setup Employee Computer.bat`**: one file, two chained runs of
  `install_desktop_bridge.py` (launcher setup → `--connect-helper` private
  JSON pick; no Python changes). Mentioned on the computer setup page and in
  `docs/SIMPLE-COMPUTER-WORKFLOW.md` (new "Employee / second-computer setup"
  section). Employee gets **their own** downloaded helper credential — never
  the owner's.

Validation (2026-11-03, from `apps/web`): `npm.cmd run typecheck` PASS,
`lint` PASS (max-warnings 0), `test` PASS **1,089 tests / 80 files** (includes
the 9 members tests), `build` PASS. Worker suite from `apps/worker`:
`python -m unittest discover` **285 tests OK**.

**Approved same day for live testing (operator instruction: "live the
testings").** The proposal was applied through MCP as hosted migration
**`workspace_members_v1`** (baseline re-verified first: 30 migrations, no
member functions present, all dependencies present). Hosted history is now
**31 migrations**. Post-application verification PASS: anon denied execute on
all four public RPCs; authenticated granted on all four;
`private_reporting.member_has_open_work` denied to clients; all five
functions SECURITY DEFINER with `search_path=''`. Security advisers after the
DDL show the members functions only inside the intentional
authenticated-executable SECURITY DEFINER class (now 44 findings — each
guards itself with live role checks), the anon-executable worker
claim/complete class unchanged (9), and the pre-existing
`worker_credentials` no-policy INFO; no new findings caused by this change.
One unrelated pre-existing Auth advisory appeared: **leaked password
protection is disabled** (WARN) — enabling it is an operator decision, no
action taken.

**Members-live production deployment (same approval):** the first
`vercel deploy` attempt failed on the known CLI network error ("fetch
failed"); the retry from the unmodified tree succeeded. Production
deployment **`dpl_9fRRCkNbJ44nQhDaDbb6F74paDEj`**
(`nd-automation-dashboard-81b5hogvb-jelly-bean2.vercel.app`) returned Ready
and is aliased to **https://nd-automation-dashboard.vercel.app**; the
anonymous `/login` footer reports **nd v0.1.4 / production** with that
deployment ID.
`npm.cmd run check:deployment` against the alias PASS (login 200; expected
signed-out 307 redirects for dashboard/run/cohorts/verify-email). These are
anonymous checks only — signed-in member add/remove/role actions remain to be
exercised by the operator with the employee account. Desktop live-account
gates are unchanged: hosted rows still show no workers/publications/tasks,
and real automation start still requires the operator physically.

## Operator-approved hosting and 0.1.4 deployment (2026-11-03)

The same operator later explicitly approved (in-chat): applying both proposals
to the hosted test database, deploying the reviewed 0.1.4 candidate to Vercel,
and a guided real-automation startup. Both proposals were applied individually
through MCP as hosted migrations **`protected_evidence_v1`** and
**`protected_bulk_intake_v1`** (baseline re-verified first: 28 migration
records, no evidence/intake objects, zero buckets). Additive only; no existing
rows touched (all new tables remain at 0 rows).

Post-application verification PASS: `reporting_evidence` and
`reporting_intake_batches` exist with RLS enabled and exactly one staff-read
policy each; authenticated-only execute on `reporting_reserve_evidence`,
`reporting_evidence_action`, `reporting_enqueue_intake_batch` (anon denied);
private `reporting-evidence` bucket (3 MiB, PNG/JPEG only) with exactly the
three evidence-scoped INSERT/SELECT/DELETE storage policies; both intake task
columns added; the `automation_one_open_task` unique index is the narrowed
non-batch variant exactly as proposed; the `reporting_intake_dispatch` guard
trigger exists with no direct grants. Hosted history is now **30 migrations**.
Security/performance advisers after the DDL show only the previously
documented classes (private no-policy INFO on `worker_credentials`,
intentional anon-executable worker claim/complete SECURITY DEFINER warnings,
unused-index INFOs) with **no new findings**; not a clean security sign-off,
and backup/PITR remains unverified.

**0.1.4 web deployment (same approval):** the first `vercel deploy` attempt
failed on a CLI network error ("fetch failed") with no deployment created; the
immediate retry from the unmodified tree succeeded. Production deployment
**`dpl_F5EJDuBLsEqAeVAQLwvVg17oDVB8`**
(`nd-automation-dashboard-bqx607klo-jelly-bean2.vercel.app`, build 54s)
returned **Ready**, is aliased to
**https://nd-automation-dashboard.vercel.app**, and the anonymous `/login`
footer now reports **nd v0.1.4 / production** with that deployment ID.
`npm.cmd run check:deployment` against the alias PASS (login 200; expected
signed-out 307 redirects for dashboard/run/cohorts). Signed-in,
evidence/intake and live-worker acceptance remains unverified; these are
anonymous checks only. Desktop code and all live-account gates are unchanged:
hosted rows still show **0 workers, bindings, publications, tasks, jobs,
evidence rows and batches**; the one pre-existing active session and three
workspaces remain untouched.

## Protected evidence, bulk intake, worker release lifecycle (2026-11-03)

Operator-directed completion of the remaining local engineering gaps, per the
phases in `REMAINING-WORK-PLAN.md`. Everything here is **implemented source with
tests only**: no proposal was hosted, no bucket created, no release signed or
installed, no live account/platform/Sheet operation, commit or push. Desktop
code (`core/`, `gui/`, launchers) is unchanged.

- **F32 evidence** (`PROTECTED-EVIDENCE.md`): web upload/inspect actions plus a
  strict candidate schema/RPC set in `supabase/proposals/protected_evidence.sql`
  — reserve → upload → `ready`; operator-supplied observation time changes no
  publication status; `review_after` is a human note, never a deletion deadline;
  holds block delete; irreversible two-phase delete with a metadata tombstone;
  PNG/JPEG ≤3 MiB with SHA-256, ≤10,000 non-deleted rows per workspace. Real
  PGlite tests cover reserve/replay, customer/foreign/anonymous denial, hold
  and two-phase delete. **Not hosted**: a private bucket + table/RPCs need
  separate approval; retention remains a policy gate.
- **F06–F09 bulk intake** (`PROTECTED-BULK-INTAKE.md`): `bulk_intake.py` is a
  local read-only preview plus explicit `--stage` with per-row Windows
  current-user DPAPI ciphertext (`private_vault.py`, no plaintext fallback, no
  persisted key), 24-hour expiry, strict Netscape/proxy validation and byte
  budgets. The web form enqueues only redacted ciphertext-path descriptors via
  the candidate `reporting_enqueue_intake_batch` RPC with necessity/permitted-use
  confirmations and receipt replay. The candidate proposal narrows the
  `automation_one_open_task` unique index to non-batch rows so one batch may
  queue several pending rows; one-lease-at-a-time stays enforced by every
  claim path's worker-row FOR UPDATE lock plus leased checks, a dispatch guard
  stops a batch after any failed/cancelled row, and assignment changes stop
  dispatch. Batch rows still apply through the existing one-profile task queue.
  F09 automatic polling/watching stays unimplemented by design; the proposal is
  **not hosted**; permitted-use/retention policy decisions remain open.
- **F36 worker lifecycle** (`WORKER-RELEASE-LIFECYCLE.md`): `worker_state.py`
  gives a stable per-user state root (`ND_WORKER_HOME`, else
  `%LOCALAPPDATA%/NDAutomation/worker`) shared across future release
  directories, with cross-release/old-checkout exclusion locks, an explicit
  fingerprinted one-time `migrate` command for legacy `.worker-state` journals
  (never auto-copied or discarded) and a drained-checkpoints requirement.
  `release_lifecycle.py` installs/rolls back only Authenticode-**signed**
  data-only manifests (`# ND-RELEASE-V1`, never executed), pinned to an exact
  reviewed publisher thumbprint, with byte/SHA-256 verification of exactly
  five worker files, pinned runtime/pins (no auto-install), staging + atomic
  pointer switch (partial installs never execute), strictly increasing
  sequences and explicit rollback to the previous release.
  `scripts/create_worker_release.py` builds **unsigned candidates** only.
  Real signing, a genuine certificate and a user-present install/rollback test
  remain open gate items.
- **Acceptance validator** (`apps/worker/acceptance.py`): validates
  operator-supplied F01–F36 records (user-present acceptance or approved
  retirement, or honestly `pending`); it cannot manufacture evidence or
  authorize desktop retirement. The full ledger stays in
  `REMAINING-WORK-PLAN.md`.
- Test fix: the post ledger test now mocks the async evidence-panel child (RPCs
  covered separately by the evidence SQL tests); the previously failing batch
  scenario passes against the narrowed index proposal.

Validation (final tree, 2026-11-03): web **typecheck PASS**, **lint PASS (zero
warnings)**, **1,080 tests / 79 files PASS** (first full run caught one
render assertion against the new evidence panel; fixed as above and re-run in
full), **production build PASS**. Worker **285 unittest cases PASS**
(`apps/worker/.venv`, exit 0). **Four packaging-safety tests PASS**.
`git diff --check` PASS (line-ending notices only). Targeted package
secret-pattern scan: **76 changed/new files, zero findings**; not a complete
repository security audit. Hosted state intentionally untouched: production
web remains **0.1.1**, source **0.1.4**; the 28-record hosted migration
history must be re-checked before any future proposal is applied.

## Local simplification — daily controls and Windows launcher (2026-11-03)

The operator requested a desktop-like flow, normal same-email sign-in from any
computer and less device/setup complexity. Implemented locally; **not deployed,
installed into Windows or live-accepted**. No desktop code/launchers were changed.

- Home/Profiles/Run now expose **Open Incogniton**, **Start profile helper**,
  **Detect profiles** and **View post status**. Home connection cards and Run
  diagnostics/imports/recovery are collapsed, not deleted. Run has direct links
  to post/listing drafts, account/editing tools, Profiles, Sheet and Results.
- A single connected helper no longer needs a device selector; the exact scoped
  worker ID remains in the form. Multiple helpers still require an explicit
  selection. This removes repeated UI choices, **not** Auth/RLS, scoped credentials,
  active work sessions, exact ownership or destructive confirmations.
- Profiles shows actual completed scan names/groups/UUIDs immediately, with its
  existing explicit save/import control moved out of Advanced. Refresh is read-only.
  Detection remains capped at 500/result-byte budget; CSV fallback is unchanged.
- `/dashboard/settings/computer` provides one-time setup. Registration defaults
  to My computer; private JSON can be downloaded rather than hand-copied.
  **Setup Dashboard Launcher.bat** installs the current-user protocol after local
  confirmation; **Connect Profile Helper.bat** selects a private connection and
  saves it exclusively without overwriting existing credentials.
- `desktop_bridge.py` accepts two fixed, argument-free URIs and always asks for
  native approval. Open-app launch checks local paths, pinned SHA-256 and valid
  WorkingGreen B.V. Authenticode signature. No URL credentials, arbitrary remote
  code, local listener, exposed Incogniton/debug ports, service or autorun.
  Changed apps/publishers require review; another protocol handler is not replaced.
- `agent.py --tasks-only` is an explicitly authorized stdlib-only profile-task
  helper: no Playwright or DOM adapter needed for scans, no monitoring/publishing/
  supervised claimant. It shares the lock/recovery checks, stops on task failure
  and limits new claims to an eight-hour window; an in-flight bounded task may
  finish afterward. Post-status monitoring still needs its reviewed DOM adapter.
- The browser cannot prove a URI request succeeded or that a stored helper runs
  on the current computer. Both distinctions are visible. Signing in alone does
  not install/connect a local helper. No fake readiness or post status is shown.

See `SIMPLE-COMPUTER-WORKFLOW.md` for setup, daily use, removal, security boundaries
and remaining gaps. Evidence storage/retention, bulk intake, signed installation/
update parity, attachment changes and real-account/F01–F36 sign-off remain open.
No new database schema, remote application/deployment, registry change, genuine
app/profile launch, Google write, commit or push occurred in this tranche.

Validation: **262 worker tests PASS**; required web **typecheck PASS**, **lint PASS
(zero warnings)**, **1,065 tests / 77 files PASS**, **production build PASS**
(includes `/dashboard/settings/computer`). Four package-safety tests and
`git diff --check` PASS (line-ending notices only). Targeted package secret-pattern
scan: 43 changed/new files, no findings; not a complete repository security audit.
Native tests mock process launches, signature tooling and registry operations; they
do not establish real Windows integration or platform acceptance.

## Authorized hosted test-database migrations 003–007 (2026-11-03)

The operator explicitly authorized Supabase migration application and, after the
backup question, directed proceeding because this is testing with no live customer
data. **Backup/PITR availability remains unverified**; no production backup/restore
readiness is claimed. Existing workspace/membership/session records were preserved.
This authorization covered the five migrations, not web deployment or live actions.

| Source suffix | Applied hosted version / name | Individual hosted smoke |
|---|---|---|
| `003_publish_scheduling` | `20261103150402 publish_scheduling` | PASS |
| `004_automatic_sheet_mapping` | `20261103150527 automatic_sheet_mapping` | PASS |
| `005_approved_media` | `20261103150630 approved_media` | PASS |
| `006_browser_task_receipts` | `20261103150709 browser_task_receipts` | PASS |
| `007_supervised_workflows` | `20261103150830 supervised_workflows` | PASS |

Applied individually in order; each catalog/pure-validator smoke, history check,
normalized source/body comparison and error/adviser review preceded the next stage.
No blind push or history repair. **28 hosted migrations; 33 public tables, all RLS
enabled**. Additional existing verified-staff role reads/version checks, foreign
workspace access-helper denial and anonymous denial PASS (read-only, no Auth
sign-in or fixtures). Populated-row/customer isolation and real execution remain
unverified. See `DB-DEPLOYMENT-20261103-0.1.4.md` for the full record and limits.

Final counts: 3 workspaces, 3 memberships, 2 sessions preserved; zero workers,
credentials, customers, publications, browser tasks, publish jobs, publish batches,
Sheet mappings/targets/events/outbox entries and storage buckets. One current human
session found at preflight was left untouched. No posting/account/profile/Google
operation, bucket creation, restore, commit, push or deployment was performed.

Post-application queries returned no database ERROR/FATAL/PANIC or HTTP 5xx in
their requested windows (ingestion lag remains possible). Advisers still report
leaked-password protection disabled, reviewed public SECURITY DEFINER RPC warnings,
private credential no-policy INFO and unused-index INFOs; not a clean security
sign-off. Source remains **0.1.4**; final anonymous `/login` fetch still reports
hosted web **0.1.1**, deployment `dpl_HPLFL7yaXBykftgUvQhpBLGuxqVt`. Web deployment
remains separate. `git diff --check` PASS (line-ending notices only).
The earlier exact-source local validation remains the evidence below; checks were
not rerun for documentation-only recording of this remote application.

## Local follow-up — retain-only edits and rollout preparation (2026-11-03)

This entry supersedes the earlier statement that all attachment-preserving edit
variants are unimplemented, **only for the narrow retain-all source variant**.
It is not a completed parity release. Current authority is local engineering and
read-only hosted inspection; historical production/commit approvals below are not
reused. Source remains **0.1.4**, not deployed by this tranche.

- F19: local optional `attachments` review pins 1–10 existing stable platform
  asset IDs and their order. The exact owned card, composer before/after filling,
  final pre-submit card and saved result must agree. Default text-only edits also
  reject any matching media node, including hidden nodes. No upload, remove or
  reorder controls are used; changed/missing result evidence requires durable
  reconciliation, never automatic save retry or a fabricated rollback.
- All edit plans now require a reviewed `edit_media` selector. Older local plans
  fail preflight until updated; they do not silently inherit attachment support.
  An actual platform must expose reliable common asset identity and complete
  selectors. DOM ID equality is not image-byte verification, permission proof or
  real Nextdoor compatibility. Attachment addition/removal/reorder remains open.
- The local attachment review stays out of queued manifests, checkpoints and
  results; only its adapter fingerprint is recorded. Existing approved text-only
  hosted draft/manifests remain unchanged. Dashboard copy documents these limits.
- Added five individual catalog/pure-validation smoke scripts under
  `supabase/tests/` for 003–007. The local publishing SQL harness executes each
  after its corresponding migration, before later migrations. These are read-only
  hosted candidates, not hosted behavioral/live acceptance. Added local negative
  privilege-expansion checks; final validation results are recorded below.
- `REMAINING-WORK-PLAN.md` records phases, later policy questions and a conservative
  individual F01–F36 acceptance ledger. `DB-DEPLOYMENT-0.1.4-PLAN.md` records
  ordered application/smokes, backup/access gates, stop/recovery conditions and
  production approval requirements. Protected evidence/retention, secure bulk
  intake and worker install/update parity remain unimplemented.

Read-only hosted verification in this session: **23 migrations**, 003–007 absent;
production `/login` footer **0.1.1**, deployment
`dpl_HPLFL7yaXBykftgUvQhpBLGuxqVt`; **29 public tables, all RLS-enabled**, **zero
storage buckets** and **zero pending/leased browser tasks or publishing jobs**.
Supabase MCP access is now available; missing credentials is not the current
blocker. Production changes still await explicit approval and the runbook gates.
No hosted migration, deployment, bucket creation, account access, real platform
request, Sheet write, commit or push was performed. Desktop code is unchanged.

Validation: **240 worker unittest cases PASS**, **29 isolated Chrome synthetic
workflow fixtures PASS** with all traffic intercepted and zero real platform
requests. Final web **typecheck PASS**, **lint PASS (zero warnings)**,
**1,059 tests / 76 files PASS**, **production build PASS**. Four package-safety
tests PASS. `git diff --check` PASS (line-ending notices only); the
targeted package secret-pattern scan found no findings across 17 changed/new
files. This scan is not a full repository security audit.

## Source 0.1.4 — durable browser tasks and supervised workflows

The operator requested continuing implementation and authorized commits/pushes
and reviewed hosted migrations. This entry supersedes older “no onboarding or
edit/delete/moderation code” statements only for the explicit boundaries below.
No full desktop parity or real platform acceptance is claimed.

- `automation_journal.py` checkpoints browser tasks before execution, preserves
  interrupted actions, replays only saved receipts and blocks uncertain local
  mutations until inspected. Agent and publisher share these recovery checks.
  Terminal checkpoints discard task payload/result; credentials remain local.
- Migration `202611020006_browser_task_receipts.sql` accepts only identical
  terminal completion replay, rejecting changed or cancelled/reconciled leases.
- Migration `202611020007_supervised_workflows.sql`, `/dashboard/workflows` and
  `supervised_workflows.py` add a separate, one-task authorized workflow path:
  genuine-data registration first step/human handoff, login/account inspection,
  bounded read-only browsing, approved text post/listing edits, exact-target
  deletion and one-account blocking. Normal agents cannot claim these tasks.
  Session, staff verification, unchanged assignments, edit approvals, exact
  existing content hashes and separate destructive confirmations are enforced.
- Local reviewed manifests/selectors must match the queued request exactly.
  Passwords/identity inputs stay in a private local plan, not the dashboard,
  journal or results. No synthetic birth dates/names/location, automatic identity
  verification/OTP/consent/preference clicking, suspended-account reuse or random
  engagement is implemented. Signup reports handoff, not a created account.
- Exactly one mutation is attempted. Exact result evidence is required; ambiguous
  actions and uncertain profile cleanup block further browser work. Profiles
  already open/unknown are not borrowed or force-stopped. No visibility/Sheet/
  yesterday-cohort success is fabricated from maintenance receipts.

Targeted validation completed: **94 publishing/workflow SQL tests PASS**,
**64 browser-task/agent recovery tests PASS**, **17 workflow/journal tests PASS**
(overlapping subsets, not additive), and **13 isolated real-Chrome synthetic
workflow fixtures PASS**, including wrong-account/target, stale content,
concurrent edit change, challenge handoff, pre-existing result and missing-result
reconciliation. These fixtures intercepted all traffic; zero platform requests.

Final whole-project checks (2026-11-03, commit `60dfe28`): web **typecheck PASS,
lint PASS (zero warnings), 1,053 tests / 76 files PASS, production build PASS**
(includes `/dashboard/workflows`). **234 worker unittest cases PASS**, four
package-safety tests PASS and `git diff --check` PASS (line-ending notices only).
These are development checks, not live acceptance.

### Historical migration status (before the authorized application above)

| Source migration | Hosted |
|---|---|
| `202611020001_automation_session_gate.sql` | Yes, as `20261102152910` |
| `202611020002_publish_dispatch_guard.sql` | Yes, as `20261102154039` |
| `202611020003_publish_scheduling.sql` | **No** |
| `202611020004_automatic_sheet_mapping.sql` | **No** |
| `202611020005_approved_media.sql` | **No** |
| `202611020006_browser_task_receipts.sql` | **No** |
| `202611020007_supervised_workflows.sql` | **No** |

Hosted history remains **23 migration records**. 003–007 were not applied: this
session had no Supabase MCP connection or database credentials, and the directory
must not be blindly `db push`ed (hosted versions differ from source names). The
0.1.4 web code depends on 003–007 RPCs, so it must not be deployed before they
are applied in order with their smoke tests. Production remains **0.1.1**.

### Remaining gaps (2026-11-03)

The items below remain **open and unimplemented** at this checkpoint:

- Attachment-preserving post/listing edit variants (F19).
- Protected evidence storage and retention (F32).
- Bulk cookie/proxy intake (F09) and preset/random posting and warmup.
- Desktop launch/install/update parity for the worker.
- Hosting migrations 003–007 and deploying 0.1.4.
- Live acceptance, isolation/recovery checks and F01–F36 sign-off.

Source is **0.1.4**; last verified hosted web production remains **0.1.1**.
Migrations 003–007 remain **local, not hosted** at this checkpoint. No live
account/post/delete/block/Google write, configuration restore or deployment was
performed. Supabase inspection still found zero workers, assignments, customers
and publications: yesterday's live checks cannot be called complete.

Remaining implementation includes attachment-preserving edit variants, protected
evidence storage/retention, bulk cookie/proxy intake, desktop launch/install/update
parity and any supported destination/preset behavior requiring operator policy
decisions. Full account onboarding intentionally requires genuine human steps.
Live acceptance/isolation/recovery and F01–F36 sign-off remain open. See
`SUPERVISED-WORKFLOWS.md`; keep the working fudge collection/rewrite path intact.

## Source 0.1.3 — code-first scheduling, bulk, mapping and images (2026-11-02)

The operator directed **implementation before configuration/live testing**, and
explicitly said the working fudge collection flow must remain unchanged. This
tranche changes ND source only. No request for credentials/configuration, hosted
migration, production deployment, Google write, real platform operation, account
creation or fudge release-gate change was made.

Implemented:

- `202611020003_publish_scheduling.sql`: explicit atomic authorization of 1–20
  already-approved immutable revisions; stable request receipts, exact replay
  checks, verified staff/workspace/session ownership, due times and 5–30 minute
  claim windows. Schedules cannot extend beyond the original session's safe
  start budget. Pauses defer, closed/expired/revoked authorizations cancel, and
  missed windows cancel without next-session catch-up. Client business-local
  times convert to UTC with DST gaps/ambiguity rejected. New Content selection
  and Publishing due/deadline UI remain gated on the undeployed protocol.
- `publisher_run.py` and the explicit publisher CLI: one job by default, separately
  confirmed sequential runs capped at 20, optional polling capped at eight hours,
  and stop-on-ambiguity/login/verification/failure. Every result and cleanup must
  settle before another claim. No blind Submit retry, bulk approval, cron or
  default publishing in the monitoring agent was introduced.
- `202611020004_automatic_sheet_mapping.sql`: opt-in exact publication/row/revision
  mappings and per-assignment future-publication policies. Sourced check results
  and confirmed new publication outcomes enqueue their exact intents transactionally.
  Technical failure remains its actual outcome, not fabricated removal. Immutable
  event-to-outbox links, owner-verification revocation checks and serialized claims
  preserve dependency order across one-intent deliverers. Rebase is blocked while
  intents are outstanding; pause does not silently cancel or retarget old work.
  `/dashboard/settings/sheet-mapping` exposes disabled-by-default explicit controls,
  saved state and bounded event evidence without claiming queued means delivered.
- The Sheet runner now supports separately confirmed bounded sequential draining
  and bounded polling, still claiming one intent at a time and stopping on the
  first conflict. Receipt-only recovery cannot run/watch a batch.
- `202611020005_approved_media.sql`, strict UI/worker descriptors and local media
  tools: immutable approved image IDs/order, SHA-256, size, MIME and explicit
  rights/privacy attestations. Up to ten JPG/static PNG/static WebP images,
  8 MiB each/30 MiB total. Actual local bytes, basic image structure/dimensions
  and hashes are checked before profile launch. FilePayload buffers avoid
  temporary-upload-file races and never delete operator originals. A separate
  capable claimant prevents old/text-only workers from leasing image jobs.
- A locally reviewed attachment adapter verifies browser-selected file bytes/order
  through SHA-256, exact preview readiness/count, final content/account/audience,
  and result-card attachment count. Changed/missing images never silently fall
  back to text-only. Image resizing/transcoding by a real platform means result
  thumbnail count is not proof of unchanged published image bytes; real visual
  acceptance is still required. Signatures/dimensions are not a full decoder,
  malware scan, EXIF scrubber or proof of content rights/privacy.
- `stage_media.py` registers explicit operator-selected local originals privately.
  `import_media.py` supports authorized HTTPS and Drive blob imports into the same
  private registry: public-unicast DNS validation, IP-pinned TLS/SNI, no proxy,
  bounded reads/redirects, no authenticated redirect forwarding, file signature/
  MIME/size checks, exclusive creation and cleanup of only its own temporary files.
  Drive tokens go only to its exact supported Google API endpoint, never a public
  source URL, registry, descriptor, browser or backend. No Drive/API request was
  made during tests; resolver/connections were mocked.

Final validation: **217 worker unittest cases PASS** and **5 real isolated-Chrome
synthetic DOM fixtures PASS** (text post/listing, image post/listing, changed-byte
refusal), zero real platform requests. Web **typecheck PASS, lint PASS (zero
warnings), 1,015 tests / 74 files PASS, production build PASS**. The build includes
the new mapping route. Python compilation, four package-safety tests and
`git diff --check` PASS (line-ending notices only). These are development
fixtures, not client configuration/live acceptance. The application enforces
39 guarded form-action entrypoints, including the new explicit batch/mapping
actions; tests cover stale-context guards rather than relaxing that boundary.

The three new migrations are **local source, not applied remotely**. Source is
**0.1.3**; production remains the previously verified **0.1.1**. Older 0.1.1/0.1.2
QA archives do not contain this tranche. No full-project completion or handover
is claimed: onboarding/human-verification workflow, edit/delete/moderation tools,
remaining profile/device operations and individual F01–F36 sign-off still need
implementation/acceptance. Legacy onboarding currently invents a birth date and
fallback names; that behavior was inspected read-only and is **not ported or run**.
Genuine supplied identity data and human verification must replace it.

## Source 0.1.2 — opt-in Sheet writeback implementation (2026-11-02)

The user explicitly requested implementing the remaining code and offered to
configure required connections. Implemented the previously missing Sheet
deliverer as an explicit **one-intent pilot**, not an always-on/automatic mode:

- `apps/worker/sheet_writeback.py`: stdlib-only offline preflight, private pinned
  workspace/operator/project/connector config, verified staff Auth and replayed
  claim authorization, bounded HTTPS/no proxy or arbitrary redirect forwarding,
  durable claim/result checkpoints, exact receipt checks and result-only recovery.
  Default invocation is offline; execution/recovery require explicit authorization.
  Local password prompts never save password/refresh tokens and refuse an echoing
  terminal fallback. Verified enrolled MFA requires an AAL2 user token. No
  service-role/admin/management key is accepted.
- `integrations/sheets/reporting-writeback.gs`: NEW standalone connector, disabled
  unless privately enabled. Only approved non-secret columns on two exact tabs;
  stable ND Row ID UUIDs, expected ND Revision, bounded reads/requests, no A1 row
  targeting, no arbitrary range or formula execution. Atomic Sheets batch updates
  include the durable operation/hash receipt in the same commit. Exact replay or
  lookup cannot create a second append; conflicting IDs/revisions stop safely.
- Dashboard enqueue validates the deliverable v1 subset; legacy generic intents
  stay readable but are not silently executed. UI explains separate authorization,
  unknown local-runner state, setup IDs and configuration ownership without
  exposing tokens/passwords. `docs/SHEET-WRITEBACK-SETUP.md` gives complete
  operator steps, private sign-in, pilot and lost-response recovery guidance.
- The connector lock covers cooperating requests in ONE script project only.
  Human/other-script edits must be excluded during the pilot; atomic batch update
  is **not** cross-collaborator compare-and-swap. Metadata receipt quotas/retention,
  OS ACLs, real Google permissions and interrupted-write recovery need acceptance.

Worker validation: **181 unittest cases PASS**, including 30 new writeback
transport/protocol/journal/CLI tests; Python compilation and Apps Script syntax
PASS. Nineteen Apps Script fixtures passed before UI integration. The first full
web run caught a stale empty-state wording assertion (934 passed, 1 failed);
the assertion was corrected to check the actual no-automatic-dispatch boundary,
not weakened into an invented readiness claim. Final full web validation:
**typecheck PASS, lint PASS (zero warnings), 935 tests / 69 files PASS,
production build PASS**. The 28 added web tests include 19 connector fixtures
and 9 delivery-subset contract cases. A cross-runtime check also passed: the real
Python and Apps Script canonical intent hashes match for Unicode and literal
formula-looking text, with zero external requests. Packaging safety's four tests
and `git diff --check` PASS (line-ending notices only).

No remote migration, real Sheet write, credential setup, Incogniton operation,
release-gate change, production deployment or external client delivery was
performed in this tranche. Source package/lock are **0.1.2**; the previously
verified production dashboard remains **0.1.1**. Earlier 0.1.1 QA archives predate
this tranche and must not be presented as containing it. Rebuilt QA source
archives under the outer workspace's `client-delivery/` identify version 0.1.2
in `RELEASE-STATUS.json`, with per-file hashes and a SHA-256 sidecar; they remain
explicitly not live-accepted.

Still needs code: automatic monitoring/publication completion-to-outbox mapping,
scheduled/bulk delivery, media/scheduled/bulk publishing, account onboarding,
remaining edit/delete/moderation/profile workflows and full desktop parity. This
tranche does not establish that only configuration/testing remains for the full
product; it closes one concrete missing delivery component safely.

## Frontend release identity and source QA archive (2026-11-02)

Added a small public footer on every ND page: **nd v0.1.1**, host environment and
an expandable deployment identity. It uses only a validated package version and
whitelisted Vercel deployment ID/generated hostname; absent metadata is labelled
unidentified/not exposed, not guessed. No private environment object, credentials,
workspace or customer data is rendered. Build identity is explicitly not a live
automation health check. Package/lock versions match. Final local web validation:
**typecheck PASS, lint PASS, 907 tests / 67 files PASS, production build PASS**
without the earlier named-JSON-import warning. Five new tests cover identity,
unknown/malformed hosts, safe fallbacks, rendered values and secret exclusion.

Latest production deployment **READY**: `dpl_HPLFL7yaXBykftgUvQhpBLGuxqVt`,
generated host `nd-automation-dashboard-7f2r3xjfk-jelly-bean2.vercel.app`, aliased
to **https://nd-automation-dashboard.vercel.app**. Post-deploy `/login` footer
text was fetched and verified to contain **nd v0.1.1**, **production** and that
exact deployment ID. `npm.cmd run check:deployment --
https://nd-automation-dashboard.vercel.app` PASS: login 200 and expected 307
login redirects for workspaces, verify-email, dashboard and run/cohorts.
These anonymous checks do not establish authenticated or live-worker readiness.

Added the standard-library-only `scripts/build_client_package.py`: tracked plus
non-ignored working source from both repos, no git history, environments (except
public examples), local pairing/profile state, tool config, dependencies, backups
or customer exports. Targeted secret checks fail closed, with only one exact
reviewed invalid negative-test fixture exception. The generated archive includes
per-file hashes, source base commits/dirty indicators, versions, a SHA-256 sidecar
and an explicit **QA candidate / liveAccepted false** status. Four packaging
safety tests PASS; trial archive was integrity/hash-verified under the approved
temporary directory. Final QA archives and their SHA-256 sidecars are generated
in the outer workspace's `client-delivery/` directory, outside both repositories;
each archive includes the final source and its per-file hash manifest. The package
is not represented as a complete live client handover,
and no recipient was supplied or external delivery performed.

Fudge follow-up is now separately authorized by the operator: lowercase `fudge`
2.0.1 / connector template 43, safer protected-connector copying/reconnect,
model-selection/read-only access diagnostics, key-safe errors and observed
connector-version UI. Its 132 smoke + 67 backend + 18 setup/version tests and
isolated real-Chrome setup UI fixture pass. This does not deploy the client's
Apps Script, approve its Google permissions or verify its real key/model. See
the fudge repository's `docs/RELEASE-STATUS.md`; upload/catalog gates remain OFF.

## Authorized ND production tranche (2026-11-02; supersedes the local-only entry below)

The operator explicitly authorized migrations and production preparation. Applied
`automation_session_gate` as hosted **20261102152910** and
`publish_dispatch_guard` as hosted **20261102154039**: **23 migration records**.
Pre-application checks found zero pending/leased browser tasks, zero workers and
zero publish jobs, so no operator work was cancelled. Post-application inspection
confirmed the new session column, publisher protocol version 1, denied anon and
authenticated execution of the private legacy claim helper, no anon execution of
the harmless version check, and all **29 public tables RLS-enabled**. No live job,
customer, profile binding, worker or platform content was created by these checks.
The previously missing automation-worker foreign-key index no longer appears in
performance advisories; unused indexes are deliberately retained.

Implemented a separate **opt-in, one-job text post/listing publisher**:

- Approved-revision Content detail has an explicit supervised queue action,
  guarded by verified staff/workspace context, exact revision/approval/binding,
  session checks, the deployed safety version and durable no-duplicate-job rules.
  Approval and page views alone never dispatch or submit. The regular agent does
  not claim publishing; `publisher.py` requires separate explicit authorization.
- A locally reviewed adapter pins the exact Incogniton UUID to the real signed-in
  account href/name and explicit supported composer kind. Remote selectors, code,
  credentials, media paths and implicit audience/group choices are not accepted.
  Unknown identity, login, challenge, disabled account, composer or audience stops.
- Reads back approved body/audience, plus listing title, decimal USD price and a
  native selected category, again at the final submit boundary. A matching
  existing card blocks publishing; success requires one new same-card exact body,
  author and canonical kind-matching link (plus listing title), never the first
  feed card. No exact result means reconciliation, not fabricated success.
- Private atomic write-ahead state precedes launch and the single Submit attempt.
  Recovery sends only saved result receipts; claimed/submit-intent ambiguity never
  replays browser work. Acknowledged results clear customer text from the journal.
  Profile cleanup uncertainty blocks subsequent work. Both runners share the
  existing local lock; the hosted guard now excludes all three lease families.
- `publishing-adapter.example.json` intentionally fails until actual local DOM
  and account review. `docs/SUPERVISED-PUBLISHING.md` covers exact one-job startup,
  recovery/attestation and remaining acceptance. No signed-in session was accessed
  or real platform submission attempted during implementation.

Final local validation: web **typecheck PASS, lint PASS (zero warnings), 902
tests / 66 files PASS, production build PASS**. Worker **151 unittest cases PASS**
(including interruption after durable submit intent without replay).
Real installed Chrome, fresh
isolated contexts, intercepted synthetic post and listing pages: **2 DOM integration
cases PASS, zero real platform page requests**. This exercises real Playwright
fill/readback/audience/submit/evidence behavior but mocks Incogniton/CDP transport;
it is not Nextdoor/Incogniton live acceptance. The first full web run passed
typecheck/lint but caught an outdated workspace-action count; the audit now covers
36 guarded actions including all browser-task actions/forms, and was rerun.

**Authorized production deployment completed:** Vercel deployment
`dpl_6rCqXq9YEEqwK4RpecdkcajT2XBa`, build alias
`nd-automation-dashboard-968554mp7-jelly-bean2.vercel.app`, returned **READY** and
was aliased to **https://nd-automation-dashboard.vercel.app**. Deployed manually
from `apps/web` (pushing still does not deploy). Added an explicit `.vercelignore`
so local `.env*`, runtime state and build/dependency artifacts are not uploaded.
No hosted environment variable was changed or old Sheet connector reactivated.
`check:deployment` PASS after deploy; additional anonymous Content, Publishing,
Run and setup-guide route requests each returned the expected same-origin 307
login redirect. Signed-in content/queue/isolation acceptance remains unverified.
The 24-hour backend HTTP breakdown contained 959 HTTP 200, 1 HTTP 204, 1 HTTP 303
and four known login HTTP 400 rejections, with no HTTP 5xx in the returned data.
No new worker or job was created. `git diff --check` PASS with line-ending notices;
targeted secret-pattern scan found no private credential or live Sheet link in
changed/untracked source. Changes remain uncommitted/unpushed; production web
deployment and both schema migrations are complete, not a client parity sign-off.

**Still not full client handover:** Incogniton health remains unavailable and
production still has zero registered workers. The operator must register a new
credential, configure/accept the actual authorized account/DOM adapter and run a
specifically approved one-post/one-listing pilot, then verify monitoring/Results,
access isolation, interruptions, cleanup and recovery/restore. Media, scheduling,
bulk/unattended publishing, account onboarding, automatic Sheet writeback delivery
and gated Fudge upload are not implemented/released by this tranche. No suspended
account or challenge is bypassed. Production Sheet variables are not silently
restored from the old development connector. Fudge remains owned by the other
developer and unchanged by this delivery. Leaked-password protection remains an
open hosted Auth advisory. No full feature-parity or "100% bug-free" sign-off is
claimed.

## ND-only launch hardening (2026-11-02; local, not deployed)

The operator narrowed work to this dashboard; Fudge is maintained by another
developer. No Fudge changes are part of this tranche. Earlier chat statements
that the whole chain was "100% ready" were too broad: automated tests and
signed-out route checks do not establish a usable live automation installation.

Read-only checks on November 2 confirmed **0 workers, credentials, inventory,
bindings, publications, browser tasks, check jobs and publish jobs** in production.
There are **29 public tables, all RLS-enabled**. Anonymous production route checks
pass; authenticated launch acceptance is unverified. The pinned local worker
runtime, adapter and connection file pass structural preflight, but Incogniton's
health probe returns **unavailable** and the hosted credential count is zero.
The saved connection must not be treated as valid pairing after the reset.
No profile or browser was opened and no job was dispatched for this check.

Implemented locally:

- Additive migration `202611020001_automation_session_gate.sql` ties each browser
  task to the approving staff member's exact verified, active work session, under
  ten hours old. Pause blocks new claims; resume permits them; closure/expiry or
  authorization loss cancels pending tasks rather than carrying them into a new
  session. Already-leased work may finish and still blocks overlapping claims.
  The reviewed enqueue implementation is moved into a revoked private helper;
  callers retain only the session-gated public RPC. Legacy unbound pending tasks
  are cancelled on application, not silently authorized. Added covering worker
  and session foreign-key indexes; no existing index or data history is deleted.
- Run defaults to read-only profile detection and disables dispatch without a
  current session. Missing session-gate schema fails closed. An empty write-target
  list no longer removes the task selector and strands the user in that choice.
- Worker browser tasks now reject expired/short/unbounded leases and malformed
  UUIDs before local actions. Cookie/proxy changes require the target profile to
  be stopped. Cookie replacement requires an explicit successful clear; failure
  is no longer swallowed. Negative text such as "not ok" is not a confirmation.
- Raw local API/file exceptions are no longer submitted to hosted task history
  where they could expose cookies, proxies or private paths.
- Profile scans honor both the 500-entry cap and a conservative UTF-8 result-byte
  budget under the hosted JSONB allowance. Long names yield an explicit partial
  scan instead of an oversized completion failure. The UI identifies CSV import
  as the fallback for omitted profiles; repeated scans do not page through them.
- Preset inventory understands the same nested/string profile-list response as
  auto-detection. Reconciled leases no longer claim "cancelled before it ran."
  Setup guide includes actual local preflight/health/one-poll startup, exact
  session authorization and the separation between collection and monitoring.

Hosted security review is **not clean**: leaked-password protection is disabled,
and SECURITY DEFINER RPC notices require the existing scoped-token/membership
controls, not blanket grant changes. See
[password-security remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
The missing automation-task worker-FK index is addressed by the pending migration;
unused indexes are retained. The last 24-hour logs included four HTTP 400 login
rejections (invalid credentials/email not confirmed), not zero errors. No HTTP 5xx
was present in the returned status breakdown. No auth setting was changed.

**Still not a full launch:** this migration and web changes need explicit hosted
application/deploy approval; the agent must be registered again and Incogniton
must be reachable. An authorized exact-profile inventory/binding and one bounded
read-only monitoring pilot are required. Production Sheet-sync configuration was
previously deliberately removed and has not been re-enabled by this work. Auto
Posting/Listing handlers, scheduling, account creation, automatic Sheet writeback
delivery, Fudge upload release and unattended operation remain absent or gated.
The historical suspended pilot account must not be used until a person resolves
its platform status. No production writes, deployment, commit or push occurred.

Final-tree validation: web typecheck PASS, lint PASS (zero warnings), **889 tests
/ 64 files PASS**, production build PASS. Worker **131 unittest cases PASS**;
the isolated environment's `pip check` reports no broken requirements. New tests
exercise legacy-task cancellation, absence/wrong-owner/paused/expired/future/
revoked/unverified session authorization, protected helper grants, resumed claims,
completion after pause, UTF-8/JSONB scan budgets, negative clear confirmations,
busy-profile refusal, lease bounds, safe error receipts and rendered dispatch
controls. `git diff --check` passes (line-ending warnings only); targeted secret
patterns found no credentials or live Sheet links in changed/untracked files.
`npm audit --omit=dev` reported zero known production dependency vulnerabilities.
Anonymous production route checks passed against the existing deployment, **not**
the new local build. No signed-in full-chain or live browser acceptance is claimed.

## Current milestone

**Protocol deployment (2026-10-30): cohort and publish-job schemas are live;
execution stays gated.** After the full-chain audit the user directed implementing
all safe readiness items. Deployed the reviewed cohort protocol — promoted from
`supabase/drafts/check_cohort_v1.sql` to
`supabase/migrations/20261030164030_check_cohort_v1.sql` — through MCP as hosted
**`20261030164030 check_cohort_v1`**, and applied the publish-jobs protocol as
hosted **`20261030164110 publish_jobs_v1`** (source
`202610270006_publish_jobs.sql`). Hosted history is now **14 migrations**; there
are **28 public base tables**, all RLS-enabled. The three new tables
(`reporting_check_cohorts`, `reporting_check_cohort_items`,
`reporting_publish_jobs`) have staff-read policies; `authenticated` can select but
not insert directly, and `anon` has no table access. All three remain empty.

`/dashboard/run/cohorts` now unlocks for verified staff with an active work
session: it queues an explicit prior-business-date cohort bounded to 500 tracked
publications with immutable membership/receipts and per-item dispositions. The
rate limit, replay conflict checks and 60–1440 minute freshness window are
unchanged from local review. `/dashboard/publishing` now reads an existing empty
queue; its cancel/reconcile controls remain, and there is still no enqueue action
or browser adapter.

Nothing irreversible was switched on: `UPLOAD_RELEASED` and
`CATALOG_DOWNLOAD_RELEASED` remain false; the bundled agent allowlists monitoring
RPCs only and claims no publish jobs; the Sheet connector is still read-only with
no delivery worker; no publish job or Sheet writeback row has ever been created.
The pilot worker `Kashif PC` is paired and has run five read-only check jobs on two
tracked publications, storing 21 real comments with authors; nothing was posted,
liked, replied to or published. One work session from the live test is still open
and will expire on its own. Leaked-password protection and signed-in production
acceptance remain open. On 2026-10-30 the pilot Nextdoor account was found
indefinitely suspended, so live monitoring is paused until a person resolves it.

Validation on the final tree: typecheck PASS, lint PASS (**0 warnings**), **814
tests / 59 files** PASS, production build PASS. Hosted post-deploy checks confirmed
table/function/policy presence, the publication-source and notification-kind
constraints, the timestamp regex in `reporting_complete_publish`, and read-only
grants. Real signed-in cohort execution and publish claim/completion were not run;
they need an authenticated session, a paired worker and real tracked publications.
See `docs/DB-DEPLOYMENT-20261030-COHORT.md`; the drafts README and test path now
point at the promoted migration. Worker side: **88 unittest cases PASS**, covering
adapter v2 validation, the two comment gates, mount/expansion behaviour, completion
honesty and the account-disabled redirect.

## First-time setup guide (2026-10-30)

Added `/dashboard/settings/guide`, a colored, step-by-step guide linked prominently
from Settings and the Home daily-workflow panel. It covers the one-time setup
(verified account, business timezone, customers, worker pairing, exact-UUID
profile mapping, Master Sheet connection), the Fudge intake flow
(collect → source Sheet → cleanup → ND master Sheet, with intake upload still
off), the dashboard automation loop (work session → Master Sheet sync →
monitoring batch → Results/comments), a daily rhythm, troubleshooting
(login/verification, proxy, profile busy, account disabled, worker offline, Sheet
not configured, partial counts) and a separate desktop-only/gated section. It
states that publishing, listings, account creation, cookie/proxy execution,
scheduled or unattended work, automatic Sheet writeback and Fudge upload remain
unimplemented or desktop-only, and that an account-disabled page is a human
stop — never something to evade. Opening the guide starts no browser, upload,
post or Sheet write.

## Live-test setup (2026-10-30)

Added a repeatable read-only connector gate,
`apps/web/scripts/check-sheet-live.ts` (`npm.cmd run check:sheet`), and ran it
against the configured connector. `Auto Posting` returned **69 rows** and
`Auto Listing` **111 rows**, both with `truncated: false`, and a deliberately
wrong token was refused as `unauthorized`. The gate prints counts and statuses
only — never row content, the endpoint URL or the token — and writes no Sheet
cell. `SHEET_SYNC_ORGANIZATION_ID` resolves to the **ND Test** workspace
(`b59489ca-c7c3-4e1a-b2ae-ec9da429f415`), which has one membership, two
customers, one worker, and still **0** profile bindings, publications and active
work sessions.

The worker runtime is now installed and verified locally: a Python 3.13 virtual
environment at `apps/worker/.venv` holds the exact pins from
`requirements-monitoring.txt` (Playwright 1.64.1, pyee 14.0.0, greenlet 3.5.6,
typing-extensions 4.16.0), `pip check` reports no broken requirements,
`preflight.py` passes python plus all four dependency checks and the Playwright
sync-API import, and the 65 worker unit tests pass under that interpreter. The
Playwright wheel was downloaded from a mirror and its SHA-256 verified against
PyPI's published digest before install. The gitignored `.monitoring/` directory
holds a copy of the empty adapter example. `preflight.py` still blocks the
connection and adapter checks, and `worker.py health` still reports Incogniton
`unavailable` (the desk app is not installed on this machine — no install path,
process, uninstall entry or listener on `127.0.0.1:35000`), so no profile can be
opened. No worker credential exists in plaintext to recover; a new registration
is required.

`docs/LIVE-TEST-RUNBOOK-20261030.md` records this verified state and the ordered
operator procedure: runtime check, profile-inventory import, worker registration
and pairing, explicit per-profile bindings, adapter validation from an authorized
DOM inspection, one human work session, a foreground agent run, then the first
bounded 500-publication cohort. It also lists the evidence to collect and the
stop/rollback steps. Nothing in the runbook enables Fudge uploads, publishing,
profile mutation or Sheet writeback delivery.

### Cleanup for a fresh test state (approved by the operator)

- **Old worker `offive laptop` revoked.** Applied the same statements as
  `reporting_revoke_worker`: deleted its one credential hash, set
  `enabled = false`, and cancelled zero pending check/publish jobs. Result:
  0 worker credentials and 0 enabled workers remain; a new registration is
  required before any dispatch.
- **Orphan organization `ND Posts` deleted.** Verified first that all 27
  organization-scoped tables held **0 rows** for it and it had no memberships.
  The two remaining workspaces are `My business` and `ND Test`.
- Resulting `ND Test` state: 0 workers enabled, 0 profile inventory rows,
  0 bindings, 0 publications, 0 sessions, 0 cohorts, 0 publish jobs,
  0 writeback rows. This is a clean starting point, not evidence of a working
  chain.

### Incogniton install (2026-10-30)

The official Windows build was downloaded (Incogniton **5.0.1.5**, 191,171,088
bytes, SHA-256 `2eaad7bf…0d4c4`) after verifying its Authenticode signature:
**Valid**, signed by `WorkingGreen B.V.` via Sectigo EV code signing. The
installer was launched from `%USERPROFILE%\Downloads\IncognitonSetup-5.0.1.5.exe`.
Completing the wizard, signing in, creating/importing profiles and confirming
the local API on `127.0.0.1:35000` are operator steps; the worker still reports
`unavailable` until they are done, so no profile has been opened and no browser
check has run.

### First supervised live monitoring check (2026-10-30)

**Adapter derivation from the live DOM.** Probing the pilot post
(`nextdoor.com/p/C2-PfTCsR2XN`, customer `ND Test`, account
`Thomas Gutierrez`, Incogniton profile `6d98db87…208fa`) showed that Nextdoor
serves a permalink page in a feed shell: `document.title` stays *News Feed*, the
page carries many `feed-item-card` elements, and **no card ever links to its own
post**. The only anchors whose path equalled the post lived in the `navbar`
(offscreen 32×32 icons). The previously required "visible body **and** in-card
self-link" contract is therefore unsatisfiable on this platform, so the contract
was corrected rather than faked.

**Identity rule now implemented** (`apps/worker/monitor.py`, `SNAPSHOT_JS`). A
visible `post_root` counts as the exact post when it has a non-empty visible body
**and** either (a) contains a visible in-card link to the target path, or (b) the
page address itself is the target path **and** the body matches the stored post
title — the normalized first 40 characters contained in the body, or at least
80% of the title's words longer than three letters. Exactly one match is
required; zero or several yield `needs_review`. Content identity is never
accepted off the canonical address, and no title means only rule (a) applies.

**Claim payload (additive migration `20261030203000_check_claim_identity`).**
`reporting_claim_check` now also returns the publication's `title` and
`account_label` so the browser can verify identity. Planning, leasing, session
authorization and the 24-hour rule are unchanged, and the worker still rejects
unknown job fields. Verified live against the pilot: the stored title matched the
target card with 100% word overlap while every other card scored 0.

**Selectors taken from the live DOM (adapter version 2).** `post_root`
`[data-testid="feed-item-card"]`, `post_body` `[data-testid="post-body"]`,
`post_link` `a[href*="/p/"]`, `login` `[data-testid="email-address-input"]`
(absent when signed in). Comment fields derived from a real 22-comment thread:
`comment` `.js-media-comment`, `comment_id_selector`
`[data-testid^="dwell-tracker"]` with `comment_id_attribute` `data-testid` and
`comment_id_prefix` `dwell-tracker-feedItem:` (leaving the numeric platform id),
`comment_body` `[data-testid="comment-detail-body"]`, `comment_author`
`[data-testid="comment-detail"] a[href*="/profile/"]`, `comment_expand`
`[data-testid="seeMoreButton"]` and `comment_total`
`[data-testid="post-reply-button"]` scoped to the identified root. Those five are
optional in version 2 (an empty string means the layout does not offer them), and
expansion only happens when the adapter names the control **and** the operator
passes `--allow-comment-expansion`. `removed`, `verification` and `unavailable`
stay non-matching placeholders, so an unrecognized layout yields `needs_review`.

**Live result.** One auto-planned job, claimed and completed
`ca03a6b3…50e5`: outcome `alive`, adapter fingerprint recorded, publication
`visibility` moved `not_checked` → `live` at `last_checked_at`
`2026-10-30 18:52:24Z`, `comments_total` left `null`, observation
`comments_complete = false`, post check `alive`/positive "Post is alive", and one
notification noting partial comment collection. A second `--once` poll returned
`idle` with no second job, and the Incogniton profile returned to `Ready`.

**Fail-closed matrix verified live before the run:** stored title → `exact_post`
true; wrong title → false; missing title → false; different target URL → false.
Two real defects were found and fixed on the way: `local_incogniton.stopped()`
ignored the `status` key (`{"status":"Ready"}`), so every idle profile looked
busy; and the first identity draft accepted a wrong target URL because the title
branch was not gated on the page address.

**Comment capture is possible and was validated at 22 of 22 (2026-10-30).** A hard
navigation mounts an empty `[aria-label="Comment list"]`; neither waiting nor
scrolling populates it. Activating the post's own comment control
(`[data-testid="post-reply-button"]`, `aria-label="Comment"`) opens the thread the
way a reader does — one item plus "See previous comments" — and each
`[data-testid="seeMoreButton"]` press loads the rest. Nothing is typed, submitted,
liked or shared, and the composer that gains focus is never written to.

On a real 22-comment post the production snapshot collected 22 items with 22
unique numeric ids, 22 authors and 22 bodies; the post's own count read 22, the
expand control was gone, and `comments_complete` came out true. Both interactions
sit behind **two independent gates** — the adapter must configure `comment_expand`
and the operator must pass `--allow-comment-expansion` — so the default run still
reads the thread exactly as rendered.

`comments_complete` is true only when the page's total was read, the number of
collected items equals it, the adapter can expand at all, and nothing remained to
expand. A collapsed, unopened or partially loaded thread therefore always stores
`comments_complete = false`, and the notification says which of the two happened.

The 117–118 character list from an earlier probe belonged to a **neighbouring
feed card**; that attribution was withdrawn and is not part of this result.

The dashboard side is already complete: `/dashboard/comments`,
`/dashboard/posts/<id>` and `/dashboard/results?view=comments` all render stored
comment detail (author, body, first-observed time, platform creation time when
known), and the post ledger shows the per-post count.

**Live acceptance paused: the pilot account is suspended (2026-10-30).** After the
first live collections, every navigation with profile `6d98db87` began landing on
`https://nextdoor.com/account_disabled/`, whose page reads "Your account has been
indefinitely suspended by Nextdoor for breaking community guidelines." This is a
platform action against the account, not a proxy failure, a selector problem or a
post removal. Ten consecutive observations across two runs and a dedicated trace
showed the same redirect, with nine restored tabs on that address.

Consequences, recorded rather than papered over:

- the pilot post holds **21 of 22** stored comments with real authors; the 22nd is
  unreachable while the account stays suspended, so the observation stays
  `comments_complete = false` and the notification stays "partial";
- the run attempted after the suspension stored `needs_review` with the reason
  "Navigation did not remain on the exact post" — honest, but too vague for an
  operator, so the classifier now recognises `/account_disabled/` and returns
  "Nextdoor redirected to its Account Disabled page; a person must review the
  account." No comment is stored from that page and no other outcome is claimed;
- no further live checks should run against this account until a person resolves
  it with Nextdoor or an authorized replacement account/profile is bound.

The 22-of-22 capture result above came from the production read path and was
reproduced immediately before the suspension; it describes the collector, not a
claim that the account is usable now.

**Reporting chain checked at the data layer** (the UI needs the operator's own
session). `/dashboard/checks` reads `reporting_post_checks` and shows the single
`alive` row. `/dashboard/reports` derives its cohort from `published_at`, so this
post — imported without a date — is deliberately excluded from day cohorts and
counted in `unknownDates` (1) with the existing coverage notice; it is not
silently dropped and no date was invented. A proxy failure observed on an
unrelated profile during probing (`ERR_SOCKS_CONNECTION_FAILED`) maps to
`proxy_issue`, never to a dead-post outcome.

**Transient failures no longer consume the 24-hour window (2026-10-30).**
`reporting_complete_check` advances `last_checked_at` for every outcome, so one
30-second `ERR_SOCKS_CONNECTION_FAILED` used to block a publication for a full
day — and an undated post had no manual requeue path at all. Migration
`20261030220000_transient_check_retry.sql` re-plans a publication whose
`last_check_outcome` is `proxy_issue`, `network_error` or `profile_error` once 30
minutes have passed, capped at **6 attempts per rolling 24 hours** so a
persistently broken profile cannot create job churn. Authoritative outcomes
(`alive`, `deleted_from_nd`, `unavailable`, `needs_review`, login/verification)
keep the full 24-hour window; `needs_review` deliberately does **not** fast-retry
because a human decision is pending. Verified as a truth table before rollout:
proxy + 40 min + 1 attempt → replan; proxy + 10 min → wait; proxy + 40 min + 6
attempts → wait; `alive` + 40 min → wait; `alive` + 25 h → replan.

**Egress is US, not Pakistan (verified in the profile's own browser).**
`ipinfo.io/json` loaded inside the pilot Incogniton profile on 2026-10-30
returned `country: US` with a non-datacenter organisation hint. The pilot is
therefore not browsing Nextdoor from a Pakistani address; the banned-region risk
is a property of whichever proxy a profile is assigned, not of the host machine.
The same proxy is demonstrably flaky (`ERR_SOCKS_CONNECTION_FAILED` observed on
two different profiles minutes apart), which is exactly the case the retry rule
above now covers.

**Authorized production web deployment (2026-10-30): public identity routes
repaired.** After the database rollout, the user approved completing the ND
side as a fully ready flow, keeping publishing/cohort SQL and live
uploads/posts/Sheet writes excluded. Deployed the reviewed working tree to the
existing Vercel project `jelly-bean2/nd-automation-dashboard` using the cached
CLI 65.8.0 (linked account `boostera385-9959`). A first upload from the
repository root failed — the project has **no Root Directory** set, so `next
build` ran with no `app/` directory; the original deploy root is `apps/web`,
and redeploying from there succeeded. Production
`dpl_G4ywobKk25PHVffoeLQGAELpPr4t` is now aliased to
https://nd-automation-dashboard.vercel.app. No Git connection was created;
nothing was committed or pushed. The stale 404 deployment (`dpl_8nGq…`) and the
failed root attempts remain only as history records.

`npm.cmd run check:deployment -- https://nd-automation-dashboard.vercel.app`
**passes on production**: `/login` 200 uncached + frame-denied; `/workspaces`,
`/verify-email`, `/dashboard` and `/dashboard/run/cohorts` 307 to same-origin
`/login` (`/workspaces` and `/verify-email` previously returned 404). Signed-in
use, Auth form submission and authenticated acceptance remain unverified
(`authenticatedReadiness: "unverified"`). Local hygiene: the mistaken repo-root
`.vercel` link and its generated root `.env.local` were removed immediately;
`apps/web/.env.local` was only refreshed with a new short-lived project-scoped
`VERCEL_OIDC_TOKEN` (pre-application backup byte-compared; file is ignored and
must never be staged); `apps/web/.vercel` was removed after deployment — see
`docs/DEVELOPMENT.md` for the relink/redeploy procedure.

**Manual production refresh (2026-10-30, later):** fixed the `reporting` GitHub
check, which had failed on a Windows/Linux CRLF mismatch in the generated Sheet
connector. The bundler now normalizes to LF and `.gitattributes` forces `*.gs`
to LF; CI passed on `7f86e3e` (814 tests). Redeployed the reviewed tree from
`apps/web` as `dpl_5VaMzwcSAubgdR8TsEcYHBKBpqz4`, aliased to
https://nd-automation-dashboard.vercel.app. `check:deployment` passes on all
anonymous routes (`/login` 200; `/workspaces`, `/verify-email`, `/dashboard`,
`/dashboard/run/cohorts` 307 to `/login`), and the new
`/dashboard/settings/guide` route returns the same auth redirect instead of
404. Signed-in acceptance remains unverified. The project still has **no Git
connection**: pushing to `main` does not deploy; production changes require the
manual CLI procedure above.

Remaining ND gaps unchanged: publishing/cohort protocol deployment (excluded
from all approvals), mapped Sheet delivery, supervised worker runtime, live
Auth acceptance and F01–F36 desktop parity. User directed Fudge as the next
repository.

**Authorized database rollout (2026-10-30): verified-access fix is now applied.**
After the local remediation below, the user explicitly authorized migrations via
Supabase and Edge Functions if needed. Reverified the shared target, 11 existing
migrations, tables, logs and advisors. Reused cached CLI 2.122.0 to generate source
`supabase/migrations/20261030155515_verified_access_v1.sql`, promoted the tested
draft, reran its security/historical-baseline cases (**14 PASS**), and applied
only that migration through MCP as **`20261030155727 verified_access_v1`**.
There are now **12 hosted migrations**; the 13 local files still include the
intentionally undeployed publishing protocol. Cohort SQL remains a draft. No
reset/history repair/wholesale push or historical source-file edit occurred.

All five deployed hardening bodies match promoted source with CRLF/edge whitespace
normalization. Trigger/grants verified; the pre/post aggregate of the existing
claim/completion/heartbeat/credential-helper bodies is unchanged. Hosted
read/role-only smoke **PASS**: existing verified staff own-business access,
missing-identity read/session-action denial and anonymous denial. No fixture
account/email/membership/customer/session/job write was used. Initial smoke
harness grant inspection under anon hit intentional private-schema denial; moved
that metadata check before assuming anon, without broadening any privilege.
Unconfirmed-member and confirmation-loss dispatch cases remain local PGlite
evidence, not a newly created hosted Auth account/browser acceptance.

All 25 public tables still have RLS; bindings, publications, check jobs and outbox
remain zero. Advisor counts unchanged (3 anonymous + 21 authenticated SECURITY
DEFINER notices, private no-policy INFO, leaked-password protection disabled,
27 unused-index INFOs). See `DB-DEPLOYMENT-20261030-VERIFIED-ACCESS.md` for source
hashes, hosted version, limits and clickable remediation guidance. No Edge
Function was needed or deployed; no live-operation gate changed.

The earlier complete local run passed typecheck/lint, **805 tests / 57 files**,
production build, **65 worker tests** and 12 signed-out local HTTP checks. The
new deployment checker also passed against that owned local build. Promoted-source
full validation is being rerun and will be recorded here when complete. Public
web identity routes still 404: this database-only approval did not explicitly
approve Vercel rollout. Publisher, mapped Sheet delivery, full restore and other
desktop/full-flow work remain incomplete; Fudge remains the selected next repo,
not a completed cutover. No user/browser/Sheet/content operation, install,
commit/push, paid resource or Vercel deployment was performed.

**Local remediation tranche (2026-10-30): confirmed SQL/worker findings addressed
in source; NOT all full-flow gaps closed.** The user selected **Fudge** as the
next repository. Deployment answer was delegated as a best-practice choice, not
an unambiguous hosted-write approval; local-first validation was chosen and no
Supabase/Vercel deployment, release enablement or real platform/Sheet write ran.

Implemented:
- `apps/worker/worker_protocol.py`: exact canonical job/lease contracts, zoned
  timestamps, a 6–15 minute remaining-lease acceptance window, bounded browser
  budget with a three-minute completion/cleanup reserve, strict bounded result
  fields and exact boolean acknowledgment (`false` remains valid idempotent
  replay). Invalid/short/expired/implausible claims stop before profile launch.
- `apps/worker/monitoring_journal.py` plus `agent.py`: private single-checkpoint,
  sibling-temp write/flush/fsync/atomic replacement; claim saved before launch,
  bounded observation saved before backend submission, exact job/lease/result
  replay on restart before any new claim. Malformed/lost receipts or disk errors
  retain the result and block new work. No token is saved in the journal; pending
  data is credential/project scoped and comment payload is removed only after
  verified acknowledgment. Files remain Git-ignored/private, not encrypted.
- Result-only recovery requires explicit authorization but no adapter, pinned
  Playwright runtime, profile launch or new claim. Uncertain cleanup stays blocked
  until an exact-job operator attestation. A claim with no observation never
  replays the browser: a distinct exact-job/loss acknowledgment records
  `operator_reconciled`, **not completed**. It asserts no server verification or
  recovered observation and cannot discard a saved result. Operator must actually
  inspect cleanup/reconcile the dashboard lease first. Clean terminal metadata
  can be replaced by separately configured credentials; unresolved data cannot.
- `supabase/drafts/verified_access_v1.sql`: additive, **undeployed** SQL hardening
  of legacy membership/staff/customer helpers and own metadata reads using fresh
  confirmed `auth.users`. A private trigger checks current verified active session
  ownership before creating/leasing checks, including previously authorized
  invalid sessions. It preserves existing claim function bodies/cross-type rules
  and allows already-leased completion to drain. Invalid legacy authorizations
  fail closed, potentially blocking that worker until operator reconciliation.
  No historical migration was edited, promoted or applied.
- `npm.cmd run check:deployment -- <origin>`: anonymous bounded GET gate, no
  redirects followed or Auth submission. Missing identity/workspace routes fail,
  login must be uncached and all inspected routes frame-denied. This is a
  detection/pre-release gate, not a production fix or signed-in acceptance.
- GitHub workflow now includes stdlib-only Python worker tests; workflow configured
  locally, not run on GitHub. Web/worker regression tests and operator commands
  are documented in `docs/DEVELOPMENT.md` and `apps/worker/README.md`.

Fresh validation after this implementation:
- Dashboard: typecheck PASS, lint PASS, **805 tests / 57 files PASS** (23 added),
  production build PASS with both identity and both cohort routes.
- Worker: **65 unittest cases PASS** (22 added), including failed storage/acks,
  lost responses, malformed/expired leases, restart-only replay, no-result and
  cleanup recovery, private scope isolation and explicit CLI confirmations.
- Owned local production server: **12 signed-out HTTP checks PASS**, stopped
  afterward. No Auth form submission or business row writes.
- Actual public deployment gate exits **1 / FAIL**: `/workspaces` and
  `/verify-email` still return 404; login and anonymous dashboard/cohort guards
  pass. Hosted rollout remains outstanding rather than claimed repaired.
- Eleven local PGlite cases specifically exercise the security draft; these are
  included in 805, not additional cases. Tests deny unconfirmed members' direct
  legacy reads/RPCs, preserve scoped verified access, block pending/new worker
  dispatch after confirmation loss and allow already-leased result drain.
- `git diff --check` PASS (existing Windows line-ending warnings only); ignored
  runtime journal path verified. Fudge application source is unchanged; its
  earlier 67/127 results are historical for this tranche, not freshly rerun.

Remaining release/code gates: deploy reviewed additive SQL/current web source
with explicit approval; keep cohort SQL/publishing migration deployment separate.
Actual publisher/submit journal, media/schedule and safe browser adapters, mapped
monitoring-to-Sheet outbox/delivery, field-writer ownership/stable IDs, latest-100
policy, full comments, remaining F01–F36 desktop adapters and full backup/restore
are not delivered by this tranche. Authorized test profiles/selectors, development
Sheet mappings/write columns, content/media rights, retention and supervised
pilots cannot be invented from passing fixtures. No missing functionality was
enabled, no customer session opened, no package installed, no commit or push.
The source-level findings in the prior review below are superseded only where
this entry explicitly implements a fix; production and full-flow gaps stay open.

**Fresh cross-repository review/testing (2026-10-30): NOT COMPLETE for the
requested end-to-end workflow.** Reviewed dashboard commit `18777bb` and Fudge
commit `2c64482`, with initially clean working trees. Targeted source review
covered verified identity/workspace boundaries, cohort requests/receipts,
monitoring claims/completion, extension consent/queue/catalog gates, Sheet
transport/writeback and publishing boundaries. This is not an exhaustive audit
or a desktop-parity sign-off. All 44 tracker IDs occur once; shared master plans
and frozen readiness checkpoints remain byte-identical.

Fresh checks actually run, rather than inherited from yesterday's entries:
- `apps/web`: `npm.cmd run typecheck` PASS; `npm.cmd run lint` PASS;
  `npm.cmd test` **782 tests / 55 files PASS** (233.51 seconds).
- `apps/web`: `npm.cmd run build` **PASS**, including `/workspaces`,
  `/verify-email` and both cohort routes in the production route manifest.
- Owned local production server on `127.0.0.1:3107`: **12 signed-out HTTP
  smoke checks PASS**. Login returns 200; workspace/verification, dashboard,
  cohort list/detail, writeback, catalog, intake, publishing and both export
  routes return 307 to `/login`; all inspected responses carry frame denial.
  Test server stopped afterward. The temporary standalone harness is outside
  the repositories; no Auth form was submitted or business row written.
- `apps/web`: `npm.cmd audit --omit=dev --json` reports zero known production
  dependency vulnerabilities; this is registry coverage, not security acceptance.
- `apps/web`: `npm.cmd run check:readiness` exits 0 for local configuration only;
  hosted/Auth/recovery/worker readiness remains explicitly unverified there.
- Fudge: `node --test tests/backend.test.js` **67 PASS**;
  `node tests/smoke.test.js` **127 PASS**; `node --check` PASS for all 18 tracked
  JS/CJS files. Smoke fallback/rate-limit messages are fixture output, not proof
  of a live writer or connector failure.
- `apps/worker`: `python -m unittest discover -v` **43 PASS**.
  Actual `python preflight.py` exits **1 / BLOCKED**, not a passing readiness
  check: exact dependency/import and private connection/adapter checks fail.
  Python 3.13.15 itself passes; zero network calls/profiles/jobs. Node v24.22.1.
- Thirteen additional offline cross-repository fixtures agree: eight ingestion
  projection/batch cases and five catalog snapshot cases. These ad hoc probes
  are separate from the suite counts, not installed-extension acceptance.

Findings requiring follow-up (no application fixes or deployments performed):
1. **Release blocker / production route mismatch:** public production
   `https://nd-automation-dashboard.vercel.app/workspaces` and `/verify-email`
   both return **404**, including a repeat check. Current source contains both
   routes and `src/proxy.ts:31` protects them. Production `/login` returns 200
   with `DENY` and private/no-store; anonymous `/dashboard`, cohort and writeback
   routes redirect 307 to `/login`. The latter does not prove that their pages
   exist behind the guard. Verify the deployed revision/build root and deploy
   the reviewed source only with approval. The fresh local production build
   includes both routes and the local smoke redirects them to login, confirming
   the observed difference from the public deployment; signed-in behavior and whether the
   central guard is deployed were not established by anonymous HTTP probes.
2. **Security / legacy SQL verification gap confirmed offline:** foundation
   migration `202610260001_reporting_foundation.sql:128-140,187-190` authorizes
   through membership without checking email confirmation. A fresh local PGlite
   fixture seeded an unconfirmed user with an existing operator membership;
   under that user's authenticated role, one fixture customer was readable and
   `reporting_session_action(...,'start',...)` succeeded. Hosted read-only function
   inspection also finds no `email_confirmed_at` reference in `is_staff`,
   `is_member` or `can_view_customer`. The newer application guard blocks this
   at the dashboard boundary, not direct legacy database access. This requires
   an existing authenticated session AND assigned membership; it is not proof
   that an ordinary fresh signup can read business data. Add reviewed additive
   SQL defense-in-depth and direct-role denial tests; do not edit applied history.
3. **Worker safety validation gap reproduced:** `apps/worker/agent.py:63-83`
   accepts both `lease_expires_at='2020-01-01T00:00:00Z'` and
   `'not-a-timestamp'`. Mocked `poll_once` calls the runner once and reports
   completed for either. Validate a bounded, future lease and budget before any
   profile operation. These probes patched the runner; no browser was opened.
4. **Worker acknowledgment validation gap reproduced:**
   `apps/worker/agent.py:46-56,88-91` accepts an arbitrary JSON object from
   `reporting_complete_check`, and the caller does not verify the completion
   receipt before reporting completed. An offline mock returned
   `{"unexpected":"not a boolean acknowledgment"}` and was accepted.
   Require the documented boolean response (false is legitimate idempotent
   replay), reject malformed responses and add negative tests. The existing
   43-test suite does not establish these two missing validations.
5. **Implementation/recovery gates remain:** no connected publisher, submit
   journal/media/schedule adapter, mapped monitoring-to-outbox deliverer, latest
   100-per-profile policy, durable worker result recovery, complete comments or
   accepted profile/onboarding/cookie/proxy replacement. Both Fudge release
   constants remain false; catalog cache never applies rules to `serviceRules`.
   Do not enable releases or remove the desktop app to make these checks pass.

Fresh read-only hosted metadata: same selected shared project; **11 applied
migrations**, **25 public tables / all RLS-enabled**, no anonymous table SELECT
and no authenticated table-level INSERT/UPDATE/DELETE grants. Publishing and
cohort tables are absent. Inventory, bindings, publications, check jobs, intake
records and writeback intents are zero; active catalog has two rules. Thus the
local cohort draft and publishing protocol are not hosted-ready, and there is no
live monitoring corpus. This metadata is not a complete schema/grant equivalence
or real tenant/Auth test. One initial metadata query used the wrong catalog-head
column and was corrected; that review-generated SQL error is not an app defect.

Hosted advisors remain non-clean: three anonymous and 21 authenticated
SECURITY DEFINER notices, disabled leaked-password protection, one intentional
private no-policy INFO and 27 unused-index INFOs. See
[worker RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[staff RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
and [private RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
The initial last-24-hour log aggregate contained four PostgreSQL ERROR entries
and two Auth WARNING entries; aggregate severity alone does not identify an
application defect. No raw logs/customer payloads were copied into the repo.

Real signed-in/multi-account/stale-tab browser tests, installed-extension MV3
restart/permission tests, real PostgreSQL contention, supervised DOM/profile
pilots, Sheet delivery and restore acceptance remain unrun. No hosted writes,
DDL, Sheet edits, signup/reset requests, customer sessions, dependencies,
release changes, commits or pushes were initiated by this review. Only status
documentation is being updated; previous dated entries below are historical.

**Code-first follow-up (2026-10-29): durable date-cohort checks and worker
preflight implemented locally; setup deliberately deferred.** New
`/dashboard/run/cohorts` and `/dashboard/run/cohorts/[id]` provide one explicit
customer/prior-business-date/post-vs-listing selection, confirmation, stable
request ID, immutable receipt history, and read-only paginated progress. The
server validates the rendered account/workspace before dispatch, bounds RPCs
with 15-second abort signals, checks exact receipt scope/IDs/counts, never
automatically retries an unconfirmed write, and locks form inputs after submit.
The entry route disables refresh controls if protocol setup/history or the
customer list cannot be verified. Merely opening/refreshing a page never queues
checks. Existing per-session profile authorization must already exist.

`supabase/drafts/check_cohort_v1.sql` is a **local, undeployed review draft**,
not a change to any applied migration. It adds verified-staff RLS read-only
cohort/header item tables and invoker public RPC wrappers around constrained
private functions. Explicit refresh snapshots at most 500 exact known-dated
tracked IDs/URLs/labels/timestamps; changes while acquiring locks abort instead
of substituting targets. Session -> ordered workers -> bindings -> publication
locking, existing open-job uniqueness, stable request replay, a six-new-request
per-minute limit, and explicit 60–1440 minute freshness preserve bounded
deduplication. Safe replay works after session end without creating jobs. Prior
business date uses the selected customer's timezone and UTC interval boundaries,
including DST. The original scheduled 24-hour suppression and worker claim/
completion functions are unchanged. Profile authorization, worker revocation,
pause/end and expired-lease reconciliation remain enforced; no profile/session
is enabled by a cohort request.

Unknown-date counts are separate snapshot metadata; unsupported worker URLs,
unmapped/unauthorized profiles and disabled workers have explicit per-item
reasons. Existing active jobs are reused, recent checks are labelled recent,
and technical outcomes never become removal. Completed counts mean durable
check completion, not proven visibility. Missing links outside the ledger
cannot be counted and remain unknown. Progress reuses durable monitoring results;
comments remain partial. **Mapped result-to-Sheet outbox hookup/delivery is not
implemented by this slice; latest-100-per-profile is a separate pending policy.**

Worker `preflight.py` now checks Python, exact pinned dependency versions, sync
API import, private connection shape and selector completeness without network,
installation, driver startup or profile operations. New pinned
`requirements-monitoring.txt` is a candidate Python >=3.12 environment, not a
claim of Incogniton/CDP compatibility. Agent dry-run reports local setup vs
unverified live gates; actual execution requires the pinned runtime first. The
existing three-RPC allowlist and authorization flags remain. Connection
validation moved into a shared local module without broadening accepted input.

Full dashboard validation: typecheck PASS, lint PASS, **782 tests / 55 files
PASS** (70 new cases), production build PASS including both cohort routes.
Thirty local cohort protocol database cases include the 100-publication fixture,
DST 23/25-hour boundaries, replay/reuse, expired leases, fresh results, actor/
tenant/role denials and atomic limits. Signed-out HTTP smoke on an owned local
build server returned 307 to login for cohort list/detail/run routes; the server
was stopped afterward. Worker **43 unittest cases PASS** (8 new).
Actual `python preflight.py` exits **1 as expected** on this unconfigured
machine: dependency/private-file checks blocked, live readiness false, zero
network calls/profiles/jobs. No dependency was installed, file populated, hosted
DDL/data changed, worker started, Sheet edited, or release gate enabled.
Real PostgreSQL multi-connection/HTTP Auth, stale-page interaction, worker
recovery, supervised DOM and 100-post live acceptance remain unrun. This is not
completion of all F01–F36/P0–P8 code or configuration readiness; publishing,
remaining desktop adapters, durable result recovery, Sheet delivery and catalog
application still require further implementation.

**Security implementation slice (2026-10-29): central verified identity and
explicit workspace context.** The real data-access layer now checks the fresh
Supabase `getUser()` result and `email_confirmed_at` before any membership or
business data read; unconfirmed sessions go to `/verify-email`, with truthful
internal-admin handoff and no claim that SMTP works. This protects direct
Server Actions and route handlers, not only dashboard layouts or proxy checks.
The notification feed no longer has a separate unordered first-membership path.

Membership reads are ordered, strictly validated and bounded at 100 (101st row
fails closed, never truncates into an arbitrary selection). A single membership
auto-selects; multiple memberships require `/workspaces` and explicit confirmation.
The HttpOnly/SameSite session preference is account-bound and verified against
current memberships on every request; it grants no access. Revoked selection
does not fall through into another business. Sign-out clears the preference.
Selection changes no database row or worker/session authorization; the UI warns
to finish/pause existing work and does not pretend that switching stops a worker.

All 30 existing form-based business action entrypoints now verify the rendered
user/business context before dispatch. A stale/missing/duplicate/foreign context
redirects to explicit re-selection with a fixed notice rather than silently
writing into the cookie's new business. Shared/custom forms carry that context;
the dashboard provider remounts on account/business change to discard old local
previews, request IDs and credentials. Notification polling/acknowledgment and
local handled-ID storage are also scoped; stale-tab feed requests return 409.
The legacy observation action additionally checks the target publication in the
selected business before its org-less RPC. Membership/RLS/RPC authorization stays
authoritative; a hidden field or selection cookie never supplies a role.

Added real-DAL transport-boundary tests (the data module/guard are not mocked),
direct mutation rejection, role/revocation/malformed/overflow/stale-tab cases,
selection action/cookie, confirmation/selector UI, notification boundary and
publication-target tests, plus guards for all 30 action entrypoints/custom forms.
Full validation: typecheck PASS, lint PASS, **712 tests / 50 files PASS** (63 new
cases), production build PASS including `/verify-email` and `/workspaces`.
A temporary, owned local production server returned `/login` 200 and anonymous
`/verify-email`, `/workspaces`, `/dashboard` and writeback 307 to `/login`; server
was stopped afterward. These are signed-out HTTP checks, not signed-in acceptance.
Fudge rerun: 67 backend + 127 smoke PASS; all tracked JS/CJS syntax checks PASS.
No Supabase schema/RLS/worker RPC was changed by this application-layer slice.
Legacy SQL verification defense-in-depth and real multi-account/browser acceptance
remain separate follow-ups. No production deployment, user/membership write,
automation or release-gate change was performed; remaining publishing, Sheet,
keyword semantics, worker setup, recovery and desktop-parity gaps stay open.

**Cross-repository readiness review (2026-10-29): NOT READY for end-to-end
automation; not an error-free certification.** Reviewed the shared master plan,
all 36 F-items and 8 N-items in the tracker, dashboard/Fudge integration paths,
worker allowlist, hosted schema/history/grants, logs and advisors. Every tracker
ID occurs exactly once; none is signed off as full desktop replacement. Both
master-plan copies and both frozen pre-test checkpoints remain byte-identical.
This entry supersedes stale counts/readiness wording in earlier milestones and
the frozen checkpoint; it is not final live acceptance.

Fresh validation actually run:
- From `apps/web`: `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS,
  `npm.cmd test` **649 tests / 43 files PASS**, `npm.cmd run build` PASS.
- `npm.cmd audit --omit=dev --json`: zero reported production-dependency
  vulnerabilities. This is registry coverage, not a security guarantee.
- From Fudge: `node --test tests/backend.test.js` **67 PASS**,
  `node tests/smoke.test.js` **127 PASS**; all tracked `.js`/`.cjs` syntax checks
  PASS. These use fixtures/mocks, not an installed-extension acceptance run.
- From `apps/worker`: `python -m unittest discover -v` **35 PASS**.
- `npm.cmd run check:readiness`: exit 0, local configuration ready, hosted
  readiness explicitly unverified by that offline command.
- Production `/login` returned 200 with frame denial/no-store; anonymous
  dashboard, publishing, catalog, writeback and master-Sheet requests returned
  307 to `/login`. No new authenticated browser walkthrough was performed.

Read-only hosted verification: selected shared project confirmed; **11 applied
migrations, not 12** (the checkpoint's table itself lists 11). Twelve local
migration files include the intentionally undeployed publishing protocol; do not
blindly push/reset either repository's migrations. All **50 deployed function
bodies match the 11 applied source migrations**, normalized for CRLF and edge
whitespace; sorted name/body aggregate MD5 `3a152185d42690fe6f4b8c9790039072`.
This body comparison is not a full schema/constraint/index equivalence proof.
All 25 public tables have RLS; anonymous SELECT and authenticated table-level
INSERT/UPDATE/DELETE privileges are denied on the inspected tables. Private
worker credentials remain client-inaccessible. Published ND Test configuration
is revision/generation 1 with **2 test rules**, not the business catalog. Inventory,
bindings, publications, check jobs, intake records and writeback intents are zero;
the publish-job table is absent and no Edge Functions are deployed.

The user-designated business/source workbook reference is saved identically as
`backups/business-source/REFERENCE.private.json` in both repositories; Git ignore
was verified. Its link and contents must not enter public Git. Anonymous bounded
reads of Structure keyword cells and Services succeeded: **21 service rules,
41 distinct request keywords, 27 without exact Services matches**, no normalized
keyword collision, no blank required classification fields or invalid flags.
Rule fields equal the existing private snapshot. Offline use of the actual
dashboard preview/contract and extension snapshot validator accepts all 21 rules
with 0 errors and 23 warnings; configured keyword identity lookup resolves 21/21.
This does not prove semantic coverage of the 27 exact misses or matching accuracy
on real reviews. No reviews, names, phone values or media were fetched in this
review. Sharing is anonymously readable: the owner should review restriction of
business data; no permission was changed. This workbook is the Source/Services
reference, **not** the operational ND Master; do not rename it to force a passing
Auto Posting connection test. The prior operational connector tab-mapping failure
and hosted connector setup remain unresolved.

Release-blocking findings / next work:
1. Publisher/release action, durable submit journal, media/schedule adapters and
   hosted publishing migration are missing; the actual agent accepts only three
   monitoring RPCs. P5/P6/P7/P8 and desktop feature sign-offs are incomplete.
2. No Sheet outbox deliverer exists; queue/cancel UI is not real Sheet delivery.
   Keep delivery unwired and both Fudge release constants false. Backend catalog
   cache still never applies to `serviceRules`; existing Services sync owns them.
3. Monitoring cannot start from this reviewed setup: zero bindings/publications,
   no documented `.monitoring/worker.json` or validated `adapter.json`, and no
   Playwright package in the current Python 3.13.15 interpreter. Other installed
   environments were not certified. Registration alone is not a successful pilot.
4. Dated-cohort one-click refresh, latest-100-per-profile policy, full comments,
   recovery/restore, real multi-connection contention and live end-to-end browser
   acceptance remain missing/unverified. DST fixture tests pass; live reporting
   acceptance is not established with zero publications.
5. Central `src/lib/data.ts` `getContext`/`requireWorkspace` checks verified user
   identity and membership but **does not check `email_confirmed_at`**. New catalog,
   intake and writeback paths have explicit checks; older Sheet/monitoring/reporting
   paths rely on upstream Auth confirmation configuration and membership-based
   RLS. An unconfirmed user who already has a valid session and membership is not
   explicitly rejected there. This is not evidence that a fresh unassigned signup
   can access data. Add central defense-in-depth plus non-mocked denial tests in a
   separately reviewed implementation change; do not call current mocked gates
   proof of universal verified-email enforcement.
6. `getContext` selects membership with unordered `limit(1)` and no workspace
   selector. Multi-business dashboard selection is ambiguous; current staff has
   one membership, so this is a future multi-business blocker, not observed leakage.
7. Preserve but do not silently migrate Fudge's legacy identity/service-changing
   first-person rewrites (`apps-script.gs`, writer prompt) or public-link Drive
   sharing. Rights, truthful attribution, media access and retention need explicit
   disposition before automated content/publishing cutover.

Security advisor remains non-clean: 3 anon-executable worker SECURITY DEFINER
notices (credential-gated paths), 21 authenticated SECURITY DEFINER notices,
disabled leaked-password protection and 1 intentional private no-policy INFO.
Performance advisor reports 27 unused-index INFOs, no unindexed-FK finding.
See [worker RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[authenticated RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
and [private RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Last-24-hour log aggregates include 4 PostgreSQL errors (42P01 x2, 42703 x1,
42601 x1) and one Auth/API 400; no source-level cause is asserted from aggregate
counts. No raw logs, credentials or customer payloads were copied into Git.
Targeted tracked-file/path scans found no real secret/private-reference matches;
one secret-key pattern hit is the intentionally fake rejection fixture in
`tests/env.test.ts`. This is not a complete history/credential audit.

No application code or applied migration changed, no production writes, Sheet
edits, automation, release enablement, installs, commits or pushes performed by
this review. SMTP remains deliberately deferred for the internal-staff workflow.

**Decision — email verification deferred (2026-10-29, user-directed):** this is
an internal organization tool, so custom SMTP (Resend or equivalent) is not
being configured now; it becomes a requirement only if external signups,
self-service password recovery or reliable confirmation delivery is needed.
Consequences recorded honestly: the Supabase "Confirm email" setting stays on,
so any self-service signup remains gated by the app's `email_confirmed_at`
checks and can see nothing; staff accounts are provisioned by an administrator
in the Supabase dashboard using "Add user" with "Auto Confirm User", which sets
`email_confirmed_at` without sending mail; and there is still no in-app
membership/invite flow, so a new staff user also needs a `reporting_memberships`
row (organization + role) added administratively. Forgot-password is therefore
not self-service — without SMTP the message may not arrive, and recovery is an
administrator-side password reset. The Auth Site URL and `/auth/callback`
redirect allowlist should still be set to the production domain so links are
correct the moment a sender exists. No release gate, Sheet delivery or worker
dispatch changes because of this decision.

**Hosted Vercel deployment (2026-10-29):** the dashboard is deployed as a
public HTTPS site at `https://nd-automation-dashboard.vercel.app` (Vercel
project `jelly-bean2/nd-automation-dashboard`, root directory `apps/web`,
region `iad1`). Production environment carries only the public browser
configuration — `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_EXPECTED_PROJECT_REF` and
`APP_URL`; the publishable key is the only Supabase key deployed and
`publicConfig()` still refuses `sb_secret_*`, so no service-role credential is
present in the deployment. Sheet-sync connector secrets were deliberately not
added, so the hosted master-Sheet preview reports "not configured" until an
explicit decision is made; the local desktop and Fudge flows are unchanged.
Vercel Authentication (deployment protection) was enabled by default and was
turned off for this project so the owner and staff can sign in; the app's own
Supabase auth plus RLS remains the only access control. The first hosted build
failed on `scripts/bundle-sheet-connector.mjs` because it resolved the Apps
Script source three directories above `apps/web`, which escapes the Vercel
build root; the script now falls back to the committed generated connector
artifact when the monorepo source is outside the build root and still fails
loudly when neither exists. Re-validated after the fix: typecheck PASS, lint
PASS, 646 tests / 43 files PASS, production build PASS. Hosted email
verification and password reset remain non-functional until the Supabase Auth
Site URL / redirect allowlist includes this domain and a sender is chosen;
`npm run dev` on `127.0.0.1:3000` remains the pristine local acceptance
target.

**Sheet writeback queue UI (2026-10-29):** new `/dashboard/settings/sheet-writeback`
page (staff + verified email only, fails closed to an explicit notice when the
bounded queue read cannot be verified). It shows the newest 25 intents of the
exact total per business with per-status counts, attempts, lease expiry, last
error and creation time (UTC), and states plainly that delivery is not active:
no connector, worker or Edge Function writes any Sheet through this queue.
Queueing one intent is explicit: bounded action/tab/row-reference/rows form,
client-stable per-form request ID and stable key, explicit confirmation
(append must not pin a row; update_cells requires an exact row reference),
15-second abort, strict receipt verification (pending only) and
unconfirmed-timeout wording that never auto-retries with new IDs. Cancelling is
pending-only, confirmed, receipt-checked and honest about state changes. Both
actions bind to the server-authorized business; forged organization fields are
ignored. Typecheck caught a Zod issue-access bug the runtime tests had not
reached (`issues` vs `error.issues`) before anything was committed. Full
validation: typecheck PASS, lint PASS, 646 tests / 43 files PASS (18 new
action tests reject forged/invalid/replay paths and 5 new page tests verify
fail-closed, empty, pending-only-cancel and inactive-delivery rendering),
production build PASS with the new route. All writeback/catalog row counts
remain zero; no migration was needed for this slice. Real signed-in queueing
against the hosted backend and any Sheet delivery remain pending; both Fudge
release gates remain false.

**Durable Sheet writeback outbox protocol (2026-10-29):** F33/N08 database
slice. Bounded append/update_cells intents enqueue per organization with
per-business ordering, replay-safe request and stable keys (idempotent
re-enqueue, changed payload refused), lease-based bounded claim batches with
persisted claim-replay results, lease-stamped acks (delivered/conflict/
failed/retry) that stay idempotent on lost ack responses and never rewrite
terminal history, retry exhaustion at 5 attempts, lease-expiry reclaim and
pending-only cancel. Staff can read all three tables (RLS); anon is denied
reads and every RPC. Two PL/pgSQL parameter/column name collisions
(`stable_key`, `values`) found by the first local run were fixed
(`p_stable_key`, `rows_`) before deployment. No Sheet is written: no
connector/worker/Edge Function dispatches through these tables, and both
Fudge release gates remain false. `apps/web/src/lib/sheet-writeback-contract.ts`
mirrors the server validator for the future UI/deliverer slice.

Authorized hosted deployment: source `20261029175611_sheet_writeback_v1.sql`
applied as hosted `20261029180253`; the post-deployment advisor's one
unindexed-FK finding (`created_by`) was fixed additively by source
`20261029180506_sheet_writeback_fk_indexes.sql`, hosted `20261029180528`.
Twelve hosted migrations; writeback outbox/claims/acks and catalog
revisions/heads/activations all remain zero; no public table without RLS;
anon denied, authenticated-only EXECUTE confirmed on all four public RPCs.
Hosted rollback-only smoke passed enqueue/replay/stable-key/invalid-intent/
cross-business/claim/wrong-lease/ack idempotency/terminal immutability/
conflict/retry-exhaustion/cancel/direct-mutation/nonmember/anon denial.
Lease-expiry timing covered locally (hosted time not shiftable). See
`DB-DEPLOYMENT-20261029-WRITEBACK.md` for full evidence and remediation
links. Full dashboard validation: typecheck PASS, lint PASS, 623 tests /
41 files PASS (9 new PGlite writeback protocol cases), production build
PASS. Real Sheet delivery, dashboard writeback UI, a deliverer worker and
the separately approved rule-application path remain pending. Prior dated
entries below are historical, not current status.

**Exact revision review and owner/admin activation (2026-10-29):** new
`/dashboard/settings/services/[id]` review page. Saved revisions (latest 20
receipts) link from the staging page to a per-revision review that loads three
independent bounded reads — revision, business head and published snapshot RPC —
and fails closed to an explicit "review unavailable" notice when any read or parse
fails or the reads disagree; no activation is requested. The review shows per-rule
added/removed/changed/unchanged counts against currently published rules plus full
before/after JSON; rules pair under collector-key normalization without inferring
equivalence (raw keyword-text and signal-order changes list their exact fields).
Operators get review-only mode; verified owners/admins can confirm publication with
the revision ID and base generation embedded server-side, a stable per-form replay
ID and a 15-second abort. Endpoint work is a server action gated on verified
owner/admin membership; feature rollout is not client-supplied. Timeout/lost
responses are unconfirmed, never automatically retried with new IDs. Researched
react-hooks lint finding (JSX inside try/catch) fixed by structure, not suppression.

No production catalog or rules saved/activated; activation changes business
configuration only — no collection, Fudge/Sheet application or third-party
content approval. Full validation: typecheck PASS, lint PASS, 614 tests /
40 files PASS (18 new: 7 activation-action, 3 diff, 5 review-page UI, 1 staging
links, 2 expectation corrections after first run), production build PASS with the
new route. Real signed-in save/review/activation, concurrency, restore and
ownership acceptance remain pending; both Fudge release gates remain false.
Prior dated entries below are historical, not current status.

**Authorized hosted catalog deployment and inactive staging (2026-10-29):** shared
target/history/schema/advisors rechecked. Promoted local draft via CLI-generated
source `20261029165237_service_catalog_v1.sql`; applied as hosted `20261029165416`.
Post-deployment advisor's two FK-index findings fixed additively by source
`20261029165727_service_catalog_fk_indexes.sql`, hosted `20261029165815`. No prior
migration or worker/publisher function changed. Nine hosted migrations, 22 public
RLS tables, zero public tables without RLS. Grants and all eight function-body hashes
match the reviewed source. Hosted rollback-only smoke passed save/replay/stale
versions/activation/rollback/original/RLS/nonmember/anon/direct-update denial;
all fixture rows rolled back and catalog revisions/heads/activations remain zero.
Security advisor counts unchanged; unused-index INFO 23→27; unindexed FK findings
cleared. See `DB-DEPLOYMENT-20261029-CATALOG.md` and its remediation links.

Dashboard now offers explicit inactive revision staging only after local contract
validation and confirmation. Uses server-derived business/Auth context, a stable
per-form request ID, expected version and a 15-second request abort. Failed/timeout
writes are unconfirmed, never automatically retried with new IDs; receipt mismatch
requires reconciliation. Bounded latest-20 metadata shows saved IDs. Input changes
and clearing are disabled during the save; successful save removes the submit form.
No actual business catalog saved or activated; no live account, Sheet, media,
collection or publication changed. Activation/diff UI and Fudge rule application
remain pending; both extension release gates are false. No Edge Function needed
or deployed; existing guarded RPCs cover this contract.
Targeted promoted-source database/contract tests: 20 PASS, index-loaded database
tests: 17 PASS. Final full dashboard validation: typecheck PASS, lint PASS,
596 tests / 38 files PASS, production build PASS. Real
signed-in save/REST/concurrency/restore/UI acceptance remains pending. Prior dated
draft-only entries below are historical, not current deployment status.

**Versioned catalog local protocol (2026-10-29):** inspected the selected shared
backend tables read-only; no existing catalog tables. Added local-only
`supabase/drafts/service_catalog_v1.sql`, not a deployed migration. Immutable rule
revisions, expected-version heads, replay IDs, owner/admin activation history and
read snapshot RPC are tested. Operator can stage, not publish; anon/customer/
unverified/cross-business access and direct mutations denied. Explicit rollback
advances activation generation rather than overwriting history. Public wrappers
are invoker, privileged implementations private/fixed-search-path with fresh access
checks and per-business locking. No worker/publishing function altered.
Added strict TypeScript request/snapshot contract and preview conversion. Validation:
typecheck PASS, lint PASS, 586 tests / 37 files PASS, production build PASS; 17 new
local PGlite cases and 3 contract cases. Not real concurrent PostgreSQL/REST/Auth
acceptance. No migration or private catalog applied, no dashboard write controls yet.
One-off offline parity check: dashboard/Fudge snapshot validators agree on seven
valid/invalid fixtures; no network or private source catalog used.
Fudge separately implements a gated last-good preview cache with download OFF and
no application to Sheet/local rules; 67 backend and 127 smoke tests PASS there.
Configuration ownership, freshness/retention, live acceptance and controlled cutover
remain gates. See `SERVICE-CONFIGURATION.md` and Fudge `SERVICE-CATALOG-CACHE.md`.

**Bounded-read/render hardening (2026-10-29):** intake metadata requests share a
15-second application deadline and AbortSignal. A stalled/failed read remains
unavailable, never zero; the deadline timer is cleared on completion. The deadline
also bounds the page wait if a transport ignores cancellation; it does not prove
database-side cancellation. Catalog rules, errors, warnings and unmatched keywords
are paginated at 25 items per section, with explicit totals and local preview clear.
Source file size and rule limits remain. Validation: typecheck PASS, lint PASS,
566 tests / 35 files PASS, production build PASS, including fake-timer hung-read
and timer-cleanup cases plus 500-rule paging bounds. Actual file-selection/paging
interaction and simultaneous real-browser workload acceptance remain pending.
Fudge's owning repo separately reduces redundant queue reads, preserves retired
epoch sweeping and tests overlapping drains/1,000 queued intents: 55 backend and
127 smoke tests PASS. No guarantee of zero busy states or production load capacity
is made; exact database counts and full local queue enumeration still need capacity
measurement. Rule storage/activation/cache remain unimplemented; uploads stay off.

**P3 service-catalog preview (2026-10-29):** new verified-staff-only
`/dashboard/settings/services`, linked from Settings. File analysis is browser-local
and ephemeral; no network upload, storage, import or activation operation exists.
Validates bounded JSON service rows, explicit flags/classification, collector-key
collisions and list delimiters; warns on uncertain matching and historical status.
Notes/collection counts are not echoed in the preview model. The user's private
snapshot was processed locally: 21 rules structurally valid, 23 warnings, 27 listed
exact keyword mappings unresolved. This is not semantic matching acceptance. No
business data or private workbook/report is included in Git. See
`SERVICE-CONFIGURATION.md` for implemented boundaries and storage/activation contract.
Initial typecheck caught dynamic-schema inference and a table-driven test shape;
both corrected. Final validation: typecheck PASS, lint PASS, 563 tests / 35 files
PASS, production build PASS. Live signed-in file selection/visual acceptance remains
pending. No new database
schema, backend write, Fudge rule replacement, Sheet write or upload release.

**P3 read-only intake visibility (2026-10-29):** added staff/verified-email-gated
`/dashboard/fudge`, linked from Settings. Uses the authenticated user's client,
explicit business filters and existing RLS; reads exact HEAD counts and at most 51
metadata-only revision rows, showing at most 50 with a truncation notice. Validates
response schemas, business IDs, unique receipt IDs and counts; malformed/failed reads
remain unavailable, never zero. No raw content, author IDs or remote media is loaded.
Separate query times are not an atomic reconciliation snapshot; the UI explicitly
cannot see local pending queues or prove full delivery. Fudge now displays up to 20
saved target-specific acknowledgment IDs for manual comparison. This is a visibility
slice, not automated reconciliation, review/approval or keyword configuration.
No schema change, hosted write, Sheet write or browser operation performed.
Validation: initial lint found unescaped JSX apostrophes; wording corrected. Full
dashboard rerun: typecheck PASS, lint PASS, 548 tests / 33 files PASS, production
build PASS. Live signed-in page/receipt comparison acceptance remains pending.
Fudge validation in its repo: 51 backend tests and 127 smoke tests PASS.

**Shared-account branded verification email preparation (2026-10-29):** updated
the canonical email generator and regenerated all six self-contained templates
with Fudge + ND branding. Verification explains shared credentials, separate
extension sign-in and no automatic collection/upload/publishing. Password reset
explains that both apps share the changed password. Existing scanner-resistant
token-hash confirmation flow is preserved. Setup guidance now names exact callback
allowlist entries and distinguishes hosted Auth settings from SQL migrations.
No hosted template/Site URL/SMTP update or verification email was sent: the connected
database MCP exposes no Auth-configuration write tool, and a public dashboard
origin/verified sender are not established for this change. Local preparation is
not live delivery acceptance. Validation after generation: typecheck PASS, lint
PASS, **524 tests / 31 files PASS**, production build PASS. Next development target
remains backend-managed service configuration and intake reconciliation, with intake
release off pending the existing acceptance/policy/pilot gates.

**Simplified shared email account UI (2026-10-29):** Signup explains that Fudge and
the dashboard share the same email/password. The dashboard first-account screen
replaces the workspace-name form with an explicit **Set up my private business
account** action using the existing guarded `reporting_create_workspace` RPC and
default `My business` name. Existing team users are directed to request access,
not create duplicates. Organization isolation, existing memberships and RLS remain;
no migration, live account creation, credential transfer or upload release occurred.
Fudge now bundles only the matching public identity from this repo's ignored
environment file and offers signup plus auto-selection of a single authorized
business; multiple-business access remains advanced. Sessions are separate.
Read-only hosted Auth settings confirm email signup enabled and confirmation
required. Real email delivery/confirmation URLs and browser acceptance remain
pending. Typecheck and lint PASS (rerun after the test change). The first combined
command timed out during tests; the subsequent run passed the 521 existing tests
but the new UI suite failed to import because it lacked a server-only Sheet-module
mock. Added that mock; the corrected full rerun passed **523 tests / 31 files**
and the production build PASS. Two new fixture UI tests added. These results do
not establish live email/browser acceptance.

**Authorized shared-database intake deployment (2026-10-28):** MCP target reverified
as `xtefjnfdjnxwrpkoydaj`. Reviewed the six existing migrations, tables, grants and
advisors. Promoted the intake draft to CLI-generated source
`supabase/migrations/20261028203213_fudge_ingestion_v1.sql`; tests load that source.
Applied through MCP as hosted **`20261028203642 fudge_ingestion_v1`**. All six
existing migrations and existing data were preserved. The new two tables have
RLS and staff SELECT only, with writes through the guarded authenticated RPC;
public wrapper is SECURITY INVOKER. No service-role key or new extension needed.

Validation: typecheck PASS; lint PASS; **521 tests / 30 files PASS**; production
build PASS. Hosted metadata verifies seven migrations and 19 public RLS tables,
direct-write/anon denial and exact source matches for all three new function
bodies. The saved `supabase/tests/fudge_ingestion_hosted_smoke.sql` passed receipt
replay, changed revision, original preservation, atomic rollback, cross-workspace,
nonmember/anon and direct-write denials. All fixtures rolled back; final raw record
and revision counts are zero. This is SQL-level claim/role testing, not real Auth,
REST/browser or concurrent-connection acceptance. Post-deployment security advisor
findings unchanged; unused-index INFOs 21 -> 23. See `DB-DEPLOYMENT-20261028.md`.

MCP config now enables project-scoped database/Edge Function tools with write/deploy
approval prompts retained; both workspace configs match. No Edge Function was
needed for the existing authenticated RPC contract. The publishing migration
remains undeployed pending its documented submit-adapter review; no live worker
claim behavior was replaced. Fudge upload release remains false. No real source
upload, Sheet write, publication/profile operation, user/membership change, reset,
backup/restore claim, paid resource, commit or push. P2–P8 remain incomplete where
acceptance/implementation is missing; earlier draft-only status below is history.
Final checks: master-plan copies and workspace MCP blocks match; intake source
hashes match hosted bodies; Fudge release remains false; `git diff --check` PASS
(existing Windows line-ending warning only). Supabase CLI local cache/branch
directories are ignored; no secret/export was staged.

**P2 Fudge extension slice implemented in the Fudge repository (2026-10-28):**
session moved there with user authorization. Added optional existing-account Auth,
verified staff-workspace discovery, trusted session-only tokens, per-capture
durable intents paired with collection saves, bounded retry/receipt processing,
MV3 startup/alarms, pause/history consent and cancellation epochs that prevent
late retired captures from resuming. The selected project is pinned by optional
host permission; only the exact internal setup page can invoke privileged controls.
New side-panel entry opens the setup/status page. Existing Sheets/collector keys
and the legacy importScripts call are preserved. Clear dialogs disclose separate
queue/backend deletion semantics. Fudge `docs/BACKEND-UPLOADER.md` and its own
implementation-status record document details and unresolved gates.

Validation in Fudge: **33 backend tests PASS; 127 existing smoke tests PASS**;
six changed/new JS modules syntax-checked; manifest and master-plan parity checked.
Offline extension/dashboard projections agree on seven fixtures. No dashboard
application source changed in this slice, so its historical 521-test/build result
was not rerun or promoted to a new result. Production Fudge `UPLOAD_RELEASED`
remains false; real Chrome/Edge/Auth/worker-eviction and hosted intake acceptance
remain pending. No real sign-in, source upload, historical migration, hosted DDL,
Sheet write/import, customer browser/profile action, commit or push occurred.
Receipt/storage retention and backend deletion remain review gates. **P2 remains
in progress; no deployment/pilot or release enablement is implied.**

**P2 local Fudge ingestion foundation implemented (2026-10-28):** added
`supabase/drafts/fudge_ingestion_v1.sql` (not a deployment migration), typed
collector projection/request/receipt validation in `lib/fudge-ingestion.ts`,
and `docs/FUDGE-INGESTION-V1.md`. Workspace-scoped identities, client-append-only
source revisions, SHA-256 content deduplication, original preservation, complete
ordered receipts, bounded batches, first-observation provenance and atomic
rollback are tested. Verified staff-only ingestion uses a public SECURITY INVOKER
wrapper/private guarded implementation, RLS and explicit read-only client table
grants. Raw data is not assigned to customers, approved or published at intake.
No service-role key or new Postgres extension is used. CLI discovery confirmed
Supabase CLI unavailable; draft promotion/deployment is deliberately pending.

Validation: typecheck PASS; lint PASS; **521 tests / 30 files PASS**, including
55 local intake tests covering tenant/customer/unverified/anon denial, membership
revocation, direct-write rejection, atomic failures, JSON key/numeric equivalence,
changed/old revisions, checksum-conflict refusal, byte/count limits, original-only
projection and malformed/partial/reordered receipts. Initial local DDL test caught
a non-immutable generated checksum expression; corrected to a hash computed solely
by the restricted RPC without mislabeling STABLE functions as immutable. Final
production build PASS; diff whitespace check PASS with existing line-ending
warning; master-plan copies are identical. Single-runtime PGlite is not real
multi-connection contention/advisor or hosted browser/Auth acceptance.

Existing applied migration files and Fudge extension behavior are unchanged.
The older per-user foundation is preserved and documented as unsuitable for direct
shared-backend deployment. No hosted DDL, source upload, historical import, Sheet
write, new user/membership, browser job, commit or push occurred. Only this project's
verified preview was restarted after build. Next: review the intake contract,
prepare an approved real migration/local staging workflow, then implement opt-in
extension Auth/workspace selection and durable MV3 uploader with generation-aware
acknowledgment. **P2 remains incomplete and live ingestion stays disabled.**

**Internal staff frontend Sheet-setup wizard implemented (2026-10-28):** new
`/dashboard/settings/sheet-setup` staff-gated route, linked from Settings and the
unconfigured Master Sheet page. Six numbered steps provide generic Apps Script
code copy, Sheet URL/ID extraction, Web Crypto private token generation, explicit
replacement warning for configured organizations, hidden-by-default secret copy,
workspace-filled environment block, deployment/authorization instructions and
troubleshooting. Inputs are not persisted to browser storage or used as arbitrary
server request destinations. Existing server tokens are never sent to the page.
Admin environment save/restart remains explicit; no automatic credential-store or
Vercel configuration feature is claimed. New staff reuse the org connection.

Validation for this wizard: typecheck PASS; lint PASS; **466 tests / 29 files
PASS** (27 new helper, source-parity, action and fixture-UI cases); production
build PASS with the new setup route. `git diff --check` PASS with existing Windows
line-ending warning. Restarted only this project's verified preview process;
`/login` returns 200 and signed-out wizard access redirects 307 to login. Actual
signed-in clipboard clicks, token generation and saved-connection test-button
acceptance remain for the user; rendered fixture tests are not a live browser
walkthrough. No commit/push, hosted migration or Sheet write was performed.

The staff-only test action reads saved server configuration through the existing
workspace-scoped transport and returns safe counts/errors only; it does not import
rows, write Sheets or start browser jobs. Canonical connector source is bundled at
development/build time for deployment portability; a parity test guards stale
copies. Vercel monorepo build source must include the outside-root canonical file.
No Google script update, Supabase migration or privileged secret was introduced.

**Optional missing proxy-tab UX corrected (2026-10-28):** user screenshots confirm
the Bulk cookies import safe preview renders; its historical Imported N cookies
text is not evidence of a dashboard-run import. The separate absent Bulk proxies
import tab now displays an informational optional-tab notice and a link to cookie
metadata, rather than the generic red header/configuration error. Transport keeps
sheet-not-found distinct from malformed-header failures. Only this exact optional
tab/missing response is softened; required tabs, authorization, network and bad
responses retain errors. No tabs are created/renamed and no credentials read.

Validation: typecheck PASS; lint PASS; **439 tests / 26 files PASS**, including
8 fixture-rendered Master Sheet cases and 1 new transport case; production build
PASS; `git diff --check` PASS with existing line-ending warning. Stopped only the
verified project preview process for rebuild and restarted it. Authenticated
visual acceptance of the new notice remains pending; no customer browser session,
Sheet/Supabase writes, live imports or worker operations were used for this fix.

**User-confirmed signed-in Sheet preview (2026-10-28):** supplied screenshots
show Auto Posting safe metadata rendering with a fetched timestamp. This accepts
that preview path only, not imports, live visibility or all-tab UI acceptance.
The Bulk proxies import screenshot shows the expected missing-tab error: the
verified seven-tab workbook has no separate proxy-import tab; its similarly named
Bulk proxy import tab contains Cookies and is mapped through Bulk cookies import.
No tab rename/creation or alias to credential data was performed. The screenshot
still shows a session older than ten hours; it must not be treated as dispatch
authorization. Local ignored inventory records Auto Posting preview evidence.
No application code, Sheet data or Supabase rows changed; no app tests rerun.

**Authenticated development connector verified (2026-10-28):** user saved the
private token locally. Offline readiness now passes all local configuration checks
(exit 0; hosted gates remain separately unverified by that command). Actual
token-authenticated `getTaskRows` requests returned strict safe metadata responses
for all seven known tabs, including the cookie alias; no response rows, tokens or
private settings were printed/saved to public files. Responses were not truncated
at the connector limit. Metadata presence does not validate a row as executable.
Only the verified project-specific preview process was stopped, then restarted
with the saved environment. `/login` returns 200 and signed-out
`/dashboard/master-sheet` redirects 307 to login. User's signed-in Sheet preview
acceptance is pending; no user browser session was accessed. Local ignored setup
inventory records connector configured/read verified; execution/write flags remain
disabled. No Sheet writes, Supabase row imports, worker jobs or browser actions
were run. No application code changed; application suites were not rerun.

**Development connector partial setup (2026-10-28):** user deployed the separate
connector and supplied its URL. Saved it only in ignored `apps/web/.env.local`,
along with the screenshot workspace UUID after read-only verification that it
has a verified owner in the selected project. Token remains blank pending private
user entry of the same Script property value. Actual POST with an intentionally
wrong token returned HTTP 200 and `{ok:false,error:unauthorized}`, with no rows.
Offline preflight now passes target/client/app-origin/Sheet-endpoint/workspace
shape; only token setup is locally blocked. Valid-token Sheet reads, dashboard
preview and row imports remain unverified; server was not restarted yet. No
Sheet write/import or application code change occurred; app suites not rerun.

**Complete development Sheet connection guide saved (2026-10-28):** added
`integrations/sheets/DEVELOPMENT-CONNECTION-GUIDE.md` with standalone connector
creation, private properties/token, owner deployment, local environment/restart,
unauthorized rejection and safe-preview checks, alias/missing-tab handling, later
explicit mappings/import and rollback. The guide distinguishes read-only preview
from Supabase import writes and unimplemented one-click refresh/writeback. No
Google deployment, permission change, secret generation, local environment change,
Sheet import/write or worker execution was performed. Documentation only;
application suites were not rerun for this guide.

**Seven-tab development schema verified and saved (2026-10-28):** named-tab
A1:L1 requests confirm headers for all seven screenshot-listed ND Master tabs.
Saved safe mappings in `docs/ND-MASTER-SCHEMA.md` and updated the ignored local
dev-copy inventory. The screenshot exposes a posting-style second header/data
region under Incog Profile Creation; executable interpretation must remain
quarantined. Bulk proxy import is actually the Cookies tab; no separate proxy
task tab was inferred. No data-row requests, Sheet/script/permission changes,
Supabase imports or browser actions occurred. Connector setup and row-level
validation remain pending. Documentation/local metadata only; no application
tests run for this change.

**ND Master development copy supplied (2026-10-28):** user designated a copied
Google Sheet for development rather than the production master. Read-only access
to the selected tab's A1:L1 headers confirms the Auto Posting-compatible layout;
no data rows/credential values were fetched, no tabs were edited and no records
were imported. Local Sheet ID/setup metadata is in ignored
`integrations/sheets/config.development-sheet.json` (inactive, writes disabled).
Other tab mappings, connector deployment and separate Source Sheet remain pending.
Headers were readable without Google sign-in; owner review of sharing/sanitized
dev credentials is advised. No application code changed or application suites ran
for this metadata/documentation update.

**User-provided signed-in UI evidence (2026-10-28):** screenshots show local Home
and Settings / More rendering an Owner workspace after login. This supports basic
login/workspace-render acceptance only; no agent-controlled authenticated walkthrough,
tenant-isolation or execution acceptance is claimed. Home reports an unconfigured
Sheet, waiting worker, zero saved profile mappings and no recent monitoring work.
Its displayed work session exceeds ten hours; end it and start a fresh authorized
session before later monitoring. Do not treat the Working label as dispatch
eligibility. Sheet setup, exact profile binding and worker pilot remain pending.

**Selected shared backend verified (2026-10-28; supersedes earlier target-change
entries below):** the user chose `xtefjnfdjnxwrpkoydaj` for both Fudge and ND
dashboard. Both saved MCP configurations are read-only and runtime project URL
verification matches. Read-only inspection confirms six existing migrations,
17 RLS-enabled public tables, matching body checksums for all 29 existing source
functions, intended table/column grants and private credential-table restrictions.
This is a targeted metadata comparison, not a full schema/permission or live Auth
acceptance certification. Existing workspace/customer/worker state was preserved.
The existing local URL and enabled modern publishable key were verified against
the selected project's key; only the stale ignored local deployment pin changed.
No key, user, membership, worker or hosted database setting was changed.

Added `docs/P1-HOSTED-REVIEW.md` and metadata-only historical baseline fixture/tests
to prevent silent edits to applied source function bodies. The publishing protocol
is still absent from hosted history and deliberately undeployed; Fudge ingestion
still needs a workspace/revision contract and reviewed additive implementation.
Security advisors report 3 anon and 21 authenticated SECURITY DEFINER notices,
disabled leaked-password protection and 1 private no-policy INFO; performance
reports 21 unused-index INFOs. These findings are recorded for review, not silently
dismissed or auto-remediated. No indexes were removed or privileges broadened.

Current validation: typecheck PASS; lint PASS; **430 tests / 25 files PASS**,
including 3 new historical-baseline tests; `git diff --check` PASS with existing
Windows line-ending warning. Both master plans are identical and saved MCP scopes
match the selected project. Production build **PASS** after its background
completion notification. Offline readiness now passes pin/client/app-origin;
Sheet endpoint/token/workspace remain blocked (exit 1). Hosted metadata inspection
does not make that offline command a live verifier. Real signed-in access/isolation,
backup/restore, mappings, pairing and live acceptance remain outstanding. No hosted
migration/reset, live Sheet/browser action, commit or push was performed.

**P0/P1 implementation started (2026-10-28):** switched work to this dashboard
repository with user confirmation. Added `docs/IMPLEMENTATION-TRACKER.md` with
individual F01–F36/N01–N08 acceptance entries and phase gates, plus
`docs/P0-DISCOVERY.md` for mapping/ownership decisions and hosted-readiness handoff.
Implemented the offline `npm.cmd run check:readiness` command, backed by a tested
pure report function. It loads local development settings without printing their
values, makes no network calls/writes, and never promotes local configuration
checks to hosted readiness. It checks the requested target pin and validated
client origin/config, canonical app origin and separate Sheet prerequisites.

Validation: typecheck PASS; lint PASS; **427 tests / 24 files PASS** (23 new
readiness tests); production build PASS; `git diff --check` PASS with the existing
Windows line-ending warning. Tracker check confirms every F01–F36/N01–N08 exactly
once. Actual offline preflight exits **1 (expected setup blockers)**: target pin
and app origin pass, client configuration and Sheet endpoint/token/workspace are
blocked. Hosted database/Auth/recovery/worker gates remain unverified. Supabase
tool discovery returned no available Supabase tools in this session. No hosted
inspection, migration, environment/credential change, account action, worker
pairing, live browser action, Sheet write, commit or push was performed. Existing
uncommitted changes were preserved. P0/P1 are **not complete**; source/master
mapping confirmation, verified target access and hosted checks remain necessary.

**One-click next-day cohort checks — planning update (2026-10-28):** both master
plan copies now specify publishing 100 posts today and checking that exact dated
cohort from the next business day with one **Refresh post statuses** action.
Requirements include authorized session/profile gating, durable deduplicated jobs,
progress, truthful outcomes, automatic result/Sheet check-field updates and explicit
refresh-policy tests. Distinct from latest-100-per-profile monitoring. Documentation
only; no button, planner change, browser check or Sheet writeback was implemented
or live-tested. No application suites were run for this documentation update.

**Shared master plan (2026-10-28):** added `docs/MASTER-AUTOMATION-PLAN.md`
in this repository and the user's Fudge repository, with identical architecture,
end-to-end task contracts, phased implementation/acceptance gates and minimal-human
daily operation. Covers ingestion/revisions, approval, safe Sheet writeback,
profile/onboarding operations, publishing recovery, per-profile previous-100
monitoring, comments and controlled reposting. Planning/documentation only: no
application code, database, worker, browser, Sheet or credential changes. No
application test suite was run for these documentation-only changes. Prior
uncommitted work was preserved; no commit/push or deployment was performed.

**New Supabase target requested (2026-10-28):**
`tyczcognqypqxrvkbmrk` replaces the old project as the user's requested target.
The new project's schema/data/Auth have **not** been inspected, copied or migrated.
Project and parent-workspace MCP configurations now point exclusively to the new
project in initial read-only mode without embedded credentials. Supabase tools
are unavailable in this active session; the CLI also reported no configured MCP
servers, so a saved configuration is not claimed to be a working connection.
The user must enable/authenticate the server through `/mcps` (and `/reload` if
needed). A personal access token posted in chat was not saved or used; revocation
was advised. The app now supports a deployment project pin; the ignored local
environment pins the new ref while retaining the old URL/key untouched until a
verified new pair is available. This intentionally disables access to the old
backend rather than silently continuing against it. The target guard validates
origins/key type and a legacy anon JWT's project hint, not opaque modern key
ownership. All earlier hosted migration/access results below refer to the **old**
project only. Safe setup order: `supabase/README.md`.

Remote plan check: `git fetch origin` succeeded; `origin/main` remains at
`e1389c4` and has no changes beyond local main. Only origin/main is listed as a
remote branch. No newer plan was found; the user was asked for its file/branch or
repository link. No new product scope was inferred from an unavailable plan.

**Sheet-first implementation (2026-10-27):** staff navigation now has Home,
Master Sheet, Run automation, Profiles and Results, with Settings / More holding
all advanced and manual fallback routes. Home no longer asks for routine manual
post/comment entry. The new master-tab preview reads safe metadata from the
existing Sheet; known-link sync reuses persistent exact customer/profile bindings.
Profiles provides a one-time name/group selector and saved mapping list. Run
automation enables/disables up to 100 mapped monitoring profiles with one explicit
batch confirmation and shows recent check progress. Results consolidates post
links, checks, comments and check problems with date/customer/search filters.
All prior routes remain accessible; no desktop/Fudge functionality was removed.
**This is not complete desktop execution parity:** only the monitoring agent is
connected in source; posting/listing/onboarding/cookie/proxy execution stays in
the desktop app. The new connector has not been deployed to a live Sheet and
requires workspace-scoped server configuration. No Sheet writeback or unattended
ingestion was added. See `SHEET-FIRST-WORKFLOW.md` for exact daily/setup steps.

User workflow correction / review (2026-10-27): the user reports that the current
reporting-first dashboard adds work compared with Fudge → cleanup → master Sheet
→ desktop/Incogniton. Reviewed screenshot, dashboard/desktop source, public Fudge
source over HTTPS, and rechecked the offline workbook aggregates. See
`SHEET-FIRST-UX-REVIEW.md` for concrete friction and the proposed sheet-first
experience. **Review only:** no app/database/live Sheet changes or tests run for
this review; no signed-in whole-dashboard browser walkthrough is claimed. A newly
created sibling Fudge clone was removed immediately following the user's
"only check, do not clone" correction; Fudge is not retained or integrated.

Latest implementation follow-up (2026-10-27): content preparation/approval and
profile inventory are implemented and staged (versions `20261027200411` and
`20261027200913`). A further publishing-job protocol is implemented/tested
**locally only** (`202610270006_publish_jobs.sql`) with an inspection page, but
no dashboard release action and no publishing agent. Full automation remains
incomplete. `PUBLISHING-PROTOCOL.md` is authoritative for this newer slice;
earlier statements below about "no publishing RPC" describe earlier milestones.

For the latest monitoring implementation, see `WORKER-BRIDGE.md`. `AUTOMATION-READINESS-AUDIT.md` records the earlier audit snapshot. Full desktop automation is not complete. Earlier test rows are historical records, not live connection or feature-parity guarantees.

Reporting foundation plus an initial read-only dashboard-to-worker bridge implemented in source, with staging database setup applied on 2026-10-27. The original desktop code is unchanged; its posting, onboarding, cookie/proxy and other write workflows remain unconnected. One pilot worker is paired and live acceptance now covers read-only post checks and comment collection; no publish, onboarding or Sheet-write flow has run live. Explicitly authorized monitoring claims are gated by work sessions; session buttons alone never enable publishing or account creation. The historical full automation plan is not delivered scope.

The user has requested full desktop-to-dashboard parity and authorized updating `AGENTS.md` for a phased migration. `DASHBOARD-PARITY-ROADMAP.md` records the direction and feature-family gaps. `apps/worker/agent.py` now implements the outbound monitoring protocol, reusing the opt-in pilot runner. It needs the new reviewed migration, private pairing, a compatible Python/Playwright environment and validated selectors. No live automation pilot, recurring Sheet ingestion or Sheet result writeback is implemented/validated by this change.

## Completed implementation — local foundation

`Implemented` means code exists. `Locally tested` names checks actually run. It does not mean deployed or validated against a hosted Supabase project.

| Area | State | Actual scope |
|---|---|---|
| Monitoring worker bridge | IMPLEMENTED / PAIRED / LIVE-TESTED ON THE PILOT (READ-ONLY) | Staff-only Automation control, private hashed worker credentials, explicit profile/customer/account binding, session-authorized due-check planning, leases/deduplication, atomic auto-check/comment/notification submission, cancellation, revocation and reviewed expired-lease/replacement-worker flows. Hosted versions: `20261027185858` (bridge), `20261027190052` (six covering indexes and schema comments), plus `20261030220000` (transient-failure retry), `20261030230000` (comment author/total/completion) and `20261030233000` (notification wording per outcome). Paired worker `Kashif PC` completed real read-only checks on the pilot binding; comment collection is validated at 22 of 22 on a real post. Agent never accepts publishing, onboarding or arbitrary executable jobs. See `WORKER-BRIDGE.md` for exact limits and deferred acceptance. |
| Content drafts and human approval (F14/F23 preparation slice) | IMPLEMENTED / LOCALLY TESTED / STAGING APPLIED | Staff-only `/dashboard/content`: create/edit text-post and listing drafts bound to an explicit authorized worker/customer/profile assignment; unpublished preview; revision-bound save/approve/return/archive with optimistic concurrency; immutable per-revision content + exact-target snapshots (binding, customer, worker, profile UUID, account label) and actor attribution. Validation in both UI (zod) and SQL (`valid_draft_content`); exact decimal USD price parsing without floats; no credentials/media fields accepted. Migration `202610270004_content_drafts.sql` applied to staging as `20261027200411`; host verification confirmed RLS on both tables, anon access denied (permission errors in rolled-back transactions), authenticated read-only table access with all writes through the two RPCs, and 0 drafts/revisions. **No publishing RPC, worker job type, scheduling, attachments, or browser submission exists.** Approval is preparation only. |
| Profile inventory (F03 foundation) | IMPLEMENTED / LOCALLY TESTED / STAGING APPLIED | Staff-only `/dashboard/profiles`: preview-validated CSV import (max 5,000 rows / 1 MB; legacy `id`/`Profile Name` aliases; credential columns rejected) into a tenant-scoped UUID/name/group inventory; explicit full-sync archiving (double confirmation), per-profile archive/reactivate, accurate insert/update/archive counts, payload-duplicate rejection, import serialization per workspace. Automation assignment form offers inventory claims as `<datalist>` suggestions while still requiring the exact UUID. Validation parity zod ↔ SQL (`valid_profile_row`); writes via two RPCs only. Migration `202610270005_profile_inventory.sql` staged as `20261027200913`; host verified RLS, anon denied, read-only client access, 0 rows. Inventory is a claim, **not** live existence/readiness and never authorizes launches; duplicate real-world profile names still resolve by exact UUID. |
| Next.js/TypeScript application and lockfile | IMPLEMENTED / LOCALLY TESTED | Production build, strict types, lint and local tests; no fake customer dataset |
| User-facing authentication | IMPLEMENTED; hosted validation BLOCKED | Sign-up/sign-in/reset actions, email callback, safe redirects, validated server user, empty workspace creation |
| Refined authentication UI | IMPLEMENTED / BROWSER SMOKE TESTED | ND branding, responsive split layout, password toggle, password-manager support, pending/error states, keyboard focus and reduced motion; desktop/mobile screenshots reviewed |
| UI/UX refresh and night mode | IMPLEMENTED / BUILD + STYLE CHECKED; authenticated browser acceptance PENDING | Design-token CSS with light/dark themes (System/Light/Dark toggle on dashboard and sign-in, saved in `localStorage`, applied before first paint); larger readable type scale; grouped sidebar, breadcrumbs, mobile drawer navigation, skip link; stacked-card tables on phones; stat-card icons, status badges with dots; onboarding screen with step list; setup checklist computed from real records only; search and observation/customer filters on All posts, Today and Yesterday (`lib/filters.ts`, untrusted URL values ignored); loading skeleton; print styles; reduced-motion support. No data, schema or server-action behaviour changed. |
| Read-only Google Sheet sync | IMPLEMENTED / LOCALLY TESTED; live connection NOT YET CONFIGURED | Standalone Apps Script `integrations/sheets/reporting-sync.gs` (separate from the desktop tool's script, which is unchanged) returns only Profile Name, Post link, Status and a one-line title for the *Auto Posting* / *Auto Listing* tabs, POST-only with a secret token. Dashboard page **Sheet sync** (staff only) shows every sheet status class, rows needing attention, a cross-check against dashboard observations, and imports new posted links through the existing reviewed import (`sheet_import`, stays *not checked*, publication date unknown). Dashboard config is server-only `SHEET_SYNC_URL` / `SHEET_SYNC_TOKEN`; the response is validated strictly and any extra field (e.g. a Password column) rejects the whole response. Setup: `integrations/sheets/README.md`. No sheet writes, no posting, no schema change. |
| Sheet health report | IMPLEMENTED / LOCALLY TESTED; not run against the real sheet | Part of **Sheet sync** (`lib/sheet-health.ts`). Ranks sheet problems High/Medium/Low with a plain reason, fix and exact sheet row numbers: link filled but Status empty (desktop tool may re-post), posted with no/unusable link, duplicate links, failed rows, rows stuck on `CLAIMED`, failed-with-link, missing Profile Name, unrecognised/non-standard status wording. Reports "N of M rows need action". CSV handover download is generated in the browser, with spreadsheet-formula escaping. Read-only; no sheet or database writes. Tested against a fixture shaped like the real snapshot (93 rows → 14 needing action, 79 clean). |
| Auth fixes and branded emails | IMPLEMENTED / LOCALLY TESTED; live Supabase email delivery NOT TESTED | Sign-up now gives the same neutral answer whether or not the email already has an account (Supabase hides that on purpose; an explicit answer would let strangers probe which emails are registered) and tells people to sign in or reset if nothing arrives. Unverified sign-in offers "Send a new verification email". Wrong-password and unknown-account share one message; rate limits and weak passwords have specific messages. Email links open `/auth/confirm` (one click, token-hash flow): works on any device and survives mail scanners; the destination is derived from the link type, never from a URL parameter. Signed-in users are redirected away from sign-in/sign-up/forgot-password. Six HTML email templates (light/dark, no remote images) generated by `apps/web/scripts/build-email-templates.mjs` into `supabase/templates/`; applying them and custom SMTP are dashboard steps (see `supabase/templates/README.md`). |
| Post checks, outcome tags and notifications | IMPLEMENTED / LOCALLY TESTED on real Postgres; **migration APPLIED to staging 2026-10-27** (version `20261026210947`; 11 public tables, all with Row Level Security; signed-out requests to the new tables/functions answer 401/42501; the security advisor shows only the intentional `SECURITY DEFINER` notices plus "leaked password protection disabled"). The signed-in dashboard against the new tables has not been viewed. | Migration `202610270001_post_checks_and_notifications.sql`: outcomes Alive / Removed from Nextdoor / Not accessible / Proxy issue / Login needed / Verification needed / Network problem / Profile did not open / Needs review, each with a positive, negative or needs-attention message. A could-not-check outcome never changes a post's visibility; removal needs written evidence; batches (up to 100) are all-or-nothing. Dashboard: **Post checks** page (bulk queue, recent results), check form and history on each post, notification bell with toast and an optional soft Web Audio chime (preference saved per device), staggered page animations. Everything degrades to a "database update needed" notice until the migration is applied. Manual entry only: **no automatic checker exists** (design in `docs/AUTO-CHECK-WORKER-DESIGN.md`). |
| Sheet understands verification scenarios | IMPLEMENTED / LOCALLY TESTED | Status text `Alive`, `Post Deleted from ND` / `Post Delete from ND`, `Proxy Issue` is recognised (anchored at the start so automation errors like "Failed: Failed to update proxy" are not misread); Alive rows import like posted ones, deleted and proxy rows go to Needs attention and the health report. The workbook contained no separate "Status Update Scenarios" section, so only the three named scenarios are handled. |
| Infrastructure hidden from customer UI | IMPLEMENTED | `/` and legacy `/setup` open `/login`; no Supabase/schema/migration instructions in public pages or workspace settings |
| Reporting schema, constraints and RLS | IMPLEMENTED / LOCALLY TESTED | Separate `reporting_*` tables, no role self-escalation, cross-organization/customer protections, atomic operations |
| Customer and post ledger | IMPLEMENTED | Manual authorized canonical share links; unknown dates preserved; Today/Yesterday/All posts |
| Reviewed CSV import | IMPLEMENTED / LOCALLY TESTED | Strict preview, max 100 rows/512 KB, credential fields rejected, transactional confirm and duplicate handling |
| Manual observations and comments | IMPLEMENTED / LOCALLY TESTED at database layer | Exact-post association, append-only observation history, evidence notes, unknown vs zero, comment ID deduplication |
| Pacific/device time and sessions | IMPLEMENTED / LOCALLY TESTED | DST-aware UTC conversion, separate local clock, pause/resume/end, session records only—no browser execution |
| Reporting snapshots | IMPLEMENTED / LOCALLY TESTED for calculation | Day cohort vs comment creation/first observation, safe CSV export; partial loaded-data limits shown and incomplete exports disabled |
| OpenCode MCP | CONNECTED / VERIFIED | Context7 and isolated local-UI Playwright; `/nd-next`, `/nd-check`, `/nd-review` commands |
| Supabase project connection | CONNECTED / MIGRATION APPLIED | Project `xtefjnfdjnxwrpkoydaj`; publishable key configured locally. `reporting_foundation` applied to hosted staging on 2026-10-26 (version `20261026185223`); all 8 `reporting_*` tables present, migration history recorded. |
| GitHub remote | PUBLISHED 2026-10-27 / VERIFIED | `main` pushed to `https://github.com/boostera385-afk/nd-automation.git` as 15 logical commits (201 files). Before staging: a content scan for keys, tokens, Apps Script URLs, passwords, mailboxes and customer data found only deliberate fake test fixtures; two docs had a Windows username path, which was removed. GitHub and the local clone point at the same commit. Commits use the repo-local identity `boostera385-afk` with the GitHub no-reply address. Intermediate web commits share files and are not individually buildable; the final commit is the verified state. |
| Public-repository exclusions | IMPLEMENTED / VERIFIED | Local config, exports, credentials, screenshots, browser traces and historical live-writing scratch tests ignored |
| GitHub Actions CI | PASSING on GitHub (run #1, 2026-10-27) | Clean Linux install from the lockfile on Node 24, then typecheck, lint, tests, production build and `npm audit --omit=dev`: all steps succeeded on commit `233eeb8` |

## Validation log

First supervised live monitoring check (2026-10-30): **80 worker unit tests
PASS** (75 + 5 new for the optional stored title, job-field strictness and the
title hand-off to the page evaluator). Live DOM derivation against the pilot post
identified the target card by title with 100% word overlap; all other cards
scored 0 and no card carries a self-link, which is why the exact-post contract
now accepts a title match **only** on the canonical post address. Live
fail-closed checks: correct title `exact_post=true`; wrong title, empty title and
a different target URL all `false`. Applied additive migration
`20261030203000_check_claim_identity` (claim returns `title`/`account_label`;
same signature, same planning/leasing) and recorded it in
`supabase_migrations`. The foreground agent then completed one job
(`alive`) end to end and a second poll returned `idle` with no duplicate job. No
Sheet cell was written, nothing was published, and no comment, removal or
verification claim was made. Web gates were not re-run in this step because no
file under `apps/web` changed.

Live-test setup (2026-10-30): added the read-only connector gate
`scripts/check-sheet-live.ts` (`npm run check:sheet`) and ran it against the
configured live connector. `Auto Posting` returned **69 rows**, `Auto Listing`
**111 rows**, both `truncated: false`, and a deliberately wrong token was refused
as `unauthorized`. The gate prints counts/statuses only and never row content,
the endpoint or the token. Added `docs/LIVE-TEST-RUNBOOK-20261030.md` and
documented which adapter selectors are proven by the shipped desktop flows
(`[data-testid="post-body"]`, `[data-testid="signin_button"]`) versus which have
no implementation at all (comments, removal, verification, unavailable notices),
so nothing is invented. Re-ran the full web gates on the final tree: typecheck
PASS, lint PASS (**0 warnings**), **805 tests / 57 files** PASS, production build
PASS. Worker unit tests: **65 PASS** on both the system interpreter and the
prepared `apps/worker/.venv`. In that environment `pip check` reports no broken
requirements and `preflight.py` passes python, all four pinned dependencies and
the Playwright sync-API import; the connection/adapter checks stay blocked until
a real pairing exists. The Playwright wheel's SHA-256 was verified against PyPI
before install. No Sheet cell was written, no profile was opened, no worker was
paired, no session was started and no migration was applied in this tranche.

Project-handover guard (2026-10-28): 17 new configuration tests cover expected
host pinning, old-project rejection, management/secret/placeholder key rejection,
legacy anon JWT ref mismatch, unsafe origins and unpinned local development.
Typecheck PASS; lint PASS; **404 tests in 23 files PASS**; production build PASS.
No database call, migration, customer operation, new app key, Auth change, worker
pairing, commit or push was performed. The new project's API readiness and the
updated plan remain blocked on verified MCP access and a plan link. Python code
is unchanged and its previous unit/mock result was not rerun for this change.

Sheet-first implementation validation (2026-10-27): typecheck PASS, lint PASS
(zero warnings), full web/database suite **387 tests / 22 files PASS**, production
build PASS including `/dashboard/master-sheet`, `/dashboard/run` and
`/dashboard/results`. New tests cover five-item navigation/role visibility,
fixture-rendered Home and Run screens, exact/ambiguous mapping behavior, bounded
and partially failing batch operations, known-link deduplication/import provenance,
all eight metadata-only connector tabs and the legacy cookie alias, credential
column exclusion, unheaded side-data exclusion, strict response validation and
workspace isolation before connector fetch. One test initially compared a URL
object with a string; corrected the assertion. Typecheck also caught an obsolete
esbuild JSX setting for the installed oxc-based test transformer; removed it.
Final checks above passed without that configuration warning.

The server-side Sheet connection now requires `SHEET_SYNC_ORGANIZATION_ID` as
well as URL/token, and `requireWorkspace(true)` plus matching workspace ownership
before fetching Google. This closes the previous server-global connector risk
across multiple workspaces. No secrets were copied or configured by this change.
`getTaskRows` is an additive read-only connector action; `getPostRecords` retains
its original two-tab boundary. Existing desktop/Fudge scripts are unchanged.

Restarted only this project's port-3000 preview after building. `/login` returned
HTTP 200; signed-out Home, Master Sheet, Run, Profiles, Results, Settings and
legacy manual/setup routes returned HTTP 307. Isolated Playwright navigation to
`/dashboard` redirected to login, so a real signed-in desktop/mobile acceptance
test remains pending. The rendered UI tests use fixtures, not a live customer
session or invented application data. No migration, browser job, Sheet write,
commit or push was performed. Python code was unchanged; its earlier 35-test
result was not rerun for this UI/connector change.

Publishing protocol follow-up (2026-10-27): added local-only migration
`202610270006_publish_jobs.sql`, immutable content/target snapshots, withdrawn
approval cancellation, cross-type worker lease serialization, exact canonical
kind-matching URL capture, timestamp/fingerprint validation, duplicate-link
reconciliation, bounded diagnostics and replay-idempotent completion. Revocation
and reassignment now account for publishing leases in this migration. Expired
publishing leases become ambiguous completed results, blocking reposting even
after reapproval. Added staff-only `/dashboard/publishing` inspection and
cancel/acknowledgement actions; there is no enqueue server action/button and the
local monitoring agent's RPC allowlist remains unchanged. 36 local PGlite protocol
tests; full web suite 327 tests / 18 files passed. Python unit/mock suite: 35
passed. Typecheck passed; lint initially found one JSX apostrophe, fixed, then
passed with zero warnings; production build passed including all five new
content/profile/publishing routes. `git diff --check` passed with existing Windows
line-ending warnings. Inventory upload checks size before reading; the action
transport limit is 4 MB to accommodate reviewed JSON expansion while inventory
CSV remains capped at 1 MB. Context7 DNS lookup failed; consulted official Next.js
serverActions configuration documentation directly for the request limit.
**Publishing migration not deployed**; no publish worker/submit path or real
browser test exists. Authenticated UI acceptance remains blocked on account
access. See `PUBLISHING-PROTOCOL.md` for remaining safety gates.

Final follow-up: removed operational diagnostic text from potentially
customer-readable publish notifications; details remain in staff-only jobs.
All 36 publish-protocol tests passed again after that SQL change. Restarted the
production preview at `http://127.0.0.1:3000`; `/login` returned HTTP 200, and
signed-out `/dashboard/content`, `/dashboard/content/new`, `/dashboard/profiles`
and `/dashboard/publishing` returned HTTP 307 as expected. This is route/auth-gate
smoke coverage only, not signed-in UI or live automation acceptance. No commits
or pushes were made.

Profile inventory milestone (2026-10-27): added `202610270005_profile_inventory.sql` (table, `valid_profile_row`, import/archive RPCs), `/dashboard/profiles` page with preview→confirm import and explicit full-sync archiving, automation-form datalist suggestions, and navigation entry. 33 new PGlite tests cover zod↔SQL validation parity, legacy CSV header aliases, payload-duplicate atomicity, accurate merge counts, explicit archive choice requirement, archive/reactivate cycles, RLS/tenant/customer isolation, direct-write denial, anon denial, cross-tenant denial and the 5,000-row cap. Full suite after this change: 291 tests in 17 files PASS; typecheck PASS; lint PASS; production build PASS (new `/dashboard/profiles` route). Applied to staging via MCP as `profile_inventory` (`20261027200913`) and host-verified (RLS on, anon denied on table + both RPCs, authenticated read-only, 0 rows). No Incogniton connection, profile launch, or live export was involved; import remains a staff claim used for exact-UUID selection.

Content drafts milestone (2026-10-27): added `202610270004_content_drafts.sql` (two tables, `valid_draft_content`, save/review RPCs), `/dashboard/content` list/new/detail pages, revision history UI, composer with live unpublished preview, and navigation entry. 47 new Postgres/PGlite tests cover validation parity (UI schema ↔ SQL), tenant isolation, RLS, direct-write denial, replay/stale-revision protection, confirmed-review requirement, approve/return/archive transitions, worker-revocation guard, and reassignment requiring a fresh snapshot. Full suite: 258 tests in 16 files PASS; typecheck PASS; lint PASS (0 warnings); production build PASS (3 new routes). Applied to staging via MCP as `content_drafts` (`20261027200411`) and verified host RLS/permissions/anon rejection; advisors show 19 authenticated and 3 anon SECURITY DEFINER notices (the two new content RPCs among the 19), 1 intentional no-policy INFO, 25 unused-index INFOs on the mostly empty DB. No customer content, worker, or job was created; publishing, scheduling and attachments remain unimplemented.

Workbook-copy review (2026-10-27): inspected the user-supplied XLSX read-only using ZIP/XML parsing, without evaluating formulas or following hyperlinks. Compared seven tabs against the checked-in desktop/Apps Script code. Auto Posting: 82 Posted claims, 77 recorded links (61 canonical, 16 normalizable) and 5 missing links. Auto Listing: 95 mapped rows (63 Posted-prefixed with No link extracted, 15 Failed-prefixed, 17 blank); no recorded exact links. Profile sheet: 87 mapped rows, declared ID column empty. Other tabs contain unheaded side-column material that must not be treated as valid jobs. Existing status authorship/live-sheet behavior cannot be inferred from the snapshot. No credentials, customer content, links or workbook bytes were added to the repository or imported to Supabase. See `WORKBOOK-WORKFLOW-REVIEW.md`. No application code changed and no validation checks were rerun for this read-only analysis/documentation update.

Hosted worker DB setup (2026-10-27, explicit user approval): verified project identity, both existing migrations and compatible schema prerequisites via MCP. Applied `monitoring_worker_bridge` (`20261027185858`) and an additive, versioned `worker_bridge_indexes` follow-up (`20261027190052`). Verified RLS on all four new tables, private credential/client permission denial, staff RPC restrictions, six covering indexes and empty worker/credential/job tables. All three worker RPCs rejected invalid credentials under anon in a rolled-back transaction. The performance advisor now reports only unused-index INFOs (19); security reports 3 anon and 17 authenticated SECURITY DEFINER notices plus the intentional private-table no-policy INFO. These are documented in `WORKER-BRIDGE.md`, not dismissed as a security certification. The new migration/index test suite passed 35 tests locally. Full typecheck and lint passed; 211 web/database tests in 15 files passed after the follow-up. Build not rerun for DB/index/test/documentation-only changes. No account role, worker credential, customer record or browser job was created. The preserved workspace has zero memberships; live pairing/UI/HTTP acceptance remain pending.

Monitoring bridge implementation (2026-10-27): typecheck and lint passed; 210 web/database tests across 15 files passed, including 34 new worker-bridge Postgres/PGlite tests; 35 Python unit/mock tests passed. `git diff --check` passed with Windows line-ending warnings. The final production build passed, including `/dashboard/automation`. The local production server was restarted and `/login` returned HTTP 200. No new migration was applied to hosted Supabase, no private worker was paired, and no live profile, post, comment, Sheet or authenticated-UI acceptance test was run. Setup and deferred production features are documented in `WORKER-BRIDGE.md`.

Readiness re-audit (2026-10-27): all 34 original core/gui files match after line-ending normalization. Web typecheck/lint passed; 176 web tests and 27 worker unit/mock tests passed. Web Sheet endpoint/token remain missing; local Incogniton health unavailable; Playwright not installed in the shell-selected Python environment. Production build and live browser/Sheet/hosted schema acceptance were not rerun. See `AUTOMATION-READINESS-AUDIT.md` for all F01–F36 dispositions and actual connection steps. No live operations were executed.

Password-recovery runtime fix (2026-10-27): the server on port 3000 had been started before local Supabase configuration was added, causing `authenticate` to return its configuration-unavailable message before calling Supabase. Restarted only this project's server to load the configured environment/current build. Through isolated Playwright MCP, submitted one recovery request for the user-provided address; the UI returned the neutral success message, "If the address is registered, a reset link will arrive shortly." Email delivery, email-link destination and successful password change remain unverified. No account password or hosted Auth settings were changed.

Fresh Windows clone validation (2026-10-27): Node 24.22.1, `npm.cmd ci` succeeded (0 reported vulnerabilities; npm warned about an unapproved `unrs-resolver` postinstall script). `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test` (176 tests across 14 files), and `npm.cmd run build` all passed. The local production server returned HTTP 200 for `/login` with a password field. No local Supabase credentials were configured; hosted authentication and signed-in acceptance were not tested.

Fresh clone follow-up (2026-10-27): Supabase MCP connected to the configured project; both named repository migrations are recorded under hosted versions `20261026185223` and `20261026210947`. All 11 tables named in the two migration files exist with RLS enabled. The security advisor reports six authenticated SECURITY DEFINER RPC notices and disabled leaked-password protection. An active publishable key was configured locally; the app has not been rebuilt or tested with it, and migration content equivalence and authenticated acceptance were not verified. Context7, Playwright and Supabase MCPs report connected after Context7 configuration reload.

Worker foundation follow-up (2026-10-27): `python -m unittest -v test_worker` passed 3 tests. The fixed loopback Incogniton `/alive` probe returned `unavailable`; no profile or browser operations were attempted. Web typecheck and lint passed; 176 tests in 14 files passed; production build passed with `.env.local` loaded. The running preview was not restarted and authenticated acceptance remains untested.

Profile-inventory foundation (2026-10-27): added an offline, data-minimizing parser for the legacy Incogniton response shape. It rejects malformed records and duplicate IDs while preserving duplicate names for explicit resolution. `python -m unittest discover -v` passed 8 worker tests. No profile data was fetched, stored or sent; this parser is not connected to the dashboard or a worker service. Web checks were not rerun for this Python-only change.

Local monitoring pilot runner (2026-10-27): added opt-in batch execution, fixed-loopback Incogniton launch/status/stop calls, loopback-only CDP validation, explicit profile UUID grouping, page observation adapters, initially rendered stable-ID comment extraction, per-result UTC/source/adapter attribution, private local output guidance and an OS-released single-checkout lock. Unknown or active profiles are skipped; uncertain launches or cleanup abort the batch. `python -m unittest discover -v` passed 27 tests (unit/mocks; no live browser); the synthetic manifest dry-run returned 1 post / 1 profile / 0 network calls. `git diff --check` passed with a Windows line-ending warning. Adapter examples deliberately reject execution until configured; no production selectors are claimed. No live profile/post/comment checks, Sheets connection, scheduling, Supabase submission, automatic resume or dashboard dispatch are implemented/validated by this runner. Web checks were not rerun because no web code changed. References elsewhere to no automatic checker describe the absent integrated dashboard worker, not this new standalone pilot.

| Check | Latest recorded result |
|---|---|
| `npm.cmd run typecheck` | PASS; current auth source also checked by production build |
| `npm.cmd run lint` | PASS after auth UI changes |
| `npm.cmd test` | PASS: 404 tests in 23 files after the project-handover guard, 2026-10-28. Includes configuration safety, fixture-rendered UI, workflow actions, connector isolation and existing PGlite suites. Not new-project or live-browser acceptance. |
| Typecheck / lint / build after all work to date | PASS / PASS (0 warnings) / PASS — 24 routes incl. `/auth/confirm`, `/dashboard/checks`, `/dashboard/notifications/feed`, `/dashboard/sheet-sync`, 2026-10-27 |
| Preview checks after final build | PASS: `/login`, `/signup`, `/auth/confirm` render (200); an invalid link type shows the "link not valid" page; `/dashboard/*` and the notification feed redirect when signed out (307); no `SHEET_SYNC_TOKEN`, `service_role` or `sb_secret` text in the browser bundle. The real confirm page was viewed in headless Chrome. The signed-in Post checks page, bell, toast and sound were viewed only as a static mock built from the real stylesheet, never in a live signed-in session, and the sound has not been heard on a real device. |
| Not verified | Live Supabase sign-up/sign-in/email delivery; the signed-in Post checks page, bell and sound against the real database; the Sheet sync against the real sheet; anything involving Incogniton or Nextdoor. |
| MCP configuration | FIXED 2026-10-27 | The Supabase/Context7/Playwright servers existed only in the inner folder's `opencode.json`, so sessions started in the outer folder had no MCP tools. The same block is now in both folders, the invalid `auth` tool group was removed, and `apply_migration`/`execute_sql` ask before running. Details in `docs/OPENCODE-SETUP.md`. |
| Sheet-sync safety checks | PASS (tests): the real `reporting-sync.gs` run against a fake sheet with the real column layout requested only Profile Name, Post Text, Post link and Status cells (never Email/Password/Proxy); refuses missing/wrong token; serves only *Auto Posting*/*Auto Listing*; rejects every legacy write action; contains no write calls; its output passes the dashboard's strict validator, which rejects extra credential-like fields. Built browser JS contains neither `SHEET_SYNC_*` name. Signed-out `/dashboard/sheet-sync` redirects (307). |
| Sheet sync against the real Google Sheet | NOT RUN: the standalone script is not deployed and `SHEET_SYNC_URL`/`SHEET_SYNC_TOKEN` are not configured. The signed-in Sheet sync page has not been viewed. |
| Defect fixed | `postUrlSchema` threw on non-URL text instead of failing validation (also reachable from the existing record-a-post action). Now returns a normal validation failure; regression tests added. |
| Browser check after UI/UX refresh | PARTIAL: the real `/login` page was captured in headless Chrome in both system-dark and system-light preference and renders correctly. The signed-in dashboard could NOT be opened (needs a verified hosted account), so its layout and both themes were checked only against a throwaway static mock that used the real `globals.css` at 1600px, 1440px and a true 390px viewport. The real toggle click, saved preference, mobile drawer behaviour and filter forms have not been exercised in a live signed-in session. |
| `npm.cmd run build` | PASS on the final polished auth/reporting code, including TypeScript validation and production page generation |
| `npm.cmd audit --omit=dev` | PASS: 0 production vulnerabilities after upgrading the CSV parser to patched 7.x |
| MCP connection check | PASS: Context7 and Playwright connected |
| Browser smoke before redesign | PASS: local routes, security headers, no console errors, no horizontal overflow at 1366px/390px. This covered the prior entry design only. |
| Browser smoke after redesign | PASS: `/` and `/setup` redirect to `/login`; auth fields/labels present; password show/hide works; unconfigured sign-in shows a friendly focused alert without technical details; email retained; no overflow at 1440px, 390px, 320px; no browser console errors |
| Hosted Supabase auth/PostgREST/customer UI acceptance | BLOCKED: Auth URL configuration and a real verified account still required |
| Hosted database inspection | PASS: project URL matches; 8 `reporting_*` tables and recorded migration `20261026185223` |
| Hosted migration application | PASS: `reporting_foundation` applied to hosted staging 2026-10-26 |
| Hosted security advisor review | PASS with 1 intentional WARN: the four `SECURITY DEFINER` RPC write paths are executable by `authenticated` by design and guard themselves via `private_reporting.is_staff`/ownership checks; `anon` is denied. 14 "unused index" INFO items are expected on an empty database. |
| Hosted Data API guard check | PASS: unauthenticated calls to `rpc/reporting_create_workspace` and `reporting_customers` return `permission denied` (401/42501) — API exposure verified, anonymous access locked |

## Next steps, in order

1. Finish hosted Auth configuration — Site URL `http://127.0.0.1:3100` and redirect allowlist containing `/auth/callback` — via the Supabase MCP auth feature after re-authorization, or the same values in the dashboard. Email confirmation stays enabled; built-in email is acceptable for low-volume staging.
2. Execute the authenticated end-to-end acceptance checklist in `docs/DEVELOPMENT.md` using authorized staging accounts.
3. Done 2026-10-27 with explicit approval. Further commits and pushes still need explicit approval; the repository is public, so scan staged content for secrets and customer data each time.
4. Add proper server pagination, invitation/customer-access management UI, immutable report versions and delivery as separately approved reporting milestones.

## Current local preview

- URL: `http://127.0.0.1:3100/login` (a local production preview was started for review).
- A refresh of the previously shown `/setup` URL redirects to the new sign-in page.
- Database configuration/migrations are developer/admin operations in documentation, not customer-facing steps.
- The unauthenticated layout and failure handling are tested. No successful hosted login, migrated staging database or authenticated customer UI acceptance is claimed yet.

## Blocked on user configuration

- Project URL and publishable key are saved in ignored `apps/web/.env.local` (no personal access token, no service-role/secret key). Local production build inlines this config.
- Hosted Auth URL configuration (Site URL + redirect allowlist) remains; without it the confirmation email link will not return to the app. Pending one Supabase MCP re-authorization after enabling the `auth` feature.
- No Edge Functions were created: this milestone needs none — server logic runs in Next.js server actions plus Postgres RPCs/RLS. Storage and Realtime are unused by design.

## Explicitly not implemented

- Live posting, account creation, random engagement, anti-detection orchestration, proxy/cookie tools, or legacy browser controls.
- Automatic Nextdoor checks/comment scraping, any Nextdoor API connection, or claims of continuous fresh visibility.
- Live Google Sheets/portal writes, production deployment, report email delivery, or an unattended worker.
- Invitation/member-management UI, customer-specific report filtering, full server pagination, protected evidence uploads, MFA enforcement and immutable report storage.

## What has not changed

The existing `core/`, `gui/`, desktop launchers, live accounts and source workbook were not modified or executed. The only cloud change is the reviewed reporting schema applied to the supplied staging Supabase project; no paid resource, production deployment, Edge Function or customer dataset was created. The work was committed and pushed to GitHub on 2026-10-27 with explicit approval (see the GitHub remote row). Only the standalone reporting app, developer tooling/docs, the sheet integration script and the legacy code as-is were published.

Developer setup and migrations live in documentation/admin workflows, not in the user-facing app. No live customer data or platform actions have been used for this implementation.

## Browser task queue and the 24-hour profile board (2026-10-31)

Two gaps closed without opening a live gate: a real task queue for the browser
work that does not touch a Nextdoor session, and a counts-only daily board.

### Browser task queue (`20261031093000_automation_tasks_v1.sql`)

New additive table `reporting_automation_tasks` with five RPCs. The kind
allowlist is enforced in SQL, so a browser cannot request a type the worker must
not run:

- `profile_create` — creates one blank Incogniton profile through the local API.
- `preset_snapshot` — returns profile/group counts only.
- `cookie_import` / `proxy_import` — validate a file that already exists on the
  laptop; counts and short domain/host samples only, never a value.

`publish_post`, `publish_listing`, `account_create` and any other string are
rejected with "This task type is not executable from the dashboard".

- One open task per laptop (partial unique index) and one browser operation at a
  time across monitoring, publishing and automation leases.
- Payloads are size-capped, key-allowlisted, and rejected if they carry a
  password, cookie or token field; 10-minute leases with idempotent completion
  (a replayed result returns `false` instead of writing twice).
- Staff-only enqueue/cancel/reconcile; the worker calls claim/complete with its
  existing scoped credential.
- `/dashboard/run` replaces the static "Desktop tasks" list with a queue form
  and a task ledger. Auto Posting, Auto Listing, ND Acc Creation and content
  presets remain listed as **Gated**, each with its reason.
- The worker runs one queued task per poll before monitoring
  (`automation_tasks.execute`, `poll_automation`), and reports failure with a
  bounded reason. A malformed task is refused before any action.
- Incogniton profile creation is implemented against `POST /profile/create` on
  the loopback API and validates the returned UUID; it is **not yet verified
  against a live Incogniton install**, so a first run may fail visibly. No proxy,
  cookie or account label is sent.

Proof: `apps/web/tests/automation-tasks-db.test.ts` (8 PGlite cases, including
the cross-family lease guard) and `apps/worker/test_automation_tasks.py`
(18 cases).

### Last 24 hours by profile, and Responses

- `src/lib/daily-board.ts` groups loaded publications and comments by
  `account_label` and counts only what falls inside a rolling 24-hour window:
  posts by `published_at`, falling back to the record time when the platform
  date is unknown; comments by `first_observed_at`.
- Home adds "Last 24 hours by profile": profile, customer, posts, comments, last
  comment seen, and an Open link. Busiest first, capped at 24 rows; profiles with
  no saved activity in the window are left off rather than shown as a zero.
  Counts only — no thread renders there.
- `/dashboard/responses` lists those profiles and their posts in the window, with
  per-post saved-comment counts and an "Open thread" link to the existing post
  page. Results now carries a "Responses (24h)" button, and the route groups
  under Results in the sidebar, so the board is reachable without a sixth main
  destination. Replying is explicitly not enabled: there is no reply job type and
  the pilot account is suspended.
- A profile showing 0 in Responses means nothing was saved, not that nothing was
  posted, and the copy says so. Loaded records are partial, so the counts are
  partial too.
- Responses opens with a comment inbox (`src/lib/comment-inbox.ts`): only the
  profiles with a comment from someone else in the window, each with the
  Incogniton profile name/UUID from the staff inventory, direct post links,
  comment previews, quiet profiles collapsed, and one honest notice for posts
  never checked. Our own replies do not count, and a fresh comment on an older
  post still surfaces. Panel order: inbox, profile counts, posts, reply gate.

Validation on 2026-10-31: `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS
(0 warnings), `npm.cmd test` **865 tests / 64 files** PASS, `npm.cmd run build`
PASS, worker `python -m unittest discover` **106 tests** PASS. The migration was
applied to the hosted database on 2026-10-31 (`automation_tasks_v1`) after
preserving the existing transient-retry logic in `reporting_claim_check`; the
table has RLS, one staff read policy, four indexes and zero rows, and anon can
execute only the token-checked claim/complete RPCs. Nothing was committed,
deployed or run live.

## Read-only profile and session health on /dashboard/run (2026-10-31)

The "Desktop tasks" list claimed six desktop capabilities while showing nothing
about whether a paired laptop or profile could actually take work. One of those
gaps is now a real dashboard view, with no new gate opened.

`src/lib/profile-health.ts` derives a per-binding status from data the dashboard
already stores: `reporting_workers.last_seen_at`/`enabled` for the agent level,
the active reporting session for the session column, and open `leased` rows in
`reporting_check_jobs` for the laptop-wide lease count.

- **Levels:** live (heartbeat <= 5 minutes), heartbeat stale (<= 30 minutes),
  agent offline (older, missing or unparseable), laptop disabled (an explicit
  `enabled = false` wins over a fresh heartbeat). A future timestamp is reported
  as live rather than a negative age.
- **Session column:** "Bound to session" only when the binding points at the
  active session and its laptop is enabled. No session means nothing is
  dispatched.
- **Leases:** `reporting_check_jobs` records the worker, never the Incogniton
  profile, so the count is labelled as laptop-wide and expired leases are called
  out separately instead of being attributed to a profile.
- **Explicitly read-only:** the panel does not probe Incogniton, open a browser,
  launch or stop a profile, or start a check. The copy says so on the page.

`/dashboard/run` keeps Auto Posting, Auto Listing, Incog Profile Creation, ND Acc
Creation, Bulk cookies / proxies import and Content presets as desktop-only,
with wording that states there is no dashboard job type behind them and a Start
button would do nothing. "Session health" was removed from that list because the
read-only view above now covers it; content presets remain desktop-only.

Tests: `tests/profile-health.test.ts` (14 cases) covers the thresholds, disabled
and missing laptops, unparseable and future timestamps, session binding, lease
attribution, expired leases without deadlines and the summary counts.

Validation on 2026-10-31: `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS
(0 warnings), `npm.cmd test` **828 tests / 60 files** PASS, `npm.cmd run build`
PASS. No worker change, migration, deployment, commit or live action was made.

## Cookie/proxy real import into a chosen profile (2026-10-31)

The `cookie_import`/`proxy_import` kinds only validated a file. They stay, and
two new executable kinds now perform the real import — still one task, one
profile, one confirmation, and **not verified against a live Incogniton
install**, so a first run may report a failure honestly.

- New kinds `cookie_write` and `proxy_write` in the worker, SQL and UI. A write
  task payload names exactly one Incogniton profile by canonical UUID and one
  absolute local file path (plus `replace` for cookies). Old kinds and payloads
  are unchanged; `publish_post`, `publish_listing`, `account_create` and
  friends are still refused at every layer.
- Migration `20261031120000_cookie_proxy_write_v1.sql` extends the kind
  constraint and replaces enqueue/complete with write validation (replace must
  be boolean `true`/`false`, not a string). Proven in PGlite **before** it was
  applied: the first proof run caught a real bug —
  `task_result->'written' < 1` compares jsonb to an integer and would have
  failed every valid cookie-write completion on PostgreSQL. It is now
  `(task_result->>'written')::numeric < 1`. Applied to the hosted database on
  2026-10-31 as `cookie_proxy_write_v1` (16th hosted migration). Hosted
  verification: the constraint lists all six kinds, both replaced function
  bodies contain the write branches, anon can still only execute the
  token-checked claim/complete RPCs (not enqueue), RLS is on with the one staff
  read policy.
- Worker (`automation_tasks.py`, `local_incogniton.py`): the Netscape parser
  is field-for-field the desktop importer's (`#HttpOnly_` handling, seven
  columns, same cookie shape) and the proxy parser is the desktop
  `parse_proxy` line-by-line (scheme prefix picks the type, default SOCKS5).
  Write calls copy the desktop's exact wire formats: cookies via
  `POST /profile/addCookie` with base64json and an optional
  `/profile/deleteCookie/{id}` when replacing; proxy via `POST /profile/update`
  form-urlencoded with `profileData` as a JSON string (three known-good
  shapes, first confirmed wins, attempted once).
- The dashboard never receives a cookie value or a proxy credential: a
  cookie-write result is counts (`entries`, `written`, `replaced`), and a
  proxy-write result is `entries` plus the applied `host:port` only — the SQL
  completion check rejects any result that carries a username/password, and
  the wording says the login details never leave the laptop.
- The queue form gains an Incogniton profile picker fed from the
  **active-only** profile inventory (an earlier draft included archived rows;
  fixed), a replace checkbox for cookies, and a confirm sentence that changes
  for writes: it says exactly which profile on which laptop receives the
  import, and that nothing is posted, published or browsed. Enqueue
  validation (`validateWriteInput`), an `InventoryProfile` type, and
  write-aware outcome wording (`describeResult` resolves the profile name from
  the inventory) close the loop.
- No write has been executed against a real Incogniton install; the worker's
  Incogniton API surface (create, cookie, proxy) remains
  **unverified live**, like the profile creation added on 2026-10-31. This
  slice adds no posting, listing, account creation or reply capability, and
  the reply gate is unchanged.

Proof: `apps/web/tests/automation-tasks-db.test.ts` grew from 8 to 10 PGlite
cases (write payload validation; cookie+proxy write through claim/complete,
including rejections of a zero count, a smuggled `cookie_value` and a
credential-bearing `applied`), `apps/web/tests/automation-tasks.test.ts`
covers the six kinds, write input validation and the write outcome wording,
and `apps/worker/test_automation_tasks.py` grew from 18 to 26 cases
(payload/profile target contract, parsed Netscape rows, replace-clears-first,
empty-file refusal, first-valid-proxy-only, scheme prefix, no-usable-line
refusal).

Validation on 2026-10-31: `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS
(0 warnings), `npm.cmd test` **870 tests / 64 files** PASS, `npm.cmd run build`
PASS; worker `python -m unittest discover` **114 tests** PASS (exit 0). The
local dev server runs for operator testing from `apps/web` with
`apps/web/.env.local` (never staged). Nothing was deployed to production;
Vercel still serves the previous build until a separate approved manual deploy.

## One-device wording: no separate "paired laptop" (2026-10-31)

The operator directed that the whole workflow — Fudge, the master-Sheet sync,
the automation agent and Incogniton — is **one and the same device**, and the
"paired laptop" wording should go. That was already the real architecture (the
registered worker `Kashif PC` is this same PC), but the copy implied a second
machine. This is a wording/wording-honesty change only: the worker
registration, credential scoping, lease rules and RLS are untouched, because a
hosted website cannot start local programs without an authenticated local
agent — the "pairing" is that security handshake, now called registration.

- The registered software agent is now called the **automation agent**, and
  physical-machine references say **this device**: the queue form's Device
  select, file paths ("on this device"), confirmations ("this device's
  automation agent"), status labels ("Waiting for agent", "Running on agent"),
  action messages (enqueue/cancel/reconcile), the Home card ("LOCAL AUTOMATION
  AGENT", "Register once"), heartbeat state ("Not registered yet"), profile
  health ("Agent disabled", "Unassigned device") and column headers on Run,
  Profiles and monitoring tables.
- The setup entry points follow: Settings now links **Automation agent setup**
  (not "Pair laptop / worker"); `/dashboard/automation` registers "this
  device's automation agent" with a "Device name" field (placeholder "e.g.
  This PC"); the setup guide step is "Register this device's automation agent
  once" and its troubleshooting card says to start the agent on this device.
- Honesty fix found during the sweep: the setup guide's desktop-only card
  still claimed "Incogniton profile creation, cookie and proxy handling" were
  desktop-only, but the browser task queue now runs those. The card now says
  posting, listings, media work and bulk operations stay on the desktop app,
  while profile creation and cookie/proxy imports are queued from Run
  automation with the desktop app as fallback — matching the queue built
  earlier on 2026-10-31.
- Kept deliberately: the internal `worker`/`reporting_workers` names in code
  and SQL, the token-gated claim/complete RPC design, and the DB error string
  "This laptop already has a queued or running browser task" (the web action
  maps it to a generic agent message and never shows the raw text). The lucide
  `Laptop` icon and "column/value pairs" mentions are not pairing language.

Five test assertions were updated with the copy
(`workflow.test.ts`, `workflow-ui.test.tsx` ×2, `setup-guide-ui.test.tsx` ×2,
`profile-health.test.ts`), including the corrected desktop-only guide card.

Validation on 2026-10-31: `npm.cmd run typecheck` PASS, `npm.cmd run lint` PASS
(0 warnings), `npm.cmd test` **870 tests / 64 files** PASS, `npm.cmd run build`
PASS. No migration, worker code, deployment or live action was involved; the
local dev server serves the reworded UI immediately for operator review.

## Fresh hosted start + Incogniton auto-detect (2026-10-31)

The operator directed a fresh setup ("remove account comments etc we will new
setup (accounts, tasks, profiles, comments)") with auto-detected profiles and
a stack of dashboard + Fudge extension + Incogniton on one and the same
laptop, with no desktop-app dependency. Two actions follow.

### Approved full data wipe (hosted, irreversible)

After an explicit confirmation with the exact row counts per table, the hosted
workspace data was deleted in one atomic transaction, child tables first so no
foreign key blocked it. Deleted: 2 test customers, 2 publications, 21
comments, 5 post checks + 5 check jobs, 0 cohorts, 3,220 profile-inventory
rows, 1 profile binding, 4 work sessions (1 stale-active), both workers
("offive laptop", "Kashif PC"), the 1 unrecoverable worker credential, 3
observations, 5 notifications, and the empty draft/revision, fudge,
service-catalog and sheet-writeback rows. Kept: the 2 organizations and 2
memberships (logins — deleting them would lock the operator out). This
supersedes the planned "disable Kashif PC / close the stale session" cleanup:
those records no longer exist. Post-wipe verification confirmed every data
table at 0 rows. The operator must now re-register the automation agent in
`/dashboard/automation` and save the new credential before any queued task
(including the first scan) can run.

### `inventory_scan`: one-click profile auto-detect

- Migration `20261031150000_inventory_scan_v1.sql` (applied hosted as
  `inventory_scan_v1`, the 17th): 7-kind task constraint, enqueue accepts the
  new read-only kind, and `reporting_complete_automation_task` gains a scan
  branch — result keys exactly `{profiles,total,truncated}`, ≤ 500 rows each
  validated by the same `private_reporting.valid_profile_row` the CSV import
  uses, and truncation mandatory when `total` exceeds 500. Scan results get
  their own 64,000-byte allowance; every other result keeps the 8,000-byte
  cap. No posting/listing/account-creation kind was added.
- Worker: `local_incogniton.list_profiles()` mirrors the desktop manager's
  `/profile/all` extraction field-for-field (accepts `profileData`/`profiles`
  keys, JSON-string lists, nested `general_profile_information`; dedupes;
  drops entries without a canonical UUID or name) and returns UUID, name and
  group only — cookies, proxies and account details are never parsed.
  `automation_tasks` caps the returned list at `MAX_SCAN_ENTRIES = 500` with
  an honest `truncated` flag and the true `total`.
- Web: `inventory_scan` added to the kind registry (label "Detect Incogniton
  profiles", honest `describeResult` that reports the truncation), an enqueue
  branch, and `importScannedProfiles` in `actions/profiles.ts` — reads the
  latest succeeded scan, re-validates rows with `profileRowSchema`, and feeds
  them to `reporting_import_profiles` with `archive_missing: false`. The
  Profiles page replaces "Live inventory discovery is not connected yet"
  with a `<ScanImport />` panel ("Use latest device scan") that shows the last
  scan's total/cap and adds a truncation confirmation when capped. CSV import
  stays as the fallback.
- Setup guide: rewritten to the single-device stack — "One device, three
  tools", a Phase-1 step "Detect your Incogniton profiles automatically", and
  the closing section retitled **NOT IN THIS STACK YET OR GATED** with
  "Not in this stack yet" replacing "Desktop only". Every user-facing
  "desktop app" reference was removed (run, automation, home, content,
  master-sheet, settings, sheet wizard/writeback/sync/status/health copy and
  the cookie_write task description); profile launch/stop now points at
  Incogniton on this device. The generated Apps Script connector source was
  deliberately left untouched to avoid connector-redeploy churn, and the
  roadmap's "Desktop source" column stays historical.
- Gated rows are unchanged: posting, listings, account creation and presets
  remain off with per-row reasons; nothing claims them.

Tests: new worker cases (both response shapes, dedupe/refusal, the 500 cap
with honest truncation) bring the worker suite to **122 PASS**; web adds
describeResult/kind cases, 4 PGlite scan cases (shape refusal, the
≥ 8,000-byte scan acceptance feeding `reporting_import_profiles`, the
64,000-byte refusal, one-task-per-device), the `importScannedProfiles`
stale-context guard, the workspace-source guard now expecting 32 guarded
actions plus `scan-import` in the form-context list.

Validation on 2026-10-31: `npm.cmd run typecheck` PASS, `npm.cmd run lint`
PASS (0 warnings), `npm.cmd test` **876 tests / 64 files** PASS, `npm.cmd run
build` PASS; worker `python -m unittest discover` **122 tests** PASS (exit
0). Migration applied hosted and verified in the migration list. Still
unverified against a live Incogniton install: profile creation, cookie/proxy
writes and now the first real scan — each would surface an honest failure.

With explicit approval, the slice was deployed to production the same day
(`vercel --prod` from `apps/web`; final deployment `4h1omaw5m`, status Ready
at **https://nd-automation-dashboard.vercel.app**, alias verified). At the
operator's direction the `SHEET_SYNC_URL` / `SHEET_SYNC_TOKEN` /
`SHEET_SYNC_ORGANIZATION_ID` values were briefly added to Vercel and then
removed again for a fresh Sheet-sync setup later, so production deliberately
runs without them until that setup happens: the setup guide now has a
Phase 1 step telling the operator to add them in Vercel →
Settings → Environment Variables (production) and redeploy, with the
"Sheet not configured" troubleshooting card pointing back to it; the
Settings connection instructions match. Local `.env.local` retains its
Sheet-sync values (never staged).
