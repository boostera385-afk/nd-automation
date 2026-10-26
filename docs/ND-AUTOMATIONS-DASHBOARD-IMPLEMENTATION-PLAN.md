# ND Automations Dashboard — Implementation Plan

**Updated:** 26 October 2026  
**Status:** Historical full-scope planning guide. A narrower standalone reporting milestone has started; see `docs/IMPLEMENTATION-STATUS.md` and `docs/DEVELOPMENT.md` for delivered scope. Legacy automation/control capabilities below are not implicitly authorized or implemented. Live platform validation has not started.  
**Application root:** `ND Full Automated/` inside the current workspace. Paths below are relative to that application root unless stated otherwise.  
**Reviewed workbook:** `ND fully Automated.xlsx` (kept locally, never committed)  
**Only Nextdoor automation path:** Existing Incogniton browser profiles + Playwright, controlled by a secure Python worker. No Nextdoor API integration.  
**Database, authentication, and file storage:** Supabase.  
**Business timezone:** US Pacific, `America/Los_Angeles`, with automatic PST/PDT daylight-saving handling; customer/location overrides are explicit.  
**Operating model:** Operator-started daily computer sessions of approximately 8–10 hours. No 24/7 computer, browser worker or overnight execution is required.

> **Main outcome:** We publish today through Incogniton during our working session. At the next daily working session, the system checks those exact posts, records whether they are still accessible/live, collects available comments, and updates the web dashboard and connected sheets. Today/yesterday normally use US Pacific business dates, not the operator PC's date. Existing operational tasks remain represented in the migration checklist; nothing is silently dropped.

This guide is a build specification, not a claim that the current automation is production-ready. The review was read-only for application code, workbook contents, and live accounts. Real posting tests, sheet writes, account creation, and deployment require a separate implementation/pilot step.

## 1. Primary objective and scope

### 1.1 Product priorities

1. **P0 — Today's posts and next-session monitoring:** Know exactly what was published today, by which account, for which customer, and whether each publication is still live when checked during the next work session. Use the configured US Pacific business date by default.
2. **P0 — Comments by exact post:** Show available comments, replies, and new activity on the correct post, not an unrelated account notification count.
3. **P0 — Automatic recorded results:** Update Supabase, the dashboard, and connected spreadsheet output columns without manually copying statuses.
4. **P1 — Web-based operational control:** Start and manage current posting, listings, profile creation, account onboarding, cookie imports, proxy imports, and other retained tasks from the dashboard.
5. **P1 — Reliable execution:** Persistent jobs, per-profile locking, controlled retries, recovery, evidence, and visible exceptions.
6. **P1 — Authentication and customer separation:** Sign-up/sign-in, team roles, customer access, and audit history.
7. **P2 — Reporting and deployment:** Daily reports, customer portal integration, notifications, and a supported daily-session worker deployment on the existing computer. An always-on worker is outside the requested scope.

The first usable release must include monitoring of existing posts. It must not be only a visually polished dashboard or another way to submit posts.

### 1.2 Fixed design decisions

- **Incogniton + Playwright is the only Nextdoor execution path.** Reuse and improve the existing browser-based system. Do not add Nextdoor API integrations, API clients, application approval dependencies, OAuth connections, API tokens or API-based publishing/monitoring fallbacks.
- **Preserve proven browser behavior before expanding it.** Wrap existing flows in web-controlled jobs and test them against the current installation. Make incremental changes for reliable results, scheduling and security; do not rewrite a working browser flow merely to introduce a different platform integration.
- **Supabase is the operational source of truth after cutover.** Sheets remain supported input/output integrations, not a second independent execution queue.
- **The UI is web-based.** Browser automation runs on the worker machine, not inside a Vercel request or a visitor's browser.
- **Automation is session-driven, not 24/7.** Run computer/browser tasks only while an operator has started an active work session and the worker is ready. A posted item remains on the platform independently, but no fresh platform checks are promised while the computer is off.
- **Pacific business time is separate from detected device time.** Default to `America/Los_Angeles`; detect the operator's local zone for display and mismatch warnings, never to silently replace the business zone.
- **Every actual publication is its own record.** One content item sent to 20 accounts produces 20 publication records, each with its own URL, verification, and comments.
- **A completed browser action is not proof of a live post.** Submission and visibility are separate statuses.
- **No historical dates or results are invented.** Existing workbook statuses are imported as legacy claims until reconciled.
- **Feature parity means preserve useful capabilities and explicitly document unsafe or unverified behavior.** It does not mean reproduce known bugs, fabricated identity data, or artificial engagement.

### 1.3 Automation boundary

Operate only genuine, customer-authorized accounts and permitted browser workflows. Account identity/address checks, CAPTCHA, OTP, platform restrictions, and ambiguous results need a dashboard handoff to a person. Do not bypass verification, suspension, or access controls. Check platform permission before enabling browser monitoring or publishing in production. All Nextdoor publishing, onboarding, status checking and comment collection use the existing Incogniton/Playwright browser approach. There is no Nextdoor API access or application-approval dependency in this plan. Browser limitations produce a visible handoff or partial result, not an API fallback.

**Terminology:** Incogniton's local profile-control API is already part of the working system and remains in use. Dashboard/worker endpoints and the sheet/portal connection are separate internal/integration interfaces; excluding the Nextdoor API does not remove these necessary connections.

## 2. Reviewed project and workbook baseline

### 2.1 Existing application

The existing application is Python/CustomTkinter, using Playwright over Incogniton's local API and Google Apps Script for sheet reads/writes. The reviewed source inventory contains 105 Python/JavaScript files, including historical patches and ad-hoc tests; this is not 105 independently verified production modules.

| Area | Existing source | Treatment |
|---|---|---|
| Desktop entry/navigation | `main.py`, `gui/app.py`, `gui/views/` | Preserve as a transition fallback; add a new web interface. |
| Incogniton lifecycle | `core/automation/incogniton_manager.py` | Reuse through a worker adapter; harden ownership and session handling. |
| Profile creation | `core/automation/profile_builder.py` | Reuse validated parsing; replace hardcoded/ambiguous mappings. |
| Account creation | `core/automation/nd_account_creator.py` | Convert to bounded, resumable, genuine-customer onboarding. |
| Posting/listings | `core/automation/auto_poster.py`, `auto_listing.py`, `auto_random_poster.py` | Retain workflows, split side effects, add structured results and exact-post verification. |
| Session activity | `core/automation/auto_warmup.py` | Inventory fully; migrate session checks without automatic random engagement. |
| Cookie imports | `core/automation/cookie_importer.py` | Retain supported formats, protect secrets, and serialize profile updates. |
| Navigation/composer | `core/automation/nd_navigation.py`, `nd_ui.py` | Retain recovery/pop-up handling; fail safely on unknown audience or state. |
| Execution | `core/engine/automation_engine.py`, `profile_worker.py`, `retry_manager.py`, `state_machine.py` | Add persistent jobs, checkpoints, distributed locks, and reliable cancellation. |
| Sheets | `core/services/sheets_service.py`, `core/assets/apps_script.js` | Add authenticated synchronization and stable record IDs. |
| Settings and launching | `core/config.py`, `gui/views/settings_view.py`, launcher batch files | Separate server settings from machine settings and use protected secret storage. |

### 2.2 Workbook evidence

Counts below refer to this workbook snapshot, not current platform state.

| Tab | Observed state | Required import decision |
|---|---|---|
| `Auto Posting` | 93 named records; 88 statuses beginning with `Posted`; 5 failed; 79 Nextdoor-looking links; 9 reported-posted records without a link. No date/time headers. | Import all 93 with original values. Reconcile the 79 links; queue missing-link discovery for review. Do not label 88 posts verified live. |
| `Auto Listing` | 98 named records with titles/descriptions/images; no saved statuses, post links, or chats. Category spelling/whitespace variants exist. | Import as legacy content/unknown publication state, not as permission to publish all 98. Normalize category labels with preview. |
| `Incog Profile Creation` | 86 named data rows plus a repeated posting-style header row. Posting data is under profile-creation headers; URLs appear in the declared `Status` column. | Quarantine the incorrect mapping. Request an explicit column map before interpreting any row as a profile-creation task. |
| `Bulk proxy import` | 8 named records; its actual data column is `Cookies`, not `Proxy`; statuses report cookie import counts. | Recognize legacy cookie-tab alias. Do not overwrite it with proxy data or automatically rename it without approval. |
| `ND Acc Creation` | No named records under A:G; 52 populated rows appear in unnamed column H. | Preserve as unmapped/reference data. Require real customer/account fields before enqueueing onboarding. |
| `Auto Warmup` | 1 named task; 84 other populated rows have no profile name under the declared schema. Additional data appears in K:N. | Import the valid task only after approval; quarantine/reference-map the remaining data. |
| `Auto Random Posting` | No named tasks under the declared schema; 90 populated rows have data in unnamed J:K. | Preserve these rows but do not auto-execute. Resolve their intended purpose first. |

The screenshot shows Incogniton version 4.9.1.0 and 3,262 profiles in use out of 3,500. Treat this as screenshot evidence, not a live inventory. Import existing profile UUIDs before creating anything new. Do not launch thousands of profiles just to populate a dashboard.

### 2.3 Defects that must not be copied into the web product

