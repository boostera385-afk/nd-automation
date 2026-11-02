# ND Sheet writeback v1 — operator setup and acceptance

**Source 0.1.3 follow-up:** automatic check/publication-to-outbox mappings and
separately confirmed bounded sequential delivery/polling are now implemented.
`202611020004_automatic_sheet_mapping.sql` is local source, not applied remotely.
Its controls live at `/dashboard/settings/sheet-mapping` and default to paused.
Mappings reserve exact stable row IDs/revisions, log event-to-outbox evidence,
stop new automatic writes when their author loses verified staff access, and
refuse rebasing while intents remain pending/leased. Technical failures keep
their actual outcomes, not fabricated removal. New claims cannot skip another
in-flight batch. Existing queued intents are not cancelled by pausing a mapping.
The deliverer can explicitly opt into `--max-intents` 1–20 / `--watch-minutes`
0–480 only with `--confirm-batch`; each claim is still one intent, and any conflict
stops the run. Receipt-only recovery cannot watch/drain a batch. Old statements
below about these pieces needing code describe the 0.1.2 pilot, not current source.
The user requested code completion first; do not start configuration/live testing
merely because this later-stage setup guide exists.

Implemented: a separately authorized **one-intent** local deliverer, strict
dashboard enqueue validation and a separate atomic Apps Script connector. This
is not an installed/live-accepted connection, scheduled delivery or automatic
monitoring-result-to-Sheet mapping. No existing read-only sync or fudge deployment
is changed. Configure an authorized **test copy**, not the shared review-only Sheet.

## 1. Prepare an isolated test target

1. Back up the intended test Sheet privately. Confirm the owning ND workspace and
   verified staff user; their IDs are shown at Settings → Sheet writeback in this
   source revision. The existing hosted writeback RPCs are required; no additional
   migration or service-role credential is required by this deliverer.
2. Use exact tab names `Auto Posting` and/or `Auto Listing`. Add headers
   **ND Row ID** and **ND Revision** once. Preserve every existing column. Header
   spelling/case is exact; duplicate required headers are rejected.
3. Existing rows you intend to update need a unique UUID in ND Row ID and `1` in
   ND Revision. Do this deliberately on the test copy, never by row-number guessing.
   New appended rows receive the reviewed UUID and revision `1` from the connector.
4. The connector can write only **Profile Name, Post link, Status, Post Text,
   Title**, further restricted by the owner in step 2. It never reads or writes
   Password, Email, Cookies, Proxy or other credential columns. Source text should
   be authorized and contain no secrets; the fixed column names alone cannot prove
   that the content is safe. Cells are literal strings, never executable formulas;
   `null` explicitly clears only a selected allowed cell.
5. Stop competing desktop/fudge/scripts on the writable target columns and prevent
   human edits, sorting or row changes during each supervised write. One standalone
   script project must own this connector/target. Its ScriptLock serializes its own
   deployments, **not other script projects or people**. Google Sheets provides an
   atomic batch, not a general compare-and-swap lock against collaborators.

## 2. Deploy a NEW Apps Script project

1. Create a new standalone Apps Script project. Copy
   `integrations/sheets/reporting-writeback.gs` into `Code.gs`. **Do not replace**
   `reporting-sync.gs`, an existing fudge Apps Script or the desktop connector.
2. In **Services → +**, add **Google Sheets API**, version **v4**, identifier
   **Sheets**. If using a standard Cloud project, enable its Sheets API as Google
   requires. Review the requested scopes/permissions; ask the administrator if
   organization policy blocks it rather than bypassing policy.
3. In Project Settings → Script properties set:

   | Property | Private value |
   | --- | --- |
   | `SHEET_ID` | Authorized test spreadsheet ID, not a full link |
   | `ORGANIZATION_ID` | Exact owning ND workspace UUID |
   | `WRITE_TOKEN` | Fresh private random URL-safe token, 32–200 characters |
   | `WRITE_ENABLED` | Initially `false`; use literal `true` only for the authorized pilot |
   | `WRITE_COLUMNS_JSON` | Example below, reduced to the columns you approve |

   ```json
   {"Auto Posting":["Profile Name","Status","Post link","Post Text"],"Auto Listing":["Profile Name","Status","Post link","Title"]}
   ```

   Generate a token in your own private terminal, not chat, screenshots or source:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
   Save it privately. The script contains no embedded token or customer Sheet ID.
4. Deploy → New deployment → Web app. Execute as the authorized owner; allow
   the server transport access permitted by your organization. The token is still
   required for **every** POST, and the Sheet itself need not be publicly shared.
   If an `Anyone` web-app deployment is prohibited, do not weaken policy: this
   connector transport is not compatible until an approved authenticated transport
   is implemented. Keep the `/exec` endpoint private. Opening it with GET returns
   `post_only`, intentionally.
5. Do not add triggers. Keep `WRITE_ENABLED=false` until ready for the one-intent
   supervised pilot. Never deploy separate script projects to write the same
   target; they would not share a lock.

## 3. Configure the local runner privately

From `apps/worker` in the source folder:

```powershell
New-Item -ItemType Directory -Force .monitoring
Copy-Item sheet-writeback.example.json .monitoring/sheet-writeback.json
```

