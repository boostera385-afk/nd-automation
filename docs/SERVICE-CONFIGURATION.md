# Service configuration: staged implementation

Updated: 2026-10-29. **Preview implemented; backend storage and activation are not.**

## Current entry point

Verified staff: Settings -> Service keyword import preview
(`/dashboard/settings/services`). Select the private `service-catalog.private.json`
next to the saved workbook snapshot under ignored `backups/business-source/`.
Do not upload the workbook, reviews, phone numbers or Names rotation data.

The file is read and validated in the current browser tab, not sent to a server,
written to the database or stored in browser storage. Refresh clears the preview.
Other browser extensions and anyone with access to the device are outside this
protection; use a trusted device. No save/import/activate action exists in this slice.

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

## Next storage/activation contract (not implemented)

1. Inspect the live schema and reuse the selected shared project; no duplicate backend.
2. Add reviewed additive versioned configuration storage and least-privilege operations.
   Verified authorized staff may stage revisions; define publish authority explicitly.
3. Require an expected version on save/activation, reject stale concurrent edits,
   preserve immutable history and audit publication/retirement. No client-supplied
   approval boolean may grant activation.
4. Preview exact rule diffs and matching fixtures; activate only after explicit review.
5. Fudge reads only its authorized business's published version, validates it and
   caches the last known good rules. Invalid/offline downloads never replace good rules.
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