1. `profile_worker.py` can mark a found target post as `Posted`, although the current account created nothing. Use `TARGET_FOUND_SKIPPED` instead.
2. A failed sheet-row claim currently writes `Failed`, potentially overwriting another worker's active status. A losing claimant must leave the other job untouched.
3. Posting/link extraction can fall back to the first profile post. Screenshots can likewise capture an unrelated first post. Match the exact publication before recording evidence.
4. Several sheet write helpers treat HTTP 200 as success without checking the returned JSON success/error result. Validate responses and surface synchronization failures.
5. The listing wrapper appends `| Chats: ...` to a link string. Store URLs and metrics in separate typed fields.
6. Listing `Chats` currently reads an account notification badge. It is not a verified count of conversations about that listing.
7. Several browser flows catch all exceptions and return plain failures, obscuring retryable/stopped states. Preserve typed errors and cancellation.
8. The current engine is in-memory and includes GUI-specific duplicate-profile prompts. Neither is suitable as the durable web execution layer.
9. Audience helpers can fall back to `Anyone` for unknown input or report an unverified selection as success. Reject unknown audiences; never silently widen access.
10. The account flow generates a random birth date and saves credentials to Chrome. Replace fabricated fields with genuine customer inputs; use an approved secret-storage strategy rather than relying on password autofill.
11. Some recognized onboarding screens can loop without incrementing the fallback step counter. Add wall-clock deadlines, per-stage timeouts, and resumable handoffs.
12. Profile-building code contains hardcoded groups/browser version assumptions. The screenshot browser version differs from the hardcoded creation version. Discover supported values and test against the installed build.
13. Existing Apps Script setup recommends `Anyone` access and has no application-level authentication. Treat the deployed security posture as unverified and fix it before cloud integration.
14. Ad-hoc `test_post*.py` and `test_update.py` scripts can write live sheet values. Isolate them from automated test discovery; use mocks and staging fixtures.

## 3. Required daily workflow

### 3.1 Publish today

1. An operator signs in and selects a customer, authorized account/profile, content type, and destination/audience.
2. Content is written in the dashboard or imported through a validated sheet mapping.
3. Preview and validate text, images, audience, account ownership, and any required approval.
4. Choose **Post now** or **Schedule**. Create one publication per target account/destination and durable execution jobs.
5. The assigned worker obtains an exclusive profile lease, checks Incogniton readiness, and launches the correct UUID.
6. Confirm login, handle permitted prompts, attach validated media, set the exact audience, and submit the post/listing.
7. Save the submission outcome and exact platform ID/share URL as soon as known. If the outcome is ambiguous, stop at `NEEDS_RECONCILIATION`; do not blindly click/post again.
8. Perform a separate exact-post verification. Save check time, viewing account/context, comments if available, and evidence.
9. Commit the database result and synchronization outbox entries together. Sheet/portal delivery is retryable separately from publishing.
10. Show the publication on **Today** by its actual Pacific business timestamp and mark its next-day verification due automatically. Due work waits for the next active computer session if the machine is off.

### 3.2 Check tomorrow / at the next active work session

1. At **Start work**, the due-job planner selects the previous calendar day's publications in the customer's business timezone, defaulting to US Pacific. Also include older publications that missed their next-day check while the computer was off; do not lose them after a weekend or day off.
2. Group due checks by authorized account/profile to avoid reopening the same browser for every post.
3. Open each exact post URL or resolve its exact ID. Verify account access before classifying the post.
4. Record `LIVE`, `UNAVAILABLE`, `CONFIRMED_REMOVED`, or `UNKNOWN` as supported by evidence. Separately record login/network/selector problems.
5. Collect accessible comments/replies and metrics, including collection completeness.
6. Update Supabase, push dashboard updates, and write monitoring results to the linked sheet rows.
7. Generate the customer report after the check batch completes or at a configured in-session report point. If the preferred report/check time passed while the computer was off, label the actual delayed check time and incomplete coverage. Do not imply an overnight check occurred.
8. Put missing links, failed access, suspected removals, and unanswered comments in **Action needed**.

### 3.3 When the dashboard is opened

- Immediately show saved data with **Last checked** and **Next check** timestamps.
- Refresh database data and worker/sheet connection health.
- Show **Start work / Resume work**, the active session, local time, Pacific time and selected business date. Opening a page while the session is closed remains read-only apart from explicitly permitted settings/draft work.
- If the account's **Auto-check on dashboard open** setting is enabled, enqueue overdue checks for the selected customer/day; execution starts only during an active work session. Defaults must be explicit and configurable.
- Use a freshness window and deduplication so reopening the page, opening multiple tabs, or multiple staff signing in does not repeat the same checks.
- Display `Queued for next session`, `Checking`, `Fresh`, `Stale`, `Session closed`, or `Worker disconnected unexpectedly` honestly. Opening a dashboard page cannot itself prove live platform status.
- Do not auto-publish, create accounts, edit, delete, or block someone merely because a user opened the dashboard.

### 3.4 When an Incogniton browser profile is opened

- For a **dashboard-launched managed session**, update the account/browser-session state and run its due checks when monitoring is enabled and the work session is active.
- For a **manually opened profile**, the agent may detect the known profile's running state using supported local status calls. Attach for monitoring only if this is explicitly enabled and the session is not owned by another job/person.
- Detecting a running browser is not proof that a post was created. Use read-only reconciliation of authorized recent posts to discover manual publications; match ID, account, content, and time, and ask for customer attribution when ambiguous.
- Automatically update existing mapped sheet records after confirmed observations. Newly discovered manual posts receive their own records only under the approved import policy.
- Never silently close a manually opened browser. If busy, display `In use` and defer the job or request handoff.
- Poll only relevant registered profiles/sessions at a bounded interval. Do not query or launch all 3,262 screenshot profiles on every page load.

### 3.5 Daily operator checklist

1. Turn on the computer, start the worker/Incogniton, open **Overview**, verify both displayed clocks and click **Start work**.
2. Review **Yesterday / Due since last session → Check due posts** and the automatic catch-up check batch.
3. Review **Action needed**, including inaccessible posts and expired logins.
4. Review comments grouped by publication; assign/respond through supported approved workflows.
5. Prepare and approve today's content.
6. Confirm sheet synchronization and daily-report delivery, then click **End work** and wait for safe job draining before shutting down.

### 3.6 Daily 8–10 hour session lifecycle

**Start:** Detect device timezone, validate the chosen Pacific/customer timezone and window, show pending work from the last session, check Incogniton readiness, then prioritize overdue post checks and comments. The 8–10 hour duration is the user's typical workload, not a fixed start/end clock or a requirement to publish continuously. Do not invent a 09:00–17:00 window; make the operator's actual window configurable.

**During work:** Allow approved posting, account/profile creation, imports, checks and sheet sync while the session is active. Give monitoring and publishing separate fair queues so a large catch-up check batch does not block all of today's posting. Closing the dashboard tab does not stop an active session if the computer/worker remain on.

**End work:** Stop leasing new browser jobs, checkpoint/drain in-flight work, reconcile ambiguous submits, flush saved results and pending sheet writes where possible, summarize incomplete work, close only worker-owned browsers, and mark the session intentionally closed. Do not terminate a submit halfway just because 8 or 10 hours elapsed. Require confirmation for forced shutdown/cancellation; recover ambiguous actions next session.

**Computer off / session closed:** Supabase retains jobs and history; the hosted website may show cached reports/drafts. It cannot control a powered-off PC. There is no browser posting, account creation, fresh comment collection or next-day verification until work resumes. Planned closure produces no repeated worker-down alarms. Cloud read access does not imply cloud browser execution.

**Next session:** Reconcile interrupted side effects first, then prioritize due checks, collect available comments since the last successful scan, retry sheet-only deliveries and present expired publish schedules for approval. Older missed check cohorts remain visible. A Monday observation proves Monday's visibility, not what was live during an unobserved weekend.

**Late publishing policy:** Never bulk-publish all missed schedules on startup. Default an overdue publish/account-creation action to `MISSED_WINDOW / NEEDS_RESCHEDULE` when it is outside its approved grace window; an operator may reschedule or explicitly release it. Read-only catch-up checks can run automatically under the configured monitoring consent. A future start-time rule may hold publishing until an approved Pacific window, but never wakes the PC or extends the shift automatically.

## 4. Existing functionality and migration checklist

**Coverage rule:** Every row below must have an implementation/test result or an explicit approved disposition before the desktop application is retired. `Controlled` means retained as a visible workflow with authorization/confirmation, not silently omitted. `Gap` means the existing label/data does not establish that the feature actually works.

