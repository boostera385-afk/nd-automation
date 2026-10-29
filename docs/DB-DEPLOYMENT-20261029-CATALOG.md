# Service catalog deployment — 2026-10-29

Explicit user authorization: shared Supabase database setup/migrations/deployment.
Target reverified as `xtefjnfdjnxwrpkoydaj`. Existing data, seven prior migrations,
worker functions, publishing protocol and Auth accounts/memberships were preserved.

## Source → hosted history

| Reviewed source | Hosted version / name |
| --- | --- |
| `supabase/migrations/20261029165237_service_catalog_v1.sql` | `20261029165416 service_catalog_v1` |
| `supabase/migrations/20261029165727_service_catalog_fk_indexes.sql` | `20261029165815 service_catalog_fk_indexes` |

CLI 2.122.0 generated both source filenames. MCP `apply_migration` applied only
these reviewed additive changes. Preserve timestamp mappings; do not reapply or
blindly `db push` the directory. The local draft was promoted/removed and its tests
now load migration sources. No publishing migration was deployed.

## Verification performed

- Pre-deployment project URL, seven-version history, existing RLS tables and
  security/performance advisors inspected. Local catalog database/contract tests
  passed before promotion; 17 database tests passed again with both source migrations.
- Three new catalog tables have RLS, authenticated staff SELECT only and no anon
  SELECT/direct client mutations. Public RPCs are SECURITY INVOKER; constrained
  private implementations use empty search paths and verified membership checks.
  Anon cannot execute any new RPC/helper; the payload validator is not executable
  by authenticated clients. All eight function-body SHA-256 hashes match source
  after trailing-whitespace normalization.
- `supabase/tests/service_catalog_hosted_smoke.sql` passed existing-publisher
  save/replay, stale-save rejection, inactive staging, exact activation/replay,
  stale activation, explicit rollback/original preservation, cross-business denial,
  direct-update denial, nonmember RLS/RPC denial and anon denial. All fixture writes
  were in one transaction ending in ROLLBACK. No test user/membership was created.
- Final catalog revision/head/activation counts are all zero. There are 22 public
  tables and none without RLS. Migration history has nine entries.
- Post-deployment advisors identified two unindexed composite foreign keys. Fixed
  through the second additive migration, not by modifying applied SQL. Final advisor
  has no unindexed-FK finding. Four explicit new indexes verified present.

## Advisor findings retained for review

Security counts unchanged: 3 existing anon and 21 authenticated public
SECURITY DEFINER notices, private worker-credential RLS/no-policy INFO, and leaked
password protection still disabled. No unrelated grant/Auth changes were made.
Unused-index INFO increased 23 → 27; retain new constraint/actor support indexes
pending real workload measurement rather than removing them merely for zero usage.

- [SECURITY DEFINER access review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

## Application boundary and remaining acceptance

The dashboard adds explicit, verified-staff inactive staging from validated local
preview, expected-version checks and stable per-form replay IDs. Timeout/lost
responses are unconfirmed, not proof of failure; reconcile the bounded revision
receipt list before issuing a new request. No production service rules were saved.
Full application validation for this slice is recorded in IMPLEMENTATION-STATUS.

Activation/diff UI, actual signed-in save/REST/browser tests, simultaneous real
PostgreSQL contention, backup/restore, retention/freshness and configuration ownership
cutover remain pending. Fudge catalog download and intake upload gates remain false;
no catalog is applied to its current Sheet/local classification. The private
business workbook/catalog remains ignored and was not imported or published.

No Edge Function was deployed: the authenticated RLS/RPC contract already supplies
the required operations. An extra HTTP wrapper would not remove authorization or
acceptance requirements. SMTP/templates/Site URL are separate Auth settings and
were not changed by these database migrations.
