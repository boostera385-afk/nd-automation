# Simple dashboard + Incogniton workflow

See [Admin-managed setup and employee daily work](ADMIN-EMPLOYEE-WORKFLOW.md)
for the current responsibility split and delivery gates. The owner-device
launcher/scan/import/session pilot passed (3,135 profiles, 2026-11-03 UTC).
Employee-device and platform-action acceptance remain separate. New role-separated
web changes are local until deployed.
The desktop app in `ND Full Automated` and this repository's desktop code stay
unchanged. There is no device-locked dashboard login: use your normal verified
email/password on any computer where you have account access. Signing in does
not grant an unrelated computer permission to execute local work.

## One-time setup on a Windows computer

1. Sign in normally and open **Settings → Connect Incogniton once**
   (`/dashboard/settings/computer`). There is no second account/password.
2. In `apps/worker`, double-click **Setup Dashboard Launcher.bat**. Select your
   existing trusted `Incogniton.exe`, then confirm installation. Python 3.13 with
   Tkinter must already be installed (the existing venv is reused when present).
   This source setup does not download Python/Incogniton or install a service.
3. As an owner/admin, if no helper is connected yet, click **Connect local helper** in the dashboard.
   Its name defaults to **My computer**. Download the private connection once.
   It is a scoped, revocable credential—not a public configuration or password.
4. Double-click **Connect Profile Helper.bat** and select that downloaded JSON.
    The source helper saves it under
    `%LOCALAPPDATA%\NDAutomation\worker\private\worker.json`, refusing
   to overwrite an existing connection. After checking setup, remove the extra
   Downloads copy yourself. Never send it in chat or commit/share it.

If a helper is already connected on this computer, reuse it instead of repeatedly
registering more credentials. If its credential was revoked, use the existing
revocation/replacement workflow; do not erase unresolved checkpoints to reconnect.

## Employee / second-computer setup

One-time, one-file setup for a non-technical teammate:

1. **Teammate first:** they sign up with their own email on the dashboard and
   confirm the email address (email delivery is not verified yet — if the
   confirmation message never arrives, the workspace administrator confirms
   the address manually; that account step needs explicit owner approval).
2. **Owner, in the dashboard:** open **Settings → Workspace members**
   (`/dashboard/settings/members`) and add that exact verified email with the
   **operator** role. No invite email is sent and no account is created for
   them. Adding is permanent: one account can only ever belong to one
   workspace. Members with open work cannot be removed or demoted until the
   work is finished.
3. **Owner:** on **Settings → Connect Incogniton once**, under "Connect another
   helper", connect a helper for the employee's computer and download its
   private connection JSON. Give the teammate that file privately — never your
   own credential, and never commit or share it.
4. **Teammate, once, on their Windows computer:** in the worker folder,
   double-click **Setup Employee Computer.bat**. It runs both steps in one
   pass: the launcher setup (select the installed `Incogniton.exe`) and the
   private-connection picker (select the JSON from the owner). Nothing
   downloads, nothing auto-starts; Python 3.13 with Tkinter and Incogniton
   must already be installed. Cancelled dialogs simply mean the file can be
   run again; saved connections are never overwritten.
5. The teammate signs in to the dashboard with their own confirmed email and
   sees the business data and automations immediately, then follows the daily
   flow below. Helpers are connected per business and claim only explicitly
   queued tasks; nothing runs unattended or around the clock.

## Daily flow

1. Sign in → **Open Incogniton**. Approve the native prompt. This opens the app
   only; no profile, monitoring or posting is implied.
2. **Start profile helper**. Approve the native prompt. A foreground console
   polls explicitly queued profile tasks during an eight-hour claim window.
   A bounded in-flight task may finish afterward. Ctrl+C stops the helper;
   preserve its journal and inspect any interrupted mutation before retrying.
3. **Start work / Resume** in the dashboard's session bar. Employees open
   **Run automation** using the helper/mappings prepared by their admin; they
   do not repeat inventory import or assignment. Admin inventory setup uses
   **Detect profiles**.
   The helper reports names/groups/UUIDs from the local Incogniton API, not from
   an account browser. Detection needs no DOM adapter or Playwright runtime.
4. Open **Profiles**. Refresh (or wait for the minute refresh), review the actual
   completed scan and click **Save detected profiles**. Choose each authorized
    customer once (owner/admin only). The source scan is bounded to 5,000 entries plus a result-byte
   budget: a partial scan says so, and CSV remains the fallback for omitted profiles.
5. Use **Run automation** for direct links to post/listing drafts, account tools,
   profile work and post checks. Use **Results** for post status/comments.

One enabled helper means no helper selector is shown; its exact scoped ID is
retained in the form. Several helpers require a deliberate selection. A stored
heartbeat is not proof that the helper is on the browser's current computer or
that Incogniton is ready. The screen explains this rather than silently sending
work to the first helper. Page views and automatic refreshes never queue scans.

