# Cohort and publish-job protocol deployment — 2026-10-30

## Authority and target

The user directed: "select and implement with best practices … fully controls and
error free implement and fix all," after the full-chain readiness audit. That
authorized the two additive protocols that were still drafts/undeployed. It did
**not** authorize Fudge upload release, real browser publishing, Sheet write
delivery, worker pairing or live jobs; those remain gated below.

Applied to the existing shared project `xtefjnfdjnxwrpkoydaj` through Supabase
MCP `apply_migration`. No reset, history repair, wholesale migration push or
historical source-file edit occurred.

| Item | Cohort | Publish jobs |
| --- | --- | --- |
| Source | `supabase/migrations/20261030164030_check_cohort_v1.sql` (promoted from `supabase/drafts/check_cohort_v1.sql`) | `supabase/migrations/202610270006_publish_jobs.sql` |
| Applied name | `check_cohort_v1` | `publish_jobs_v1` |
| Hosted version | `20261030164030 check_cohort_v1` | `20261030164110 publish_jobs_v1` |
| New public tables | `reporting_check_cohorts`, `reporting_check_cohort_items` | `reporting_publish_jobs` |
| New functions | 2 public wrappers, 3 private helpers | 5 public + 1 private helper |

Source/hosted version mapping is recorded because the publish-jobs source file
retains its original review timestamp `202610270006` while the hosted row uses the
apply time. This follows the verified-access precedent (`20261030155515` source,
`20261030155727` hosted).

## What changed

### Cohort ("Check yesterday")

- New staff-only protocol for an explicit prior business date and publication
  kind (`posts`, `listings`, `both`), bounded to 500 tracked publications.
- Replays are idempotent per `(organization, request_id)`; conflicting replays are
  rejected. Rate limit: 6 requests per user per minute per organization.
- Requires a verified owner/admin/operator, an active work session started within
  the last 10 hours, and an unchanged publication target snapshot.
- Every tracked member receives a disposition: `queued`, `active_job`, `recent`,
  `unsupported_link`, `not_authorized` or `worker_unavailable`. Missing or
  unknown-date posts are never substituted.
- Creates only normal pending check jobs; it does not enable a profile, start a
  browser or bypass worker claim/complete.
- Unlocks `/dashboard/run/cohorts`; its notice still says a queued job is not a
  completed observation.

### Publish jobs

- Durable one-job-per-approved-revision queue with unique
  `(draft_id, draft_revision)`; re-publishing requires a new approved revision.
- Enqueue requires an approved draft revision, an unchanged binding/assignment,
  an enabled worker and an active staff session.
- Claim is worker-token authenticated, one browser operation at a time across
  check and publish jobs, 10-minute lease. Completion is lease-bound,
  replay-idempotent and validates the exact outcome fields.
- A submitted result must carry the canonical Nextdoor post URL and an explicit
  timezone publication time within the lease window; the URL type must match the
  approved content. Duplicate URLs become `needs_reconciliation`, never a silent
  second publication.
- Expired leases can only be reconciled to `needs_reconciliation`; there is no
  automatic retry.
- Adds `worker_publish` to publication sources and `publish_result` to
  notification kinds.

## What is deliberately still not enabled

- **No publish adapter exists in the bundled worker.** `reporting_enqueue_publish`
  is granted but no dashboard action calls it, and the worker does not claim
  publish jobs. Queueing alone never launches a browser.
- **Fudge uploads remain released-off** (`UPLOAD_RELEASED = false`).
- **Sheet writeback delivery remains inactive.** The outbox and enqueue/cancel RPCs
  exist, but `integrations/sheets/reporting-sync.gs` accepts only
  `getPostRecords`/`getTaskRows`; there is no write action or delivery worker.
- **No worker is online.** The single registered worker has never heartbeated and
  all work sessions are closed; live dispatch needs pairing, an active session and
  operator supervision.
- **No publication, cohort or publish-job rows were created** by the deployment.

## Validation performed

- Dashboard typecheck, lint, test and production build: see the current
  `IMPLEMENTATION-STATUS.md` entry for exact counts.
- Hosted post-deploy checks: 3 new tables present with RLS enabled and 3 staff-read
  policies; 28 public base tables all RLS-enabled; cohort/public and publish/public
  function counts match the source; `reporting_complete_publish` retains the
  `\d{4}` timestamp regex after transport; publication-source and
  notification-kind constraints include the new values.
- Cohort table counts remain zero; publish-job counts remain zero.
- New tables inherit default privileges only through explicit grants; `authenticated`
  receives `select` with staff-scoped RLS, and `anon` receives nothing.
- Real signed-in cohort execution and publish claim/completion were **not** run on
  the hosted project; they require an authenticated browser session, live worker
  and real publications. Local PGlite coverage is recorded in the status entry.

## Remaining rollout

1. Load real tracked publications (Master Sheet import or Fudge capture).
2. Pair the worker, start a work session and supervise a real check batch.
3. Decide and document the Fudge upload release gates.
4. Build the publish adapter and pass supervised acceptance before exposing an
   enqueue action.
5. Extend/deploy a Sheet write action and delivery worker before any writeback is
   claimed as delivered.
6. Enable leaked-password protection and complete signed-in production acceptance.

Any rollback must be a separately reviewed additive change; do not reset the
database or delete applied migration history.
