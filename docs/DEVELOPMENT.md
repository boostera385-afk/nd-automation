# Development guide — reporting foundation

This guide covers the reporting foundation. The subsequent read-only monitoring
bridge and its applied staging migrations are documented in `WORKER-BRIDGE.md`.
Worker pairing and live browser acceptance remain pending; the full automation
requirements are not a delivered desktop replacement.

## 1. What this release does

This milestone is a standalone customer-reporting application in `apps/web`. It does not execute or wrap the legacy browser/account automation.

Implemented code includes:

- Supabase email sign-up/sign-in, password reset and verified server-side user lookup.
- Empty-workspace creation after verification; a new sign-up cannot join an existing organization automatically.
- Organization/customer-scoped reporting tables and database Row Level Security.
- Customer records and canonical authorized post links entered manually or through a reviewed CSV import.
- Exact-post manual observation history with separate visibility, timestamp, notes and optional comment totals.
- Manually recorded comments grouped by post; unknown creation time is not guessed.
- Pacific Today/Yesterday views, an all-post ledger and daily CSV reporting snapshots.
- Human Start/Pause/Resume/End work-session records and device/business clocks; no browser side effects.
- TypeScript, lint, unit/Postgres-policy tests, build and production dependency auditing.

Hosted Supabase configuration, email flows and authenticated browser acceptance still require your staging project. Do not equate local code/tests with a deployed production service.

## 2. Prerequisites

- Node.js 22 or newer; Node.js 24 LTS is the CI baseline. The initial local checks ran on Node.js 26.
- npm and a browser.
- A separate **staging Supabase project** for live authentication/database validation.
- Git for normal source-control use. Git was not installed on PATH during development; a checksum-verified portable MinGit was used from the approved OpenCode temporary tools directory. Install Git normally for durable personal use; do not depend on a temporary tool path forever.

No Python runtime, Incogniton installation, Nextdoor developer application or platform credentials are required to run this reporting app.

## 3. Open the correct folder

The workspace originally contained a nested application folder. The project root is the **inner** folder containing `README.md`, `apps/`, `supabase/`, `opencode.json`, and `docs/`:

```powershell
cd '<path to the inner "ND Full Automated" folder, the one that contains apps\ and docs\>'
```

OpenCode has been moved to this application root so its project-local instructions, MCP settings and slash commands apply.

## 4. Install and run without a database

```powershell
cd apps/web
npm.cmd ci
npm.cmd run dev
```

Visit <http://localhost:3000>. `/` opens the polished sign-in page. Without valid environment configuration, protected views and the legacy `/setup` URL also redirect to `/login`; database/migration instructions never appear in the customer UI. Forms remain usable, but an attempted account action returns a friendly availability message until the backend is configured. Customer data/sign-in success are never simulated.

The dev/start scripts bind to loopback, not every network interface. Use `npm.cmd` in PowerShell to avoid execution-policy issues with `npm.ps1`. The initial review preview uses `http://127.0.0.1:3100/login`; normal development defaults to port 3000. When connecting Auth, set `APP_URL` and allowed redirects to the actual consistent hostname/port you use.

## 5. Configure Supabase locally

From `apps/web`:

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local` on your own computer:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
APP_URL=http://localhost:3000
```

Use the project publishable key, or legacy **anon** JWT key. **Never use a service-role, secret, database password or personal access token here.** The app rejects obvious secret/service-role keys rather than accepting them as a public configuration. Do not paste secrets into chat or source control.

Environment changes may require restarting the Next.js dev process. This is separate from OpenCode MCP config, which hot-reloads without restarting OpenCode.

### Apply the reviewed migration

1. Confirm you are in the intended **staging** Supabase project.
2. Review `supabase/migrations/202610260001_reporting_foundation.sql` from the project root.
3. Apply it once using the Supabase SQL editor or your approved migration workflow.
4. Do not run a reset command or apply it blindly to a production database. The initial migration creates new `reporting_*` tables/functions; it is not an idempotent script to rerun after successful application.

Applied: the reviewed migration was applied to the supplied staging project on 2026-10-26 and recorded as version `20261026185223` (`reporting_foundation`). All 8 `reporting_*` tables exist there. Re-applying the same file is not needed; future schema changes go through new versioned migration files.

The migration has been exercised against local PGlite/Postgres with a test-only `auth.users`/`auth.uid()` shim and `authenticated`/`anon` roles, and verified on the hosted project: unauthenticated Data API calls to the RPCs and tables are rejected with `permission denied`, and the hosted security advisor reports only the intentional `SECURITY DEFINER` RPC warnings.

### Configure Auth

- Enable email/password authentication and **email confirmation**.
- Set the site URL to match the running app origin — currently `http://127.0.0.1:3100` (this is also `APP_URL` in `apps/web/.env.local`).
- Allow redirect URLs `http://127.0.0.1:3100/auth/callback` and `http://127.0.0.1:3100/auth/callback?next=/reset-password` as supported by your Supabase redirect settings (sign-up links target the first, password-recovery links the second).
- Use a consistent hostname when requesting and opening PKCE email links. Do not switch between localhost and 127.0.0.1 for the same auth flow.
- Configure production SMTP/rate limits and HTTPS redirects before deployment. Supabase's auth rate limits remain relevant; the app does not claim to provide a separate distributed rate limiter. The built-in email service is acceptable only for low-volume staging.
- Sign up, verify email, sign in and create an empty workspace. No existing customer organization is assigned automatically.

