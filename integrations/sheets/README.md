# Read-only sheet sync (setup guide)

For the current user-designated development copy, use the full
[development connection walkthrough](DEVELOPMENT-CONNECTION-GUIDE.md), including
private configuration, verification, missing-tab expectations and execution limits.

Lets the dashboard **read** the status of the posts your desktop tool already writes to the Google Sheet. It never writes to the sheet and never touches the script your desktop tool uses.

```
Google Sheet  ←(read only)—  NEW standalone Apps Script  ←(HTTPS + secret token)—  Dashboard server
                             returns 4 columns only
```

Only these columns leave the sheet: **Profile Name, Post link, Status** and a one-line title (**Post Text** on *Auto Posting*, **Title** on *Auto Listing*). Email, Password, Proxy, Cookies and every other column are never read.

The newer `getTaskRows` action also previews safe profile/status/link metadata for
the profile-creation, account-creation, cookie/proxy import, warmup and random-posting
tabs. These tabs do **not** expose credentials, complete content, media or job
payloads. The legacy `Bulk proxy import` cookie-tab alias is read without renaming
it. Unheaded side-column data is ignored. This is a read-only preview, not a new
desktop execution queue.

The newer `getMasterLayout` action inspects **structure only** so a workbook with
its own tabs, a date banner in row 1 and headers in row 2 can be mapped without
guessing: tab names, row/column counts, the detected header row, a planned
calendar date from the banner, and column labels that match the connector's
allowlist. Any header text it does not recognise is counted, never returned. It
returns no data cells and no credential values. Run it from `apps/web` with
`npm.cmd run check:master-layout`; set `SHEET_PROBE_URL` / `SHEET_PROBE_TOKEN`
to probe one deployment without changing the saved workspace connection. A banner
date is a **plan**, not proof that a post was published.

The newer `getMasterSections` action reads a tab that repeats a **date banner**
and header row (the common "day plan" layout). It returns dated sections with a
projected, safe subset only: Account/Profile Name, an **exact Nextdoor link**,
status, a one-line title, service, area and state. Phone, pictures, remarks,
email, password, cookies and proxy columns are never read, and a link that is not
an exact Nextdoor share URL is refused rather than passed on. The link column is
**never guessed from data**: it must carry a recognised header or be declared with
`SHEET_MASTER_LINK_HEADER` (for a workbook whose link column is still headed
`Issues`, set `SHEET_MASTER_LINK_HEADER=Issues`). A section banner is a plan date;
a `Posted` status stays a claim until a check is recorded. Run it with
`npm.cmd run check:master-sections -- "<exact tab name>"`.

## 1. Create the script (separate from your existing one)

1. Go to <https://script.google.com> → **New project**. Name it `ND reporting sync (read-only)`.
2. Replace the editor contents with `integrations/sheets/reporting-sync.gs` from this repository. Save.
3. **Do not** edit your existing automation script.

## 2. Add the two secrets (Project Settings → Script properties)

| Property | Value |
|---|---|
| `SHEET_ID` | The long id in your sheet URL: `docs.google.com/spreadsheets/d/<THIS PART>/edit` |
| `SYNC_TOKEN` | A random secret, 24+ characters (generate below) |

Generate a token in PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

## 3. Deploy

**Deploy → New deployment → Web app** · *Execute as:* **Me** · *Who has access:* **Anyone** → Deploy → authorize → copy the **Web app URL** (ends in `/exec`).

"Anyone" is required because the dashboard server calls it without a Google login. Every request without the token is refused.

## 4. Tell the dashboard (server-side only)

Add to `apps/web/.env.local` (ignored by git — never commit it):

```
SHEET_SYNC_URL=https://script.google.com/macros/s/XXXXXXXX/exec
SHEET_SYNC_TOKEN=the-same-token-as-SYNC_TOKEN
SHEET_SYNC_ORGANIZATION_ID=the-owning-workspace-uuid
SHEET_MASTER_LINK_HEADER=Issues
```

`SHEET_MASTER_LINK_HEADER` is optional and only needed when the post-link column
has an unusual header. Leave it unset for a workbook whose link column is already
called `Post link`; the connector will then refuse to read links rather than guess.

Restart the dashboard server so it reads the new values. Neither value is ever sent to the browser.

Find the owning workspace UUID under **Settings / More → Connection setup → Sheet
connection instructions**. The server requires verified staff access **and** this
workspace match before contacting the connector; another workspace's staff cannot
use this server-global connection. Missing workspace configuration fails closed.
The URL/token stay server-side; do not send them through chat or commit them.

## 5. Use it

Dashboard → **Master Sheet** → choose the familiar tab. It reads automatically
when opened and can refresh the view every minute; refresh never writes or starts
jobs. For Auto Posting / Auto Listing, **Sync known profiles now** saves reported
links using the exact customer/profile mappings previously saved under **Profiles**.
Unknown/ambiguous mappings are skipped, not guessed. Existing links are deduplicated.
Imported dates remain unknown and visibility remains **not checked**.

The dated-plan reader needs `SHEET_MASTER_LINK_HEADER` only when the post-link
column has an unusual header. The tab name must be exact: open **Master Sheet →
Dated plan**, which lists the tabs that contain data, or run
`npm.cmd run check:master-sections` with no argument to list them. A single
populated tab is selected automatically; several tabs produce an explicit choice
instead of a guess.

**Settings / More → advanced import/export** retains the older per-profile review,
CSV upload, health report and export tools as fallbacks. This is not a requirement
to recreate or reapprove content already cleaned in the master Sheet.

Existing deployments need the updated standalone connector to use `getTaskRows`:
save this file in the **separate** dashboard script and deploy a new version. Never
replace the desktop or Fudge script. No deployment was performed by the UI change.

## Sheet health (for whoever cleans the sheet)

After each fetch, **Sheet health** lists what to fix, most serious first, with a plain-language reason and fix for each, and the exact sheet row numbers. **Download cleaning checklist (CSV)** gives the same list to hand over. Checks: link filled in but Status empty (the desktop tool may post it again), posted with no or unusable link, the same link on several rows, failed rows, rows stuck on `CLAIMED`, failed rows that still have a link, rows with no Profile Name, and unrecognised or non-standard status wording. Fetch again after cleaning to confirm.

## Check it is locked

A request without the token must fail:

```powershell
Invoke-RestMethod -Method Post -Uri "<your /exec URL>" -Body '{"action":"getPostRecords","token":"wrong"}' -ContentType "text/plain"
# expected: ok = False, error = unauthorized
```

## Rotate or switch off

- **Rotate:** change `SYNC_TOKEN` in the script properties and in `.env.local`.
- **Switch off:** Deploy → Manage deployments → archive the deployment. The desktop tool is unaffected.

## Known limits

- Up to 2,000 rows per tab per fetch.
- The sheet has no publication date, so imported posts have an **unknown** publication date.
- `Posted` only reports what the desktop tool wrote. It is not proof the post is live.
- Master Sheet displays the first 200 returned rows as a safe preview. Source
  truncation above 2,000 rows is reported; no complete-coverage claim is made.
- Known-link sync is explicit, repeatable and separate from automatic view refresh;
  it does not run unattended background ingestion or Sheet result writeback.
- Your existing automation script is set to "Anyone" and returns whole rows (including Email/Password/Proxy) to anyone holding its URL. Treat that URL as a password. Adding a token to it would break the desktop tool, so it is deliberately left unchanged here.
