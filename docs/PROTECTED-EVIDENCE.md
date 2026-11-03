# Protected evidence storage (F32)

Status: local engineering candidate only. The SQL is a **local proposal**
(`supabase/proposals/protected_evidence.sql`), **not applied**; it creates a
private storage bucket and new table, which requires separate explicit
approval. No evidence has been uploaded, held, deleted or live-accepted. The
retention policy itself remains an open operator decision; **no automatic
deletion, retention scheduling or scheduled job exists**.

## Design

- Single table `reporting_evidence`: one row per uploaded object with exact
  organization/customer/publication foreign keys, PNG/JPEG mime only, ≤3 MiB,
  SHA-256, operator-supplied zoned observation time, object key forced to
  `<org>/<id>`, and state `pending → ready → delete_requested → deleted`
  (plus optional `held`). RLS: workspace members may view only `ready` rows of
  customers they can see; staff see pending rows.
- Upload flow (web action `uploadEvidence`): verify image bytes/type
  client-side first, `reporting_reserve_evidence` reserves capacity under a
  per-workspace lock (≤10,000 non-deleted rows), upload to the private bucket,
  then `reporting_evidence_action('ready')` finalizes. A failed upload leaves
  a visible pending reservation; operators retry that reservation, never a
  duplicate. Upload changes **no publication status**; observed time is
  operator-supplied and does not establish post visibility.
- `review_after` is an optional human-selected review date — explicitly **not
  a deletion deadline**; nothing acts on it automatically.
- Holds (`held`) block delete_request; only administrators release holds. New
  holds fail visibly once a delete was authorized.
- Delete is **two-phase**: `request_delete` authorizes and irreversibly locks
  metadata, the object is removed from the bucket, then `finish_delete`
  records the tombstone. Ambiguous removals keep a durable tombstone for
  explicit reconciliation; nothing is silently erased.
- Deliberately absent: worker upload path, signed/public URLs, publication
  status writes, cross-tenant access, and any retention/deletion schedule.

## Remaining gates

- Operator retention/approval decision (proposed 30-day review discussed;
  nothing installed), including who may hold, view, download and delete.
- Hosted application (bucket creation) and live customer-isolation tests.
- Worker-side screenshot capture/scoped upload remains a separately reviewed
  path; none exists yet.