| ID | Existing capability or behavior | Web implementation and required proof |
|---|---|---|
| F01 | Home connection checks and opening Incogniton | Worker health, machine/app/API readiness, and permissioned **Open Incogniton** action; no frontend-to-localhost assumption. |
| F02 | Bulk browser-profile creation | Single/bulk wizard with validated names, group, proxy and genuine location settings; preview before queueing; return actual created UUIDs. |
| F03 | Existing profile names/groups/IDs | Inventory and customer assignment; resolve duplicate names by exact UUID/group in the dashboard instead of a Tk dialog. |
| F04 | Launch, stop, cooldown, readiness, out-of-sync handling | Preserve lifecycle recovery; ownership-aware stopping; explicit review for local/cloud sync conflicts; never discard newer profile data automatically. |
| F05 | Proxy parsing and update before a task | Preserve host/port, authenticated, and scheme-based formats; validate, redact, and serialize updates; expose proxy health without passwords. |
| F06 | Bulk proxies import | Dashboard upload/form plus sheet input; preview, run, per-row result, retry, and auto-import settings. |
| F07 | Cookie import formats | Preserve JSON arrays/wrappers, Netscape text, base64, and approved worker-local file inputs; validate and encrypt; never reveal cookie contents in logs. |
| F08 | Cookie append/clear-first and readback | Explicit replace confirmation, exclusive profile lease, success verification, and safe failure behavior. |
| F09 | Auto-import new cookie/proxy rows | Durable polling schedule and explicit readiness flag; deduplicate rows; missing values wait rather than becoming destructive jobs. |
| F10 | Nextdoor account creation | Dashboard-guided authorized onboarding, sequential/resumable stages, actual profile binding, and per-account status. |
| F11 | Signup name/email/password, location/address and birthday screens | Genuine customer-provided fields; protected secrets; manual identity/address/OTP/CAPTCHA handoff; no random birth dates. |
| F12 | Onboarding topics, recommendations, pledge and optional prompts | Preserve stage detection. Use genuine selected preferences and explicit consent; agreement/follow actions must not be arbitrary background behavior. |
| F13 | Credential/autofill and logged-out recovery | Protected credential references or approved authorization; distinguish login needed from network error; do not depend on Chrome autofill. |
| F14 | Standard text posts | Composer with content validation, account/customer/audience preview, schedule, exact result capture, and follow-up check. |
| F15 | Images from Drive, direct URLs and local paths | Keep source support; browser uploads become managed storage assets; worker-local paths restricted to approved directories. Validate actual media bytes and supported formats. |
| F16 | Multiple attachments, upload fallback and temporary cleanup | Per-job temporary workspace, image ordering/deduplication, supported upload fallback, verified attachments, cleanup on success/failure/cancel. |
| F17 | Audience selection across UI variants | Explicit `Anyone`, `Nearby neighborhoods`, or `Your neighborhood`; verify actual selection, fail closed on unknown values. |
| F18 | Target-name detection and skip/new-link extraction | Controlled monitoring rule; exact author/account disambiguation; save `TARGET_FOUND_SKIPPED`; never count the discovered post as a new customer publication. |
| F19 | Editing the previous post using `Random Post Text` | Retain as a separate explicit **Edit post** workflow using a selected exact post ID, revision history, and approval; no implicit first-post overwrite. |
| F20 | Deleting a previous post using delete-like text | Retain explicit **Delete post** with exact target, preview, permission, and confirmation; legacy text is an import warning, not a delete trigger. |
| F21 | `Spammers` URLs and blocking behavior | Preserve authorized block-list management as an independent controlled moderation action. Confirm exact targets, ownership and results; do not silently mass-block as a posting prerequisite. |
| F22 | Area field | Preserve customer service-area data and approved moderation/reference mappings; do not infer verified residence from an area label. |
| F23 | Listings: title, price/free, description and category | Dedicated listing composer, validated category, attachments, and exact listing verification; existing listings remain untouched unless explicitly selected. |
| F24 | Listing post-link and screenshot capture | Save a clean URL, exact ID and correctly scoped evidence; no metric text appended to URL fields. |
| F25 | Listing `Chats` badge extraction | Preserve as **Account unread badge (legacy observation)** if useful; real per-listing conversations require supported access and explicit association, never pretend these are equal. |
| F26 | Auto Random Posting screen and flow | Preserve a separate content-preset/batch workflow and result history. **Gap:** its UI says random groups, but the reviewed flow does not establish group selection. Require a demonstrated permitted group flow and explicit selected destinations before advertising that capability. |
| F27 | Auto Warmup browsing/scrolling | Retain as **Session health / supervised browsing** with bounded duration, stop, and logs. This is not proof of post visibility. |
| F28 | Warmup's random likes/reactions | Inventory acknowledged; do not carry artificial/random engagement into unattended production. Genuine engagement needs an approved, permitted, user-directed action and is not a launch blocker for monitoring. |
| F29 | Pop-up dismissal, composer variants and network recovery | Reuse shared navigation/composer adapters, test known variants, distinguish proxy/network/login errors, stop on unknown destructive dialogs. |
| F30 | Concurrency and start/stop controls | Account/machine capacity settings, exclusive leases, durable progress, pause queue, cancel at safe boundaries, and recheck before retry. |
| F31 | Logging, status counters, failure diagnostics | Structured job events, timestamped stage/errors, redacted logs, accurate skipped/success/failure counts, customer-safe summaries. |
| F32 | Success screenshots and dated folders | Protected evidence storage keyed by customer/publication/job/check; retention controls; local worker cache only as a transient fallback. |
| F33 | Sheets pending fetch, claim, row updates, field writes and aliases | Authenticated connector, stable record IDs, schema preview, conditional claims, typed results and retryable outbox. |
| F34 | Script setup/create-repair/copy instructions | Retain a safe **Sheets setup** guide and versioned connector assets; preview schema additions, preserve formulas/data, support legacy aliases without silent destructive repair. |
| F35 | Incogniton path, Apps Script URL, connection tests and theme | Separate worker machine settings and organization integrations; admin connection tests, dark/light UI, responsive layout, remembered preferences. |
| F36 | Launch/update scripts and graceful shutdown | Documented worker install/update/start process, pinned dependencies, version reporting, graceful drain and rollback. Keep desktop launchers during transition. |

### 4.1 New capabilities required for the main objective

- N01: Today's publication ledger with actual publication time and customer attribution.
- N02: Tomorrow's automatic check of today's exact publications.
- N03: Live-state history, stale-check indicators, removal/access exception queue.
- N04: Per-post comments/replies with stable identity and collection completeness.
- N05: Day-specific reports and monitoring coverage.
- N06: Secure web authentication and tenant/customer isolation.
- N07: Dashboard/profile-open refresh rules and manual-publication reconciliation.
- N08: Reliable sheet writeback and optional existing-portal synchronization.

### 4.2 Migration sign-off rule

Keep a tracked result for F01–F36 and N01–N08: `Not started`, `Implemented`, `Tested`, `Controlled/reviewed`, or `Explicitly deferred`. A feature cannot disappear just because it is not in the first release. Deferred production-affecting workflows stay available in the old desktop app only under an explicit non-overlapping ownership policy, or remain paused; never run both systems against the same task/profile concurrently.

## 5. Web dashboard screens

| Screen | Required experience |
|---|---|
| **Overview** | Pacific business clock/date plus detected local clock; **Start work / End work**; elapsed session time; today/yesterday cards; verified-live counts; overdue checks; planned-closed vs unexpected-disconnect states; **Check yesterday**, **Create post**, **Action needed**. |
| **Today** | Actual publications today by Pacific/customer business date, current work-session filter, queued schedules separately, batch progress, clean post links, immediate verification and next-session check appointment. |
| **Yesterday / Post Monitoring** | Previous-business-day publications plus **Due since last session**; last observed visibility, comments, check result, evidence, stale warnings and **Check selected**. Default primary operations view. |
| **All Posts & Listings** | Search/filter by customer, day, account, service, area, type, audience and visibility; timeline and exact post detail. |
| **Create / Schedule** | Standard posts, listings and retained preset flow; media preview; customer/account/destination validation; approval and bulk preview. |
| **Comments** | Group comments/replies by exact publication; unread/assigned/resolved filters; genuine response workflow if supported; no fabricated per-post DM counts. |
| **Customers** | Authorized accounts, service/area details, customer reporting timezone, approvers and report access. |
| **Accounts & Browser Profiles** | Existing UUID inventory, duplicate resolution, group/customer assignment, login/verification tasks, safe open/stop, capacity and session ownership. |
| **Account Onboarding** | Authorized signup jobs, required genuine inputs, verification handoff and resumable stage history. |
| **Bulk Tools** | Profile creation, cookie import, proxy import, sheet import/export, session checks, authorized moderation, explicit edit/delete. |
| **Jobs & Workers** | Active/closed work sessions, queued/running/reconciling/failed jobs, late-window review, machine capacity, safe cancel, retries, logs; disconnect alerts only when a session should be active. |
| **Sheets & Integrations** | Header mappings, import preview, row errors, pending exports, last successful sync, setup guide and optional portal connection. |
| **Reports** | Daily customer snapshots, coverage, new comments by post, delivery history, download/export and versioned corrections. |
| **Team / Settings / Audit** | Roles, invitations, security, notification preferences, monitoring schedules, platform capabilities and change history. |

### 5.1 Primary publication table

`Customer | Published at | Account/Profile | Type | Content preview | Audience | Post link | Publish state | Last observed visibility | Check health | Comments total | New comments in selected day | Last checked | Sheet sync | Actions`

Use text badges as well as colors. Keep customer-safe information visible; move technical details into an expandable side panel. Include bulk selection, saved filters, column preferences, pagination/server-side search, and mobile-friendly detail views.

## 6. Architecture and Incogniton worker

### 6.1 Recommended stack

