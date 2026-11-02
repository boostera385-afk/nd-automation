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
  when its migration is absent. Approved draft detail now has a separate, explicit
  supervised queue action, gated by the deployed publisher safety version check.
- `202610270006_publish_jobs.sql`: publishing protocol applied to hosted staging
  as **`20261030164110 publish_jobs_v1`** (2026-10-30). The durable queue is live,
  with a separate opt-in, one-job text post/listing runner (`publisher.py`, added
  2026-11-02). The normal monitoring agent still never claims publishing work.
  The new claimant guard serializes against browser tasks too and validates the
  exact verified session owner. Both November 2 safety migrations are applied.
  Live adapter/account acceptance, media and scheduling remain open. See
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

## Still required before live acceptance

- The bounded local publisher and exact content/identity/audience/result checks
  now exist with unit and isolated synthetic-browser fixtures. Review the real
  authorized DOM and accept each supported account/composer before live execution.
  It refuses arbitrary code, unintended audiences, implicit edits/deletes/blocks
  and legacy random engagement; it never accepts a first-post fallback.
- Durable local submit-intent/result recovery now exists; real filesystem/OS ACL,
  cleanup and interrupted-result delivery acceptance still require an operator.
  A crash or lost response after clicking submit must never cause a second submit.
- Safe media support, approved local paths, verified attachments, scheduling and
  missed-window policy (none implemented by this milestone).
- Explicit per-session user authorization and supervised fixture/live acceptance.
  Do not use the development Playwright MCP on customer profiles.

The desktop app remains unchanged and available. No browser, account, cookie,
proxy, Sheet or customer-content operation ran against a real platform during
this implementation. The isolated fixture browser used synthetic HTML only.
See `SUPERVISED-PUBLISHING.md` for exact commands and the remaining handover gates.
