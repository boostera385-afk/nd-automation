# ND Master development-copy schema verification

Verified: 2026-10-28. Scope: all seven tab names visible in the user's screenshot,
read through named-tab `A1:L1` header-only requests. The screenshot confirms the
document title and displayed tab list. Hidden/additional tabs, data quality,
row counts, formulas, permissions and deployed scripts were not verified.

The user designated this as the **development copy**, not production. The actual
spreadsheet ID and setup inventory are stored only in Git-ignored
`integrations/sheets/config.development-sheet.json`. That file is a local handoff
record, not an active connector. All execution/write flags remain disabled.

## Verified named columns

| Tab | Header mapping | Status / result |
| --- | --- | --- |
| Incog Profile Creation | A Profile Name; B Email; C Password; D Group; E Proxy; F Lat/Long; G Accuracy; H Status; I ID | Status H; declared ID I is not proof of a real Incogniton UUID |
| Bulk proxy import | A Profile Name; B Cookies; C Status | Cookie-import tab despite its name; existing dashboard alias `Bulk cookies import` must be retained |
| Auto Posting | A Profile Name; B Email; C Password; D Post Text; E Visibility; F Pictures; G Random Post Text; H Area; I Spammers; J Proxy; K Post link; L Status | Exact link K; execution Status L |
| ND Acc Creation | A Profile Name; B Full Name; C Email; D Password; E Proxy; F Status; G ID | Status F; declared ID G needs semantic validation |
| Auto Listing | A Profile Name; B Email; C Password; D Title; E Price; F Description; G Category; H Pictures; I Chats; J Proxy; K Post link; L Status | Exact link K; execution Status L; Chats I is not per-post comments |
| Auto Warmup | A Profile Name; B Email; C Password; D Proxy; E Status | Status E; no automatic random engagement authorized |
| Auto Random Posting | A Profile Name; B Email; C Password; D Pictures; E Proxy; F Post link; G Status | Exact link F; Status G; no content/destination assumptions from its title |

Trailing empty header cells are not schema fields. No separately named bulk-proxy
task tab is established by this seven-tab inventory; do not synthesize proxy jobs
from the cookie tab or silently create/rename tabs.

## Quarantine / ownership decisions

1. The screenshot shows a second posting-style header row inside **Incog Profile
   Creation**, followed by posting-shaped values under profile-creation headers.
   Header row 1 alone is insufficient to validate executable rows. Quarantine the
   mixed region and require explicit row mapping/correction in the dev copy;
   never treat post text as a password or picture links as proxy settings.
   No second-row/body values were fetched by this verification.
2. Ignore unheaded side columns. Do not shift side-data into job fields or infer
   account/customer ownership from row position or display name alone.
3. Preserve existing execution Status and Post link. Never clear Status to request
   a check, and never infer successful posting or profile creation from free text.
4. **Visibility** in Auto Posting is the intended audience, not a live-post check
   result. `Post link` identifies the exact observation target; missing links need
   reconciliation. Current data rows/link completeness were not audited here.
5. No named publication timestamp, stable backend record ID, dedicated check
   outcome/time, customer binding, approval revision or sync version was observed
   in these named header ranges. Agree additive columns/mappings before writeback.
6. Map actual profile UUID/customer/worker ownership separately. Any imported
   ID must be checked against real inventory; no new profile launch was authorized.

## Safe connection next steps

- Use the separate token-protected `integrations/sheets/reporting-sync.gs`, deployed
  as its own Apps Script project bound by Script property to the dev-copy Sheet ID.
  Do not replace the desktop or Fudge script, run its menu tasks, or rename tabs.
- The existing connector reads only safe profile/link/status/short-title columns;
  it does not enable publishing, account creation or Sheet writeback.
- Configure connector URL/token/workspace privately on the dashboard server after
  owner deployment. Validate unauthorized rejection and metadata response before
  importing known links through explicit exact-customer/profile mappings.
- The header endpoint was accessible without sign-in. Review sharing and use
  sanitized fixtures for development, especially credential/cookie/proxy columns.
  Connector authentication cannot secure a separately public spreadsheet.
- Keep this development copy as the only proposed integration test destination.
  Future writes require reviewed versioned operations and specific approval;
  access to a copy is not permission to publish its content to a live platform.

No Sheet cells, scripts, permissions or Supabase data were changed. No credential
values were retrieved or saved by these header-only requests. This completes the
seven-tab header inventory, not P0 policy decisions or production acceptance.
