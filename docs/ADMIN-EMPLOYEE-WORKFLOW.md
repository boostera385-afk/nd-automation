# Admin-managed setup and employee daily work

## Status

The owner-device pilot passed: launcher, pairing, sessions, read-only detection
of 3,135 profiles, full inventory import, one exact customer mapping, and clean
session closure. This does **not** accept publishing, monitoring, account
workflows, cookie/proxy writes or employee-device operation.

Role-separated screens/server-action guards are implemented locally. The matching
database enforcement source is `supabase/proposals/admin_managed_setup.sql`.
After explicit approval it was applied as `admin_managed_setup_v1` (hosted record
`20261103204414`); live checks confirm direct operator setup RPCs are denied and
shared profile/mapping reads remain available. Hidden UI alone is not a security
boundary.
Production deployment is separate; see `IMPLEMENTATION-STATUS.md` for exact results.

## Responsibility split

| Responsibility | Owner/admin | Employee (`operator`) |
|---|---|---|
| Add registered, email-confirmed members | Existing member-management role rules | No |
| Create customers and choose business timezones | Yes | View permitted data |
| Register/revoke helpers and keep private connections | Yes | No daily registration |
| Import/archive inventory and save/change mappings | Yes | View shared records |
| Install/connect employee laptop once | Admin, employee present | Approve dialogs; admin may assist |
| Start/pause/resume/end own session | Yes | Yes |
| Run authorized daily tasks and review results | Yes | Yes, task-specific authorization |

Execution is not blanket approval: exact bindings, verified active work sessions,
reviewed adapters, human challenge handoffs and destructive confirmations remain.
Artificial engagement and deceptive warmup stay disabled.

## Admin: prepare once

1. Employee signs up and confirms their own email. Add that exact address under
   **Settings / More → Workspace members** as **operator**. This sends no invite
   email and creates no account. Do not grant owner/admin merely to enable setup.
   An elevated employee must finish open work before an approved role change;
   never silently force-close sessions or change their role.
2. Configure customers and timezones centrally. Default business timezone is
   `America/Los_Angeles`; device timezone is separate.
3. Register one clearly named helper per laptop, e.g. `Employee name — laptop`.
   Download its private JSON once and transfer it securely. Never reuse the owner's
   credential or put it in chat, email, docs or the repository.
4. On the laptop, help install Python 3.13 with Tkinter and Incogniton through
   trusted installers. Sign in to the authorized Incogniton account/team and
   ensure it has access to the exact profiles this employee will use.
5. Run **Setup Employee Computer.bat** from the worker folder once. Pick the
   installed `Incogniton.exe` and this laptop's private JSON. This connects the
   launcher and pairs the helper. It does **not** install prerequisites, download
   software, create a service, auto-start work, or copy browser profiles.
6. With the employee present, start the helper and an authorized work session.
   The admin may request a local scan and save its result. Centrally saved
   inventory is reused; a scan is not required every day.
7. Save exact profile → customer → **employee helper** mappings once. A mapping
   targeting the owner's helper still runs there, not on the employee laptop.
   One profile cannot silently belong to two helpers. Moving an existing binding
   uses the reviewed replacement/revocation/reconciliation procedure; do not revoke
   a working owner helper simply to make a test convenient.

The private connection lives at
`%LOCALAPPDATA%\NDAutomation\worker\private\worker.json`; recovery state is under
`%LOCALAPPDATA%\NDAutomation\worker\state`. Existing connections and unresolved
checkpoints are never silently overwritten. Legacy migration is explicit and
preserves originals, not a routine employee step.

## Employee: daily routine

1. Sign in with the confirmed email the admin added.
2. **Open Incogniton**, using its authorized account if login is needed.
3. **Start profile helper**, approve the native prompt, leave the console open.
4. **Start work / Resume → Run automation**. Use only the helper the admin
   identified for this laptop and the authorized task/profile. Multiple helpers
   require explicit selection and show a short ID to distinguish duplicate names.
5. Review **Results → End work**. Stop the helper with Ctrl+C only when its task
   has finished. Session controls block new claims; bounded in-flight work may
   finish. There is no 24/7 execution or unattended login bypass.

No daily customer creation, import, mapping or helper registration. Missing setup
is an admin support issue, not a reason to register another helper.

## Sharing and remaining limits

- Reuse the administrator's existing cleaned ND Master workbook. The current
  legacy connector expects row-1 Auto Posting / Auto Listing metadata; a workbook
  with different tabs, row-2 headers and date banners needs an explicitly reviewed
  read-only adapter/mapping. Do not create extra Sheets or silently rename/rewrite
  the existing workbook to fit that template. Date banners are not automatically
  treated as actual publication timestamps, and profile identity must be explicit.
- Operators see permitted workspace customers, inventory and mappings after
  login. Customer viewers retain their narrower existing RLS access.
- Inventory loads through ordered API pages up to 5,000 rows. Search covers all
  loaded rows; the UI renders 50 per page. Partial windows are labeled.
- Metadata is not proof of local Incogniton access. Email login does not copy
  profiles, cookies, proxies or credentials into a laptop.
- Helpers are workspace-scoped, **not** restricted to one employee email.
  Explicit named-helper choice is implemented; per-user helper ACLs and
  cryptographic current-browser/laptop binding are not implemented. Heartbeats
  are not evidence of physical laptop ownership or browser readiness.
- The simple profile helper does not run monitoring, publishing or supervised
  account actions. Those need separate reviewed runners/adapters and acceptance.

## Support and next live test

If a helper closes or a task sticks, stop requeuing, preserve private files and
contact the admin. Inspect the exact task/checkpoint; reconcile an expired lease
only with explicit confirmation. Replay a durable result, never an uncertain
action. Do not erase journals or manufacture successful outcomes.

Before the employee-device pilot:
- End old employee work and ensure membership is in the **team's workspace** as
  **operator**, not owner of a separate self-created workspace. The designated
  employee's approved move is complete, with Auth identity preserved; browser
  login acceptance is still pending. Do not repeat that destructive recovery as
  an ordinary onboarding step.
- The setup-permissions proposal is applied; deploy the local web changes
  before treating the production employee screens as complete.
- Prove one-time setup, native prompt, heartbeat, correct helper and exact local
  profile access on the employee laptop.
- Verify shared data appears without setup controls and direct operator setup
  RPCs are denied. Start a fresh session, run one authorized read-only task,
  verify its real result and end the session.
- Test publishing/monitoring separately. Never add employee emails, credentials,
  customer exports or screenshots to the public repository; use placeholders.