- **Web:** Next.js with TypeScript, a consistent component library, and accessible responsive tables/forms.
- **Backend boundary:** Protected Next.js server endpoints for authorization, job requests, worker protocol, imports and sync status. Use short requests, not long browser sessions.
- **Supabase:** Postgres, Auth, private Storage, tenant-filtered Realtime and migrations. Persist due times in Postgres. Initial dispatch is a session-driven planner when the worker starts and at bounded intervals while active; a cloud scheduler such as `pg_cron` is optional for metadata only, not a requirement for 24/7 execution.
- **Browser worker:** Python reusing the existing Playwright/Incogniton adapters, packaged as an independently runnable agent.
- **Queue initially:** Postgres `jobs` table with atomic server-side claim functions and leases. Avoid introducing Redis/Celery unless measured capacity requires it.
- **Synchronization:** A separately retryable outbox/dispatcher for Sheets and the existing portal, if that portal has a supported integration.

No Nextdoor developer application, OAuth/token integration, publishing API client, comment API client or cloud API-only Nextdoor worker is part of the stack. Nextdoor browser sessions run on the registered computer using the existing Incogniton installation and Playwright flows.

```text
Operator / Customer web browser
              |
        Next.js web app
              |
     Authorized server endpoints
              |
 Supabase Auth + Postgres + Storage
       |                   |
 durable jobs       events / sync outbox
       |                   |
 outbound HTTPS      Sheets / existing portal
       |
 Registered Windows worker
       |
 Incogniton local API (127.0.0.1:35000)
       |
 Authorized profile UUID -> Playwright -> Nextdoor
```

### 6.2 Cloud-to-local connection

1. Admin registers a worker and approves its organization/customer/profile assignments.
2. The agent authenticates outward over HTTPS using a narrowly scoped, revocable credential.
3. It sends a heartbeat and claims only jobs authorized for that worker/machine.
4. Server-side code validates job ownership, lease token, capabilities and allowed action.
5. The worker calls its own Incogniton API locally and executes the bounded task.
6. It sends stage events, typed results and evidence using scoped upload permissions.
7. The server commits validated results and schedules synchronization/follow-up work.

Never expose the Incogniton API, CDP ports, arbitrary command execution, a public local FastAPI control endpoint, or broad Supabase service-role credentials to browser clients or desktop workers. Job types and payloads must be allowlisted, not executable Python/JavaScript supplied from the UI.

### 6.3 What “web-based” means

- All job creation, status review, content management and reporting happen in the web app.
- Incogniton windows still run on the assigned worker machine. Clicking **Open profile** from another device does not open that browser on the visitor's device.
- Manual verification can be completed on that machine, or through separately secured remote access if approved. Embedded remote browser streaming is not implied and needs a separate security/implementation decision.
- Browser jobs continue after the dashboard tab closes only while the work session is active and the worker/Incogniton remain available. **End work** intentionally stops new dispatch; a powered-off computer cannot run browser tasks.

### 6.4 Suggested additive project layout

```text
ND Full Automated/
  core/                         # existing code retained, refactored carefully
    automation/
    engine/
    services/
  gui/                          # transition-only desktop interface
  apps/
    web/                        # new Next.js application
    worker/                     # agent runner, pairing, job handlers, checkpoints
  packages/
    contracts/                  # versioned JSON schemas; TS and Python validation
  supabase/
    migrations/
    seed/                       # synthetic data only
  tests/
    unit/
    integration/
    browser_fixtures/
    acceptance/
  docs/
    README.md
    ND-AUTOMATIONS-DASHBOARD-IMPLEMENTATION-PLAN.md
```

This is proposed structure, not directories already implemented. Keep historical patch scripts intact until their relevance is assessed. Create source control with secret exclusions before substantive implementation; do not commit customer workbooks, cookie exports, proxy credentials or raw production screenshots.

### 6.5 Worker result contract

Replace overloaded `(success, message)` strings with a validated result containing: `job_id`, `lease_token`, `publication_id`, `action`, `outcome`, `stage`, `platform_post_id`, `share_url`, `published_at`, `observed_at`, `visibility`, `check_error_code`, `comments_complete`, `evidence_refs`, and a redacted diagnostic message. Fields may be null when genuinely unknown. Never use placeholders such as `No link extracted` as URLs or `0` to represent a failed metric read.

## 7. Data model and status definitions

### 7.1 Core tables

| Table/group | Purpose and important rules |
|---|---|
| `organizations`, `memberships`, `customer_access` | Authentication-linked access, operator roles and restricted customer membership. |
| `customers`, `services`, `campaigns`, `areas` | Business attribution, report timezone and optional daily targets. An Incogniton group is not automatically a customer. |
| `platform_accounts`, `account_authorizations` | Genuine account identity, account type, consent and supported capabilities; protected credential references. |
| `browser_profiles`, `workers`, `work_sessions`, `browser_sessions` | Actual Incogniton UUID, assigned machine/customer, group, health, ownership and profile/session leases; explicit work start/end, business timezone, detected device timezone, planned window and closure reason. |
| `content_items`, `content_revisions`, `assets`, `approvals` | Draft content, listing fields, media, selected audience, approval scope and immutable approved revision. |
| `publications` | One actual intended publication per account/destination. Original source, exact external IDs/URL, actual publication time, immutable schedule timezone/offset, business date, work-session attribution, type and separate statuses. |
| `publication_checks` | Append-only observations with viewing context, evidence, result and error; do not overwrite history. |
| `engagement_snapshots`, `comments`, `comment_observations` | Counts with collection status, external comment/reply IDs, authored/first-seen timestamps, edits/deletions only when observed. |
| `jobs`, `job_attempts`, `job_events`, `schedules` | Durable task state, lease tokens, retries, heartbeats, cancellations and checkpoints. |
| `review_tasks`, `moderation_actions` | Explicit human handoffs, selected edit/delete/block targets, approver and result. |
| `import_batches`, `import_rows`, `sheet_links`, `sync_outbox` | Raw-source provenance with sensitive fields protected, approved schema mapping, stable sheet record identity and retryable exports. |
| `reports`, `report_deliveries`, `notifications`, `audit_events` | Versioned daily summaries, recipients, delivery state and actor/action history. |

Every tenant-owned record needs an enforceable organization relationship. Customer-visible records need explicit customer attribution and corresponding policies. Validate that referenced account, profile, customer, asset and job belong to the permitted organization/customer; a matching frontend dropdown is not authorization.

### 7.2 Three independent status dimensions

**Publishing state:**

```text
DRAFT -> AWAITING_APPROVAL -> SCHEDULED -> QUEUED -> PUBLISHING
      -> SUBMITTED -> NEEDS_RECONCILIATION / FAILED / CANCELLED
```

`SUBMITTED` requires positive submission evidence. A click alone or a missing composer is insufficient. `TARGET_FOUND_SKIPPED` is a task outcome, not a publication success.

**Last observed visibility:**

```text
NOT_CHECKED | LIVE | UNAVAILABLE | CONFIRMED_REMOVED | DELETED_BY_US | UNKNOWN
```

`LIVE` means accessible in the recorded authorized viewing context at the stated check time. It is not a guarantee of universal visibility or of still being live now. `CONFIRMED_REMOVED` requires explicit platform evidence, not just omission from a list/search.

**Check health:**

```text
QUEUED | CHECKING | OK | LOGIN_REQUIRED | VERIFICATION_REQUIRED
NETWORK_ERROR | SELECTOR_CHANGED | ACCESS_DENIED | WORKER_OFFLINE | NEEDS_REVIEW
```

Freshness is derived separately from the last successful check and the monitoring policy. Preserve the last reliable observation when a new check fails, but mark it stale/failed; do not present an old green badge as a fresh result.

**Account health:** `CONNECTED`, `LOGIN_REQUIRED`, `VERIFICATION_REQUIRED`, `RESTRICTED`, `SUSPENDED`, `CONNECTION_ISSUE`. Do not retry around a platform restriction by switching identities.

**Job state:** `QUEUED`, `LEASED`, `RUNNING`, `WAITING_FOR_HUMAN`, `RETRY_WAIT`, `RECONCILING`, `NEEDS_RESCHEDULE`, `SUCCEEDED`, `FAILED`, `CANCELLED`. Keep `MISSED_WINDOW`, `SESSION_CLOSED` and `WORKER_DISCONNECTED` as distinct reason/availability values. Profile creation and warmup/session checks must not be exported with the posting-specific status `Posted`.

**Work-session state:** `NOT_STARTED`, `ACTIVE`, `PAUSED`, `ENDING`, `CLOSED`, `INTERRUPTED`. Work-session IDs are separate from individual browser-session IDs and Pacific business dates; a shift can cross Pacific midnight.

### 7.3 Identity and time rules

- Keep `internal_record_id`, `incogniton_profile_uuid`, `platform_account_id`, `platform_post_id`, and `platform_comment_id` distinct.
- A sheet-generated random `ID` is not automatically a valid Incogniton UUID.
- Use platform IDs where available. Canonicalize share URLs without confusing different posts. For comments lacking a stable ID, record low-confidence observations; do not claim exact deduplication from text alone.
- Store timestamps in UTC and reporting timezones as IANA identifiers. Build previous-day ranges from local midnight to the next local midnight, accounting for daylight saving time.
- Store `published_at`, `published_at_source`, `first_seen_at`, `last_checked_at`, `last_live_at`, `next_check_at`, and `source_imported_at` separately. Never treat file modification/import time as publication time.

### 7.4 US Western / Pacific time and automatic detection