Edit only the ignored copy. Set the existing project's HTTPS `supabase_url`, its
**publishable** application key, exact `organization_id` and `operator_id`, new
`connector_url`, and matching `connector_token`. Leave `enabled: false` initially.
Never use an admin/service-role/management key. Do not store an ND/platform or
Google password in this file. Protect the folder with your OS account permissions.
The example is deliberately unconfigured and contains no usable connection.

Offline check (stdlib Python; no browser, Google request or sign-in):

```powershell
python sheet_writeback.py --config .monitoring/sheet-writeback.json
```

This must report `offline_preflight`, `configuration_valid: true`,
`network_requests: 0` and `sheet_writes: 0`. It does not verify connectivity.
Use the current source UI; these changes are not automatically on the previously
deployed dashboard until its next separately reviewed deployment.

## 4. Queue and run ONE supervised append

1. Review/cancel any older pending generic intents first. The new v1 connector
   deliberately refuses legacy row-number updates or unsupported/secret columns.
   Do not reuse a real customer's unrelated pending queue as test material.
2. Set private local `enabled: true` and Script property `WRITE_ENABLED=true` only
   after confirming exclusive writable-column ownership and the authorized target.
3. In Settings → Sheet writeback choose append, exact allowed tab, and a JSON row
   with a **fresh** UUID (example UUID below is documentation, not a reusable live ID):

   ```json
   [{"ND Row ID":"11111111-1111-4111-8111-111111111111","Status":"Pilot checked"}]
   ```

   Generate a fresh UUID with `python -c "import uuid; print(uuid.uuid4())"`.
   Confirm the exact intent. A stable queue key/request ID identifies this logical
   write; do not create another request just because a response is slow.
4. Explicitly run one job, signing in at your **local terminal**:

   ```powershell
   python sheet_writeback.py --config .monitoring/sheet-writeback.json --sign-in --execute --confirm-authorized
   ```

   Enter your verified staff email and password at the local prompts. Password
   input is hidden; passwords and refresh tokens are not saved. This does not
   extract a browser session. MFA/SSO-only accounts must use an administrator-
   approved authenticated token flow; do not disable MFA. For such a flow the
   runner also accepts a short-lived user access token from the **local** named
   `ND_WRITEBACK_ACCESS_TOKEN` environment variable, without `--sign-in`. Never
   put its value in command arguments/chat or commit it. Expired sessions require
   reauthentication, not a silent refresh daemon.
5. Check the exact Sheet row and dashboard outcome. The runner authenticates the
   expected user live and the backend checks current verified staff membership
   on claim, claim replay and acknowledgment. It claims at most one item and exits.
   It does not connect to Incogniton or publish platform content.

## 5. Update, conflict and recovery acceptance

- For update use `rowRef` **`id:<exact ND Row ID UUID>`**, never `A2`. Supply one
  row such as `[{"Status":"Checked again","__expected_revision":"1"}]`.
  The connector resolves the current row by ID, rejects missing/duplicate IDs and
  observed revision mismatches, then increments ND Revision. Old spreadsheet
  row numbers are not authority. An authorized maintenance row move **between**
  writes must preserve the whole row/ID/revision; verify the update still targets it.
- Atomic Sheets `batchUpdate` commits selected cells and metadata receipt together.
  A lost Google response is not a failed write. Replay/lookup uses the same
  operation ID and intent hash; a changed payload under that ID conflicts.
- Local `.worker-state/writeback-journal.json` saves claim IDs before network and
  results before acknowledgment. It may contain queued customer text while pending;
  protect local access/backups. It never contains access/refresh/password/token
  values; settled records clear the customer payload. Do not delete checkpoints
  or rotate targets/credentials while unresolved to force another submission.
- Receipt-only recovery, with no Sheet write:

  ```powershell
  python sheet_writeback.py --config .monitoring/sheet-writeback.json --sign-in --recover-results --confirm-authorized
  ```

  A saved result replays only its acknowledgment. A claimed job looks up its
  committed receipt. If no receipt is found, recovery **does not apply a write**.
  Normal execution can apply the same operation only while its remaining lease is
  safely bounded. Expired/unresolved claims block; an operator must inspect the
  Sheet and backend lease history rather than invent success or discard the journal.
  If another claimant replaced the lease, the backend may refuse the old receipt;
  reconcile the exact item with an administrator. No blind retry/requeue is safe.
- Developer metadata stores only bounded receipt IDs/hash/time/count/tab, not cell
  text or tokens. Google metadata quotas are finite; exhausted quota must fail the
  atomic batch, not delete the replay ledger. Do not purge receipt metadata or use
  another operation ID to bypass a conflict. Long-term archival/retention policy
  requires separate acceptance.
- Test revoked membership, wrong organization, duplicate IDs/headers, stale
  revisions, formula-looking text, null clearing, lost Google response, lost backend
  acknowledgment and disabled configuration before expanding beyond the pilot.

Finally set `WRITE_ENABLED=false` and local `enabled:false` when the pilot stops.
This implementation does not wire publication/monitoring completion automatically
into outbox intents, supply scheduling/bulk delivery, or establish full product
acceptance. Those remain separately tracked work, not configuration switches.

References: [Advanced Sheets service](https://developers.google.com/apps-script/advanced/sheets),
[atomic batch updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate),
[metadata receipts](https://developers.google.com/workspace/sheets/api/guides/metadata).
