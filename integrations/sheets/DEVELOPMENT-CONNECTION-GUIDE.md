# Connect the ND Master development copy

## Easier: use the frontend wizard

Sign in as staff and open **Settings / More -> Connect Master Sheet — step-by-step**
at `/dashboard/settings/sheet-setup`. It includes numbered instructions, the exact
generic connector code with copy/manual-copy fallback, Sheet URL-to-ID extraction,
Web Crypto token generation, private copy buttons, current-workspace settings and
a **Test saved connection** action. Existing organization connections are reused;
new staff do not need separate connectors. Saved server tokens are never exposed.

The wizard is guided copy/paste setup, not automatic server-credential storage.
Token inputs stay only in current-page memory. An administrator must still save
the environment block privately and restart/redeploy. The test action ignores
unsaved page inputs and tests only the authorized workspace's saved server config.
It returns a row count, not content, and starts no imports/browser jobs.

Developers: `npm.cmd run bundle:connector` generates the bundled source from the
canonical script; `predev` and `prebuild` run it automatically. The offline source
parity test prevents stale copies. Vercel builds rooted at `apps/web` must include
the canonical `integrations/sheets/reporting-sync.gs` outside that root in their
build source; no runtime filesystem access or secret insertion is used for the
generic script. Configure monorepo outside-root source availability before deploy.

The detailed manual fallback follows.

## What this connection enables

Connect the user-designated **development copy of ND Master** to the local
dashboard. This first connection displays safe Sheet metadata and, after explicit
profile/customer mapping, can import known post links into the reporting ledger.

It does **not** publish posts, create accounts/profiles, import cookies/proxies,
check whether posts are live, or write check statuses to the Sheet. One-click
next-day checks and writeback are requirements awaiting implementation/pilot.

Flow now: development Sheet -> separate read-only Apps Script -> dashboard server
-> Master Sheet preview. Keep Supabase on the selected shared project
`xtefjnfdjnxwrpkoydaj`; no second Supabase project is needed.

## Before you start

1. Use the Google account that owns or is authorized to read the dev-copy Sheet
   and create/deploy the connector. Keep the production Sheet untouched.
2. Confirm you are in the copy titled **ND fully Automated** supplied for development.
   The private ID is recorded in ignored `config.development-sheet.json` beside
   this guide. Do not put a production ID in its place.
3. Review sharing permissions and sanitize development credentials/cookies/proxies.
   The header endpoint was readable without sign-in. A connector token does not
   protect an independently public Sheet. You do not need public Sheet sharing.
4. Keep the dashboard running locally and sign in at
   <http://127.0.0.1:3000/login>. Its current workspace is the intended owner of
   this server-side connection; do not guess another workspace's ID.
5. Do not use the Sheet's existing **Automation** menu or replace a desktop/Fudge
   Apps Script. Those actions may run unrelated legacy tasks.

## Create a separate Apps Script connector

1. Open <https://script.google.com> in your browser.
2. Choose **New project**. Name it **ND Dev Dashboard Connector — Read Only**.
3. On your computer open this repository's
   `integrations/sheets/reporting-sync.gs` in a text editor. Copy the complete file.
4. In the new Apps Script project, replace the starter contents of `Code.gs`
   with that complete file. Do not paste only a section. Save the project.
5. Do not click Run on `doPost`; it expects an HTTP event and is not a setup wizard.
   The standalone script creates/renames no Sheet tabs and installs no triggers.

## Configure private Script properties

Open the connector's **Project Settings** (gear icon), find **Script properties**,
choose **Add script property**, and add exactly these names:

| Property | Value |
| --- | --- |
| `SHEET_ID` | Dev-copy spreadsheet ID: only the segment between `/d/` and `/edit` in its URL. Do not include `gid`, the full URL or the production ID. |
| `SYNC_TOKEN` | A newly generated private random token; use the identical value in the dashboard environment later. |

