# Master automation delivery tracker

Updated: 2026-10-28. Execution companion to `MASTER-AUTOMATION-PLAN.md`, not a replacement for `IMPLEMENTATION-STATUS.md` or evidence of live acceptance. Role owners below are proposed responsibilities; assign named owners during P0. Every unaccepted browser workflow stays paused in the dashboard; legacy use requires non-overlapping ownership.

## Phase gates

| Phase | State | Next deliverable / dependency |
| --- | --- | --- |
| P0 | In progress | Confirm Source/ND Master mapping and policy decisions in `P0-DISCOVERY.md`; feature inventory below |
| P1 | Read-only hosted baseline verified; acceptance/recovery pending | See `P1-HOSTED-REVIEW.md`; six existing migrations preserved, target URL/key verified; real login/isolation, recovery and Sheet setup gates remain |
| P2 | Intake schema deployed; Auth/MV3 queue implemented; release off | Hosted `20261028203642`, rollback-only smoke PASS; see `DB-DEPLOYMENT-20261028.md`. Real-browser/REST/concurrency acceptance, retention/deletion and pilot remain; no real source uploaded |
| P3 | Intake receipts, catalog preview, local catalog SQL protocol and gated cache implemented; remaining bridge incomplete | Catalog migration promotion/deployment, dashboard write/activation UI, live cache/application/ownership acceptance, automated reconciliation, authenticated content approvals, durable writeback and conflict tests |
| P4 | Partial existing monitoring source; live acceptance pending | Pairing/selector validation, dated-cohort one-click refresh and latest-100 policies |
| P5 | Local protocol only; browser publishing paused | Reviewed publisher, media, durable submit journal, explicit release and live pilot |
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
| F33 | Separate read-only Sheet connector; writeback missing | P3 backend + connector | Stable IDs, conflicts, durable outbox and replay |
| F34 | Setup guides/assets exist; acceptance pending | P3 connector | Non-destructive versioned setup; legacy aliases preserved |
| F35 | Theme/settings foundations; connections unverified | P1/P4 web + worker | Real target/machine checks without exposing secrets |
| F36 | Desktop launchers preserved; worker operations incomplete | P4/P8 worker | Versioned install/update/drain/restart/rollback |
| N01 | Publication ledger foundation | P3/P5 backend | Sourced time/customer/exact URL; unknown stays unknown |
| N02 | Planner foundation; no accepted one-click cohort action | P4 web + backend | Publish 100 today, next-day click queues eligible exact links once |
| N03 | Observation/check history foundation | P4 web + worker | Staleness, evidence, technical failure != removal |
| N04 | Manual comments + partial worker collector | P4 worker + backend | Exact-post stable IDs, partial/completeness, unknown totals |
| N05 | Reporting foundations | P4/P8 web | Date cohorts, DST, true coverage and partial-data indicators |
| N06 | Auth/RLS source; new target unverified | P1 backend | Genuine login, tenant/customer negative access tests |
| N07 | Refresh/reconciliation partially prepared | P4 web + backend | Explicit refresh freshness, deduplicated active jobs, missing-link recovery |
| N08 | Read-only Sheet sync; no writeback | P3 connector + backend | Independent retry, version conflict and row-move tests |

For each completed item append: source change, exact test command/result, target environment, deployed migration/version if applicable, live pilot evidence if approved, operator acceptance, and remaining limits. Do not turn proposed ownership or a passing fixture into sign-off.
