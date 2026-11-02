# Master automation delivery tracker

Updated: 2026-11-03. Execution companion to `MASTER-AUTOMATION-PLAN.md`, not a replacement for `IMPLEMENTATION-STATUS.md` or evidence of live acceptance. Role owners below are proposed responsibilities; assign named owners during P0. Every unaccepted browser workflow stays paused in the dashboard; legacy use requires non-overlapping ownership.

Source **0.1.3**, code-first follow-up: automatic result-to-outbox mapping,
business-time scheduling, explicit selected-revision bulk authorization, bounded
sequential publisher/deliverer polling, approved images and private local/HTTPS/
Drive asset import are implemented with local fixtures. Migrations 003–005 are
not hosted. This supersedes earlier missing-code claims for these narrow features,
not full desktop parity. No configuration/live testing or fudge changes were made.
Onboarding, edit/delete/moderation, remaining device/profile operations and final
feature sign-off remain development work. See the newest implementation status.

Source **0.1.4** follow-up: browser-task durable recovery and separate supervised
workflow queue/runner/UI implement genuine-data registration first-step handoff,
login/identity inspection, bounded read-only browsing, approved text edits and
exact-target delete/block operations. Normal agents never claim them. New
migrations 006–007 remain local. No real accounts/actions or yesterday-cohort
checks were performed. Protected evidence, bulk intake, attachment-preserving
edits, deployment/update parity and all live acceptance remain open.

2026-11-03 checkpoint: whole-project checks PASS (web typecheck/lint/1,053 tests/
build; 234 worker tests). Hosted migrations stop at 002 (23 records); 003–007 are
**not hosted** and production stays 0.1.1. Remaining gaps stay open; see the
migration status and remaining-gaps tables in `IMPLEMENTATION-STATUS.md`.

Source 0.1.2 follow-up: the missing one-intent Sheet deliverer and separate
atomic Apps Script connector are now implemented, with safe-column/stable-ID/
revision validation, verified staff authorization, private write-ahead recovery
and literal string cells. This supersedes older "no Sheet write path" statements
for explicitly queued v1 pilot intents only. It does **not** implement automatic
monitoring/publication-to-outbox mapping, a schedule/bulk deliverer or live setup.
No Google/hosted write or production deploy was performed for this tranche.
See `SHEET-WRITEBACK-SETUP.md` and the newest implementation-status entry.

November 2 follow-up: operator-authorized safety migrations are applied as hosted
`20261102152910 automation_session_gate` and `20261102154039 publish_dispatch_guard`
(23 migration records). Browser tasks require exact work-session authorization;
publishing now shares their lease exclusion. A separate opt-in, one-job text
post/listing publisher and explicit approved-revision queue action are implemented
with private write-ahead intent/result recovery. Real isolated-browser synthetic
post/listing fixtures pass without real platform requests; this is not live
acceptance. Media, scheduling, onboarding, Sheet delivery and full handover remain
open. See `SUPERVISED-PUBLISHING.md` and the newest implementation-status entry.

Readiness review (2026-10-29): all 44 feature IDs are present exactly once; no
full desktop replacement sign-off. Fresh dashboard 649 tests/build/typecheck/lint,
Fudge 67 backend + 127 smoke, and worker 35 tests pass. Hosted history contains
11 applied migrations; publishing remains intentionally undeployed. Source
Services has 21 rules but ND Test's active catalog has only 2 test rules; 27
request keywords lack exact Services matches and need semantic review. Central
verified-email enforcement, explicit multi-business selection, live worker setup,
Sheet mapping/delivery and recovery/rights gates remain; see the current status
entry for evidence and precise limitations. Do not enable automation from this
tracker or infer live readiness from test counts.

Protocol deployment (2026-10-30): after the full-chain audit the user directed
implementation of the safe readiness items. Hosted history now contains **14
migrations** — cohort `20261030164030 check_cohort_v1` and publish jobs
`20261030164110 publish_jobs_v1` were added — and **28 public base tables**, all
RLS-enabled. Both protocols are queue/history only: no worker, publish adapter,
Fudge upload release, Sheet delivery or live job was enabled, and the new tables
remain empty. `/dashboard/run/cohorts` now unlocks for verified staff with an
active session; `/dashboard/publishing` reads an existing empty queue with no
enqueue action. Dashboard validation: 805 tests / 57 files, typecheck and lint
PASS; the production build result is recorded in the current status entry. See
`DB-DEPLOYMENT-20261030-COHORT.md`.