Generate a 64-character token in PowerShell on your computer:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Save the token in your approved password/secret storage and paste it into the
property. Treat terminal output as private. Do not send it through chat, commit
it, put it in Sheet cells or include it in screenshots. Save Script properties.

## Deploy and authorize

1. Choose **Deploy -> New deployment**.
2. In the deployment-type selector (gear), choose **Web app**.
3. Set **Execute as** to **Me** (the authorized Sheet-reading owner).
4. Set **Who has access** to **Anyone**. This permits the dashboard server's
   unauthenticated Google transport, but the script independently requires the
   secret token for every read request. It does not require public Sheet sharing.
5. Deploy and review Google's authorization request. Authorize only your own
   reviewed project and intended account. If Workspace policy blocks deployment,
   ask the administrator; do not bypass organizational controls or change Sheet
   sharing to try to fix it.
6. Copy the **Web app URL** ending in `/exec`. Keep it private. Do not copy the
   editor URL, deployment ID alone or a `/dev` test URL.

Opening the `/exec` URL directly in a browser may return
`{"ok":false,"error":"post_only"}`. That is expected: this connector accepts
token-authenticated POST, not browser GET. It is not a failed deployment.

## Configure the dashboard locally

Open `apps/web/.env.local` in a local editor. It is Git-ignored. Replace any
placeholder values for these three variables; do not add duplicate definitions:

```dotenv
SHEET_SYNC_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
SHEET_SYNC_TOKEN=YOUR_PRIVATE_TOKEN
SHEET_SYNC_ORGANIZATION_ID=YOUR_CURRENT_DASHBOARD_WORKSPACE_UUID
```

- URL: the new connector's actual `/exec` URL.
- Token: exact same value as its Script property `SYNC_TOKEN`, without accidental
  spaces or line breaks.
- Workspace UUID: sign in, open **Settings / More**, expand **Sheet connection
  instructions**, and copy the displayed current workspace ID. Do not use the
  Supabase project ref, account ID or a customer/profile UUID.

Leave existing Supabase URL/publishable key, the selected deployment pin and
`APP_URL` unchanged. Never add a service-role/secret key. Save the local file.

The local `config.development-sheet.json` inventory is documentation only; editing
it alone does not configure the app. Script properties own the Sheet selection;
the web server environment owns the connector URL/token/workspace restriction.

## Restart and verify

The currently running server must reload the saved environment. If the coding
assistant started it, ask the assistant to restart this project's server; do not
kill unrelated Node processes or start another server on the same port. If you
started it yourself, stop that terminal's server with Ctrl+C, then from `apps/web`
run `npm.cmd run dev` for development or rebuild and use `npm.cmd run start` for
a production-mode local preview.

From `apps/web`, run `npm.cmd run check:readiness`. Local configuration checks
should pass after setup; hosted gates intentionally remain unverified because
this command is offline. Shape validation alone does not prove token agreement
or actual Sheet access.

Verify in order:

1. Check unauthorized rejection. In a private PowerShell window:

   ```powershell
   $connectorUrl = Read-Host 'Paste your private new connector /exec URL'
   Invoke-RestMethod -Method Post -Uri $connectorUrl -Body '{"action":"getPostRecords","sheet":"Auto Posting","token":"wrong"}' -ContentType 'text/plain'
   ```

   Expected: `ok = False`, `error = unauthorized`. If the response returns Sheet
   records, stop using the deployment and review the complete code/token check.
2. Open <http://127.0.0.1:3000/dashboard/master-sheet> while signed in. Select
   **Auto Posting**. Expected: a safe preview or an honest empty result, with
   fetched time and profile/short-title/status/link fields only. No passwords,
   cookies or proxies should appear.
3. Check **Auto Listing** and the other known tabs. The dashboard's **Bulk cookies
   import** label maps to the actual **Bulk proxy import** cookie tab. A separate
   **Bulk proxies import** tab does not exist in the verified seven-tab copy;
   the current dashboard shows an optional-tab-not-configured notice for it.
   Older builds show a missing-tab error. Do not rename/create tabs merely to hide it.
