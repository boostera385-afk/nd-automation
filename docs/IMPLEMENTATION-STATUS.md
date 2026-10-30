# Implementation status

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
no delivery worker; the single worker has never heartbeated and no work session is
active; no publication, check, cohort, publish-job or writeback row was created.
Leaked-password protection and signed-in production acceptance remain open.

Validation on the final tree: typecheck PASS, lint PASS (**0 warnings**), **805
tests / 57 files** PASS, production build PASS. Hosted post-deploy checks confirmed
table/function/policy presence, the publication-source and notification-kind
constraints, the timestamp regex in `reporting_complete_publish`, and read-only
grants. Real signed-in cohort execution and publish claim/completion were not run;
they need an authenticated session, a paired worker and real tracked publications.
See `docs/DB-DEPLOYMENT-20261030-COHORT.md`; the drafts README and test path now
point at the promoted migration.

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

**Selectors taken from the live DOM:** `post_root` `[data-testid="feed-item-card"]`,
`post_body` `[data-testid="post-body"]`, `post_link` `a[href*="/p/"]`, `login`
`[data-testid="email-address-input"]` (absent when signed in). The `comment`,
`comment_id_attribute`, `comment_body`, `removed`, `verification` and
`unavailable` values are deliberately non-matching placeholders: the current
build exposes **no** per-comment identity attribute, and a post card's
`comment-avatar-container` is the comment *composer*, not a comment. Comment
capture therefore stays empty and is recorded as incomplete — never as zero
verified comments.

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

**Comment capture is not possible without interaction, and the pilot post has
no comments to collect.** The pilot post and four other tracked links were
scanned at the profile's default window and at 1440×900 emulation: the target
post's own `.comment-list-container` never contained text, no control mentioning
"comment" was present, and at desktop width the list was not rendered at all.

A later scan scoped strictly to the target card measured `own_chars = 0` both
before and after a programmatic `post-body` click (which opens the detail view
without mutating anything). The 117–118 character list seen in that run belonged
to a **neighbouring feed card**; the earlier "comments appear after a click"
attribution was wrong and is withdrawn. A rendered empty list is also *not* proof
of zero comments, because the card carries a composer avatar — so `comments_total`
stays `null` and `comments_complete` stays `false`.

The dashboard side is already complete: `/dashboard/comments`,
`/dashboard/posts/<id>` and `/dashboard/results?view=comments` all render stored
comment detail (author, body, first-observed time, platform creation time when
known), and the post ledger shows the per-post count. Those views are empty only
because `reporting_comments` holds no rows. Enabling automatic capture still
needs an explicit approval for the detail-opening step **and** a post that
actually has comments, so a selector can be validated against real items.

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

Reporting foundation plus an initial read-only dashboard-to-worker bridge implemented in source, with staging database setup applied on 2026-10-27. The original desktop code is unchanged; its posting, onboarding, cookie/proxy and other write workflows remain unconnected. Actual worker pairing and live acceptance are pending. Explicitly authorized monitoring claims are gated by work sessions; session buttons alone never enable publishing or account creation. The historical full automation plan is not delivered scope.

The user has requested full desktop-to-dashboard parity and authorized updating `AGENTS.md` for a phased migration. `DASHBOARD-PARITY-ROADMAP.md` records the direction and feature-family gaps. `apps/worker/agent.py` now implements the outbound monitoring protocol, reusing the opt-in pilot runner. It needs the new reviewed migration, private pairing, a compatible Python/Playwright environment and validated selectors. No live automation pilot, recurring Sheet ingestion or Sheet result writeback is implemented/validated by this change.

## Completed implementation — local foundation

`Implemented` means code exists. `Locally tested` names checks actually run. It does not mean deployed or validated against a hosted Supabase project.

| Area | State | Actual scope |
|---|---|---|
| Monitoring worker bridge | IMPLEMENTED / LOCAL VALIDATION / STAGING DATABASE APPLIED; WORKER NOT PAIRED OR LIVE-TESTED | Staff-only Automation control, private hashed worker credentials, explicit profile/customer/account binding, session-authorized due-check planning, leases/deduplication, atomic auto-check/comment/notification submission, cancellation, revocation and reviewed expired-lease/replacement-worker flows. Hosted versions: `20261027185858` (bridge), `20261027190052` (six covering indexes and schema comments). Agent never accepts publishing, onboarding or arbitrary executable jobs. See `WORKER-BRIDGE.md` for exact limits and deferred acceptance. |
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
