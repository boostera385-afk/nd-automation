# Dashboard monitoring-worker bridge

## Delivery status

Implemented in source and locally tested; **the database migrations were applied
to the authorized hosted staging project on 2026-10-27**. Browser automation is
not validated on live Incogniton/Nextdoor. This adds read-only monitoring, not
full desktop parity. Publishing, listings, account/profile creation, cookies,
proxies, editing/deleting/blocking, and Sheet writeback remain unconnected.

Adjacent milestone: `/dashboard/content` provides staff-only draft + revision-bound
human approval bound to these same explicit assignments (migration `content_drafts`,
host version `20261027200411`). It creates **no** jobs and has **no** worker
protocol path — a future publish job type will reference an approved
(draft, revision) pair at creation time so edits after approval cannot change
what a worker was authorized to publish.

Hosted migration history records `monitoring_worker_bridge` as `20261027185858`
and `worker_bridge_indexes` as `20261027190052`. The latter corresponds to local
`202610270003_worker_bridge_indexes.sql` and adds six covering foreign-key indexes
plus explanatory database comments. Do not reapply either migration to this project.
No worker credentials, profile assignments or jobs were created during DB setup.

The earlier readiness audit predates this implementation. The integrated code
now consists of:

- `/dashboard/automation`: staff-only worker registration, explicit customer /
  profile UUID / account-label assignments, per-session monitoring authorization,
  worker heartbeats/revocation, replacement-worker reassignment, latest 100 jobs,
  pending cancellation and operator-confirmed expired-lease reconciliation.
- `supabase/migrations/202610270002_monitoring_worker_bridge.sql`: organization-
  scoped metadata, private credential hashes, durable jobs and allowlisted RPCs.
- `apps/worker/agent.py`: outbound HTTPS polling and scoped result submission,
  using the separately configured read-only browser adapter in `monitor.py`.

No service-role key, public local control server, Nextdoor API or arbitrary
remotely supplied code is used. Workers authenticate with a random 256-bit,
revocable credential through three narrow RPCs. Human requests still use verified
Supabase authentication and RLS. Credentials are stored hashed in a private table;
the browser shows the generated credential only in the registration response.

## Automatic monitoring policy

Code-first extension (2026-10-29): `/dashboard/run/cohorts` adds explicit
prior-business-date cohort requests in source, using the existing job/worker
contract. Its protocol is now applied as hosted `20261030164030 check_cohort_v1`
(2026-10-30); no worker or job ran from the deployment. Snapshot membership and
receipts are immutable; strict action/read/UI paths fail closed until setup. A
configurable 60–1440 minute explicit-refresh window
does not alter the scheduled 24-hour policy below. It never enables profiles,
changes sessions, reclaims expired leases or writes Sheets. Unknown dates and
unsupported/unmapped targets remain explicit, not replacement cohort members.
The latest-100-per-profile policy and mapped result writeback remain separate
unimplemented code. Offline `apps/worker/preflight.py` and pinned candidate
requirements now expose local prerequisites without claiming live readiness.

An operator starts a work session and explicitly enables each assigned profile.
This authorization belongs to that exact session and is not carried into a new
session. The connected agent plans up to 100 due jobs per poll, then claims one.
It runs serially and opens/closes the worker-owned profile for each job; grouping
multiple leased jobs into a single profile visit is not implemented in this agent.

- Only a matching customer, exact account label and explicit profile UUID qualify.
- Known publication dates must be before the current date in the customer's
  configured timezone (Pacific by default). Older due cohorts catch up naturally.
- Unknown publication dates remain unknown, but their explicit links qualify.
- Posts with a check in the last 24 hours are excluded, including failed checks.
  This is a daily policy, not an immediate automatic technical-failure retry.
- Imported `Posted` claims never establish visibility.
- Pause/End work, lost staff membership or a session older than ten hours blocks
  new claims. Already claimed reads may drain. Closed/expired sessions' pending
  jobs are cancelled before planning new jobs; pause preserves pending work.
- Disabling a profile cancels its pending jobs. Revocation rejects new claims
  and result submissions, but cannot force-stop a local browser operation.
- The agent itself exits after eight hours and requires an explicit restart.

The queue deduplicates pending/leased publications, allows one outstanding lease
per worker and one per profile, and uses a random lease token with a ten-minute
deadline. **Expired leases are not automatically retried.** An operator must
stop the old agent, inspect/close the profile and reconcile partial work before
releasing an expired lease in the UI. Do not treat that checkbox as a substitute
for actually checking the local machine.

## Results and data accuracy

Source hardening (2026-10-30): strict future lease budgets and boolean completion
receipts now gate the agent. A private flushed/atomic monitoring journal records
claim and observation before browser execution/backend submission respectively;
restart/result-only recovery replays the identical saved job/lease/result, never
the browser. Cleanup ambiguity and a claim with no result block new work. See
`apps/worker/README.md` for commands and remaining filesystem/operator recovery
limits. This is not a publishing journal or a live acceptance result.

Completion validates worker ownership, lease, allowed outcomes, bounded comments,
adapter fingerprint and observation time. Completion replay is idempotent for
the same job/lease. Check history, observation, comment deduplication, notification
and job completion commit together. Older worker observations do not overwrite
a newer observation/check summary.