Security follow-up (2026-10-29): central application-layer email confirmation,
explicit authorized workspace selection, stale-account/business form rejection
across all 30 business form actions, and matching notification scope are now
implemented; full validation passed (712 tests / 50 files, typecheck, lint, build).
Signed-out local HTTP route checks also passed. No hosted schema change or live browser
acceptance is implied. See the newest implementation-status entry; remaining
SQL-level defense-in-depth, Sheet/publisher/worker/recovery/rights gates stay open.

Code-first monitoring follow-up (2026-10-29): local date-cohort snapshot/queue,
strict server action, history/detail/progress UI and a separate offline worker
preflight/pinned dependency specification now exist. Protocol is a draft only,
not a hosted migration; UI fails closed until it is configured/deployed. No
configuration, live job or dependency install performed. The scheduled 24-hour
policy remains unchanged; explicit refresh has its own bounded freshness policy.
Full validation: 782 dashboard tests / 55 files, typecheck, lint and build PASS;
43 worker tests PASS; signed-out cohort HTTP smoke PASS. Single-runtime fixtures
do not establish real concurrent PostgreSQL/Auth/browser acceptance.
Sheet completion-to-outbox mapping/delivery, latest-100 policy, durable worker
result recovery and the remaining publishing/profile adapters still need code.

## Phase gates

Authorized deployment follow-up (2026-10-30): promoted verified-access source
`20261030155515` applied to the shared database as `20261030155727` (12 hosted
migrations). All five source body hashes, trigger/grants and unchanged monitoring
bodies verified; hosted read/role-only smoke PASS, advisors unchanged. The
current web app was then deployed to the existing Vercel production site from
`apps/web` — the original deploy root; a repository-root upload fails because
the project has no Root Directory. The anonymous route gate now passes on
https://nd-automation-dashboard.vercel.app: `/workspaces` and `/verify-email`
redirect to same-origin `/login` instead of 404. Signed-in/Auth acceptance
remains open; publishing/cohort deployments remain excluded. See
`DB-DEPLOYMENT-20261030-VERIFIED-ACCESS.md` and the current status entry.

Security/recovery remediation (2026-10-30): strict lease/receipt validation and
durable monitoring-result replay are implemented locally (65 worker tests PASS).
Explicit operator attestation can reconcile a claim with no recoverable result;
it does not verify server state, fabricate an observation or discard a saved
result. `supabase/drafts/verified_access_v1.sql` hardens legacy confirmed-user
helpers/metadata policies and new check-job/session-owner dispatch; it is locally
tested, **not deployed**. Dashboard typecheck/lint, 805 tests / 57 files, build
and 12 signed-out local HTTP smoke checks PASS. New `check:deployment` fails on
the two missing production identity routes, not a repaired production deployment.
Worker CI coverage is configured, not remotely executed. Publishing, Sheet
delivery/mapping, runtime/pilot, complete restore and desktop parity stay open.
User selected Fudge as the next owning repository; no cutover or release implied.

| Phase | State | Next deliverable / dependency |
| --- | --- | --- |
| P0 | In progress | Confirm Source/ND Master mapping and policy decisions in `P0-DISCOVERY.md`; feature inventory below |
| P1 | Central app verification/workspace selection and additive verified SQL hardening implemented; security source applied as hosted `20261030155727`, 12 migration records | Current dashboard deployment, negative live Auth/isolation and selector/stale-tab acceptance, restore and operational Sheet setup remain |
| P2 | Intake schema deployed; Auth/MV3 queue implemented; release off | Hosted `20261028203642`, rollback-only smoke PASS; see `DB-DEPLOYMENT-20261028.md`. Real-browser/REST/concurrency acceptance, retention/deletion and pilot remain; no real source uploaded |
| P3 | Intake/catalog/queue foundations, exact automatic result mappings, serialized outbox claims and bounded opt-in Sheet deliverer/connector implemented; cache gated | Reviewed migration deployment later, rule approval, real ownership/isolation/concurrency/rights/delivery/conflict/recovery acceptance |
| P4 | Monitoring source, deployed date-cohort protocol/UI, offline preflight and durable monitoring-result replay implemented; live acceptance pending | Real filesystem/worker recovery acceptance, latest-100 policy, pairing/selector/real concurrency and supervised pilot acceptance |
| P5 | Durable queue, immutable approved images, explicit bulk/schedule controls, bounded sequential publisher, exact identity/audience/byte/result checks and submit-intent recovery implemented | Reviewed additive migrations later; authorized DOM/account/asset rights, real post/listing/image/schedule/batch/recovery acceptance; managed cloud asset UI remains open |
| P6 | Inventory foundation only | Controlled profile/onboarding/cookie/proxy adapters and local secret storage |
| P7 | Not started | Approved linked reposts and bounded batching after correctness gates |
| P8 | Not started | Full acceptance/recovery/rollback; individual feature sign-off |

