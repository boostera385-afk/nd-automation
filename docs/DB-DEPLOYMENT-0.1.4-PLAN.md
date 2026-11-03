# 0.1.4 database and web rollout plan

**Execution update (2026-11-03):** the operator subsequently approved and directed
applying 003–007 to this test database despite unverified backup/PITR availability.
All five are now applied with individual hosted smoke tests passed; see
`DB-DEPLOYMENT-20261103-0.1.4.md` for actual hosted versions and the recovery
limitation. **Web deployment is not authorized/performed by that migration request.**
The remainder below is the original reviewed plan, not a statement that the
migrations are still pending or that production recovery prerequisites were met.

**No migration or deployment has been performed by this plan.** Source is 0.1.4.
Read-only inspection on 2026-11-03 confirmed production web 0.1.1 and 23 hosted
migration records, ending with `20261102154039 publish_dispatch_guard`. Target is
the existing project `xtefjnfdjnxwrpkoydaj`, not a new/paid project. Reconfirm the
target and state immediately before applying anything.

## 1. Approval and preflight

Obtain explicit approval for the five named migrations and the reviewed web
candidate. This does not authorize publishing, account actions, Sheet delivery,
worker registration, fixture data writes or any destructive restore.

- Confirm current production deployment identity and retain its rollback target.
  Do not deploy from repository root: the existing Vercel project deploys from
  `apps/web`. Follow `DEVELOPMENT.md`; inspect current CLI help/docs before use.
- Verify the current hosted history, schema and affected function definitions
  against source. Hosted timestamps differ from historical source filenames;
  map by reviewed name/content, never blindly push or repair migration history.
- Record source SHA-256 hashes, hosted function definitions/grants/policies and
  migration versions in a private release record. Do not export customer data or
  secrets into this public repository.
- Read current database/Auth/API logs and security/performance/health advisories.
  Investigate new critical failures. The historically disabled leaked-password
  protection remains an explicit security review gate, not an assumed fixed item.
- Confirm recent recoverable backup/PITR availability and operator-approved
  recovery procedure. Do not assume the plan's existence proves a usable backup;
  do not create paid backup resources or run restore without separate approval.
- Stop runners through their supported controls; check pending/leased jobs, active
  sessions and unresolved local journals without deleting or reconciling them.
  Pause approval/queueing during the rollout; do not close users' sessions silently.
- Run local typecheck, lint, tests and build. Existing PGlite tests exercise the
  actual migrations and each catalog smoke immediately after its corresponding
  migration, before later migrations can hide ordering errors.

**Stop** for wrong target, drift, changed migrations, outstanding work without an
approved pause/drain plan, missing recovery evidence, failed local checks or
unreviewed security issues. Missing prerequisites are blockers, not permission to
skip gates. The read-only baseline found no active browser/publish jobs, but it
must be repeated at rollout time.

## 2. Apply exactly one source migration per approved operation

Use the approved migration mechanism to record a single migration each time;
with the available Supabase MCP this is one `apply_migration` call per file.
Do not run `db push`, replay historical files, modify hosted history, concatenate
all five files or deploy web midway through this sequence.

After each application: re-read hosted history; require exactly one expected new
record, compare installed definitions/grants/policies with that source, run the
corresponding smoke file **on the hosted target**, then check errors/advisories.
Only continue after all results are recorded as passed. Record the actual hosted
version; do not assume it will equal the source filename timestamp.

| Order | Source under `supabase/migrations/` | Individual smoke under `supabase/tests/` | Important review |
|---|---|---|---|
| 003 | `202611020003_publish_scheduling.sql` | `publish_scheduling_hosted_smoke.sql` | Due/deadline columns, bounded constraint, RLS/read-only batch table, staff enqueue/private claimant grants. |
| 004 | `202611020004_automatic_sheet_mapping.sql` | `automatic_sheet_mapping_hosted_smoke.sql` | Three RLS/read-only tables, two event triggers, staff-only mapping controls and private helpers. Mappings remain opt-in; inspect any unexpected rows/intents. |
| 005 | `202611020005_approved_media.sql` | `approved_media_hosted_smoke.sql` | Strict descriptors, separate media-capable claimant, old claimant capability gate and private helper grants. No storage bucket or upload is created. |
| 006 | `202611020006_browser_task_receipts.sql` | `browser_task_receipts_hosted_smoke.sql` | Public scoped-token completion wrapper/private predecessor, exact replay conflict and cancelled-lease rejection. |
| 007 | `202611020007_supervised_workflows.sql` | `supervised_workflows_hosted_smoke.sql` | Separate supervised claimant, staff-only enqueue/version, hidden helpers, kind constraint and strict result trigger. |

