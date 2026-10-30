# Master automation delivery tracker

Updated: 2026-10-30. Execution companion to `MASTER-AUTOMATION-PLAN.md`, not a replacement for `IMPLEMENTATION-STATUS.md` or evidence of live acceptance. Role owners below are proposed responsibilities; assign named owners during P0. Every unaccepted browser workflow stays paused in the dashboard; legacy use requires non-overlapping ownership.

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
| P3 | Intake receipts, deployed catalog/review/activation and queue UI implemented; owner guided 2-rule catalog pass recorded; cache gated and Sheet delivery unwired | Full business rule matching/approval, operator/cross-business/concurrent live acceptance, cache/application/ownership acceptance, automated reconciliation, authenticated content approvals, writeback deliverer and real Sheet delivery/conflict acceptance |
| P4 | Monitoring source, deployed date-cohort protocol/UI, offline preflight and durable monitoring-result replay implemented; live acceptance pending | Real filesystem/worker recovery acceptance, latest-100 policy, pairing/selector/real concurrency and supervised pilot acceptance |
| P5 | Durable publish-job queue applied as hosted `20261030164110`; browser publishing paused | Reviewed publisher/adapter, media, explicit release and live pilot |
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
| F10 | Account onboarding unconnected | P6 worker + operator | Genuine authorized onboarding, resumable stages |
| F11 | Identity/location/OTP handoff unconnected | P6 worker + operator | No fabricated identity or challenge bypass |
| F12 | Onboarding choices/consent unconnected | P6 worker + operator | Explicit genuine preferences and consent |
| F13 | Credential/login recovery unconnected | P6 worker | Protected local references, truthful login-needed results |
| F14 | Text draft/approval foundations; no publisher | P5 web + worker | Exact approved revision/target and captured publication |
| F15 | Media publishing unconnected | P5 worker + web | Rights, actual bytes, allowed paths/origins/types |
| F16 | Attachment fallback/cleanup unconnected | P5 worker | Verified order/attachments, bounded transient files |
| F17 | Audience execution unconnected | P5 worker | Actual audience selection verified; unknown fails closed |
| F18 | Legacy target-found behavior not accepted | P5 worker | Found != newly published; exact identity attribution |
| F19 | Explicit post-edit workflow unconnected | P6/P7 web + worker | Selected exact post/revision, fresh approval |
| F20 | Explicit post-delete workflow unconnected | P6/P7 web + worker | Exact target, permission, destructive confirmation |
| F21 | Moderation/block workflow unconnected | P6/P7 web + worker | Explicit targets/confirmation; never implicit mass blocking |
| F22 | Service-area ownership not signed off | P0/P3 web + operator | Approved mapping; area != verified residence |
| F23 | Listing drafts exist; no publisher | P5 web + worker | Typed price/category/media and exact listing capture |
| F24 | Operational listing evidence unconnected | P5 worker | Clean exact URL, scoped evidence, no appended metrics |
| F25 | Legacy account unread badge not per-post comments | P4/P6 worker | Correct account-level label, no false association |
| F26 | Preset/group flow unresolved; not enabled | P0/P7 operator + worker | Demonstrated permitted explicit destinations; user disposition |
| F27 | Supervised browsing not dashboard-connected | P6 worker | Bounded session, stop/recovery; not visibility evidence |
| F28 | Random/artificial engagement excluded from proposed automation | P0 operator | Explicit disposition recorded; no silent migration |
| F29 | Legacy navigation preserved; live adapters unvalidated | P4/P5 worker | Known UI fixtures; unknown/challenge states stop safely |
| F30 | Monitoring queue/session foundations only | P4–P7 backend + worker | Real contention, cross-type profile exclusion, pause/revoke recovery |
| F31 | Partial job/check events and results | P4/P5 web + worker | Real counters, accurate skipped/failed states, redacted diagnostics |
| F32 | Protected operational evidence not complete | P5 backend + worker | Access control, scoped capture, retention/deletion |
| F33 | Deployed durable writeback outbox protocol + explicit dashboard queue/cancel UI (hosted `20261029180253` + `20261029180528`); delivery to any real Sheet unwired | P3 deliverer + connector | Stable IDs, conflicts, durable outbox and replay |
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
| N08 | Writeback outbox deployed and smoke-tested; no Sheet write path yet | P3 deliverer + connector | Independent retry, version conflict and row-move tests on a real Sheet |

For each completed item append: source change, exact test command/result, target environment, deployed migration/version if applicable, live pilot evidence if approved, operator acceptance, and remaining limits. Do not turn proposed ownership or a passing fixture into sign-off.
