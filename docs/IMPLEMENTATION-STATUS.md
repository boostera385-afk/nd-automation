# Implementation status

## Current milestone

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
| `npm.cmd test` | PASS: 387 tests in 22 files after the sheet-first UI/connector milestone, 2026-10-27. Includes fixture-rendered UI, workflow actions, connector privacy/tenant isolation and existing PGlite suites. Not live browser/Incogniton acceptance. |
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
