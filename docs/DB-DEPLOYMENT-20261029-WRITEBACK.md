# Sheet writeback outbox deployment — 2026-10-29

Explicit user authorization: shared Supabase database setup/migrations/deployment.
Target reverified as `xtefjnfdjnxwrpkoydaj`. Existing data, ten prior migrations,
worker/publisher/catalog functions and Auth accounts/memberships were preserved.

## Source → hosted history

| Reviewed source | Hosted version / name |
| --- | --- |
| `supabase/migrations/20261029175611_sheet_writeback_v1.sql` | `20261029180253 sheet_writeback_v1` |
| `supabase/migrations/20261029180506_sheet_writeback_fk_indexes.sql` | `20261029180528 sheet_writeback_fk_indexes` |

CLI 2.122.0 generated both source filenames. MCP `apply_migration` applied only
these reviewed additive changes. Preserve timestamp mappings; do not reapply or
blindly `db push` the directory. Tests load both source migrations.

## What the protocol is (and is not)

Durable write-outbox for future Sheet writeback (F33/N08): bounded append or
update_cells intents recorded per organization with per-business ordering, a
stable key (idempotent re-enqueue within a business), enqueue request replay
(that never double-writes and refuses changed payloads), lease-based bounded
claim batches with a persisted claim-replay result, lease-stamped
acknowledgments (delivered/conflict/failed/retry) that are idempotent on lost
ack responses and never rewrite terminal history, retry exhaustion at 5
attempts, lease expiry reclaim, and cancel of pending items only. Delivery to
any real Sheet stays unwired: no connector, worker or Edge Function writes a
Sheet through these tables yet, and no release gate changed.

## Verification performed

- Local first: 9 PGlite protocol tests (enqueue/ordering, request+stable-key
  replay, intent validation, claim/batch/lease, ack idempotency, retry
  exhaustion, lease-expiry reclaim + terminal conflict, cancel/deny paths,
  staff-read-only RLS/anon denial) passed before deployment, and again with
  both source migrations loaded.
- Hosted deployment: 12 migrations in history. Three new tables have RLS with
  authenticated staff SELECT only; anon is denied SELECT, EXECUTE on all four
  public RPCs and every private helper. Public RPCs are SECURITY INVOKER
  wrappers; constrained private implementations use empty search paths and
  verified-staff checks (`sheet_writeback_access`), with per-business
  transaction advisory locks around enqueue/claim/ack/cancel.
- `supabase/tests/sheet_writeback_hosted_smoke.sql` passed rollback-only:
  enqueue/replay/stable-key conflict, invalid-intent denial, cross-business
  denial, ordered bounded claim, claim replay (identical returns, changed
  limit refused), wrong-lease denial, delivered ack + lost-ack idempotency,
  terminal immutability, terminal conflict with recorded detail, retry
  exhaustion → `failed`/`Attempts exhausted`, pending cancel + non-pending
  refusal, direct-mutation denial, nonmember RLS/RPC denial and anon denial.
  All fixtures were in one transaction ending in ROLLBACK; no test
  user/membership created. (Lease-expiry timing is covered by local tests;
  hosted time is not shiftable.)
- Post-deployment advisors found one new unindexed FK (`created_by` on the
  outbox); fixed additively via the second migration, same pattern as the
  catalog. Final unindexed-FK count is zero. `created_by` FK now covered by
  `reporting_writeback_creator_fk`.
- Final counts: writeback outbox/claims/acks 0/0/0, catalog
  revisions/heads/activations 0/0/0. 25 public tables, none without RLS.

## Advisor findings retained for review

Security counts unchanged: 3 existing anon and 21 authenticated public
SECURITY DEFINER notices, private worker-credential RLS/no-policy INFO,
leaked-password protection still disabled. The new writeback RPCs do not
appear in any security finding (SECURITY INVOKER wrappers; private helpers are
not in the exposed schema). Unused-index INFO increased 27 → 28
(`reporting_writeback_lease_expiry`); retain the queue/lease/creator support
indexes pending real workload measurement.

- [SECURITY DEFINER access review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

## Application boundary and remaining acceptance

`apps/web/src/lib/sheet-writeback-contract.ts` mirrors the server intent/outcome
validator for a future dashboard UI and deliverer; nothing dispatches yet, and
the existing connector (`sheet-sync.ts`, `bundle-sheet-connector.mjs`) remains
read-only. Real Sheet write-through, a deliverer worker, dashboard writeback
UI, live acceptance of the catalog review/activation UI, Sheet-vs-backend
configuration ownership and Fudge catalog download enablement remain pending;
both Fudge release gates remain false. Two PL/pgSQL parameter/column collisions
(`stable_key`, `values`) found by the first local test run were fixed by
renaming parameters (`p_stable_key`, `rows_`) before any hosted application.
Full dashboard validation for this slice is recorded in IMPLEMENTATION-STATUS.

No Edge Function was deployed: the authenticated RLS/RPC contract already
supplies the required operations. SMTP/templates/Site URL are separate Auth
settings and were not changed by these database migrations.
