# Read-only sheet sync (setup guide)

Lets the dashboard **read** the status of the posts your desktop tool already writes to the Google Sheet. It never writes to the sheet and never touches the script your desktop tool uses.

```
Google Sheet  ←(read only)—  NEW standalone Apps Script  ←(HTTPS + secret token)—  Dashboard server
                             returns 4 columns only
```

Only these columns leave the sheet: **Profile Name, Post link, Status** and a one-line title (**Post Text** on *Auto Posting*, **Title** on *Auto Listing*). Email, Password, Proxy, Cookies and every other column are never read.

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
```

Restart the dashboard server so it reads the new values. Neither value is ever sent to the browser.

## 5. Use it

Dashboard → **Sheet sync** → choose the tab and customer → **Fetch sheet status**. You see every status in the sheet, rows that need attention, and new links ready to import. Imported posts are recorded as **not checked**.

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
- Your existing automation script is set to "Anyone" and returns whole rows (including Email/Password/Proxy) to anyone holding its URL. Treat that URL as a password. Adding a token to it would break the desktop tool, so it is deliberately left unchanged here.
