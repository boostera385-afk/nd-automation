# Hosted test-database rollout — 003–007 (2026-11-03)

## Authority, target and recovery limitation

The operator explicitly authorized applying these five migrations using Supabase.
After being asked about the unverified backup/PITR prerequisite, the operator
clarified: **"we are testing not live apply it with best practices and no live data
in db"**. Application proceeded under that explicit test-environment direction.
Backup/PITR availability and a tested restore point were **not independently
verified**. This exception does not establish production backup readiness or
authorize a restore, deletion, paid resource, web deployment, commit or push.

Target: existing Supabase project `xtefjnfdjnxwrpkoydaj`, Postgres **17.11**. It is
not an entirely empty database: workspace, membership and human session records
already existed and were preserved. No customer/publication/job fixture was added.

The procedure followed `DB-DEPLOYMENT-0.1.4-PLAN.md`, with the explicitly documented
test-environment recovery exception above. Source SHA-256 values were rechecked
and match that plan. No source migration file was modified, wholesale `db push`
performed, migration history repaired or historical migration replayed.

## Sequential applications and individual hosted smokes

Each row was a separate successful Supabase MCP `apply_migration`. Before the
next application, history was checked, the corresponding read-only smoke was
executed, installed function bodies were compared with source and logs/advisories
were inspected. Normalized body MD5 comparison was used for accidental drift,
not as a release signature; source identification uses the plan's SHA-256 values.

| Source migration | Hosted version / name | History count | Individual hosted smoke |
|---|---|---|---|
| `202611020003_publish_scheduling.sql` | `20261103150402 publish_scheduling` | 24 | `publish_scheduling_hosted_smoke.sql` PASS |
| `202611020004_automatic_sheet_mapping.sql` | `20261103150527 automatic_sheet_mapping` | 25 | `automatic_sheet_mapping_hosted_smoke.sql` PASS |
| `202611020005_approved_media.sql` | `20261103150630 approved_media` | 26 | `approved_media_hosted_smoke.sql` PASS |
| `202611020006_browser_task_receipts.sql` | `20261103150709 browser_task_receipts` | 27 | `browser_task_receipts_hosted_smoke.sql` PASS |
| `202611020007_supervised_workflows.sql` | `20261103150830 supervised_workflows` | 28 | `supervised_workflows_hosted_smoke.sql` PASS |

Smoke files are under `supabase/tests/`. They check catalog access, versions,
constraints, policies, triggers, private-helper grants and selected pure validator
behavior. They do not create/claim/complete jobs, transfer media or run a browser.
All newly created/replaced function bodies matched their reviewed source after
CRLF/edge-whitespace normalization. The 003 public outer claimant stayed unchanged;
the old 006 completion and 007 automation claimant bodies survived unchanged in
their revoked private locations.

## Additional read-only role checks

Using an existing verified staff identity and transaction-local SQL role/subject
settings (not an Auth login or a newly created account):

- Authenticated access to all four new tables and all four feature-version RPCs
  passed. Own-workspace publishing/mapping access helpers returned true.
- Publishing/mapping helpers denied an existing foreign workspace for that actor.
- Anonymous workflow-version execution and batch-table read were denied.
- Every role/subject setting was transaction-local and rolled back. No identity,
  membership, credential or application fixture was inserted or changed.

This is hosted **role-only** acceptance, not actual sign-in, populated-row tenant/
customer isolation, scoped worker execution or real browser compatibility. Those
remaining tests require separate authorized setup and participation.

## Final database observations

- **28 migration records**; **33 public base tables**, all RLS enabled.
- Existing counts preserved: **3 workspaces, 3 memberships, 2 work sessions**.
  Preflight found one current human session; it was not closed or paused here.
- **0 workers/worker credentials, customers, publications, browser tasks, publish
  jobs or Sheet outbox entries**.
- **0 publish batches, publication mappings, publish targets or delivery events**.
  Optional Sheet mappings therefore remain inactive; no Google request was made.
- **0 storage buckets**. Migration 005 defines media descriptors, not an evidence
  storage service. Evidence storage/retention remains unimplemented.
- No posting, listing edit, account creation/login/delete/block, live profile
  access, real platform request, data reset or destructive restore was performed.

## Logs, advisories and release caveats

Baseline last-24-hour logs contained expected Auth rejections (`invalid_credentials`,
`refresh_token_not_found`, `session_not_found`), and one PostgreSQL connection
termination LOG (`08006`). No HTTP 5xx appeared in that returned breakdown.
Each post-application error query returned no PostgreSQL ERROR/FATAL/PANIC or
HTTP 5xx in its requested window. Log ingestion delay means these observations
are not a guarantee of future health.

Final advisers (observed around **2026-11-03 15:09 UTC**) reported no ERROR-level
findings, but the project is **not security-clean**:

- **9 anonymous / 37 authenticated SECURITY DEFINER warnings.** Added RPCs account
  for the increases; public worker RPCs deliberately require scoped tokens inside
  the reviewed bodies, while human mutations require verified staff/session gates.
  Private bypass helpers remain non-executable by anon/authenticated. Do not
  remove authorization checks or blanket-grant private access to quiet advisers.
  [Anonymous RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
  [authenticated RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Existing [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
  remains unresolved; no Auth configuration was changed.
- One private RLS/no-policy INFO remains for intentionally RPC-only worker
  credentials; **28 unused-index INFOs** remain. No index was dropped.

No web or worker source changed in this database-application tranche. The preceding
exact source candidate already passed web typecheck, lint, **1,059 tests / 76
files**, production build, **240 worker tests**, **29 isolated synthetic browser
fixtures** and four package-safety tests. Those checks were not rerun solely for
the subsequent documentation updates and must not be described as new hosted
behavioral tests. `git diff --check` PASS after the release record update
(line-ending notices only).

**Web deployment remains separate and unperformed.** Final anonymous `/login`
fetch still reports **0.1.1**, deployment `dpl_HPLFL7yaXBykftgUvQhpBLGuxqVt`.
The hosted database
dependency is now applied, but application deployment, live acceptance and full
F01–F36 sign-off are not implied. Do not reapply 003–007 from their source names;
use the hosted mapping above when reviewing history.