Reviewed source SHA-256 values (raw checkout bytes, 2026-11-03):

| Source suffix | SHA-256 |
|---|---|
| `003_publish_scheduling.sql` | `fbb0a8a1a6855fc73c866fcfffd0a8bbccd71277f5a764187481a0db7b0d39b7` |
| `004_automatic_sheet_mapping.sql` | `4c181c38f03d6fd78131f455905c72bc9d4add303b625925b01eba056102b04c` |
| `005_approved_media.sql` | `04001815c1db527506c14feee701c145e10c8964f9c95330fd3522e74c9423a9` |
| `006_browser_task_receipts.sql` | `8067402c622b472464cfc64a52ffa2dd30c507428bd0628e02966a4e96485c0d` |
| `007_supervised_workflows.sql` | `63b9597bed28df937e3e8e29f9e3ea21f83acc1d47dce7e2b4b2631727f07f47` |

Recompute before approval/application; investigate any difference, including line
ending changes, instead of silently replacing the approved hash. These hashes
identify reviewed inputs, not proof of successful hosted application or a signed
release. Compare installed function bodies and privileges separately.

These smoke scripts use read-only transactions and no application fixtures, claim
calls or browser/network actions. An error must halt the procedure; rollback the
failed read-only transaction before further inspection. A catalog smoke is **not**
proof of verified-user RLS behavior, scoped-token checks, deployed RPC visibility
or real browser compatibility. The local behavior suite covers those database
contracts with synthetic identities; do not mislabel it hosted acceptance.

Before promotion, separately verify the approved hosted read-only role/access
checks with real authorized identities, including another tenant/customer and
anonymous denial. Recheck API schema visibility after `NOTIFY pgrst` without
calling mutation/claim RPCs. If the required identities are unavailable, promotion
is blocked pending explicit review—not silently passed. Rollback-only hosted
fixture writes, if desired for behavioral acceptance, need their own reviewed
script and explicit production-write approval; none are authorized here.

Expected history after all five successful applications: **28 records**, assuming
no concurrent approved migration changed the baseline. Any unexpected count/name
is a stop, not an invitation to fix history automatically.

## 3. Deploy only after all hosted gates pass

- Review the exact working tree and release contents; exclude environments,
  private worker state, customer exports and local screenshots. The existing
  `.vercelignore` is part of the release safety boundary.
- Re-run web checks for the final candidate; confirm package/lock identity 0.1.4.
- Deploy manually from `apps/web` to the existing Vercel project only after explicit
  approval. Do not create a new project, alter environment variables or reactivate
  Google connectors as a side effect. Commit/push is a separate approval.
- Require READY, verify generated/production alias identity, then run
  `npm.cmd run check:deployment -- https://nd-automation-dashboard.vercel.app`.
  Fetch the footer and require 0.1.4 and the exact new deployment ID.
- Perform user-present authorized sign-in/read-only route/isolation checks. Confirm
  missing dependencies fail closed, no jobs were silently queued and no worker,
  browser, account or Sheet operation ran merely from deployment or page views.
  Do not advertise live readiness on the basis of the version footer.

## 4. Failure and recovery

- Failed migration: stop the sequence. Re-read history/definitions to determine
  whether it committed before retrying; never assume a lost response means no
  change. Do not rerun non-idempotent `CREATE`/`ALTER ... SET SCHEMA` blindly.
- Committed migration with failed smoke: keep web on 0.1.1 and runners stopped;
  inspect drift/errors and prepare a separately approved forward fix. Do not
  proceed to the next migration merely because application returned success.
- Failed web promotion: restore the previously recorded web deployment using the
  approved hosting rollback path. Leave additive database objects intact; inspect
  compatibility before resuming any old worker. Keeping the old web does not
  guarantee the changed database functions are compatible with all old clients.
- No destructive down migration, dropped tables, deleted receipts, journal reset,
  token rotation, session closure or backup restore without specific approval.
  Preserve uncertain-action evidence; restore cannot make external browser actions
  disappear. Existing desktop code/launchers remain available but must not overlap
  with a worker on the same profile.

## Current platform documentation reviewed

- [Explicit Data API grants (enforced 2026-10-30)](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): new tables in 003/004 already grant staff SELECT explicitly; smoke verifies those grants plus RLS.
- [TLS cipher retirement (earliest 2026-11-10)](https://supabase.com/changelog/cbc-tls-ciphers-deprecated): include supported OS/TLS runtime in subsequent worker acceptance; do not weaken TLS to accommodate old clients.
