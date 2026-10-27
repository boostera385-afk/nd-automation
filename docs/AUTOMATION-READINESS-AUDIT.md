# Automation readiness audit — 2026-10-27

**Historical snapshot before the monitoring bridge implementation.** The worker
queue, pairing, dashboard controls and result protocol below were subsequently
implemented in source and the staging migrations were applied, but the actual
worker remains unpaired and not live-tested. See `WORKER-BRIDGE.md`
and the latest implementation-status entry for the current state. The verdict
that full desktop parity is incomplete still stands.

## Verdict

**Not a completed desktop replacement and not ready for unattended automation.**
The dashboard is a reporting application. The local monitoring pilot is separate.
Source preservation, passing tests and planned requirements are not proof of
connected browser execution. No F01–F36 feature is signed off as a complete,
end-to-end tested dashboard replacement by this audit.

## Evidence checked

- Compared all 34 original `core/` and `gui/` files with the cloned repository:
  zero missing files and zero content differences after line-ending normalization.
- Inspected dashboard routes, worker files, feature requirements and current status.
- Web Supabase URL, publishable key and APP_URL are set locally; no values copied
  into this report. Earlier hosted inspection found two recorded migrations and
  eleven RLS-enabled tables; the hosted schema was not reinspected in this audit.
- `SHEET_SYNC_URL` and `SHEET_SYNC_TOKEN` are missing from web local configuration.
- The original desktop `config.json` exists and has `apps_script_url` and
  `incogniton_path` settings. The clone has no desktop `config.json`. Values were
  not printed, copied, requested from the live endpoint or published.
- `python worker.py health`: `incogniton.status=unavailable`, `jobs_enabled=false`.
  This does not diagnose whether the application is absent, closed or misconfigured.
- `python -m pip show playwright`: not installed in this shell's selected Python;
  this does not rule out an installation in another environment.
- Typecheck and lint passed. Web tests: 176 passed in 14 files. Worker tests:
  27 passed (unit/mocks, not actual Incogniton or post-page testing).
- Production build was not rerun for this audit-only documentation change; the
  earlier successful build does not establish automation acceptance.

## Desktop feature coverage (dashboard, not preserved desktop source)

| Requirement | Current disposition |
|---|---|
| F01 Connection/open Incogniton | Local health probe only; dashboard connection/open action missing |
| F02 Profile creation | Missing |
| F03 Profile inventory/assignment | Offline response parser only; dashboard inventory/binding missing |
| F04 Profile lifecycle/recovery | Local pilot launch/stop subset only; no dashboard leases/recovery |
| F05–F06 Proxy validation/update/import | Missing |
| F07–F09 Cookie import/replace/automatic imports | Missing |
| F10–F13 Account onboarding, consent and credential recovery | Missing; verification must remain human-controlled |
| F14–F17 Publishing, media, uploads and audience | Missing; recording a post URL is not publishing |
| F18 Target detection/skip attribution | Missing |
| F19–F21 Controlled edit/delete/block actions | Missing; explicit authorization/confirmation required |
| F22 Service-area/mapping parity | Not signed off; existing customer fields are not proof of parity |
| F23–F25 Listings, evidence and unread badges | Missing as operational dashboard features |
| F26 Preset/random posting | Missing; claimed group behavior still needs demonstration |
| F27 Supervised browsing/session health | Missing as a dashboard workflow |
| F28 Random engagement | Not enabled; needs explicit safe disposition, not silent imitation |
| F29 Shared browser recovery/UI variants | Legacy source preserved; integrated dashboard behavior unverified |
| F30 Queue/concurrency/start-stop | Missing; reporting session buttons do not control the worker |
| F31 Operational events and counters | Pilot has local results only; durable dashboard job events missing |
| F32 Protected operational screenshots | Missing |
| F33 Sheet fetch/claim/writeback | Separate read-only fetch/import exists; connection missing; claim/writeback missing |
| F34 Sheets setup/repair | Versioned scripts/instructions preserved; dashboard parity not signed off |
| F35 Machine/integration settings, connection tests, themes | Themes exist; worker settings/connection management missing |
| F36 Worker install/update/drain/rollback | Desktop launchers preserved; managed worker lifecycle missing |

