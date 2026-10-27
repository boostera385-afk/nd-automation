# Operational workbook copy: workflow review

Reviewed 2026-10-27, read-only, from the user-supplied offline Excel copy. The
workbook, credentials, cookies, proxies, customer content and individual post URLs
were not copied into the repository, sent to Supabase or used for browser tasks.
Only schema names, aggregates and issue row numbers are recorded here.

## Workflow described by the user

```text
Fudge Chrome extension -> separate raw-data sheet -> user cleanup
                      -> operational Google Sheet
                      -> desktop + deployed Apps Script + local Incogniton

Requested addition: check each exact published post next session, collect its
available comments, and update the reporting dashboard / mapped sheet.
```

The raw-data sheet, extension, actual live Google Sheet and deployed Apps Script
were not inspected. The Excel file is a snapshot, not a live connection and not
evidence of who wrote a status or when. Behavior below is based on the snapshot
and the checked-in desktop code; the live deployed script may differ.

## Actual tabs and data layout

Counts refer to non-empty rows within the named header columns, excluding the
header. Unheaded side-column material is reported separately, not treated as
account or publishing jobs.

| Tab | Snapshot findings |
|---|---|
| Incog Profile Creation | 87 mapped rows; 60 non-empty free-text Status cells, 27 blank. The declared ID column has no values. Status messages were not treated as successful profile creation without a reliable result/UUID. |
| Bulk proxy import | Despite the tab name, headers are Profile Name / Cookies / Status. 30 rows have cookie-import status text. This is the legacy cookie-tab alias supported by the code, not a proxy inventory. |
| Auto Posting | 82 mapped rows, all labelled Posted. 77 post-link cells: 61 canonical links and 16 links normalizable by removing query/fragment metadata. No duplicate link strings found. Five Posted rows have no link. |
| ND Acc Creation | No populated values under its named A:G account columns. 52 non-empty rows contain only unheaded H-column material. Do not interpret these as 52 valid onboarding jobs. |
| Auto Listing | 95 mapped rows: 63 Posted-prefixed, 15 Failed-prefixed, 17 blank Status cells. Post link column K is empty throughout. Every Posted-prefixed status contains a No link extracted marker, with Link/Chats detail text. |
| Auto Warmup | One populated row under named A:E fields with blank Status. Additional material appears in unheaded K:N columns; it is not mapped work input. |
| Auto Random Posting | No populated rows under named A:G fields. Other material is in unheaded J:K columns; do not turn it into jobs. |

Posting headers include Visibility and Pictures, not an observed-live visibility
field. Listing headers include Pictures and Chats. No named publication date,
last checked time, per-post comment collection, customer assignment or dedicated
verification-status columns are present in this snapshot. No exact Alive / Post
Deleted from ND / Post Delete from ND / Proxy Issue / Status Update Scenarios
labels were found in its shared strings. Their absence does not establish how
the live sheet is maintained or whether manual checking occurs elsewhere.

Across the two posting/listing tabs: 177 mapped rows, 145 Posted-prefixed claims,
77 recorded links and **68 Posted-prefixed rows without recorded links**. These
are publication claims, not 145 verified-live posts. The 77 links still require
customer authorization, exact profile binding and unknown-date handling before
any reviewed import or monitoring.

## What the checked-in desktop writes automatically