**Default:** Interpret the user's “USA western” focus as **US Pacific**, stored as `America/Los_Angeles`. Confirm customer locations before production; not every western-US location uses Pacific time. For example, most Arizona locations use `America/Phoenix`, which must be an explicit location/customer override. Never hardcode a permanent `UTC-8` offset or use the ambiguous abbreviation `PST` as a timezone identifier.

**Observed review-machine setting:** Windows reported `Pakistan Standard Time` (UTC+05:00), and the local JavaScript runtime resolved `Asia/Karachi`. This is the operator machine's setting, not a US customer schedule. Do not change the Windows clock/timezone as part of dashboard setup. The actual web client and worker must report their zones again when implemented; this planning check does not implement detection in a dashboard.

**Automatic detection rules:**

1. On login/session start, detect the visitor device zone with `Intl.DateTimeFormat().resolvedOptions().timeZone`; detect the worker's machine zone separately. Convert Windows timezone identifiers to validated IANA identifiers on the server/worker where necessary.
2. Use the saved customer timezone for that customer's publishing/reporting. If absent, inherit the organization's `America/Los_Angeles` default. Device detection is for display/conversion and mismatch warnings, not for changing the business date.
3. If an approved customer location is available, a timezone lookup may suggest a customer zone. Require confirmation before applying changes. Do not trust proxy IP, browser geolocation or Incogniton's fingerprint timezone to override business scheduling.
4. Display both clocks when zones differ: **Business: US Pacific (PST/PDT automatically)** and **Your device: detected local zone**. A posting preview shows the Pacific business date, scheduled local wall time, current applicable offset and the operator-local equivalent.
5. Save each schedule's intended IANA zone, local date/time, resolved UTC instant and DST ambiguity choice. Save actual platform publication time separately. Future timezone/customer changes must not silently move already approved schedules.
6. Calculate Today/Yesterday from trusted server time in the selected business zone, not from the PC's possibly incorrect clock. Detect major worker clock drift; record server receipt and platform timestamps distinctly.
7. A shift crossing Pacific midnight spans two business dates. **This work session** groups the operator's shift; **Today** groups the current Pacific/customer calendar day. Keep both filters and labels to avoid hiding work on either side of midnight.
8. Automatically apply daylight-saving rules using IANA data (`Intl` on the web, timezone-aware `zoneinfo` with supported `tzdata` on Windows/Python). Do not implement fixed hour subtraction.
9. Reject nonexistent spring-forward local schedule times with a clear next-valid-time choice. For a repeated fall-back hour, require choosing the earlier/later occurrence or an explicit offset; do not guess or execute twice. Calendar-day report ranges may contain 23 or 25 hours.
10. Show unknown legacy publication times as unknown. Do not translate date-like text or assign a Pacific day without a verified source/date interpretation.

**Examples for planning only; dates/times are not configured work hours:**

| Intended Pacific time | Applicable zone | Pakistan local equivalent |
|---|---|---|
| 10:00 on a Pacific standard-time date | PST, UTC−08:00 | 23:00 on the same date, UTC+05:00 |
| 10:00 on a Pacific daylight-time date | PDT, UTC−07:00 | 22:00 on the same date, UTC+05:00 |

Read-only local runtime checks confirmed that on 8 March 2026 Pacific time skips from the 01:00 hour to the 03:00 hour, and on 1 November 2026 the 01:00 hour occurs twice with different offsets. Add these boundary cases to implementation tests; this check validates timezone conversion behavior, not an implemented scheduler.

## 8. Post verification and comment monitoring

### 8.1 Browser-first verification algorithm

1. Select due publications by customer/day/freshness policy; deduplicate pending checks.
2. Obtain the account/profile lease and reuse a compatible managed session if safe.
3. Confirm account identity and login. Handle ordinary navigation recovery without bypassing verification.
4. Navigate to the exact platform URL/ID. If unavailable, distinguish login/access failure, generic not-found, network failure and explicit removal notice.
5. Match post identity, author/account, content revision and available publication time. Never substitute the first post on a feed/profile.
6. Record observed visibility and actual audience context. Public and neighborhood-only access are not equivalent.
7. Read comments/replies using permitted UI access, expand/load additional items within a bounded collection policy, and record whether collection was complete or partial.
8. Save stable comment IDs, parent IDs, author display fields only as needed, body, platform creation time if available, first-seen time and observation time. Respect customer authorization and data retention.
9. Record metrics as observed values; failed or unavailable reads are null, not zero.
10. Save exact-post evidence with sensitive unrelated content minimized. Write database result plus outbox event.
11. Release the profile safely; close only sessions owned by the worker unless the operator has requested otherwise.

If the permitted browser view cannot expose reliable comment identity/timestamps or all replies, display a partial collection indicator and use **Newly observed comments** rather than claiming exact **Comments received yesterday**. Do not use undocumented/private endpoints to work around restrictions.

### 8.2 Initial monitoring policy

These are configurable starting assumptions, not verified platform quotas:

| Event | Proposed behavior |
|---|---|
| Successful submission | Initial exact-post verification after a short processing delay; retry observation rather than repost. |
| Same day | One later check where useful and permitted; higher frequency only for customer-approved active conversations. |
| Next day | Mark cohort checks due in the customer's business timezone; execute during the next active daily session. If the preferred window was missed while off, report actual delayed check time and coverage. |
| Subsequent days | Lower-frequency checks for the selected active monitoring horizon; retain older publications for on-demand checks. |
| Dashboard opened | Enqueue only stale/due checks when enabled; dispatch only in an active work session. |
| Managed profile opened | Run relevant due checks/update session health during an active work session. |
| Planned session end / computer off | Persist due jobs, show `Waiting for next session`; no expected overnight execution and no planned-offline alarm. |
| Unexpected disconnect during work | Bounded recovery/alert, preserve checkpoints, reconcile uncertain submits on return; no false live/removed conclusions. |
| Weekend / skipped day | Keep missed cohorts, check at the next active session and label gaps; never backdate observations or bulk-publish expired schedules. |

Batch multiple checks per authorized profile. Start with low machine concurrency, benchmark CPU/RAM/browser behavior, and configure capacity; the legacy UI's maximum of 20 is not proof that 20 concurrent profiles are safe.

### 8.3 Reports must distinguish two questions

1. **Publication cohort:** Of the posts published yesterday, how many are verified live at today's check, unavailable, unverified, or not checked?
2. **Activity period:** Across monitored posts, which comments were created yesterday, or first observed yesterday when creation time is unavailable?

Do not mix these into a single misleading count. A comment on a three-day-old post still belongs in yesterday's activity report if it was actually created yesterday. Do not use net changes in total comments as exact daily additions because comments can be removed or missed.

### 8.4 Daily report contents

- Customer, local date/timezone, generation time and latest included observation.
- Work-session/coverage window, expected closed hours and actual catch-up time. A session-end report may be provisional if checks/sync remain; the next session creates a labeled revision rather than claiming off-hours collection.
- Scheduled work vs actual submitted publications; verification results shown separately.
- Previous-day publication cohort with verified-live/unavailable/confirmed-removed/not-checked counts.
- Coverage: checks completed / checks due, partial comment collections, stale results and access failures.
- New comments or newly observed comments, clearly labeled, grouped by exact post.
- Outstanding assigned/unanswered comments where reply attribution is reliable.
- Exact links and permissioned evidence; account-level notification badges separately labeled if retained.
- Worker/sheet/portal delivery exceptions and next actions.

Store an immutable report version; corrections create a new version. Never overwrite a delivered report silently. Historical activity before collection began may be incomplete and must be labeled accordingly.

## 9. Spreadsheet and live portal synchronization

### 9.1 Sheets remain part of the product

Retain current task tabs, supported legacy names, pending-task intake, status exports and setup guidance. Add monitoring output columns/tabs only after an administrator reviews the mapping. The workbook file is an import snapshot; continuous updates need the actual connected Google spreadsheet identity and credentials or a separately specified local-file export workflow.

**Before implementation:** Obtain the live spreadsheet URL/ID and confirm whether “update the sheet” means the live Google Sheet, an Excel export, or both. Do not claim a downloaded `.xlsx` updates itself as the Google Sheet changes.

Retain the existing Google Apps Script bridge as the default sheet connection and harden it with authenticated/signed requests, replay protection, allowed operations, versioned schema mappings and validated response bodies. Do not replace a working sheet workflow unnecessarily or rely on an unguessable public script URL as authentication. Any future alternative sheet connector is a separate explicit decision, not a prerequisite for this dashboard. No live Google files are being changed by this planning task.

### 9.2 Stable identity and ownership

- Add an approved immutable `ND Record ID` or equivalent mapping field. Store spreadsheet ID, tab ID, record ID and last known row position.
- Row numbers are hints only: users can sort/insert/delete rows. Locate and validate the stable record ID before writing; duplicate/missing identity becomes a review task.
- Do not repurpose a legacy `ID` column containing unrelated values without preview/approval. Add `Incogniton Profile ID` separately where necessary.
- Define input-owned fields and output-owned fields. Supabase owns execution/monitoring results; sheets may supply approved drafts and explicit task requests.
- A nonempty sheet row with an empty status is not sufficient authorization after cutover. Use an explicit readiness/queue field or an approved import action.
- Imported `Posted`, failed and missing-link records are reconciliation candidates, not fresh publish jobs.

### 9.3 Recommended posting/listing output columns

Retain original content columns. Propose additions through mapping rather than overwriting unrelated data:

