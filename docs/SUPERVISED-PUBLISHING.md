# Supervised text publishing pilot

## Source 0.1.3 update (code-first; supersedes older missing-code statements)

Approved JPG/static PNG/static WebP images, original-session scheduling and
selected-revision bulk authorization are now implemented in source. New migrations
`202611020003_publish_scheduling.sql`, `202611020004_automatic_sheet_mapping.sql`
and `202611020005_approved_media.sql` are **not deployed**. The one-job/default
text workflow below remains compatible; no new mode is enabled automatically.

`publisher.py` defaults to one job. Multiple jobs or due-job watching additionally
require `--confirm-batch`, with `--max-jobs` 1–20 and `--watch-minutes` 0–480.
These caps govern new dispatch; an already authorized in-flight operation may
finish within its own lease/budget. Pauses/closed sessions/revocations still gate
claims server-side; expired dispatch windows cancel, never catch up next session.
Every result and owned-profile cleanup must settle before another claim. Any
non-submitted/ambiguous result stops the whole sequential run.

Image execution additionally needs an explicitly supplied private `--media-registry`
and a locally reviewed per-form `media` adapter with exact `input`, `preview`,
per-preview `ready` and result-card `result` selectors. The registry maps approved
asset UUIDs to private absolute paths on this device. Descriptors bind name/MIME/
size/SHA-256/order and explicit rights/privacy attestations, not paths or image
URLs. The worker checks bytes before launch and via browser FileList SHA-256
before Submit. Missing/changed/unsupported assets stop without text-only fallback.
The new claimant is capability-gated; old workers skip image jobs.

`stage_media.py` registers selected local originals offline; `import_media.py`
supports approved public HTTPS or permissioned Drive binary imports into private
managed local objects. Source URLs/tokens are not stored in descriptors/registry.
The importer forbids private-network/DNS-rebinding targets, authenticated redirects,
unsupported content/size and executable formats. Drive access is sent only to the
exact Google API blob endpoint; download restrictions/abuse warnings are not bypassed.
All imports still require human rights, provenance and privacy/EXIF review. Signature
and dimension validation is not a full image decoder, malware scanner or metadata
scrubber. Inspect actual matching originals before approval. Platform transcodes
cannot be fingerprint-verified from thumbnail count alone; visual live acceptance
is still needed. No local original is changed/deleted, and upload buffers create
no temporary copy. Only importer-owned staging files are cleaned up.

These features were implemented/tested with local synthetic fixtures only. The
operator has requested completing the remaining code before configuration/live
testing. No secrets, live jobs, configuration changes or platform operations are
requested or implied by this documentation update.

## Original one-job text pilot

This is implemented code with unit/database fixtures and a real isolated-browser
synthetic DOM test, **not accepted live publishing or a client handover**. It does
not implement media attachments, scheduling, bulk posting, account onboarding,
edits/deletes, replies, random engagement or suspension/challenge evasion.

## Authorization and exact target

1. Use an authorized, non-suspended account. A person must resolve account
   restrictions with the platform; never use this runner to evade them.
2. Register the local agent and bind the exact Incogniton UUID/customer/account.
   The scoped credential is private; no service-role key is accepted.
3. Prepare a text post or text listing in Content. Review and approve its exact
   immutable revision and target. Approval alone never queues or submits.
4. Start the approving operator's work session. From the approved detail page,
   explicitly authorize **Queue approved revision for supervised publishing**.
   This creates one durable job; it does not open a browser or click Submit.
5. Stop the normal agent before using the publisher: both hold the same local
   device lock. Cross-type database leases also prevent overlap, including expired
   leases that still need operator reconciliation.

The database migrations are `202611020001_automation_session_gate.sql` and
`202611020002_publish_dispatch_guard.sql`, applied with operator approval on
2026-11-02. The latter must be present before the new queue action is offered.

## Local adapter acceptance (required before any live execution)