4. Mixed rows in **Incog Profile Creation** remain non-executable. Preview does
   not validate them as creation jobs or authorize any action.
5. Do not click **Sync known profiles now** yet. That action writes publication
   references to Supabase, even though it never writes the Sheet or posts online.
6. Check the development Sheet remains unchanged. Report only the success/error
   text or a sanitized screenshot; do not send tokens or credential columns.

The preview shows at most 200 returned rows; the connector reads at most 2,000
rows per tab. Partial-coverage notices are meaningful, not errors to hide.

## Configure profile mappings and import known links

This is a later, explicit database-write step after the read-only connection is
accepted. It does not require retyping all post content.

1. Confirm each customer and its authorized real Incogniton profiles. Do not
   invent customers or use profile names/Sheet-generated IDs as real UUIDs.
2. Review the existing local-worker registration in **Settings / More -> worker
   setup / Automation control** before creating a replacement. Do not overwrite
   an existing credential blindly. Registration metadata is not live pairing.
3. In **Profiles -> Inventory setup & advanced tools**, an authorized sanitized
   UUID/name/group CSV can populate inventory. Never import cookie/password/proxy
   columns. Real inventory discovery is not connected yet.
4. Save exact customer/worker/profile-UUID/Sheet-account-label bindings in
   **Profiles** or the advanced **Automation control** assignment form. Display
   name conflicts require explicit resolution, not fuzzy matching.
5. After confirming authorization to store these references, use **Master Sheet
   -> Auto Posting / Auto Listing -> Sync known profiles now** for mapped links.
   Unmapped/ambiguous rows skip; imported publication dates remain unknown and
   visibility remains `not_checked`. Posted text is not proof of a live post.
6. Follow `docs/WORKER-BRIDGE.md` for separate private pairing, compatible runtime,
   selector validation and an explicitly approved read-only pilot. Do not enable
   monitoring merely because a Sheet preview works. End the stale 21-hour work
   session shown in the screenshot; begin a fresh session only for authorized work.

Unknown dates/missing links must be reconciled before claiming yesterday's full
100-post cohort coverage. The planned one-click refresh/writeback is not enabled
by this connector. Continue the master plan's P0–P8 implementation gates.

## Troubleshooting, rollback and next phases

| Symptom | Check / safe action |
| --- | --- |
| Dashboard says not configured | All three local variables, correct workspace UUID, placeholders removed, environment reloaded |
| unauthorized | Script `SYNC_TOKEN` and local `SHEET_SYNC_TOKEN` agree exactly; do not log either |
| server_error | Correct development `SHEET_ID`, deployment owner access, saved properties and authorized project; avoid printing rows/tokens in logs |
| sheet_not_found | Correct tab name/alias and dev-copy selection; missing separate proxy tab may be expected |
| invalid_action | Update the separate connector to the current complete file and deploy a new version |
| HTML/login/404 instead of JSON | Correct `/exec` web app URL, Execute as Me, intended access policy and Workspace restrictions |
| post_only in browser | Normal GET rejection; test through dashboard/POST |
| No imported links | Preview is separate from import; mappings, valid exact URLs and eligible source statuses are required |
| Import does not show Alive | Correct behavior: Sheet claims do not create verified platform observations |

For code updates: save the standalone connector, **Deploy -> Manage deployments
-> Edit -> New version -> Deploy**. Saved editor code alone does not update an
existing deployment. Recheck denial and preview after deployment changes.

To disconnect: stop reads/remove local Sheet settings and reload this app, or
archive only the separate connector deployment. Do not delete Sheet data or
alter legacy scripts. To rotate: change the token privately on both sides and
reload the dashboard. No connector secret should be stored in public repository
files or passed in a URL query string.

Local acceptance comes before Vercel preview. Later Vercel setup needs separate
environment configuration and authorized Supabase redirects; the local worker
does not move to Vercel. No commit/push, deployment, purchase, live browser action
or Sheet write is authorized merely by following this read-only setup guide.
