# Publishing preparation and protocol status

## Delivered versus pending

- `/dashboard/content`: text-only post/listing drafts, unpublished preview,
  exact customer/profile assignment, immutable revision history, human approval,
  return-to-draft and archive. Staging migration: `20261027200411`.
- `/dashboard/profiles`: previewed inventory CSV import, UUID/name/group claims,
  explicit archive/reactivate and assignment suggestions. Staging migration:
  `20261027200913`. Inventory is not a live readiness check.
- `/dashboard/publishing`: staff-only protocol-job inspection, pending-job
  cancellation and expired-operation acknowledgement. Degrades to a setup notice
  when its migration is absent. **No enqueue/publish server action or button.**
- `202610270006_publish_jobs.sql`: publishing protocol applied to hosted staging
  as **`20261030164110 publish_jobs_v1`** (2026-10-30). The durable queue is live,
  but **no submit adapter exists** and no enqueue action is exposed; the bundled
  `agent.py` still allowlists monitoring RPCs only. See
  `docs/DB-DEPLOYMENT-20261030-COHORT.md`.

## Protocol rules implemented locally

1. Queue only the current approved revision, unchanged exact target and an active
   staff work session younger than ten hours. Queueing requires an explicit RPC;
   page views and approval never queue anything.
2. Snapshot content, customer, profile, account label and worker at queue time.
   A claim never substitutes a later draft or target. Withdrawn approval/changed
   pending assignments are cancelled on claim; in-flight completion records the
   originally authorized snapshot.
3. One durable job per approved revision, permanently. Outstanding, submitted or
   ambiguous work blocks another job for that draft even after reapproval.
4. Serialize publishing and monitoring leases per worker; refuse a second lease
   while one is outstanding, including an expired lease awaiting acknowledgement.
5. Require credential, job ownership, live lease, strict bounded result fields,
   adapter fingerprint, canonical kind-matching URL and zoned lease-window time.
   Replay of completed jobs returns false, without repeating database effects.
6. Submitted results create a `worker_publish` publication with **not_checked**
   visibility. Normalize `www` URLs; an existing customer URL becomes
   `needs_reconciliation`, not a duplicate publication. Operational notes remain
   staff-only; customer-readable notifications contain no worker diagnostics.
7. Expired operations become `needs_reconciliation`, never safe-to-retry errors.
   Acknowledgement is not proof that nothing was submitted. There is currently no
   automatic or manual retry-release RPC for ambiguous/submitted drafts.
8. Revocation cancels pending jobs and denies future credential use. Worker
   reassignment refuses outstanding publishing or monitoring leases. Human session
   pause/end prevents new claims but does not pretend to abort a submission.

## Still required before live publishing

- A bounded, explicit local publisher that refuses arbitrary code, unintended
  audiences, implicit edits/deletes/blocks and legacy random engagement.
- Verified browser identity/audience and exact-submit result capture; no first-post
  fallback, no `Posted` result for a target that was merely found, no blind retry.
- Durable local submit-intent/result recovery: a crash or lost HTTP response after
  clicking submit must not cause a second submit.
- Safe media support, approved local paths, verified attachments, scheduling and
  missed-window policy (none implemented by this milestone).
- Explicit per-session user authorization and supervised fixture/live acceptance.
  Do not use the development Playwright MCP on customer profiles.

The desktop app remains unchanged and available. No browser, account, cookie,
proxy, Sheet or customer-content operation ran during this implementation.