Worker observation time must be within the lease window, with one minute of
backward and five minutes of forward clock tolerance; synchronize the worker
clock. Server completion time is stored separately on the job. Comments have
unknown platform creation times and explicit `auto_check` source. An author is
not inferred: `Author not collected` is used until author extraction is supported.
Initially rendered stable-ID comments only are collected; totals remain unknown
and collection is always partial. Existing comment text is not overwritten on
deduplication. History displays manual versus automatic provenance.

Confirmed deletion is deliberately not accepted from the automated adapter yet.
Removal-like notices require review, and technical failures never change post
visibility. See `apps/worker/MONITORING.md` for browser/selector limitations.

## Next phase: staged setup and live acceptance (not performed)

1. Database setup is complete for the authorized staging project: both the worker
   bridge and index follow-up migrations are recorded. For a different fresh
   project, review/apply its migrations separately with approval. Never reapply
   existing migrations or reset this database. Authenticated dashboard acceptance
   is still pending; schema application alone does not prove UI or browser success.
2. Verify a real login, assigned workspace and customer records. The prior deleted
   user does not regain its preserved workspace simply by signing up again.
3. Open **Automation control**, register the authorized machine and save its
   private JSON response as `apps/worker/.monitoring/worker.json`. The containing
   directory is Git-ignored. Protect the file with local OS permissions. Do not
   paste it into chat, commit it, or store it in browser localStorage. The modern
   `sb_publishable_` key is required; legacy anon JWT keys are not supported by
   this agent. Custom Supabase domains/local stacks need a reviewed URL policy.
4. Assign a real profile UUID, customer and the exact account label already used
   by the customer's stored post records. Stop legacy jobs for those profiles.
5. Configure a reviewed Python/Playwright environment compatible with Incogniton.
   No tested package/browser combination has been chosen on this laptop yet.
   Supply a validated local adapter at `.monitoring/adapter.json`; the example's
   empty selectors intentionally reject execution rather than guess results.
6. Dry-run (no network calls or browser operations):

   ```powershell
   cd apps/worker
   python agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json
   ```

7. Only for the approved pilot: start work, enable one assigned profile and run:

   ```powershell
   python agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json --execute --confirm-authorized --once
   ```

   Remove `--once` only after reviewing the pilot. The agent polls every 15 seconds
   for up to eight hours. Refresh the dashboard for job progress; the job list
   does not currently live-poll. Browser/connection/cleanup ambiguity stops the
   agent instead of rerunning browser actions. Result submissions alone retry
   up to three times, using the same idempotent job/lease.
8. Complete tenant/customer access tests, multi-connection claim contention,
   proxy/login/verification failures, close/pause/revoke races, machine shutdown,
   expired-lease recovery, timezone/DST fixtures and the 20-post next-day pilot.
   Unit/mock and single-connection PGlite tests are not these acceptance tests.

For a lost/exposed worker credential, revoke it, register a replacement worker,
stop the previous agent and reconcile outstanding leases. The UI can move an
assignment from a revoked worker to an enabled replacement only when there is
no outstanding profile lease. Monitoring is reset to off after reassignment.

## Sheets and remaining parity

The existing Sheet sync remains read-only and manually fetched/imported. After
authorized post references are imported and assigned, the worker can plan checks
from the reporting database. It does not read the raw legacy sheet or use its
credential-bearing response. Automatic recurring Sheet ingestion and authenticated
result writeback/outbox are not implemented by this migration. Do not replace
the desktop's live Apps Script or copy its secret URL into public configuration.

The report CSV timestamp header is now `last_observed_at_utc` (formerly
`manual_review_at_utc`) because results may be manual or automatic; the post-record
provenance header is `publication_source` (formerly `source`). Adjust any consumers.

This is an initial read-only bridge: no claim is made of full F01–F36 replacement,
live selector validation, encrypted local credential storage, distributed API
rate limiting, immutable evidence storage, full pagination, replies collection,
automatic service installation, or unattended production readiness. Keep the
desktop available until each remaining feature has its own tested replacement.

## Hosted setup verification and advisor notices

Verified through Supabase MCP: all three public worker tables and the private
credential table have RLS enabled; anonymous direct reads and authenticated direct
inserts are denied; the private credential table denies both anonymous and
authenticated reads. Staff RPCs are not callable by anon. The private credential
helper is executable by neither client role. All three public worker RPCs rejected
invalid credentials when executed under anon in a rolled-back transaction.

After the index follow-up, the performance advisor no longer reports the six
unindexed foreign keys. It reports unused-index INFO notices on this mostly empty
database; no indexes were removed. The security advisor still reports:

- Three intentionally [anon-callable SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), guarded by scoped worker credentials.
- Seventeen [authenticated SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), including the existing reporting functions; explicit authorization remains required inside each.
- One [RLS-without-policy INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the private credential table, which intentionally denies client access by default.

These notices are recorded, not suppressed or represented as a clean security
certification. Successful real-worker pairing, HTTP transport acceptance,
multi-client concurrency and live profile/comment checks remain unverified.
The preserved workspace currently has no memberships after the earlier approved
account deletion; no account was assigned a role as part of database setup.
