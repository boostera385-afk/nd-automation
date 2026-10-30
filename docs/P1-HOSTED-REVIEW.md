# P1 shared-backend read-only review

Observed: 2026-10-28. Target verified through MCP: `https://xtefjnfdjnxwrpkoydaj.supabase.co`. This is the user-selected single backend for Fudge and ND dashboard. The superseded project was not altered.

## Verified metadata

- Six migration history entries match the intended existing foundation, checks, monitoring bridge, bridge indexes, content drafts and profile inventory. Hosted versions differ from source filenames; the explicit mapping is retained in `apps/web/tests/fixtures/hosted-baseline-20261028.json`.
- All 17 public tables are `reporting_*` and have RLS enabled. Existing policies were inspected; this does not replace authenticated cross-tenant access tests.
- All 29 existing application/helper function bodies match the six source migrations after outer-whitespace/CRLF normalization. Their body checksums are metadata only, not a complete schema comparison or cryptographic authenticity proof. Offline regression tests guard against silently editing these applied source bodies; use a new reviewed migration for changes.
- Function metadata has empty fixed `search_path` settings. Three monitoring RPCs intentionally accept anon transport and require a separate scoped worker credential in their matching source. Other staff mutations remain restricted to authenticated execution plus function-level checks.
- Public tables grant authenticated SELECT and no anon SELECT/INSERT/UPDATE/DELETE. Broad authenticated table INSERT/UPDATE/DELETE is absent. Customers and comments have the intended narrower column-level grants: approved customer inputs can be inserted/updated, and manual comment inputs inserted, under RLS. Server-owned ID/time/source fields do not acquire those input grants. Column privileges must be inspected separately from table privileges.
- Private worker credential storage has RLS, no client policies and no anon/authenticated SELECT or INSERT privileges. Do not add a read policy merely to silence the advisor.
- Existing workspace/customer/account/worker state is present and preserved. No profile bindings or publications were available for a live monitoring acceptance test. No private rows, cookies, passwords or tokens were saved in this review report or fixture.
- The local environment's existing URL and modern publishable key match the selected project's verified enabled key. Only `SUPABASE_EXPECTED_PROJECT_REF` was corrected to the selected ref after that comparison; key and URL values were not replaced. A running server may require its normal restart to load changed environment settings.

## Advisor findings and decisions

| Finding | Observation | Required handling |
| --- | --- | --- |
| Leaked password protection | Disabled (WARN) | Administrator must review availability/plan requirements and enable if supported/approved; do not claim protection exists or purchase a plan automatically |
| Anon SECURITY DEFINER execution | 3 monitoring RPCs (WARN) | Source bodies match existing credential-gated protocol; retain narrow transport, audit/retest revoked/invalid credentials and tenant/lease boundaries before pilot |
| Authenticated SECURITY DEFINER execution | 21 notices (WARN), including those worker RPCs | Matching bodies and fixed search paths are evidence, not a blanket waiver; keep authorization/negative-access tests and review after changes |
| RLS with no policy | 1 private credential table (INFO) | Intentional client-deny design; preserve grants and scoped RPC-only access |
| Unused indexes | 21 (INFO) | Retain; empty/lightly used tables do not justify deleting correctness/foreign-key coverage indexes |

No advisor-driven DDL or Auth setting change was performed. No all-clear security certification is claimed. The catalog checks did not execute mutations, create users, change memberships, register/revoke workers or invoke publishing.

## Migration decision

Do **not** replay the six existing migrations. Do **not** reset the database, create a duplicate reporting schema, or blindly push the directory. The `202610270006_publish_jobs.sql` protocol was applied separately as hosted `20261030164110 publish_jobs_v1` on 2026-10-30 (queue only; no publisher adapter). Earlier text in this review records the pre-deployment state.

Fudge raw ingestion and its workspace/revision model are not implemented on this backend. The per-user SQL in the Fudge repository must not be applied unchanged as a shortcut. Settle ingestion authorization/ownership and implement a separately tested additive migration when its P0/P1 dependencies are resolved.

## Remaining exit gates / next implementation

1. Real signed-in dashboard acceptance and authorized workspace/customer selection. A verified Auth user and membership existing in metadata is not evidence of a successful current login or correct user-visible data.
2. Live/approved negative tenant/customer/worker access checks. Offline tests cover fixtures, not browser/session delivery or production contention.
3. Backup/export availability, restore validation, retention and deletion decisions. None was confirmed from these tools; no backup was created or claimed.
4. Confirm Source Sheet headers, live ND Master mapping, cleanup/approval policy and actual profile UUID assignments. Configure the separate dashboard Sheet connector privately; do not reuse a legacy whole-row endpoint.
5. Proceed to the versioned workspace-scoped Fudge ingestion contract and local tests, keeping live ingestion/publishing off until their gates pass.

The offline readiness command still intentionally reports hosted checks as unverified: it performs no hosted requests and must not cache this review as permanent readiness. It now passes target pin/client configuration/app-origin checks; Sheet endpoint/token/workspace remain setup blockers.