New requirements: N01 publication ledger and N03/N05 reporting have implemented
manual foundations, not verified automated provenance/coverage. N02 next-day
scheduling, N07 automatic refresh/reconciliation and N08 reliable writeback are
missing. N04 comments are manual in the dashboard; the local pilot only samples
initially rendered comments with stable IDs, with unknown totals and incomplete
collection. N06 Auth/RLS exists, but complete real-account acceptance, including
the reported email-link failure, is still outstanding.

## How the existing connections differ

```text
Existing desktop:
Python GUI -> private config.json -> legacy Apps Script / Google Sheet
           -> local Incogniton API -> existing browser profiles

Current dashboard:
Next.js -> configured Supabase reporting database
        -> separate read-only Sheet connector (not yet configured)

Local pilot (separate, not dashboard-dispatched):
Validated local manifest + page adapter -> Incogniton -> local JSONL results
```

The legacy Apps Script URL is not interchangeable with the reporting connector:
the dashboard requires a strict, token-protected, four-field response. Do not
paste the legacy endpoint into it or expose the legacy whole-row response to the
web app. Copying the old settings does not implement a job queue or result bridge.

## Connections available now

1. Recreate/verify a dashboard login. The earlier user deletion preserved its
   workspace but removed that user's membership; new signup does not restore
   workspace access automatically. Decide whether to grant the new identity
   approved access to that workspace or create a separate one.
2. For **read-only Sheet status**, deploy the separate
   `integrations/sheets/reporting-sync.gs` using `integrations/sheets/README.md`.
   Set the deployment's `SHEET_ID` and `SYNC_TOKEN` privately; add its endpoint and
   matching token to `apps/web/.env.local`, then restart the app. Never replace
   the desktop's live script or publish secrets. This enables fetch/import, not
   automatic Nextdoor checks or sheet writes.
3. For the **supervised local pilot only**, follow `apps/worker/MONITORING.md`:
   compatible isolated Python/Playwright, reachable Incogniton API, exact assigned
   profile UUIDs/post links and validated page selectors. Empty example selectors
   deliberately reject execution. No production selectors or browser compatibility
   have been validated here. Keep the selected profiles out of legacy jobs.

## What must be implemented before the requested automatic loop works

1. Secure worker pairing/revocation and organization/customer/profile bindings.
2. Durable jobs, active-session authorization, atomic claim/lease/fencing,
   per-profile exclusion, heartbeat, safe cancellation and recovery.
3. Automatic due-post selection (Pacific day/DST, unknown dates and catch-up),
   sanitized Sheet ingestion and unambiguous profile resolution.
4. Pilot-validated exact-post adapters, scoped comment/reply pagination and
   completeness, error/evidence rules, and safe browser ownership.
5. Scoped result submission with accurate `auto_check` attribution; dashboard
   progress, exception review and actual last-check times.
6. Stable sheet identity, authenticated result writeback and retryable outbox.
7. Controlled publishing/listings, profile management and remaining F01–F36 parity.
8. Authorized small pilot followed by the documented 20-post next-day acceptance,
   tenant isolation, recovery, off-hours/DST and rollback tests.

These are code and acceptance gaps, not settings the user can turn on. Keep the
desktop available, but never let legacy and new jobs own the same profile/task.

## Claim corrections

- Full automation and full desktop parity are **not delivered**.
- The 27 worker tests are not 27 live profile/post tests.
- A successful password-reset request is not proof of email delivery or a working
  reset link; the user's invalid-link screenshot remains unresolved by this audit.
- Historical validation rows in `IMPLEMENTATION-STATUS.md` record earlier states,
  not a guarantee that every current connection is ready. The implementation plan
  is a requirements inventory, not a completed acceptance report.
- No live Sheet requests, profile launches, postings, account creations, credentials
  migration, hosted schema changes or customer-data imports were performed here.
