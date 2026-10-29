# Service configuration: staged implementation

Updated: 2026-10-29. **Catalog protocol deployed; local preview and explicit inactive staging implemented. Activation/diff UI and Fudge rule application remain incomplete.**

## Current entry point

Verified staff: Settings -> Service keyword import preview
(`/dashboard/settings/services`). Select the private `service-catalog.private.json`
next to the saved workbook snapshot under ignored `backups/business-source/`.
Do not upload the workbook, reviews, phone numbers or Names rotation data.

The file is read and validated in the current browser tab, not sent to a server,
written to the database or stored in browser storage during preview. A separate
confirmed **Save inactive revision** action sends only contract-validated service
rules to the backend. Notes, counters and workbook contents are excluded. Refresh
clears the local preview; saved backend revisions remain.
Other browser extensions and anyone with access to the device are outside this
protection; use a trusted device. No activation/apply action exists in this slice.

Rules and each message list render at most 25 items per page; totals and navigation
keep remaining rows accessible. Clear local preview releases the displayed model
and selected file reference. JSON parsing/validation is still synchronous within the
1 MiB/500-rule input ceiling; real browser interaction/load measurement remains
pending. Pagination is not evidence of unlimited catalog capacity.

## Validation contract

- UTF-8 input <= 1 MiB; 1–500 service rows; bounded text and supported row columns.
- Keep source keyword/search term/family/subcategory explicit; missing classification
  blocks future import rather than inventing a general-repairs fallback.
- Require explicit topic/family-inventory flags; invalid or blank flags are unresolved.
- Match current Fudge list delimiters: pipe, semicolon, newline. A comma inside a
  phrase is not silently interpreted as a separator.
- Detect collisions under current Fudge lookup normalization. Flag them for an owner,
  never auto-merge or delete a rule. This ASCII normalization itself needs reviewed
  Unicode support before non-ASCII service catalogs are accepted.
- Historical Sheet status is not rule activation authorization. Required/exclusion
  signals remain blank if supplied blank; no synonyms are invented.
- The snapshot's missing-keyword list is informational, not a fresh read of every
  live Structure requirement. Exact mismatch may be covered by a family rule; prove
  matching with fixtures before creating aliases.
- Ignore report metadata and activation claims from the supplied JSON. Notes and
  collection counts are not included in the preview result model.

## Deployed storage protocol

`supabase/migrations/20261029165237_service_catalog_v1.sql` adds three RLS tables: immutable
rule revisions, one head per business, and immutable activation events. No source
review or publishing/worker-claim function is replaced. The live schema was inspected
read-only before deployment; no matching catalog table existed. Hosted version is
`20261029165416`; follow-up index source `20261029165727` maps to hosted
`20261029165815`. Both are applied; do not reapply or blindly push/reset migrations.
See `DB-DEPLOYMENT-20261029-CATALOG.md` for smoke/grant/hash/advisor evidence.

- `reporting_save_service_catalog_v1(org, rules, expected_revision, request_id)`:
  verified owner/admin/operator can stage an immutable revision. Expected latest
  revision rejects stale edits; same request ID replays only identical content,
  base version and actor. Staging does not activate.
- `reporting_activate_service_catalog_v1(org, revision_id, expected_version, request_id)`:
  verified owner/admin only; checks the expected activation version and same-business
  revision, records an activation event, supports replay and explicit rollback by
  creating a newer activation generation pointing at an older revision.
- `reporting_get_service_catalog_v1(org)`: verified staff read only the published
  snapshot, or null if no revision is active. Direct draft/head/audit reads remain
  RLS staff-scoped. Anon and direct client mutations are denied.

Public RPC wrappers are SECURITY INVOKER; constrained private implementations are
SECURITY DEFINER with empty search paths and explicit verified-membership checks.
Writes serialize per business and recheck access after the lock. Server validates
exact bounded fields, flags, signal arrays and collector-key collisions. The client
contract in `lib/service-catalog-contract.ts` leaves a 256 KiB transport budget
within the 512 KiB server JSONB ceiling. No service-role key is involved.

Local PGlite and hosted rollback-only SQL smoke cover version/replay conflicts,
rollback and access denials; local tests also cover operator/verification denials.
They do not establish real
PostgreSQL concurrent-connection, hosted REST/Auth, advisor or browser acceptance.
Fudge's matching preview cache is implemented but production download is separately
false and no cached rules are applied to collection/Sheets.

## Remaining deployment/activation work

1. Inspect the live schema and reuse the selected shared project; no duplicate backend.
2. Accept the explicit inactive-staging UI, then build exact revision diff/activation
   UI with explicit owner/admin publication confirmation. No automatic activation.
3. Require an expected version on save/activation, reject stale concurrent edits,
   preserve immutable history and audit publication/retirement. No client-supplied
   approval boolean may grant activation.
4. Preview exact rule diffs and matching fixtures; activate only after explicit review.
5. Accept Fudge's gated published-version download/cache against real Auth/REST;
   implement the separately approved application path. Invalid/offline downloads
   must never replace good rules; review freshness and storage-retention policy.
6. Resolve Sheet-vs-backend ownership before cutover. Existing Services sync must not
   overwrite backend configuration or compete as an independent writer.
7. Record classification rule version separately from immutable original review data;
   material changes remain drafts. Configuration does not approve third-party media,
   testimonials or execution.
8. Test cross-business denial, revoked staff, concurrent edits, replay, rollback,
   offline/restart behavior, malformed versions and existing collector/Sheet parity.

No database migration or production activation is authorized by a preview result.
Live signed-in upload-control/visual acceptance remains pending; local fixture tests
do not establish it. Apply the master plan's independent intake and browser gates.