`ND Record ID`, `Customer`, `Incogniton Profile ID`, `Business Timezone`, `Business Date`, `Work Session ID`, `Published At`, `Publish State`, `Post link`, `Post Status`, `Check Health`, `Comments Total`, `New Comments Date`, `New Comments Count`, `Comments Collection`, `Last Checked At`, `Next Check At`, `Evidence Link`, `Last Error`, `Last Synced At`.

For exported timestamps use ISO 8601 with an explicit offset (or UTC plus the named business timezone); label Pacific display times clearly. Never export an unlabeled local timestamp that could be mistaken for Pakistan time. Distinguish preferred due time from `Waiting for next session` and actual check time.

Keep legacy task `Status` compatible with its task type, while writing monitoring into `Post Status`/`Check Health`. Example: a previously submitted publication can retain `Status = Posted` while `Post Status = Unavailable`. Do not keep resetting the task status and accidentally enqueueing a duplicate post.

For onboarding/profile/import tabs, export their own outcomes such as `Created`, `Verification required`, or `Imported`, not `Posted`. Preserve all current input columns including visibility, random-post text, area and moderation references in the raw import/mapping even when the resulting operation needs explicit confirmation.

Optional approved output tabs:

- **Post Monitoring:** one row per publication with exact link, customer, date, current observation and freshness.
- **Comments:** authorized accessible comment data by publication, with partial-collection markers and retention limits.
- **Daily Reports:** one row per customer/day/report version, coverage and report link.

### 9.4 Reliable synchronization sequence

1. Publishing/checking completes and a validated result is saved in Postgres.
2. The same database transaction adds a versioned `sync_outbox` record.
3. A dispatcher locates the correct mapped sheet record and validates allowed target columns.
4. Write only owned output cells, preserving formulas, input cells and unrelated records.
5. Check the application response, mark the delivery successful, and show its timestamp.
6. Retry sheet/network failures independently; keep `Sheet sync pending/failed` visible.
7. Reject stale events so a delayed older `LIVE` result cannot overwrite a newer unavailable/deleted observation.
8. On a missing row/duplicate ID/schema change, stop the write, retain the result in Supabase and request mapping repair.

No cross-system atomicity is assumed. If Nextdoor succeeded and Sheets failed, the publication remains submitted; only sheet delivery is retried.

### 9.5 Existing live portal

The portal URL, code, authentication and integration contract have not been supplied. Do not silently assume it is the same as the new customer dashboard.

- If this new web dashboard replaces the portal, use the same Supabase records with customer-restricted views.
- If an existing portal must remain, implement a supported server-side API/webhook integration with stable IDs, versioned status events and a retryable outbox.
- If no supported interface exists, agree a separate authorized integration/export workflow before implementation; do not promise unsupported portal writes.
- Never make publishing depend on portal availability or repost because portal sync failed.

## 10. Authentication, permissions, and security

### 10.1 User lifecycle and roles

Use Supabase Auth for email/password sign-up/sign-in, verified email, invitations, password reset and secure sessions. New public sign-ups enter a pending/empty state or their own empty organization; they never gain access to existing customer data. Organization/customer membership is an explicit admin action.

| Role | Access |
|---|---|
| Owner/Admin | Worker pairing, integrations, team, security, all authorized organization operations. |
| Manager | Customer/content assignment, approvals, schedules, reports and permitted operational controls. |
| Operator | Assigned customers/accounts/tasks, monitoring and permitted execution; destructive actions only if granted. |
| Customer | Only their own approved content, posts, monitoring, comments/reports as configured; no cookie/proxy secrets or worker internals. |

MFA for privileged users, database Row Level Security and private storage policies are launch requirements. Validate authorization in server endpoints, RPCs, realtime subscriptions and worker uploads as well as the UI.

### 10.2 Secret and browser safety

- Keep Supabase privileged keys and Google/portal credentials server-side. Workers use scoped revocable credentials, not a universal service-role key.
- Encrypt platform/proxy/cookie secrets using a protected key-management strategy; limit decryption to the permitted operation. Prefer references over copying secrets into jobs.
- Treat cookies as sensitive credentials. Do not include raw values in logs, reports, source control or sheet exports.
- Redact proxy passwords, login credentials, tokens and browser-debug endpoints from user-visible diagnostics.
- Use private evidence buckets and short-lived signed links. Reports should use authenticated app links rather than permanently public screenshots.
- Bound media downloads, check actual content, limit size, validate redirects and block local/private-network destinations to prevent SSRF.
- Web users upload files; they cannot read arbitrary `C:\...` paths on the worker. Approved worker-local file compatibility must be directory-scoped and permissioned.
- Capture only necessary comment/customer data. Agree retention/deletion policies, especially for onboarding identity information and screenshots.
- Require exact target preview/approval for edit, delete, cookie replacement and blocking. A typed word in a sheet must not trigger a destructive action automatically.
- Browser automation must stop for account restrictions and verification challenges, not attempt an evasion workflow.

## 11. Scheduling, retries, and recovery

### 11.1 Durable job types

Initial handlers: `SYNC_PROFILE_INVENTORY`, `CHECK_ACCOUNT_HEALTH`, `CREATE_BROWSER_PROFILE`, `IMPORT_COOKIES`, `UPDATE_PROXY`, `ONBOARD_ACCOUNT`, `PUBLISH_POST`, `PUBLISH_LISTING`, `PUBLISH_PRESET`, `RECONCILE_PUBLICATION`, `CHECK_PUBLICATION`, `COLLECT_COMMENTS`, `EDIT_PUBLICATION`, `DELETE_PUBLICATION`, `MODERATION_ACTION`, `SYNC_SHEETS`, `SYNC_PORTAL`, `GENERATE_REPORT`, `DELIVER_REPORT`. All browser handlers require an active work session. The initial sync/report dispatcher is invoked during work sessions; off-hours cloud dispatch is not required.

Use explicit feature/capability flags for controlled or unavailable actions. A disabled capability must explain why in the UI, not vanish.

### 11.2 Claiming and locking

- Claim jobs atomically through server-only Postgres functions, such as a transactional `FOR UPDATE SKIP LOCKED` implementation.
- Use a lease expiry, worker heartbeat and fencing token. Reject stale result writes from expired/reassigned workers.
- Lock the actual Incogniton UUID and its account for browser/proxy/cookie operations across all workers and legacy tooling, not merely inside one Python thread.
- Keep API launch cooldowns and machine capacity limits; control long-running browser work outside serverless request limits.
- Dashboard reads must never mutate task ownership or consume pending jobs.
- Enforce active work-session/allowed-window checks server-side at job lease time, not only in the web buttons. Planned closure holds jobs without failing them; unexpected heartbeat loss while active marks the session interrupted.
- On session resume, reconcile uncertain actions and release due monitoring work first. Expired publishing/onboarding windows need an explicit reschedule/approval decision; never automatically replay a whole night's publish backlog.

### 11.3 Idempotency and side effects

- Use an immutable publish-operation key tied to the approved revision/account/destination/occurrence; a deliberate future repeat gets a new occurrence.
- Save operation intent and pre-submit checkpoint before a platform side effect; save the external result immediately afterward.
- **Exactly-once publishing cannot be guaranteed across browser/DB failures.** Use at-least-once job delivery with deduplication and reconcile-before-retry.
- A crash after submission, missing URL or expired lease during publishing goes to `RECONCILING`, not automatic reposting.
- Recover actual platform state before replaying edit/delete/block/account-creation/profile-creation steps.
- Sheet/report/notification delivery retries must never repeat a publish action.

### 11.4 Error handling and cancellation

Retry transient network/worker/sheet failures with bounded exponential backoff and jitter. Login/OTP/CAPTCHA, unknown UI, unavailable media, ambiguous profile mapping or account restrictions become handoffs. Preserve error type across adapters.

Cancel queued jobs immediately. Running jobs stop at safe boundaries, save a checkpoint and release owned resources. If cancellation arrives after submission, record the submitted publication and schedule reconciliation rather than claiming nothing happened. Add per-stage and whole-job deadlines so recognized-screen loops cannot run forever.

### 11.5 Human handoff

Each handoff includes customer/account, exact job stage, safe redacted evidence, required action, assigned operator, deadline and **Resume after verification**. Resume revalidates platform state and job ownership. No browser window should remain invisibly waiting forever.

## 12. Implementation phases and developer tasks

### Phase 0 — Protect, map and validate

**Deliverable:** Validated source mapping and a safe non-production environment.

- [ ] Create source control and exclusions; snapshot existing code/config/schema without committing secrets.
- [ ] Record the F01–F36 behavior inventory and isolate ad-hoc live-writing test scripts.
- [ ] Confirm the actual Google Sheet, portal, worker machine, account types, customer permissions, timezone and monitoring horizon.
- [ ] Confirm US Pacific (`America/Los_Angeles`) as the organization default; validate customer/location overrides, detected device zone and a configurable daily 8–10 hour work session. No fixed work start/end time is assumed.
- [ ] Confirm platform permission for proposed browser operations; record actual Incogniton/Playwright capabilities and handoff limits. Do not request Nextdoor API credentials or add an API-access prerequisite.
- [ ] Build import preview with original-row provenance, duplicate-header detection, missing-column quarantine and zero execution by default.
- [ ] Import/reconcile profile inventory by real UUID without launching profiles or creating duplicates.
- [ ] Resolve wrong workbook column maps, unknown customer assignments and publication times without inventing values.
- [ ] Verify Python/Playwright/Incogniton setup on the intended worker. Python was not runnable through the review shell's `python` command; this is a PATH/runtime check, not proof that no installation exists elsewhere.

