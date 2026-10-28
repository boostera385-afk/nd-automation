# P0 discovery and P1 readiness handoff

Updated: 2026-10-28. This is a decision record in progress; inferred defaults below are proposals, not approved production mappings.

## Confirmed direction

- Shared master plan P0–P8; dashboard repository is the integration base, Fudge stays a separate extension.
- User selected `xtefjnfdjnxwrpkoydaj` as the single shared backend for both apps, superseding `tyczcognqypqxrvkbmrk`. No cross-project synchronization or deletion is authorized.
- Supabase is the intended system of record; local worker executes authorized browser tasks.
- Preserve desktop/Fudge behavior until replacements are accepted; prohibit overlapping writers/profile tasks.
- Publish 100 today, then next-day **Refresh post statuses** queues the exact dated cohort with one action during an authorized work session. Separate requirement: latest 100 tracked posts per profile.
- Minimize repetitive operator work; retain approvals, identity handoffs, ambiguity reconciliation and destructive confirmations.
- User supplied a separate ND Master development-copy URL. Its ID is retained only in ignored `integrations/sheets/config.development-sheet.json`, not in public documentation. This local handoff file is not consumed as an active connector and grants no write capability. Production remains out of scope for development writes.

## Input needed from workflow owner

| Decision | Available evidence | Needed before |
| --- | --- | --- |
| Source Sheet layout | User-described cleanup step; no confirmed headers or safe sample | P2 payload mapping / P3 review |
| ND Master layout | All seven screenshot-listed dev-copy tabs verified by named-tab header reads; see `ND-MASTER-SCHEMA.md`; mixed profile-tab rows and additive columns remain unresolved | P3 writes |
| Customer/profile identity | Display names exist; actual UUID/customer bindings unconfirmed | Import/monitoring/publishing |
| Raw data ownership | Fudge SQL is per-user, dashboard is workspace/customer scoped | P2 migration/contract |
| Cleanup rules | Existing service rules are not approved cross-system transformations | P3 automation |
| Approved content/media rights | Not established by collection or workbook presence | Publishing/media use |
| Approval authority | Reviewer identities, editable columns and authenticated Sheet approval unresolved | P3 approval |
| Previous-100 policy | Latest known-dated tracked links proposed; listing quota unresolved | P4 policy |
| One-click refresh | Yesterday cohort proposed in business timezone; repeat freshness/cooldown unresolved | P4 action |
| Retention/recovery/capacity | Daily count example is not complete load/retention/backup requirements | P1 production readiness |

Provide header names and sanitized metadata only. Do not send workbook credentials, cookies, proxy passwords, personal access tokens or private connector URLs through chat. Configure secrets in ignored local files or approved secret storage.

### Development-copy header check

Read only `A1:L1` of the supplied tab through Google's header-range endpoint on
2026-10-28. Headers: Profile Name, Email, Password, Post Text, Visibility, Pictures,
Random Post Text, Area, Spammers, Proxy, Post link, Status. This confirms an
Auto Posting-compatible layout, not the actual tab name, data rows or all workbook
tabs. No credential values, post bodies, cookies or proxy values were requested.
No Google file was changed and no data was imported to Supabase.

The header endpoint was readable without a signed-in Google session. Because
credential-related columns exist, the owner should review sharing permissions
and remove real secrets from shared development data. Do not make the Sheet
public to connect it; the separate token-protected Apps Script can read a private
Sheet as its authorized owner. Its token alone does not protect an independently
public Sheet. Replace dev credentials with fixtures without altering production.

## Proposed field ownership — requires confirmation

| Field family | Proposed authoritative writer | Rules |
| --- | --- | --- |
| IDs, originals, provenance | Backend via Fudge ingestion | Immutable original plus linked revisions |
| Review corrections | Authenticated designated reviewer | Expected-revision validation; no original overwrite |
| Approval | Authorized reviewer via restricted operation | Exact revision/customer/profile/audience/media snapshot |
| Execution Status / Post link | Authorized execution result | Never clear to initiate a check; missing URL means reconciliation |
| Check Outcome / Checked At / reason | Observation pipeline | Independent from execution; technical errors never mean deletion |
| Sheet Sync Version | Backend connector/outbox | Stable record ID, compare expected version, flag human conflicts |
| Password/cookie/proxy values | Protected worker-local store | Opaque references only outside the machine |

The Source Sheet can remain optional during migration, but removal requires explicit workflow-owner agreement. Existing legacy status semantics remain unchanged until field ownership is handed over.

## P1 implemented first slice: offline configuration preflight

From `apps/web` run:

```powershell
npm.cmd run check:readiness
```

The command loads local Next.js development environment settings without printing values, performs no network calls/writes, and returns fixed redacted JSON messages. Exit 1 means local setup blockers; exit 0 means local configuration shape checks passed, **not** hosted readiness. A valid-looking modern publishable key does not prove project ownership.

Checks: required requested-target pin, validated client configuration/origin, explicit canonical app origin, separate Sheet endpoint, token length, workspace UUID shape. Hosted database, Auth, recovery and worker checks deliberately remain unverified. The Sheet checks are later-integration prerequisites, not a claim that P1 is impossible without a Sheet.

Observed initial run: project pin and app origin pass; client configuration and Sheet endpoint/token/workspace are blocked. Supabase tools were not exposed in this active session. No connection, secret or existing environment setting was changed.

## Hosted inspection gate — initial read-only review completed, acceptance pending

Read-only MCP now verifies the selected project and its six existing migrations,
17 RLS-enabled public tables and 29 matching source function bodies. The local
URL/key pair was verified and the stale pin corrected without replacing credentials.
See `P1-HOSTED-REVIEW.md` for findings and remaining login/access/recovery gates.
Earlier initial-run observations above are historical, not current connection status.

1. Enable/authenticate project-scoped Supabase MCP in OpenCode; reload tool availability if required. Never paste tokens into chat.
2. Verify exact target `xtefjnfdjnxwrpkoydaj`; inspect schema, migration history and security/performance advisors read-only. Historical inspection of this project is not a substitute for a current check.
3. Compare existing schema/history with repository migrations. Propose only missing compatible changes; do not reset, blindly push, duplicate hosted versions or apply the local publishing protocol automatically.
4. Retrieve a verified target URL/publishable-key pair; update ignored local settings together only after verification. Preserve the target pin. No secret/service-role key in the web app or worker.
5. Validate real user Auth, actual authorized workspace/customer memberships, redirect/email configuration, grants and RLS. Old IDs/memberships/tokens are not assumed valid on the new target.
6. Record backup/restore/retention decisions and obtain separate approval for hosted migrations or live writes.

Current documentation reviewed for this work: Supabase changelog, API key guide and explicit Data API grants change. New tables require intentional grants plus RLS/policies; no database changes were made by this preflight slice.

- https://supabase.com/changelog.md
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
