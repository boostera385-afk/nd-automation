# Desktop-to-dashboard parity roadmap

## Direction and current status

Sheet-first UI follow-up (2026-10-27): five daily destinations replace the long
staff menu; advanced routes remain available through Settings / More. Master Sheet
has safe all-tab metadata previews and explicit mapped post-link sync. Profiles
saves one-time bindings reused across imports; Run supports explicit monitoring
batches and recent progress. Results unifies saved links/checks/comments/problems.
The separate connector update is not live-deployed. Desktop execution/writeback
gaps below remain; see `SHEET-FIRST-WORKFLOW.md` for the actual working boundary.

The requested product direction is to manage the existing desktop workflows from the browser dashboard without silently losing functionality. The user authorized updating `AGENTS.md` for a phased migration; this is not a claim that the functionality is implemented. Sensitive or unverified legacy behavior still requires an explicit, safe disposition.

The detailed requirements and F01–F36 inventory remain in `ND-AUTOMATIONS-DASHBOARD-IMPLEMENTATION-PLAN.md`. This roadmap tracks the gap at a feature-family level; it does not replace individual feature sign-off.

| Feature family | Desktop source | Dashboard status | Remaining work |
|---|---|---|---|
| Incogniton connection and profiles | `core/automation/incogniton_manager.py`, `profile_builder.py`, `gui/views/bulk_create_view.py` | Staff-maintained profile inventory (UUID/name/group claims, staged 2026-10-27); no local API connection yet | Live readiness/health probes, approved create/launch/stop actions, duplicate-name resolution end-to-end, worker-reported reconciliation and tests |
| Cookies and proxies | `core/automation/cookie_importer.py`, `gui/views/bulk_cookies_import_view.py`, `bulk_proxies_import_view.py` | Not implemented | Secure local handling, validation, previews, explicit replacement confirmation, redacted results and tests |
| Account onboarding | `core/automation/nd_account_creator.py`, `gui/views/nd_acc_creation_view.py` | Not implemented | Authorized onboarding, genuine data, secure credentials and human verification handoff |
| Posting and listings | `core/automation/auto_poster.py`, `auto_listing.py` and corresponding views | Manual publication records + text-only draft/approval foundation (`/dashboard/content`, staged 2026-10-27) | Controlled publish worker jobs (none exist yet), attachments, schedules, exact result capture and duplicate reconciliation. Approval currently authorizes nothing to run. |
| Preset/random posting and warmup | `core/automation/auto_random_poster.py`, `auto_warmup.py` and corresponding views | Not implemented | Inventory and demonstrate actual supported behavior; explicit disposition for random engagement and unverified group selection |
| Automatic post checks and comments | Existing browser navigation and profile adapters | Manual checks, observations and comments only | Exact-post worker, conservative evidence-based classification, comment collection and pilot; see `AUTO-CHECK-WORKER-DESIGN.md` |
| Google Sheets | `core/services/sheets_service.py`, `core/assets/apps_script.js`, `gui/views/script_view.py` | Separate read-only sync implemented; live setup unverified | Authenticated connector, stable row identity, controlled writeback, retryable outbox and staging tests |
| Work sessions, settings and operation | Desktop engine, launchers and views | Reporting sessions and theme implemented; not worker controls | Worker install/update, heartbeat, work-session dispatch, job progress, safe cancellation, recovery and rollback |
| Customer reporting | Not a direct desktop equivalent | Reporting foundation implemented; authenticated acceptance pending | Validate real staging auth, isolation, data, reports and remaining delivery/access features |

## Delivery order and gates

1. **Inventory and safety:** reconcile the approved scope; assign each F01–F36 item a test and a replacement or an explicitly approved disposition. Confirm authorized accounts, staging project, machine and sheet. Never copy local credentials or customer exports into the public repository.
2. **Worker foundation:** build a separately runnable local agent, scoped and revocable pairing, heartbeat, allowlisted job types, durable leases and profile ownership. No arbitrary remote code, exposed local control port or service-role key.
3. **Read-only monitoring:** test exact-post checks and comments on authorized examples, keep uncertain outcomes distinct from removal, and validate a small pilot before the planned 20-publication acceptance test.
4. **Publishing and listings:** add responsive preview/approval flows, controlled job execution, exact result capture, safe retries and follow-up checks. Test with fixtures before an explicitly approved live pilot.
5. **Remaining operational parity:** implement approved profile, onboarding, proxy, cookie, settings and controlled legacy workflows; verify each F01–F36 disposition. Manual verification and destructive operations require explicit human control.
6. **Cutover:** test tenant isolation, recovery, Pacific/DST boundaries, sheet synchronization, rollback and operator usability. Keep the desktop app available until each replacement is signed off; never run overlapping jobs on the same profile.

No migration has been applied for this roadmap. No worker, live browser control, posting, account creation or other missing operation is enabled by this document. No UI label should imply otherwise.

Implementation follow-up: `apps/worker/monitor.py` now provides a standalone,
opt-in local monitoring pilot with unit/mock tests, not the integrated automated
dashboard workflow. See `apps/worker/MONITORING.md` for required selectors and
explicit gaps. The monitoring row above still describes the dashboard gap.

Subsequent bridge implementation: `apps/worker/agent.py`, `/dashboard/automation`
and migration `202610270002_monitoring_worker_bridge.sql` now implement the initial
read-only dashboard connection, session-driven queue and result protocol in source.
This supersedes the monitoring-connection gaps above **at code level only**;
staging application and live acceptance remain deferred. See `WORKER-BRIDGE.md`.
Publishing, profile/account creation, cookie/proxy tools and Sheet writeback still
need implementation; no full F01–F36 sign-off is claimed.

Hosted DB follow-up: the worker bridge and six covering-index migration are now
applied to staging with explicit approval (versions `20261027185858` and
`20261027190052`). This supersedes the earlier staging-application blocker, not
the remaining pairing, selector validation, UI/live acceptance or parity gaps.

Content follow-up: the draft/approval migration is applied (`20261027200411`).
Drafts are bound to explicit worker-profile assignments with immutable
revision/target snapshots. There is **no publish job type** yet; connecting an
approved draft to a worker publish flow is the next gated step and must reuse
the audited legacy flows with fixed result capture (see plan §2.3 defects 1–6).

Subsequent protocol: `202610270006_publish_jobs.sql` is now applied as hosted
`20261030164110 publish_jobs_v1` (2026-10-30). It implements durable approved-revision
jobs, immutable snapshots, cross-type leases and exact result capture with
duplicate/ambiguity guards, but the bundled agent has no publishing support and no
enqueue action is exposed. `/dashboard/publishing` is inspection only. See
`PUBLISHING-PROTOCOL.md` and `DB-DEPLOYMENT-20261030-COHORT.md`.