**Exit gate:** No imported row can cause publishing, account creation, deletion or bulk profile creation without explicit approval.

### Phase 1 — Web foundation and read-only operations

**Deliverable:** Sign-in plus real customer/account/post data, not mock-only screens.

- [ ] Add `apps/web`, Supabase migrations and generated/validated contracts.
- [ ] Implement Auth, pending sign-up/invitations, roles, RLS, customer assignment and protected storage.
- [ ] Add customer/account/profile inventory and capability/authorization views.
- [ ] Import existing publication references with legacy/unverified statuses and unresolved-date flags.
- [ ] Build Overview, Today, Yesterday, All Posts, publication detail and Action needed.
- [ ] Implement worker registration/heartbeat and job persistence without enabling publishing yet.
- [ ] Implement Pacific/local clocks, timezone mismatch warnings, work-session Start/Pause/End controls and planned-closed vs unexpected-disconnect states.

**Exit gate:** Users cannot access another customer's/organization's records; known historical links can be browsed without launching or reposting anything.

### Phase 2 — Main objective: next-day checks, comments and sheet writeback

**Deliverable:** A complete monitoring loop using existing authorized Incogniton profiles.

- [ ] Add GUI-free worker entrypoint and repository/service abstraction; remove Tk dialog dependencies from worker execution.
- [ ] Implement exclusive managed-session handling, exact-post checks and typed outcomes.
- [ ] Add comments/replies collection with stable IDs where available and explicit partial-result flags.
- [ ] Add session-driven due-check planning, Pacific day/DST rules, dashboard-open deduplication, managed-profile-open checks, weekend catch-up and late-check labels. No dispatch while work is closed.
- [ ] Add authenticated sheet connector, stable row identity, output mapping and retryable outbox.
- [ ] Import/reconcile the workbook's 79 existing post links; investigate the 9 claimed-posted records without links.
- [ ] Generate daily monitoring reports with coverage and clear cohort/activity separation.
- [ ] Test the complete monitoring loop on a small authorized sample, then a 20-publication cohort.

**Exit gate:** The operator can answer: “For yesterday's 20 tracked publications, which were checked, which are live, which are inaccessible, which comments were observed, and did the sheet update?” Every record is accounted for, including failures.

### Phase 3 — Posting today and automatic tomorrow scheduling

**Deliverable:** Web-controlled publishing through Incogniton connected to Phase 2 monitoring.

- [ ] Build standard post and listing composers, upload handling, preview, approvals and schedules.
- [ ] Refactor current posting/listing flows into explicit resumable operations with typed results.
- [ ] Verify account identity, attachments and audience; fail closed on unknown audience.
- [ ] Save exact post identifiers and evidence; add reconcile-before-retry and duplicate protection.
- [ ] Automatically mark next-day verification due for each publication using the customer's business timezone; execute next session if off. Add approved publishing windows and missed-window review rather than automatic catch-up posting.
- [ ] Migrate standard posting, listing and the actual supported preset/random-post behavior with feature-parity tests.
- [ ] Keep found-target skip separate from created-post counts; keep editing/deleting/moderation independent.

**Exit gate:** An approved small live publishing pilot and its next-day monitoring complete without accidental duplicates, unrelated screenshots, or lost sheet updates. No unattended production rollout solely on mock tests.

### Phase 4 — Remaining operational feature parity

**Deliverable:** Current operational capabilities managed from the web, with explicit controlled actions.

- [ ] Migrate browser-profile creation, dynamic groups/settings, proxy changes, bulk imports and protected cookie imports.
- [ ] Add bounded genuine-customer onboarding with verification handoff/resume and secure credentials.
- [ ] Add explicit exact-post edit/delete, authorized block-list management and target-monitoring skip rules.
- [ ] Add session-health/supervised-browsing workflow and record the disposition of random-like behavior.
- [ ] Resolve the random-group UI/implementation gap before enabling or promising group-specific publishing.
- [ ] Migrate settings, connection tests, dark/light UI, worker update/drain and legacy connector setup guidance.
- [ ] Complete F01–F36 sign-off. Retain/disable legacy workflows explicitly until their replacements are tested.

**Exit gate:** Every inventory entry has a tested replacement or a documented approved controlled/deferred disposition. There is no silent functionality loss and no overlapping legacy/new job ownership.

### Phase 5 — Customer access, portal integration and production rollout

**Deliverable:** Secure deployed operations with reporting, recovery and support procedures.

- [ ] Add customer-only report/post views and configured email/in-app report delivery.
- [ ] Implement existing-portal sync only after its contract is reviewed, or explicitly approve replacement by this dashboard.
- [ ] Add alerts for unexpected worker disconnect during active sessions, failed checks, incomplete coverage, failed sheet sync and report delivery. Suppress expected closed-session/off-hours alarms.
- [ ] Run security, recovery, timezone, browser-version and workload tests.
- [ ] Configure domains/TLS, SMTP, production secrets, backups, evidence retention and restore procedures.
- [ ] Stage rollout: read-only -> checks -> controlled posting -> wider customer cohorts.
- [ ] Train operators, record ownership/maintenance responsibilities, and retire desktop task paths only after parity approval.

**Exit gate:** Production checklist, 20-publication next-day acceptance, access-isolation tests, backup restore and rollback drill are signed off. Dates/estimates are set after platform permission, portal review and pilot timings; external approval time is not assumed.

## 13. Testing and acceptance criteria

### 13.1 Main 20-publication acceptance test

Use existing authorized publications first; new test posts need approval. Do not intentionally produce spam or manipulate engagement to test reporting.

1. Track 20 publications with exact account, customer, URL/ID, actual day/timezone and known expected observations.
2. Tomorrow's scheduled run selects the correct local-day cohort exactly once, including DST/midnight boundary fixtures.
3. All 20 receive a result: checked-live, unavailable/removed with evidence, unknown/access failure, or not checked with an explicit reason.
4. Verify available comments/replies on their exact publications, deduplication, edits and partial collection indicators using authorized examples or fixtures.
5. Dashboard and mapped sheet agree on the latest successful observation and check timestamp; sync failures remain visible.
6. The report accounts for all 20 without calling failures live or classifying missing access as removal.
7. Reopening the dashboard twice and using two operators does not publish/recheck duplicate work unnecessarily.
8. Worker/network interruption resumes safely. A crash after submission causes reconciliation, not a duplicate post.
9. Sheet-only downtime does not alter the platform publication or trigger reposting.
10. A customer sees only their allowed records, comments and evidence.
11. Closing the work session and turning off the PC causes no off-hours browser jobs or repeated failure alarms. Due work remains stored and resumes in the next active session.
12. Resume after a skipped day/weekend includes older due cohorts, labels the actual observation time, and never publishes all expired schedules automatically.
13. Device timezone `Asia/Karachi` does not change Pacific Today/Yesterday filters or approved schedule instants. A shift crossing Pacific midnight is correctly split by business date and still visible under **This work session**.

### 13.2 Required automated tests

| Area | Cases |
|---|---|
| Imports | Repeated headers, wrong columns, unnamed data, legacy cookie-tab alias, duplicate names, ambiguous IDs, whitespace/category normalization, no automatic execution. |
| Media/cookies/proxies | Accepted legacy formats; invalid/unsupported media; missing Drive access; oversized files; SSRF/redirect checks; protected local paths; cookie replace failures and redaction. |
| Publication identity | Found-target skip; first-post mismatch; missing link; stale results; repeated content; manual-publication attribution; exact screenshot target. |
| Browser state | Logged out, suspended, verification required, composer variants, unknown audience, incomplete upload, modal interruption, out-of-sync profile, manually owned browser. |
| Comments/metrics | Stable-ID deduplication, replies, edited/deleted observations, inaccessible metrics vs zero, partial pagination, missing creation timestamps, account badge vs listing conversations. |
| Queue/recovery | Double claim, expired lease, stale fencing token, process restart, cancel before/after submit, per-stage timeout, profile conflict across job types, end-of-session drain, planned-offline suppression, weekend catch-up, expired publish schedule review and no execution while session closed. |
| Sheets | Sorted/inserted/deleted rows, duplicate/missing record ID, renamed columns, formulas preserved, HTTP 200 with JSON error, stale outbox version, replay protection and retry after outage. |
| Auth | Pending sign-up, invitations, password reset, role checks, cross-tenant IDs, RLS/storage/realtime isolation and revoked worker credentials. |
| Reporting | Pacific vs Pakistan date mismatch, device/business zone separation, spring nonexistent time, fall repeated hour, 23/25-hour days, worker clock drift, cross-midnight work sessions, late comments, older-post/off-hours activity, unknown creation times, immutable report revisions, failed delivery and incomplete coverage. |

Use synthetic fixtures and mocked browser/connector responses for most tests. Real Incogniton/browser tests run only in an authorized staging/pilot environment. Existing production-writing test scripts are not a safe test suite. Maintain release evidence linking F01–F36 and N01–N08 to test cases.

## 14. Deployment and operations guide

### 14.1 Environment layout

