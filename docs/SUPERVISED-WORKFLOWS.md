# Supervised account and content workflows — source 0.1.4

This is implemented code with synthetic acceptance fixtures, not proof of live
Nextdoor compatibility. The normal monitoring agent never claims these tasks.
The source migrations are not automatically applied by committing/pushing.

## Exact scope

- Registration: one genuine supplied first/last name, email and password form
  submission. The result is always **human handoff**, never “account created”.
  No fallback identity, invented date/location, residence claims, automatic OTP,
  consent/preference clicking, identity-challenge bypass or suspended-account reuse.
- Login: private local email/password, then exact account URL and label readback.
- Inspect/browse: verify the exact signed-in account; browse is a bounded 30-second
  read-only review. No feed likes, comments or artificial engagement.
- Edit: exact owned tracked post/listing, expected existing normalized-body hash,
  separately approved immutable text revision, matching original account/customer
  assignment, final content/audience readback and exact result-card verification.
  The local retain-all adapter can preserve explicitly reviewed existing asset IDs
  and order. Adding, removing or reordering attachments is not implemented. The
  default text-only plan refuses any attachment nodes, including hidden nodes.
  Both variants check the original card, composer before/after filling and saved
  result; missing or changed result evidence requires reconciliation, never retry.
  These are synthetic fixture checks, not live platform compatibility or byte proof.
- Delete/block: exact target, separate dashboard and local destructive confirmation,
  same-target dialog and result evidence, one final confirmation click. A missing
  result is `needs_reconciliation`; mere page absence is never deletion evidence.

## Authorization and execution

1. Review the applicable migrations, active verified staff session and exact local
   worker/customer/profile assignment. `/dashboard/workflows` stays disabled when
   `reporting_supervised_workflow_version()` is unavailable.
2. Select the operation and exact IDs/URLs. Editing requires an already approved
   text draft/revision of the same target kind. Review and confirm the manifest.
   The dashboard sends only that strict non-secret manifest; no credentials,
   identity documents, OTP, private paths or browser selectors are accepted there.
3. Privately create `.monitoring/workflow.private.json` with four required keys:
   `manifest` (the exact reviewed dashboard JSON), `reviewed: true`, `selectors`
   and `values`. An edit may additionally have the local-only `attachments` review
   described below. Keep it on the authorized device and out of repos/archives.
4. Each selector is a locally reviewed bounded locator, never remote JavaScript.
   All operations require `account`, `login`, `challenge`, `disabled`.
   Login additionally requires `form`, `email`, `password`, `submit`;
   registration also requires `first_name`, `last_name`. Local `values` must
   contain exactly those genuine identity fields plus
   `genuine_identity_confirmed: true` for registration. Other operations use `{}`.
5. Post actions additionally require `post_root`, `post_link`, `post_author`,
   `post_body`, `post_media`, each scoped to the exact selected post.
   Edits also require `edit_open`, `edit_root`, `body`, `title`, `price`, `category`,
   `audience`, `submit`, `result_title`, `result_price`, `result_category`,
   `result_audience`, `edit_media`. `post_media` and `edit_media` must select
   individual attachment nodes, not gallery containers or unrelated avatars.
   Older edit plans without `edit_media` now fail preflight and need local review;
   the runner must inspect composer attachments even for text-only edits.
   This adapter expects native category/audience selects and
   exact saved result labels; other UI variants are not claimed supported.
   Delete/block additionally require `action_open`, `dialog`, `dialog_target`,
   `confirm`, `result`, `result_target`. Target selectors must expose an exact
   canonical href. Existing result markers are refused as fresh-action evidence.
6. Offline validation makes zero network/browser calls:

   ```powershell
   python supervised_workflows.py --connection .monitoring/worker.json --plan .monitoring/workflow.private.json
   ```

   Later authorized execution adds `--execute --confirm-authorized`; delete/block
   additionally require `--confirm-destructive`. It claims **one** supervised task,
   compares the entire manifest to the local plan, shares the monitor lock and
   refuses unresolved monitoring/publishing/browser-task checkpoints. There is no
   background scheduler or bulk signup/moderation mode.

The existing body fingerprint is SHA-256 of UTF-8 text after splitting whitespace
and joining with one ASCII space (`supervised_workflows.body_hash`). Review that
exact source and ownership before approval; never guess a hash from a title.

## Local retain-all attachment review

For an exact text edit only, an optional fifth local plan key is:

```json
"attachments": {
  "mode": "preserve",
  "id_attribute": "data-media-id",
  "ids": ["reviewed-asset-1", "reviewed-asset-2"]
}
```

This fragment is illustrative, **not a real platform adapter**. Use only actual
stable platform asset identifiers individually reviewed on the owned post and in
its composer, in their exact order (1–10, distinct bounded opaque IDs). The local
attribute must be a reviewed `data-*` attribute, never `src`, signed URLs, private
paths or credentials. Do not inject IDs into the page to satisfy this contract.
If the platform exposes no reliable common asset identity across card/composer/
saved result, this variant is unsupported and must stop for a human.

Selectors must cover all actual attachments, including hidden nodes, while
excluding container placeholders and unrelated media. Missing/lazy-loaded media
may stop a legitimate operation; never narrow selectors to manufacture success.
IDs attest DOM identity/order only: no download, image-byte verification or proof
of content permission is performed. Actual platform selector/asset semantics and
visual preservation require explicit live acceptance. Do not enable this adapter
based on synthetic fixtures alone.

Only the hash of selectors plus the local attachment review enters the result.
The review is not queued, journaled or uploaded. Existing hosted manifests remain
unchanged; approved draft content still describes the text change, not replacement
media. No upload, remove or reorder control is invoked. Any post-save mismatch is
`needs_reconciliation`, preserves the checkpoint and blocks blind replay. A
failed save is not rolled back or retried automatically, since its effects may be
unknown. Adding/removing/reordering assets needs a future separately approved
protocol, including explicit destructive confirmation for removal.

## Handoff and recovery

The runner closes its page and attempts to stop **only** the profile it launched.
A handoff preserves the site's state in that Incogniton profile; a human must
reopen it and personally finish verification/location/OTP/consent. Re-check account
identity with a new explicit inspect task afterward. Never repeat registration to
“resume”; identical claimed mutations are blocked from blind new-request replay.

`.worker-state/automation-journal.json` is flushed before any action. Crashes leave
the claim unresolved and block all browser work. Receipt delivery can retry, not
the action. Exact server completions replay; changed/cancelled completions are
rejected. Terminal checkpoints discard the task payload/result. Credentials are
never stored in this journal or uploaded in the result.

- `agent.py --connection … --recover-browser-results --confirm-authorized` replays
  a saved result only, without Playwright or profile calls.
- An acknowledged uncertain action/cleanup requires actual operator inspection,
  then `--confirm-browser-inspection TASK_UUID --confirm-authorized`.
- A claim with no saved result requires actual expired server-lease reconciliation
  in the dashboard, stopped runner and inspected profile/account, then
  `--confirm-browser-reconciled TASK_UUID --acknowledge-action-ambiguity
  --confirm-authorized`. The local command is an **attestation**, not server proof.
- Never delete an unresolved checkpoint, issue a new request ID to bypass history,
  or call a failed/uncertain action “did not run”.

Workflow receipts do not modify publication visibility or yesterday's cohort
coverage. Those still require explicit sourced checks. Real DOM, OS ACLs,
cross-device profile ownership, account/provider permissions and live acceptance
remain release gates. Private files rely on protected OS user directories/ACLs;
no encryption-at-rest or full secrets-vault implementation is claimed.