Team invitation and membership-management screens are **not implemented**. Additional staff/customer membership must currently be provisioned through a trusted admin workflow in staging. Never allow a public user to select a role or arbitrary organization ID. Customer-role access additionally requires an explicit `reporting_customer_access` record in the same organization; a membership alone does not expose every customer.

## 6. First end-to-end manual acceptance

1. Create a staging user, verify email and create a new workspace.
2. Confirm the business clock is US Pacific and the detected local clock is separate.
3. Start a reporting work session; verify pause/resume/end behavior. No browser or account operation should occur.
4. Add a genuine authorized customer and explicit timezone.
5. Record an existing canonical post share link. A new record starts `Not checked`.
6. Open that exact post yourself through an authorized view, then save a manual observation and viewing-context notes.
7. Leave comment total blank when unavailable. Blank is not zero. `Confirmed removed` requires evidence notes.
8. Record an authorized comment, using its external ID if available. The initial form records first-observed time and leaves platform creation time unknown.
9. Open Today, Yesterday and All posts. Unknown publication dates appear only in All posts and are called out in reports.
10. Select a reporting date and download CSV. Verify timestamps, business date and formula escaping.
11. Test a second user in a different organization and a customer role with one explicit customer assignment. Verify denied cross-organization/customer reads and writes through both UI and direct user-scoped requests.
12. Test sign-out, expired/invalid confirmation links, password reset and an unavailable database.

These live-auth/UI steps remain pending until hosted Auth URL configuration is completed and a verified staging account exists. Unauthenticated sign-in-page smoke tests do not establish that hosted authentication or authenticated screens passed acceptance.

## 7. Reviewed CSV format

Export a clean **post-reference-only** CSV; do not upload the raw legacy workbook or cookie/proxy export.

```text
title,url,account_label,published_at
```

- Required columns: `title`, `url`, `account_label`.
- Optional: `published_at`, with a full ISO timestamp including `Z` or an explicit offset. Missing time remains unknown.
- Accepted URLs are canonical HTTPS `/p/ID` or `/for_sale_and_free/ID` share links on the supported Nextdoor domains. Tracking fragments/queries are removed; profile/login/feed URLs are rejected.
- Maximum: 100 records / 512 KB per import.
- Extra/duplicate headers, credentials/cookie/proxy fields and malformed rows are rejected.
- Preview shows validation results and **writes nothing**. Confirm requires an explicit authorization checkbox.
- The backend validates again; the database imports the batch atomically, rejects cross-customer IDs, and skips an already stored URL for that same customer.
- Imported states remain `Not checked`, even if the source sheet had a `Posted` label.

Excel `.xlsx` parsing, flexible legacy column mapping, live Apps Script/Google Sheets synchronization and portal writeback are **not implemented** in this milestone. A reviewed CSV is an offline import, not a connected live sheet.

## 8. Time and reporting semantics

- Organization reporting defaults to `America/Los_Angeles`, with automatic PST/PDT.
- The computer was detected as `Asia/Karachi`; device time never replaces business time automatically.
- Publication entry interprets the optional local timestamp in the selected **customer's** timezone. Organization-level Today/Yesterday/reports explicitly use the **workspace** timezone. Per-customer report timezone/filter UI is deferred; do not assume it exists.
- UTC is stored, and display/export labels identify the business zone or UTC.
- Spring-forward nonexistent and fall-back ambiguous manual wall times are rejected rather than guessed. Offset-bearing CSV input can express an unambiguous timestamp.
- A reporting work session may cross Pacific midnight. “Recorded in this session” identifies when a record was added, not when the external post was actually published.
- Last observed live is not current live status. A failed login/time-out must not be recorded as confirmed removal.
- Comment creation counts and first-observed counts are separate. Initial comment entry does not invent platform creation times.
- Reports are current snapshots, not immutable historical archives. They do not prove off-hours visibility.

## 9. Validation commands

From `apps/web`:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

Run independent type/lint/tests in parallel if useful; run build after source fixes and do not race its generated types with a separate build. Never run legacy top-level `test_post*.py` or `test_update.py` as a test suite—they can write live sheet values.

Tests cover Pacific/Pakistan date differences, 23/25-hour DST days, ambiguous times, pause accounting, strict CSV parsing, unsafe URLs, formula injection, auth redirect validation, public-key safety, real database RLS, no role self-escalation, atomic import rollback, unverified imports and observation/session permissions.

CI is defined in `.github/workflows/reporting-ci.yml`. It runs on GitHub after an approved push/PR; adding the workflow locally does not mean GitHub has executed it.

## 10. Repository connection and safety

The local repository is initialized on `main` and `origin` is:

```text
https://github.com/boostera385-afk/nd-automation.git
```

The remote was inspected as public and empty. **No files have been staged, committed or pushed by this implementation.** Do not run `git add .` casually. Review the safe reporting files and ignore rules, scan for secrets/customer data and stage intentionally before any approved commit/push.

Known excluded artifacts include `config.json`, `.env.local`, workbooks/CSV/TSV exports, cookies/proxies, screenshots/temp images, logs/dependencies and historical top-level scratch/live-writing test scripts. Existing files remain on disk.

## 11. Deployment boundary

Deploy `apps/web` as the project root on Vercel or a compatible Next.js host. Use staging credentials first and an HTTPS `APP_URL`; rebuild with the correct environment, configure Auth redirect URLs and run authenticated acceptance before production use.

No hosted Supabase project, migration, storage bucket, email delivery service, customer dataset, deployment or paid resource has been created automatically. Protected evidence uploads, MFA enforcement, invitation UI, full pagination, stored report versions, live sheet/portal sync and production hardening remain pending. The implementation status is the source of truth for delivered/tested scope.
