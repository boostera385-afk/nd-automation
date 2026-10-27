# Sheet-first dashboard

## Daily use

1. Continue **Fudge → source Sheet → cleanup → ND master Sheet** as before.
2. Open **Home**. Start your work session using the top bar.
3. Open **Master Sheet**, select Auto Posting / Auto Listing, and use **Sync known
   profiles now** to save reported links using existing mappings. No retyping.
4. In **Run automation**, select profiles and confirm a monitoring batch once.
   Your paired agent plans due read-only checks. Enablement is per work session.
5. Open **Results** for links, saved visibility checks, comments and problems.

View refresh is automatic every minute while the page is visible (optional).
It never writes data or starts browser jobs. Link synchronization is explicit,
idempotent and uses saved profile/customer mappings, not guessed assignments.
Unknown publication dates remain unknown; a Sheet Posted/Alive label is a claim,
not an automatically verified observation. Comments may be incomplete samples.

## One-time setup

- **Settings / More → Customers**: create authorized customer records.
- **Settings / More → Pair laptop**: pair the private monitoring worker, install
  compatible browser dependencies and validate its page selectors before a pilot.
- **Profiles**: select an existing profile by name/group/exact UUID, customer and
  worker, and save its mapping once. The Sheet Profile Name must match exactly.
  Duplicate names are not resolved by guessing. Inventory CSV remains an advanced
  setup fallback until live discovery is connected, not a recurring daily task.
- Configure the separate read-only dashboard connector following
  `integrations/sheets/README.md`. Required server settings: `SHEET_SYNC_URL`,
  `SHEET_SYNC_TOKEN`, `SHEET_SYNC_ORGANIZATION_ID`. The workspace UUID is shown in
  the connection instructions under Settings. Tokens stay private/server-side.

Master Sheet exposes safe metadata previews for the desktop tabs. Reading cookie,
proxy or account tabs does **not** fetch their secret fields or turn them into jobs.
The legacy cookie-tab alias is supported without renaming the actual Sheet.
Old connector deployments still support post-link sync, but need a new deployment
of the separate dashboard script for the new all-tab metadata preview. Never
replace the Fudge or desktop Apps Script with this connector.

## Preserved versus unavailable

All existing dashboard URLs remain available through Settings / More or Results
fallback links. Manual post entry, observations, checks, CSV imports/exports,
reports, drafts, worker revocation and recovery have not been removed. They are
no longer promoted as ordinary daily work.

Dashboard publishing/listings, account/profile creation, cookie/proxy execution,
media, scheduling, automatic Sheet writeback and unattended ingestion remain
unimplemented or unvalidated. Run automation labels these tasks **Desktop only**;
there are no pretend Start buttons. Use the preserved desktop app for those
tasks and avoid overlapping operations on the same profile.

No customer session, live Sheet or browser operation was used to validate this
milestone. Code/fixture tests are not signed-in or live automation acceptance.