| Stage | Source behavior |
|---|---|
| Fetch work | `core/assets/apps_script.js` reads rows with an empty Status. General pending-row fetch can treat unheaded side data as making an otherwise unmapped row nonblank, so input validation/quarantine is essential. |
| Claim posting/listing/warmup work | `claimRow` accepts empty or Pending status and writes CLAIMED under a script lock. General fetch itself selects empty Status, not every possible pending synonym. |
| Browser profile creation | `gui/views/bulk_create_view.py` requests Created or Failed status updates. It passes the created profile ID as notes, but the current Apps Script status writer writes Status only and does not persist those notes into the ID column. |
| Profile-sheet ID | `getPendingProfiles` may generate an ID with Utilities.getUuid() when missing. That is a sheet-generated identifier, not proof of the actual Incogniton profile UUID. Do not use it blindly as a worker profile binding. |
| Cookie/proxy import | `BulkSheetImportView` and its subclasses write success/import or Failed status text. The cookie subclass writes Imported N cookies. |
| Nextdoor account onboarding | The account view requests Account Created, Not Created or profile-start error text. These are source capabilities, not evidence that onboarding was performed on this snapshot. |
| Posting/listings | `core/engine/profile_worker.py` writes Post link plus Posted for HTTP-prefixed flow results; other successful results become Posted with Link detail in Status. Failures/stops/retry exhaustion produce separate Failed messages. |
| Listing Chats | The listing view updates Chats separately and appends Chats text to its flow result. This is an account unread-badge observation, not per-post comments or verified listing conversations. |

Two result-format defects matter when migrating: the listing wrapper returns
`link + Chats detail` rather than a clean URL; and a successful flow with No link
extracted can still produce a Posted-labelled row. Both need typed result
handling, exact-target reconciliation and no blind repost-on-retry. HTTP 200 on
an Apps Script request also does not establish application-level success when
the JSON response contains an error; some existing Python writers check HTTP
status alone. These legacy behaviors were inspected, not modified here.

## What still needs review and what cannot be inferred

- This copy cannot show which cells were edited manually: there is no actor or
  status-change audit trail. Do not label its existing statuses as manually
  written without live version history or user confirmation.
- Existing post/link/status writers do not establish a next-day post check or
  automatic per-post comment collection. The new monitoring agent is a separate
  workflow requiring pairing and validated page adapters.
- Auto Posting rows **6, 29, 45, 51 and 68** claim Posted but lack a post URL.
- All 63 Posted-prefixed listing rows lack exact links and report No link extracted.
  Reconcile the actual publications before adding them to exact-post monitoring.
- The declared profile ID column is empty, and generated sheet IDs are not a
  substitute for actual profile UUID inventory and explicit customer assignment.
- Quarantine unheaded data in ND Acc Creation H, Auto Warmup K:N and Auto Random
  Posting J:K until its intended mapping is confirmed. Never shift it into
  account/password/task columns automatically.
- Imported publication dates must remain unknown unless sourced. Row order and
  Posted labels cannot establish yesterday's publication cohort.
- Keep cookies, passwords and proxy credentials worker-local/private. A workbook
  copy can still contain sensitive values even when it is not the live sheet.

## Recommended status contract (proposed, not observed in this copy)

Keep **execution** separate from **monitoring** and **synchronization**:

1. Execution Status: Pending / Claimed / Posted / Failed / Needs reconciliation.
   Written by the authorized execution system. Creating a profile or importing
   cookies has its own task result, not a post-visibility status.
2. Check Outcome: Alive / Removed with explicit evidence / Not accessible /
   Proxy issue / Login needed / Verification needed / Network problem /
   Profile error / Needs review. Save actual check time, source and profile UUID.
3. Comment observations: exact publication association, stable IDs, observed
   time, nullable totals and collection completeness. Chats stays separate.
4. Sync State: queued / delivered / failed, with versioned results and stable
   sheet record IDs rather than row-number-only identity.

**Do not clear or overwrite execution Status to trigger a visibility check.**
The legacy tool treats blank Status as runnable work; this can cause reposting.
Manual input should be limited to real authorization/customer mappings, missing
link reconciliation, evidence review and login/identity/ambiguous-page handoff,
not routine opening of every profile once the monitoring workflow is validated.

No fields, statuses, legacy scripts, browser profiles, live sheets or database
records were changed by this review. The newer snapshot aggregates supersede
earlier workbook-count assumptions for this copy only; they do not invalidate
historical test fixtures or prove the live sheet matches this file.
