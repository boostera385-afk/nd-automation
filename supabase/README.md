# Supabase project setup

## Current requested target

Project: `xtefjnfdjnxwrpkoydaj` — selected as the single shared Fudge/dashboard backend on 2026-10-28.
URL: `https://xtefjnfdjnxwrpkoydaj.supabase.co`.

**Intake schema deployed; full acceptance remains pending.** Project-scoped OAuth MCP
with approved database/Edge Function capabilities is configured in both `opencode.json` files. Verify
`get_project_url` after reconnection; the previous runtime connection was scoped
to the superseded project. Open `/mcps` if authentication is needed, or `/reload`
if the catalog needs refreshing. No personal access token is stored in configuration.

Latest read-only verification (2026-10-28): MCP URL matches this target; six existing
migrations, 17 RLS-enabled public tables and 29 matching source function bodies
were checked. Existing local URL/key pair was verified and only the stale local pin
was corrected. See `docs/P1-HOSTED-REVIEW.md` for findings and remaining gates;
this is not full Auth, recovery, worker or production acceptance.

This supersedes the earlier target `tyczcognqypqxrvkbmrk`. Do not use a second
project for Fudge ingestion or copy data between projects. Earlier applied-migration
records for `xtefjnfdjnxwrpkoydaj` are historical evidence only; preserve and inspect
its current state. Do not delete or repurpose the other project without approval.

## Safe handover order

1. Verify the connected MCP project URL is exactly the requested target.
2. Inspect existing tables, migrations and security/performance advisors before
   making changes. Preserve all pre-existing data and application schemas.
3. Compare existing migration history with repository SQL; review and apply only
   missing, approved migrations in dependency order. Do not reset a database or
   blindly run `db push`: historical hosted versions differ from source filenames,
   and the publishing protocol is still an undeployed implementation-stage slice.
4. Obtain the selected project's **publishable key** through its verified project
   connection. A personal access token is not a client key; service-role keys are
   forbidden in the web app and worker.
5. Update the ignored `apps/web/.env.local` URL and publishable key together, keeping
    `SUPABASE_EXPECTED_PROJECT_REF=xtefjnfdjnxwrpkoydaj` only after verifying the pair.
    Do not change the existing local pin just to bypass the current connection block.
   Modern publishable keys are opaque: the guard does not prove which project a
    key belongs to; retrieve the pair from the verified selected project.
6. Inspect existing Auth site/redirect URLs and email delivery; validate a genuine
    verified account. Preserve existing users and verify access rather than guessing IDs.
7. Create or explicitly restore authorized workspace access according to the user's
    decision. Configure `SHEET_SYNC_ORGANIZATION_ID` for the actual authorized workspace.
8. Inspect existing worker assignments/leases and confirm customer/profile mappings.
    Register or rotate credentials only when needed and authorized. Keep conflicting
    workers stopped during cutover and avoid overlapping browser execution.
9. Validate authenticated tenant isolation and a supervised read-only pilot before
   enabling broader operations. Keep the desktop and Fudge workflows unchanged.

## Source migrations

P2 intake is **deployed**: source `20261028203213_fudge_ingestion_v1.sql`, hosted
version `20261028203642`. As of 2026-10-30 there are **14 applied migrations** and
**28 public RLS-enabled tables**. See `docs/DB-DEPLOYMENT-20261028.md`,
`docs/DB-DEPLOYMENT-20261030-VERIFIED-ACCESS.md` and
`docs/DB-DEPLOYMENT-20261030-COHORT.md` for verification and the remaining
release/acceptance gates. Do not apply the older per-user Fudge SQL as an intake
shortcut. The publishing protocol is deployed as a durable queue only; no submit
adapter or upload release is enabled. Extension uploads stay off.

| Source file | Scope |
|---|---|
| `202610260001_reporting_foundation.sql` | Reporting ledger, auth-linked memberships, sessions, RLS |
| `202610270001_post_checks_and_notifications.sql` | Sourced checks and notifications |
| `202610270002_monitoring_worker_bridge.sql` | Credential-scoped monitoring protocol |
| `202610270003_worker_bridge_indexes.sql` | Covering indexes and schema comments |
| `202610270004_content_drafts.sql` | Drafts, immutable revisions, human approval |
| `202610270005_profile_inventory.sql` | Staff-maintained UUID/name/group claims |
| `202610270006_publish_jobs.sql` | Publishing protocol, applied as hosted `20261030164110`; queue only, no submit adapter |
| `20261028203213_fudge_ingestion_v1.sql` | Applied workspace-scoped raw intake and immutable revisions (hosted `20261028203642`) |
| `20261030155515_verified_access_v1.sql` | Applied verified-email/session hardening (hosted `20261030155727`) |
| `20261030164030_check_cohort_v1.sql` | Applied prior-date check cohort protocol (hosted `20261030164030`) |

Use MCP `apply_migration` for reviewed DDL, not raw SQL. Change the initial
read-only MCP mode only after target/schema review and explicit deployment
approval. Never copy migration history from another project as if it were applied.

## Validation

Before hosted inspection, run `npm.cmd run check:readiness` from `apps/web`.
This offline command prints only fixed redacted configuration findings and makes
no network calls. Exit 1 identifies local prerequisites; exit 0 does not verify
the key's project ownership, database/Auth, worker or production readiness. See
`docs/P0-DISCOVERY.md` and `docs/IMPLEMENTATION-TRACKER.md` for the current gates.

Repository tests exercise migrations with local Postgres/PGlite. They do not prove
new-project readiness. After each approved hosted migration verify RLS, table/RPC
privileges, tenant boundaries, invalid-credential rejection and advisor notices.
Record exact hosted versions and remaining acceptance gaps in
`docs/IMPLEMENTATION-STATUS.md`. There is no destructive rollback script here;
plan data-preserving recovery before applying schema changes.