## Feature inventory / acceptance backlog

All entries are **not signed off for end-to-end dashboard replacement**. Existing local tests and historical hosted results remain detailed in `IMPLEMENTATION-STATUS.md`; none establishes new-project readiness. Database/client implementation alone does not satisfy a browser operation's acceptance test.

| ID | Requirement / current boundary | Phase / role owner | Required acceptance evidence |
| --- | --- | --- | --- |
| F01 | Health probe source; no accepted Open Incogniton dashboard action | P4/P6 worker | Health != authenticated readiness; explicit safe launch |
| F02 | Profile creation unconnected | P6 worker | Actual returned UUID, validation, duplicate-safe recovery |
| F03 | Inventory and binding foundations; not live inventory | P4/P6 worker + web | Exact UUID/customer binding, duplicate names resolved |
| F04 | Lifecycle/lease foundations; live recovery unverified | P4/P6 worker | Ownership-safe launch/stop, no discarded newer data |
| F05 | Proxy parsing/update unconnected | P6 worker | Redaction, validation and serialized replacement |
| F06 | Bulk proxy import unconnected | P6 worker + web | Preview, explicit confirmation, per-row recovery |
| F07 | Cookie format import unconnected | P6 worker | Supported format fixtures, local secret protection |
| F08 | Cookie replacement/readback unconnected | P6 worker | Exclusive lease, replace confirmation, verified result |
| F09 | Automatic cookie/proxy intake unconnected | P6 worker | Authorized schedule, stable-ID deduplication; empty fields wait |
| F10 | Explicit genuine-data first-step registration queue/runner/UI implemented; handoff, not automatic completed account | P6 worker + operator | Actual permitted DOM, existing-profile human continuation and genuine identity acceptance |
| F11 | Challenge detection stops for human handoff; never synthesizes identity/location/OTP or resumes registration blindly | P6 worker + operator | Human verification/inspect follow-up, real challenge variants |
| F12 | Preferences/consent remain deliberate human actions; automated consent not ported | P6 worker + operator | Genuine operator choices and acceptance; no false parity |
| F13 | Explicit private local login and exact account verification implemented; no hosted credentials or secrets-vault claim | P6 worker | Private OS ACLs, real login/OTP/challenge/recovery acceptance |
| F14 | Text drafts/approval plus explicit supervised queue and one-job publisher implemented with fixtures | P5 web + worker | Live exact approved revision/target and captured publication; not signed off |
| F15 | Approved-image publishing and private local/HTTPS/authorized Drive import implemented; hashes/size/type/order verified, no remote arbitrary paths | P5 worker + web | Actual platform upload/visual acceptance, rights/privacy/metadata review, approved asset storage/preview ownership; not signed off |
| F16 | In-memory uploads, reviewed file input/preview/result-count controls and managed-import temporary cleanup implemented; no silent attachment-loss fallback | P5 worker | Real UI variants, transient cleanup/interrupt acceptance and alternate upload-control support if required |
| F17 | Explicit audience selection and visible-label verification implemented in supervised text publisher | P5 worker | Real account/composer audience acceptance; unknown fails closed |
| F18 | Exact same-card body/author/permalink capture; existing matching content blocks submission | P5 worker | Live found != newly published and exact identity attribution acceptance |
| F19 | Exact owned-post fingerprint + approved immutable text revision, readback and same-card result implemented | P6/P7 web + worker | Attachment-preserving variants still need code; real text/listing edit approval/identity/recovery acceptance |
| F20 | Exact tracked owned target, dashboard/local destructive confirmations, same-target dialog/result and no replay implemented | P6/P7 web + worker | Real permission/UI/ambiguous-result and recovery acceptance |
| F21 | Separate one-account exact-target block workflow implemented; no implicit mass blocking | P6/P7 web + worker | Real permitted moderation UI/dialog/result/recovery acceptance |
| F22 | Service-area ownership not signed off | P0/P3 web + operator | Approved mapping; area != verified residence |
| F23 | Text-listing publisher verifies title/body/decimal price/native category/audience with fixture result capture | P5 web + worker | Live typed fields/exact listing capture and media implementation; not signed off |
| F24 | Operational listing evidence unconnected | P5 worker | Clean exact URL, scoped evidence, no appended metrics |
| F25 | Legacy account unread badge not per-post comments | P4/P6 worker | Correct account-level label, no false association |
| F26 | Preset/group flow unresolved; not enabled | P0/P7 operator + worker | Demonstrated permitted explicit destinations; user disposition |
| F27 | Explicit account-inspected 30-second read-only review implemented through separate workflow runner | P6 worker | Real profile cleanup/session/identity acceptance; never engagement or visibility evidence |
| F28 | Random/artificial engagement excluded from proposed automation | P0 operator | Explicit disposition recorded; no silent migration |
| F29 | Legacy navigation preserved; live adapters unvalidated | P4/P5 worker | Known UI fixtures; unknown/challenge states stop safely |
| F30 | Monitoring queue/session foundations only | P4–P7 backend + worker | Real contention, cross-type profile exclusion, pause/revoke recovery |
| F31 | Partial job/check events and results | P4/P5 web + worker | Real counters, accurate skipped/failed states, redacted diagnostics |
| F32 | Protected operational evidence not complete | P5 backend + worker | Access control, scoped capture, retention/deletion |
| F33 | Outbox, queue/cancel/mapping UI, automatic check/publication-to-outbox triggers, serialized claims, bounded sequential deliverer and atomic connector implemented | P3 deliverer + connector | New mapping migration later; real setup/ownership, stable-ID row moves, conflicts, lost-response replay and full pipeline acceptance |
| F34 | Setup guides/assets exist; acceptance pending | P3 connector | Non-destructive versioned setup; legacy aliases preserved |
| F35 | Theme/settings foundations; connections unverified | P1/P4 web + worker | Real target/machine checks without exposing secrets |
| F36 | Desktop launchers preserved; worker operations incomplete | P4/P8 worker | Versioned install/update/drain/restart/rollback |
| N01 | Publication ledger foundation | P3/P5 backend | Sourced time/customer/exact URL; unknown stays unknown |
| N02 | One-click date-cohort snapshot/queue/history/progress code and tests; SQL deployed as hosted `20261030164030` | P4 web + backend | Real contention, live exact-cohort/restart/pause acceptance and mapped result writeback; latest-100 remains separate |
| N03 | Observation/check history foundation | P4 web + worker | Staleness, evidence, technical failure != removal |
| N04 | Manual comments + partial worker collector | P4 worker + backend | Exact-post stable IDs, partial/completeness, unknown totals |
| N05 | Reporting foundations | P4/P8 web | Date cohorts, DST, true coverage and partial-data indicators |
| N06 | Auth/RLS source and current shared hosted metadata verified; central app email/selection/stale-form guards implemented | P1 backend | Genuine negative tenant/customer access, multi-business/stale-tab browser acceptance, SQL defense-in-depth and recovery |
| N07 | Explicit bounded refresh freshness, frozen membership and active-job reuse implemented locally | P4 web + backend | Real concurrent scheduler/refresh, worker result recovery and missing-link reconciliation acceptance |
| N08 | Outbox deployed; automatic mappings, explicit intent delivery, bounded watch/drain and receipt-only recovery implemented locally | P3 deliverer + connector | New source migration later; real delivery/permissions/conflict/row-move/recovery and bounded watcher acceptance |

For each completed item append: source change, exact test command/result, target environment, deployed migration/version if applicable, live pilot evidence if approved, operator acceptance, and remaining limits. Do not turn proposed ownership or a passing fixture into sign-off.
