# Verified-access deployment — 2026-10-30

## Authority and target

After local validation, the user explicitly authorized database migrations via
Supabase and Edge Functions if needed. Applied **only** verified-access hardening
to the existing shared project `xtefjnfdjnxwrpkoydaj`. No Edge Function was needed
or deployed. This does not authorize publishing/cohort protocol deployment,
uploads, Sheet writes, real browser operations, paid resources, commits or pushes.
Vercel rollout was not explicitly approved by this database-only response.

Rechecked the project URL, 11 prior migration records, public/private tables, logs
and security/performance advisors before DDL. Reused the already-cached Supabase
CLI 2.122.0 (not on PATH); no CLI/runtime/dependency installation. Discovered
`migration new` with `--help`, then generated the source filename with the CLI.
No database reset, history repair or wholesale migration-directory push.

| Item | Evidence |
| --- | --- |
| Source | `supabase/migrations/20261030155515_verified_access_v1.sql` |
| Hosted version | `20261030155727 verified_access_v1` |
| Deployment | Supabase MCP `apply_migration`, success |
| Hosted history afterward | 12 migrations; all preceding records preserved |
| Local migration count | 13; publishing remains intentionally undeployed |
| New public tables / Edge Functions | None |

## Change and limits

- New private confirmed-current-user helper; legacy staff/member/customer checks
  require fresh `auth.users.email_confirmed_at` and existing membership/access.
- Own membership/access/notification metadata reads receive the same verification.
- New private trigger checks the current verified, authorized, active session
  owner before check-job creation or lease. Existing invalid legacy authorizations
  fail closed and need operator reconciliation. Already-leased results may drain.
- Existing claim, completion, heartbeat and worker-credential helper bodies are
  unchanged; no private credential/table access is granted and no public RPC added.
- No credential, membership, account-confirmation, session, binding, publication
  or job row was modified by the migration. It enables no profiles or work.

Five deployed function bodies match promoted source, normalized for CRLF and
edge spaces/tabs/newlines:

| Private function | MD5 |
| --- | --- |
| `verified_human` | `7d27f57b9e84572260d0810bd8bb5531` |
| `is_staff` | `8a881e880c222ad460f93586d0c54101` |
| `is_member` | `b8e0d7ba9eb952baf231de7552f99504` |
| `can_view_customer` | `51c23316672409ebf8f2420a29772ab0` |
| `require_verified_check_session` | `bb85206ef26165abc4e7ab696eda6a04` |

The same pre/post aggregation of the three monitoring public functions plus
`worker_for_token` is `3c8ccdd5c9f0db8292cc45fcd2c7edbf`. This is a body comparison,
not a complete schema/constraint or concurrent-execution proof.

## Validation performed

- Pre-promotion dashboard typecheck/lint, **805 tests / 57 files**, production
  build PASS; **65 worker tests PASS**. Promoted-source security plus historical
  baseline tests rerun: **14 PASS**. Final full promoted-source rerun is recorded
  in the current `IMPLEMENTATION-STATUS.md` entry.
- `supabase/tests/verified_access_hosted_smoke.sql` PASS after deployment. This is
  a read/role-only transaction using an existing verified staff identity: own
  membership/business scope remains readable; missing identity has no legacy
  data and cannot start a session; anonymous table/helper access is denied.
  No fixture user, email/membership mutation, session/job creation or customer
  write. The transaction is rolled back. First harness attempt checked a private
  function grant while assuming `anon`; private schema USAGE correctly denied
  that name lookup. Moved the metadata assertion before assuming anon; no grant
  was broadened to make the test pass.
- Real unconfirmed-member and lost-confirmation queue/lease cases are covered by
  the 11 local PGlite tests, not newly created hosted accounts. Hosted SQL roles
  and source hashes do not establish real Auth/REST/browser acceptance.
- Trigger present, all 25 public tables still RLS-enabled. Bindings, publications,
  check jobs and writeback outbox remain zero; publishing/cohort tables remain
  absent. No live worker, browser, upload or delivery ran.

## Advisors and remaining rollout

Post-deployment counts unchanged: three anonymous and 21 authenticated
SECURITY DEFINER notices; one intentional private no-policy INFO; disabled
leaked-password protection; 27 unused-index INFOs, no new FK-index finding.
These are not a clean security certification:

- [Worker RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Staff RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Private default-deny RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

Production web `/workspaces` and `/verify-email` still return 404; the local
production build and new route gate pass. A separately approved deployment and
signed-in acceptance are needed. Publishing, mapped Sheet delivery, full restore,
runtime/profile pilot, content/media rights and remaining desktop parity are
not completed by this security migration. Preserve data/history and investigate
any regression; do not reset the database or restore the unverified access gap
as a shortcut. Any rollback requires a separately reviewed additive change.
