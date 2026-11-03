# Remaining work — authorized local implementation plan (2026-11-03)

**Subsequent database authorization:** 003–007 are now applied to the existing
test project, each with a hosted smoke PASS; see
`DB-DEPLOYMENT-20261103-0.1.4.md`. The operator directed proceeding on a testing/no
live-customer-data basis; backup/PITR remains unverified. Web deployment, commits,
pushes and live operations remain separate. Baseline/approval text below records
the starting plan and is superseded only for those five database applications.

**Latest local tranches (same day; no remote change):** engineering source for
phase 3 (F32 evidence), phase 4 (F36 worker state/release lifecycle/acceptance
validator) and phase 5 (F06/F07 staged bulk intake; F09 stays unimplemented by
design) now exists and is unit-tested — see `PROTECTED-EVIDENCE.md`,
`WORKER-RELEASE-LIFECYCLE.md` and `PROTECTED-BULK-INTAKE.md`. The SQL files
under `supabase/proposals/` are **local candidates, not applied**; hosted
application, bucket creation, real signing, the retention decision, the
permitted-use decision, deployment and every live acceptance item below remain
explicit gates. Policy questions and the ledger below are unchanged in force.

This is a phased engineering plan, not production approval or a parity sign-off.
The current user request supersedes historical approvals quoted in older status
entries: no production write, deployment, commit or push is authorized here.
Preserve `core/`, `gui/` and all desktop launchers. Do not change the separate
Fudge project or enable artificial engagement or invented identities.

## Verified starting point

- Clean working tree before this tranche; web source version `0.1.4`.
- Read-only Supabase MCP inspection of the existing project confirmed 23 hosted
  migrations through `publish_dispatch_guard`. Source 003–007 are absent.
- Anonymous production `/login` still reports `0.1.1`, deployment
  `dpl_HPLFL7yaXBykftgUvQhpBLGuxqVt`.
- Hosted inspection: 29 public base tables, all RLS enabled; zero storage buckets;
  zero pending/leased browser tasks and zero pending/leased publishing jobs.
- These observations do not prove current account permissions, active browser
  state, authenticated acceptance, backup readiness or a complete security audit.

## Phases and gates

1. **F19 retain-only edits (first local tranche).** Keep immutable approved text
   revisions and exact owned target/account checks. Add explicit local attachment
   ID/order review; verify original, composer and result. Stop rather than silently
   drop media. Cover posts/listings, concurrent changes, unexpected/hidden media,
   failed saves and reconciliation with isolated synthetic fixtures. No attachment
   addition/removal/reorder yet. No claim of real platform support without review.
2. **Deployment preparation.** Prepare ordered 003–007 application with one smoke
   per stage and explicit recovery/stop conditions. Obtain approval and verify
   backups and current access before any remote application. Deploy the reviewed
   `0.1.4` candidate only after all five hosted stages pass. See
   `DB-DEPLOYMENT-0.1.4-PLAN.md`.
3. **F32 evidence.** Start with genuine operator-directed uploads using verified
   user Auth and tenant/customer RLS; private bucket, immutable random object keys,
   bounded supported file types, byte validation, attachment metadata and narrowly
   authorized short-lived downloads. Worker uploads need a separately reviewed
   scoped authorization path, not a service-role key or direct privileged tables.
   Add cross-tenant/customer denial and expired-access tests. Proposed policy for
   discussion: 30-day screenshot retention, with holds and previewed explicit
   deletion. **Not approved:** no automatic deletion, retention scheduling or bucket
   creation in this tranche. Inspect actual storage/schema before implementation.
4. **F36 worker lifecycle.** Compare the actual desktop launch/install/update
   scripts. Build an offline-first, explicitly invoked installer/update path with
   reviewed release identity, authenticated integrity verification, pinned runtime,
   version checks, held device lock and unresolved-journal refusal. Install to a
   separate version directory; preserve private state outside release payloads;
   switch only after preflight. Test interrupted install, tampering, busy worker,
   drifted pins and rollback without browser actions or journal deletion. Digest
   verification alone is not release authenticity. Do not add remote code execution
   or a default daemon/automatic update policy.
   Current `worker_lock.py` explicitly locks only this checkout, and runners keep
   journals under checkout-relative `.worker-state`. Separate release directories
   would therefore create separate locks/checkpoints today: a stable private state
   root shared across versions is a prerequisite, not delivered functionality.
   Design/test explicit state migration and old/new version exclusion before any
   side-by-side install can run; never copy/discard unresolved journals silently.
5. **F06–F09 intake.** Current worker supports one-profile Netscape cookie writes,
   explicit clear-first handling and first-valid-line proxy assignment; this is not
   bulk or encrypted-vault parity. Before extending it, confirm why normal login is
   insufficient and that account/session transfer and proxy use are permitted.
   Then design local-only intake preview, exact UUID mapping, redacted per-row
   results, protected storage and explicit authorization; no cookies/proxy secrets
   in dashboard tasks. F09 automatic polling is separate from manual bulk intake
   and must not be enabled implicitly. Keep random likes and deceptive warmup off.
