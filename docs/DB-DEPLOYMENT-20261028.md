# Shared database deployment — 2026-10-28

## Applied and verified

Target was reverified through MCP as `https://xtefjnfdjnxwrpkoydaj.supabase.co`.
User explicitly authorized database setup/migrations. Six existing migrations and
17 RLS-enabled public tables were inspected and preserved; no reset, history
repair, existing-row update, user creation or membership change was performed.

| Hosted version | Migration | Source |
| --- | --- | --- |
| `20261028203642` | `fudge_ingestion_v1` | `supabase/migrations/20261028203213_fudge_ingestion_v1.sql` |

The source filename was generated using `npx.cmd --yes supabase@2.122.0 migration
new fudge_ingestion_v1`. The reviewed draft was promoted into that file and tested
before applying via MCP `apply_migration`. MCP assigns its own hosted timestamp;
this mapping is intentional. Do not blindly `db push` the directory: the six
historical sources also have different hosted timestamps, and publishing is
deliberately undeployed. No direct changes to migration history were made.

Added only the raw identity/revision tables, indexes, staff-read RLS and guarded
intake RPC. Original payloads remain client-append-only. No new extension, bucket,
cron schedule, public storage, service-role credential or Edge Function was needed.
The extension already targets the authenticated RPC; an extra HTTP wrapper would
not remove the need for database authorization and would add another API surface.

## Verification actually run

- Before deployment: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`:
  PASS, **521 tests / 30 files**, including the 55 intake tests against the promoted
  migration. `npm.cmd run build`: PASS.
- Hosted history confirms seven applied migrations. Public table count is 19,
  with **zero public tables lacking RLS**.
- New tables allow authenticated SELECT under workspace staff RLS; anon SELECT
  and authenticated direct INSERT/UPDATE/DELETE are denied.
- Public intake wrapper is SECURITY INVOKER; private guarded implementation is
  SECURITY DEFINER. Both have a fixed empty search path, authenticated EXECUTE
  only, no anon EXECUTE. Validator grants no client EXECUTE.
- All three hosted function-body SHA-256 hashes match the source after identical
  line-ending/space normalization. No source-to-hosted drift was observed.
- `supabase/tests/fudge_ingestion_hosted_smoke.sql` executed through MCP: PASS for
  accepted intake, complete receipt/replay deduplication, changed revision,
  original preservation, cross-workspace/nonmember/anonymous denial, direct-write
  denial, RLS-hidden fixture and atomic failure. All fixture inserts were enclosed
  in a transaction and **rolled back**; final records/revisions are both zero.
  It uses existing verified staff claims at SQL level; it is not a real Auth login,
  REST/JWT delivery test, real collector upload or multi-connection contention test.
- Security/performance advisors rerun after deployment. Security findings unchanged:
  3 anon and 21 authenticated SECURITY DEFINER warnings for existing RPCs; private
  credential table no-policy INFO; leaked-password protection still disabled.
  Unused-index INFOs increased from 21 to 23 (two new intake indexes). Retained
  coverage indexes; no blanket permission revocations to hide warnings.

References: [security-definer review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
[unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Remaining boundaries

- `202610270006_publish_jobs.sql` is **not deployed**. Its documented prerequisite
  is real submit-adapter review; it replaces monitoring claim/revoke/reassignment
  functions and exposes new publish RPCs. Applying it is not merely inert table
  setup. Complete that review and add explicit release/acceptance gates first.
- Fudge `UPLOAD_RELEASED` stays false. No historical upload, publication,
  customer-browser/profile operation or Sheet write was performed.
- Backup availability and restore drill, retention/deletion/storage-pressure
  policies, real browser/Auth/REST acceptance and concurrent PostgreSQL tests remain
  unverified. No backup/export or paid resource was created or claimed.
- P3–P8 schema is not invented in advance: approval/Sheet ownership and remaining
  worker contracts need implementation and tests. P2 and P8 are not complete.

## Data-preserving recovery

Leave intake release off if acceptance fails. Preserve existing raw records and
revisions; do not drop tables or replay old migrations. For a security incident,
use a separately reviewed migration to revoke intake EXECUTE on the public and
private entry points, then investigate. This report is not a tested backup/restore
procedure and does not authorize data deletion. No destructive down migration is
provided.