| Component | Initial location | Notes |
|---|---|---|
| Next.js web app | Vercel or equivalent managed host | UI and short authenticated server requests only. |
| Supabase | Separate staging and production projects | Region chosen for customers, worker latency and applicable data requirements. |
| Incogniton browser worker | Existing approved Windows computer, during daily 8–10 hour work sessions | Use existing profiles and supported Incogniton installation. No always-on hosting/PC requirement. Not a serverless function. |
| Scheduler/sync/report processing | Durable due times in Postgres; planner and bounded dispatcher run during active work sessions | No permanent cloud worker is required for the initial scope. Short authenticated server calls may perform bounded integration writes; unfinished work persists. Dashboard-tab closure is different from End work. |
| Off-hours website access | Hosted web app and Supabase may remain reachable | Show stored results, clear freshness and drafts; no promise of live checks or remote actions while the computer is off. |

### 14.2 Setup sequence

1. Provision staging Supabase and apply reviewed migrations/RLS/storage policies. Seed synthetic accounts/data only.
2. Configure Auth redirect URLs, email verification/password reset, SMTP and admin MFA.
3. Deploy staging web with server-side environment secrets. Only intended public configuration goes to the frontend.
4. Install/pin a supported Python runtime and dependencies on the worker; validate Playwright compatibility with Incogniton. Do not auto-upgrade customer machines without approval.
5. Pair the worker using a one-time registration flow; scope it to approved profiles/customers and low initial concurrency. Set `America/Los_Angeles` as business default, detect device timezone without changing the OS, and configure operator-controlled session start/end and optional approved Pacific posting windows.
6. Confirm Incogniton is signed in, API-enabled where required, reachable locally, and has sufficient storage/browser capacity.
7. Import UUID inventory and link real customer accounts without creating new profiles.
8. Configure a staging sheet mapping and authenticated connector. Do not point test writes at the production sheet.
9. Run health, import, exact-post check, comment, sheet-outbox and report tests; test Start/End work, computer-off/resume, Pacific/Pakistan/DST date conversion and missed-window handling; then the approved 20-publication next-day pilot across two actual work sessions.
10. Repeat reviewed configuration for production; enable features progressively and record cutover ownership from the desktop app.

### 14.3 Worker availability and maintenance

- The operator's computer runs approximately 8–10 hours daily, not continuously. Prevent disruptive sleep only during an active work session if approved; do not change system-wide availability policy silently. Outside work hours normal shutdown/sleep is expected.
- Validate lock/logoff/reboot, Incogniton logout and browser updates. An interactive desktop session may be required; document it. Treat planned End work as normal, and unexpected disconnection during an active session as an interruption.
- On startup after reboot, show readiness and **Start work / Resume interrupted session**. An installed agent may start for health reporting if approved, but it must not automatically publish/onboard until the work session and task window are authorized.
- **End work** drains/checkpoints tasks and attempts pending sheet/report sync. If the computer shuts down first, persist results/outbox and retry next session; do not require the PC to remain on overnight just to meet a report schedule.
- Add active-session heartbeat alerts, session history and operator-controlled recovery; do not store exposed login credentials for convenience. The dashboard must explain exactly which checks waited while the PC was off.
- Drain jobs before worker/app updates; pin compatible worker/contract/browser versions and support rollback.
- Back up database and required private storage; test restoration. Handle Incogniton profile backups using supported vendor procedures, not copying active profile files blindly.
- Set evidence/comment/raw-import retention and database/log cleanup policies.
- Track checks per profile, average duration, queue age and failed-collection rates before increasing concurrency or machines.

### 14.4 Cutover and rollback

Pause legacy execution for a selected profile/customer before enabling web execution. Keep read-only legacy records available. If a release fails, disable new dispatch, let active tasks reach a safe checkpoint, reconcile possible platform side effects, restore the previous compatible worker/web version, and replay only safe pending sync/check operations. Never rollback by deleting recorded publications or blindly rerunning the old sheet queue.

## 15. Decisions required and known limitations

### 15.1 Decisions to confirm before production implementation

1. **Live sheet:** Actual spreadsheet URL/ID; whether the local Excel file also needs generated exports; preferred authenticated connection.
2. **Portal:** Existing portal URL/source/API, or confirmation that the new customer dashboard replaces it.
3. **Accounts:** Neighbor/business account types, genuine customer authorization and demonstrated/allowed browser capabilities using the existing Incogniton/Playwright system. No Nextdoor API connection is required or planned.
4. **Customer mapping:** Which workbook profiles/areas/services belong to which customers; do not infer this from names alone.
5. **Reporting:** Confirm US Pacific default plus per-customer overrides, actual daily work-session hours, preferred next-session check/report time, active monitoring horizon and delivery channel. The requested operating model is already daily 8–10 hours, not 24/7.
6. **Scale:** Expected publications/day, monitored posts, comments/day, team size, worker machines and acceptable check delay.
7. **Open behavior:** Whether dashboard-open and manually opened-profile checks are enabled by default; how manual-session ownership is managed.
8. **Controlled legacy actions:** Who may approve edit/delete/block/cookie replacement; disposition of warmup/random likes and unverified group-selection behavior.
9. **Credentials and retention:** Secret-management approach, allowed local-file directories, identity-data requirements, evidence/comment retention and customer visibility.

### 15.2 Explicit limitations

- No current live status can be concluded from the workbook's `Posted` labels alone.
- Historical daily publication/comment counts cannot be reconstructed reliably from dates absent in the source. Reconciliation may recover platform timestamps where accessible; unknown remains unknown.
- Private/neighborhood visibility depends on the authorized viewing context. Public browsing is not an adequate replacement.
- The authorized browser view may not expose all comments/replies or their IDs/timestamps. Report partial observations rather than promise unsupported completeness; no Nextdoor API fallback is planned.
- No browser checks or fresh comment collection run while the computer is off or the work session is closed. The next session can collect available intervening activity, but cannot reconstruct continuous overnight visibility or comments removed before they were ever observed.
- An account's unread-chat badge is not a per-post conversation count. Direct-message integration needs separately verified support and permission.
- Browser UI selectors and Incogniton behavior can change. Unknown layouts need safe failure, test fixtures and maintained adapters.
- “Fully automated” means routine permitted tasks run without repetitive manual work; identity verification, platform restrictions and ambiguous destructive operations still need a person.
- Nextdoor API integration is explicitly out of scope, including optional/fallback integration. Do not add it without a new explicit user instruction. Only supported authorized browser-visible actions/data are used for Nextdoor operations.
- No one can guarantee universal post visibility, continuous accessibility or exactly-once browser publishing under all network/process failures.

## 16. First implementation checklist

Follow this order. Do not start with bulk account creation or a decorative-only dashboard.

1. **Protect existing work:** Source-control setup with secret exclusions; preserve desktop code and the workbook.
2. **Validate mappings:** Resolve workbook anomalies, customer ownership, actual sheet/portal targets and profile UUIDs.
3. **Build Auth + schema + RLS:** Secure real records before enabling operational controls.
4. **Build Pacific Today/Yesterday views:** Import known post links as historical/unverified references with unknown-date flags; detect local device timezone separately and include **This work session**.
5. **Build the secure session-driven worker connection:** Start/Pause/End work, heartbeat, job claim, exact-profile lock, typed result, cancellation and normal planned-offline handling.
6. **Build exact-post monitoring:** Browser-first authorized checking, comments and evidence; no publishing enabled yet.
7. **Build sheet outbox:** Stable row ID, monitoring columns, reliable versioned writeback and error visibility.
8. **Prove the next-session loop:** Pilot existing links, then 20 tracked publications across two daily work sessions, with Pacific-day coverage, off-hours/catch-up labels and daily reporting.
9. **Connect today's publishing:** Web composer -> Incogniton -> exact result -> tomorrow's due check -> next active session; no automatic replay of expired publish schedules.
10. **Complete remaining parity:** Account onboarding, profile/cookie/proxy tools and all controlled legacy tasks using F01–F36.
11. **Deploy gradually:** Read-only, monitoring, controlled publishing, then customer-by-customer rollout with rollback readiness.

**Definition of done:** During the daily 8–10 hour computer work session, an operator can control supported existing tasks from the web, publish through assigned Incogniton profiles, see exactly what was posted today by Pacific/customer business date, and review the next session's verified observations/comments per post. Device timezone detection never silently changes the business schedule. When the computer is off, due work is preserved, planned closure is normal, and late observations are labeled honestly. The mapped sheet/portal either received the latest saved result or clearly shows a delivery failure. Every existing capability has an explicit tested or approved disposition.

## 17. References

### Reviewed local sources

- `main.py`, `gui/app.py`, relevant `gui/views/`, `gui/ui_helpers.py`.
- `core/automation/`, `core/engine/`, `core/services/sheets_service.py`.
- `core/assets/apps_script.js`, `core/config.py`, `requirements.txt`, launcher/update files and selected ad-hoc tests.
- User-provided workbook and Incogniton screenshot. Raw credentials, cookies and customer post bodies are intentionally not reproduced here.

### Official Incogniton documentation

- Incogniton local-first browser/API architecture: <https://api-docs.incogniton.com/getting-started/quickstart>
- Incogniton API reference: <https://api-docs.incogniton.com/apis>

External capability documentation can change. Revalidate required browser operations and permissions against the actual authorized accounts and installed Incogniton version before enabling production automation. Nextdoor API references from earlier discussion are intentionally excluded because that integration is not part of the user's requested solution.