Copy `apps/worker/publishing-adapter.example.json` to the ignored local path
`apps/worker/.monitoring/publishing-adapter.json`. It deliberately fails preflight
until a person reviews the actual authorized UI and configures:

- `accounts`: exact Incogniton UUID keys, each with an exact canonical account
  `url` (`https://nextdoor.com/profile/...`) and matching dashboard account `label`.
  These are identities, not credentials. Never guess or reuse another account.
- `account`: one visible signed-in account anchor with its own matching href and
  displayed account name; a post author's link is not the signed-in identity.
- `login` and `verification`: reviewed human-handoff selectors.
- `forms`: only supported `post`/`listing` composers. Every non-optional selector
  must identify exactly one intended visible node. The known desktop open/body/
  submit selectors are starting references only, not a live acceptance result.
- `audiences` and `audience_labels`: an exact option selector and resulting visible
  label for all three supported explicit audiences; no random group selection.
- Result selectors: a scoped card containing the **entire exact approved body**,
  the exact author account href and one canonical kind-matching permalink. A
  listing also requires its exact title. A generic first-feed-card/share-link
  fallback is forbidden. If the UI cannot provide this evidence, do not enable it.
- For listings: title and decimal-USD price fields, a native category select whose
  displayed option equals the approved category, and result title. Unsupported
  custom category controls stop safely rather than being guessed.

Keep only actually reviewed form kinds in `forms`; an absent kind is refused.
Set `reviewed: true` only after that inspection. This attestation is local, not
proof of browser compatibility or live acceptance.

From `apps/worker`, offline validation (no network, profile or submit):

```powershell
.\.venv\Scripts\python.exe publisher.py --connection .monitoring/worker.json --adapter .monitoring/publishing-adapter.json
```

Only after exact queued-content authorization and supervision, run one job:

```powershell
.\.venv\Scripts\python.exe publisher.py --connection .monitoring/worker.json --adapter .monitoring/publishing-adapter.json --execute --confirm-authorized
```

The command claims at most one job. It does not import a schedule, log in, solve
verification, run the legacy publisher wholesale or modify any unapproved content.
It refuses active/unknown profiles and unsupported local adapters. Composer text,
identity, price/category and audience are read back before the single Submit click.
The observed submission time is recorded in UTC; it is not a fetched platform
creation timestamp or a visibility guarantee.

## Crash, network and cleanup recovery

The private `.worker-state/publishing-journal.json` is flushed atomically before
launch and again **before** the only submit attempt. It contains customer text
while awaiting resolution; acknowledged/reconciled terminal records clear that
text and retain only job/lease/profile identifiers. Protect local ACLs/backups and never commit/share it.
Raw exceptions and credentials are not sent as failure receipts.

- `claimed` or `submit_intent` without a recorded result blocks new work. Never
  delete the file or rerun the browser action to force progress. Inspect the exact
  account and reconcile the expired hosted operation first. A submission may have
  reached the platform even if its HTTP/browser response was lost.
- `result_ready` replays only the identical completion, never browser work:

  ```powershell
  .\.venv\Scripts\python.exe publisher.py --connection .monitoring/worker.json --recover-results --confirm-authorized
  ```

- After **actual** operator inspection/cleanup and hosted reconciliation, attest
  the exact unresolved job (this command verifies neither the server nor the UI):

  ```powershell
  .\.venv\Scripts\python.exe publisher.py --connection .monitoring/worker.json --confirm-reconciled <exact-job-uuid> --confirm-authorized
  ```

  A saved result cannot be discarded by this command. Submitted/ambiguous drafts
  remain blocked by the backend; this is not a retry-release operation.

## Evidence required before client handover

Run the suite and isolated synthetic browser test, then a separately authorized
real one-post and one-listing pilot. Verify exact account/audience/content/URL,
that one and only one platform submission occurred, receipt replay after a lost
response, safe pause/expiry/revocation and local cleanup. Follow with a read-only
visibility check and verify Results/Comments. Confirm retention/restore and access
isolation separately. No live pilot or client-content submission occurred while
implementing this module.