The simple profile helper can also execute previously separately confirmed blank
profile creation/cookie/proxy tasks; the native confirmation names those effects.
It does **not** claim monitoring, publishing or supervised account/edit/delete/
block workflows. Task-specific approval, exact bindings and verified active work
sessions remain enforced by the hosted database.

## Actual post-status monitoring

The profile helper does not open account browsers. Post checks/comments still
need a reviewed real DOM adapter, pinned monitoring environment and explicit
profile/session authorization. Stop the profile helper first, then use the
existing monitoring runner; both hold the same checkout lock and refuse unresolved
monitoring/publishing/browser-task checkpoints. Do not run two versions/copies on
one profile: cross-checkout device ownership is still a separate acceptance gap.

Publishing, listings and account maintenance retain their separate reviewed
adapters, immutable approvals and human challenge handoff. No fake status,
unapproved publishing, artificial likes or invented identities were introduced.

## Local launcher security and removal

Only these fixed actions are accepted (one browser/Windows-normalized trailing
slash is also supported):

```text
nd-automation://open-incogniton
nd-automation://start-profile-helper
```

No query parameters, profile IDs, file paths, credentials, callback URLs,
arbitrary commands or extra command-line arguments are accepted from a URI.
No HTTP listener or debugging/API port is exposed. The app's existing API stays
local; the helper connects outbound through the existing scoped RPC bridge.

Any website can invoke a custom URI; Windows provides no reliable caller identity.
Consequently the native confirmation is mandatory even when a browser remembers
external-app permission. See [Microsoft's URI activation security guidance](https://learn.microsoft.com/en-us/windows/apps/develop/launch/handle-uri-activation#security-considerations).
The launcher never trusts a claim that the calling website authenticated a person.

App launch verifies an exact local non-linked `Incogniton.exe`, a pinned SHA-256
and a valid **WorkingGreen B.V.** Authenticode publisher signature. Updates to that
app fail closed until reviewed/reconnected; a hash is not a replacement for
publisher authentication. Unrecognized publisher changes need review, not relaxed
signature checks. No Incogniton executable is downloaded or copied into the repo.

Registration is under the current Windows user's `Software\Classes\nd-automation`;
no admin elevation or autorun is installed. Existing registrations/settings are
never silently overwritten. To explicitly remove **this exact launcher**, run
from `apps/worker`:

```powershell
python install_desktop_bridge.py --remove
```

Confirm the native removal dialog. The uninstaller checks its exact handler
command, deletes only its known keys/launch-only settings and refuses another
app's registration. Unknown subkeys can leave a partial removal requiring review;
there is no recursive registry cleanup. It does not uninstall Incogniton, delete
worker credentials/journals or change the desktop app. Review a changed executable,
remove the old launcher, then explicitly reconnect; no automatic updater exists.

Local files inherit Windows user-directory ACLs (private creation modes where
supported); no encryption-at-rest, credential-vault or real ACL acceptance is
claimed. Python/source distribution is not a signed packaged installer. Real
Windows registration/browser handoff, signature behavior, OS permissions,
installation/update/rollback, concurrent processes and genuine profile scans need
user-present acceptance before a client handover.

## Remaining delivery gates

This tranche simplifies navigation and provides launch/profile-helper source.
It does not finish attachment add/remove/reorder, a signed worker updater, live
platform acceptance or F01–F36 retirement sign-off.

Local engineering source for the remaining protected features now exists and
is described separately: screenshot evidence storage and its two-phase deletion
model (`PROTECTED-EVIDENCE.md`), strict local bulk cookie/proxy staging with
Windows DPAPI per-row ciphertext (`PROTECTED-BULK-INTAKE.md`), one-time explicit
state migration, a shared cross-version state/lock root, Authenticode-verified
offline release install/rollback and the F01–F36 operator acceptance validator
(`WORKER-RELEASE-LIFECYCLE.md`). All of those are source and tests only:

- the former proposals were applied to the hosted database on 2026-11-03
  after explicit approval (`protected_evidence_v1`, `protected_bulk_intake_v1`);
  evidence/batch queueing now exists on the hosted database, but no evidence
  or batch has been created and none of it is live-accepted;
- real signing needs a genuine certificate and out-of-band publisher
  thumbprint; no release exists yet;
- nothing here adds evidence/image/file storage to this workflow; the daily
  helper runs no watcher, no bulk apply and no automatic intake; page visits
  and refreshes still never queue scans or media uploads;
- retention, permitted cookie/proxy use, deployment and real-account work stay
  explicit operator decisions, as recorded in `REMAINING-WORK-PLAN.md`.

Hosting deployment and local installation are separate, explicitly reported
actions.