6. **Acceptance/cutover.** User-present real-account tests after explicit approval:
   authorized post/listing preservation, tenant/customer isolation, pause/session
   expiry, interruption, ambiguous saves, profile cleanup, restore/rollback and
   operator usability. Keep the desktop path until each feature is signed off.

## F01–F36 acceptance ledger

Statuses below are conservative: existing code and historical test evidence are
not a replacement for individual current live acceptance. The requirements in
`ND-AUTOMATIONS-DASHBOARD-IMPLEMENTATION-PLAN.md` remain authoritative.

| ID | Current disposition / remaining proof |
|---|---|
| F01 | Health/preflight plus confirmed fixed-URI Windows launch source; real install/publisher/readiness acceptance open. |
| F02 | Single-profile creation path exists; bulk wizard and live UUID/result acceptance open. |
| F03 | Prominent profile detection/preview and stdlib-only task helper source; duplicate-name/full inventory acceptance open. |
| F04 | Ownership/cleanup checks exist; lifecycle/sync-conflict recovery acceptance open. |
| F05 | Single-profile proxy path exists; format, redaction and launch-time parity open. |
| F06 | Bulk proxy intake now has local staged-source implementation (`PROTECTED-BULK-INTAKE.md`); necessity/permission policy, hosted batch RPC application and live acceptance gate. |
| F07 | Netscape parser exists; strict bulk validator plus DPAPI vault added; permission policy and full vault parity acceptance open. |
| F08 | Clear-first refusal/exclusivity checks exist; readback and live failure acceptance open. |
| F09 | Automatic cookie/proxy intake unimplemented by design; staging expires locally after 24h and has no watcher/polling — explicit polling policy gate unchanged. |
| F10 | Genuine-data first-step/handoff source only; no automatic account-creation claim. |
| F11 | Genuine local fields and handoff source; user-present identity acceptance open. |
| F12 | Human preferences/consent, not background agreement; stage coverage open. |
| F13 | Local supervised login source; protected credential lifecycle/recovery open. |
| F14 | Approved text publishing source/fixtures; hosted protocol and live sign-off open. |
| F15 | Local/HTTPS/Drive image staging source/fixtures; managed storage/live acceptance open. |
| F16 | Approved media order/hash source/fixtures; real upload/fallback/cleanup acceptance open. |
| F17 | Reviewed native audience controls only; other variants/live acceptance open. |
| F18 | Target-skip/new-link behavior not accepted; never count discovery as publication. |
| F19 | Retain-all text-edit source/fixtures added here; add/remove/reorder and live acceptance open. |
| F20 | Exact-target confirmed deletion source/fixtures; live destructive approval/sign-off open. |
| F21 | One-target confirmed blocking source/fixtures; block-list UI/live acceptance open. |
| F22 | Service-area/reference parity unverified; no residence inference authorized. |
| F23 | Approved listing source/fixtures; actual categories/media/edit acceptance open. |
| F24 | Exact result URL source exists; protected scoped screenshot capture open. |
| F25 | No claim of per-listing conversations; usefulness of legacy unread badge needs a decision. |
| F26 | No random/group flow enabled; transparent presets and exact permitted destinations need design/approval. |
| F27 | Bounded read-only review source/fixtures; no synthetic engagement or visibility claim. |
| F28 | Artificial/random engagement will not be ported; record user-approved retirement before parity sign-off. |
| F29 | Conservative adapters/fixtures exist; real variants/challenges/network acceptance open. |
| F30 | Exclusive leases/journals/session gates exist; capacity and live stop/recovery acceptance open. |
| F31 | Redacted structured receipts exist; full diagnostics/counter/live accuracy acceptance open. |
| F32 | Protected evidence storage/retention is now local source + a candidate proposal (`PROTECTED-EVIDENCE.md`); retention policy, hosted bucket/schema application and privacy/access acceptance gate. |
| F33 | Connector/outbox/mapping source exists; pending hosted migration and real Sheet acceptance open. |
| F34 | Versioned setup guides/assets exist; actual client connector/repair acceptance open. |
| F35 | Dashboard settings exist; full device/path/integration/theme parity acceptance open. |
| F36 | Per-user launcher install/remove and private-connection picker source added; shared cross-version state root, signed offline release lifecycle and acceptance-validator source added (`WORKER-RELEASE-LIFECYCLE.md`). Real certificate, actual install/update/rollback and live parity acceptance open. |

## Questions that gate later phases, not local F19 tests

- Approve or change the proposed 30-day screenshot retention, and specify who may
  place holds, view/download evidence and authorize deletion. No default deletion
  will be activated without approval.
- Is cookie import necessary instead of normal login, and what permitted account
  transfer/proxy use should the application support? Do not provide cookie values.
- Approve the migration/deployment plan separately when ready; an MCP connection
  is available, so lack of credentials is not the current blocker.
- Select the genuine authorized account and specific content for a user-present
  pilot later. Do not provide passwords, cookies or identity documents in chat.
