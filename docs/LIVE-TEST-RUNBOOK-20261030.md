# Live test runbook — 2026-10-30

This is the operator procedure for the first supervised live test. It covers
**read-only monitoring** and the reporting chain. It does **not** authorize
Fudge uploads, publishing, profile creation or Sheet writeback delivery.

## What is already verified

| Item | Evidence |
| --- | --- |
| Hosted schema | 15 migrations (added `20261030203000 check_claim_identity`); 28 public base tables, all RLS-enabled |
| New protocols | `20261030164030 check_cohort_v1`, `20261030164110 publish_jobs_v1`; both tables empty |
| Connector (live) | `npm run check:sheet` PASS: Auto Posting 69 rows, Auto Listing 111 rows, truncation false, wrong token refused |
| Web validation | typecheck, lint (0 warnings), 805 tests / 57 files, production build PASS |
| Worker unit tests | **80 PASS** (75 + 5 identity/job-contract tests) |
| Worker runtime | Python 3.13 `.venv` with the exact pins; `pip check` clean, `preflight.py` dependencies + Playwright import PASS, wheel SHA-256 verified |
| Test-state cleanup | Old worker `offive laptop` revoked (0 credentials, 0 enabled workers); empty orphan org `ND Posts` deleted; `ND Test` has 0 bindings/publications/sessions |
| First live check | Job `ca03a6b3…50e5` completed `alive` on 2026-10-30 18:52:24Z for `Thomas Gutierrez`; second poll `idle`; profile back to `Ready` |

## Exact-post identity on Nextdoor (read before step 5)

Nextdoor serves a post permalink in a **feed shell**: the title bar still says
*News Feed*, several `feed-item-card` elements render, and **no card ever links
to its own post**. A contract that demands an in-card self-link can never be
satisfied, so the adapter accepts either identity signal:

1. an in-card visible link whose path equals the target post path; or
2. the page address equals the target path **and** the visible body matches the
   publication's stored title (normalized first 40 characters contained in the
   body, or ≥80% of the title's words longer than three letters).

Exactly one matching root is required. Without a stored title only signal 1
applies. Verified live on 2026-10-30: correct title matched with 100% word
overlap while every other card scored 0; wrong title, empty title and a different
target URL all returned `exact_post = false`.

## Hard preconditions (operator actions)

1. **Incogniton must be installed, running and signed in** on whichever machine
   hosts the worker, with the pilot profiles accessible. **Done on this machine
   on 2026-10-30:** Incogniton **5.0.1.5** is installed, signed in (3,220
   profiles / 33 groups) and answering on `127.0.0.1:35000`. The installer
   (`%USERPROFILE%\Downloads\IncognitonSetup-5.0.1.5.exe`, 191,171,088 bytes,
   SHA-256 `2eaad7bf69eb8bf91514bc13d0b3c1014eccb1eb611d0991f841e5581e10d4c4`)
   was verified before use: Authenticode **Valid**, signed by `WorkingGreen B.V.`
   through Sectigo EV code signing. Keep the app running and logged in for every
   test; a closed app makes every claim fail with `profile_error`.
2. **A verified staff sign-in** to the dashboard for the `ND Test` workspace
   (`b59489ca-c7c3-4e1a-b2ae-ec9da429f415`). Live checks cannot be authorized
   from this session.
3. **Explicit pilot profiles.** Do not reuse a profile that the legacy desktop
   tool is currently using.

## Ordered setup

### 1. Confirm the runtime

From `apps/worker`:

```powershell
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe preflight.py
python -m unittest discover
```

`preflight.py` must report Python, the four pinned packages and the Playwright
sync-API import as `pass` (already confirmed in this environment). The connection,
adapter and hosted-credential checks stay blocked until steps 3–5.

### 2. Import profile inventory

1. Export the Incogniton profile inventory for the pilot profiles (ID, name,
   group only — never cookies, proxies or passwords).
2. Sign in to the dashboard, select **ND Test**, open **Profiles**, preview the
   CSV and import it.
3. Review every UUID/name/group claim. Do not guess a duplicate name.

### 3. Register and pair the worker

1. Open **Worker setup** (`/dashboard/automation`).
2. Register the real machine name and confirm the authorization checkbox.
3. Copy the private connection JSON **once** and save it as
   `apps/worker/.monitoring/worker.json`.
4. Never commit, paste into chat or share this file. It can claim assigned jobs.
5. The old unused worker `offive laptop` has already been revoked (credential
   deleted, jobs cancelled); register a new machine name instead and never reuse
   a credential that was never paired.

### 4. Bind profiles to the right customer

For each pilot profile, create an explicit binding: worker + exact profile UUID
+ customer + account label. The account label must exactly match the label used
on tracked publications. Unknown or ambiguous mappings stay unbound.

### 5. Validate the monitoring adapter

Fill `.monitoring/adapter.json` only from an authorized DOM inspection of a real
post page opened with the pilot profile. **Adapter version is 2**: the fields
below are required, and `comment_id_selector`, `comment_id_prefix`,
`comment_author`, `comment_expand` and `comment_total` are optional — an empty
string means "this layout does not offer it". Values verified on 2026-10-30:

| Field | Verified value | Evidence |
| --- | --- | --- |
| `post_root` | `[data-testid="feed-item-card"]` | 11 cards on the post page, 5 with a body |
| `post_body` | `[data-testid="post-body"]` | 5 visible bodies |
| `post_link` | `a[href*="/p/"]` | never matches the post itself (see identity note) |
| `comment` | `.js-media-comment` | one item per comment, stable across expansion |
| `comment_id_selector` | `[data-testid^="dwell-tracker"]` | per-item holder of the platform id |
| `comment_id_attribute` | `data-testid` | e.g. `dwell-tracker-feedItem:1735634352` |
| `comment_id_prefix` | `dwell-tracker-feedItem:` | stripped to the numeric id |
| `comment_body` | `[data-testid="comment-detail-body"]` | 22/22 non-empty bodies |
| `comment_author` | `[data-testid="comment-detail"] a[href*="/profile/"]` | 22/22 authors |
| `comment_expand` | `[data-testid="seeMoreButton"]` | "See previous comments"; gone at 22/22 |
| `comment_total` | `[data-testid="post-reply-button"]` | the post's own count (scoped to the root) |
| `login` | `[data-testid="email-address-input"]` | absent/not visible while signed in |

`removed`, `verification` and `unavailable` remain deliberately non-matching
placeholders: removal, verification and unavailable notices are never
auto-confirmed, and an unrecognized layout yields `needs_review`.

**Two independent gates protect comment expansion.** A read-only "show more
comments" click happens only when the adapter configures `comment_expand` **and**
the operator passes `--allow-comment-expansion` (on `agent.py` or `monitor.py`).
Without both, the thread is read exactly as rendered and stored as incomplete.

`comments_total` is read from the post's own reply control inside the identified
root. `comments_complete` becomes true only when the total was read, the number
of collected items equals it, the adapter can expand at all, and no expand
control remained — so a collapsed thread can never look complete.

Execution rejects empty or structurally invalid selectors. Do not invent
selectors or copy page content into the repository. Re-derive these values before
relying on a new Incogniton/Nextdoor build.

### How comment capture works (verified 2026-10-30)

A hard page load mounts an **empty** `[aria-label="Comment list"]`; waiting and
scrolling do not populate it. Activating the post's own comment control
(`[data-testid="post-reply-button"]`, `aria-label="Comment"`) opens the thread as a
reader would: one item plus a "See previous comments" control
(`[data-testid="seeMoreButton"]`). Each press of that control loads the next page
of the thread; when it disappears and the item count equals the post's own count,
collection is complete.

On a real 22-comment post this produced 22 items, 22 unique numeric ids, 22
authors and 22 bodies, with `comments_total = 22` and `comments_complete = true`.
Nothing is typed, submitted, liked or shared; the composer that gains focus is
never written to, and the profile is closed when the batch ends.

Both interactions are gated: the adapter must configure `comment_expand` **and**
the operator must pass `--allow-comment-expansion`. Without both, the page is read
exactly as rendered and the result is stored as partial.

`comments_complete` is true only when the total was read, the item count equals
it, the adapter can expand at all, and no expand control remained. A rendered
empty list is never treated as zero comments, and `comments_total` stays `null`
when the count cannot be read.

The dashboard already renders stored comment detail (author, body, first-observed
time, platform creation time when known) on `/dashboard/comments`,
`/dashboard/posts/<id>` and `/dashboard/results?view=comments`; the post ledger
shows the per-post count.

### STOP: the pilot account is suspended (2026-10-30)

Do not run further live checks with profile `6d98db87` / account
`Thomas Gutierrez` until a person resolves it. Every navigation now lands on
`https://nextdoor.com/account_disabled/`, which reads:

> Your account has been indefinitely suspended by Nextdoor for breaking community
> guidelines.

This is a platform action on the account — not a proxy failure, a selector drift or
a post removal. The worker now recognises that address and records `needs_review`
with "Nextdoor redirected to its Account Disabled page; a person must review the
account." It stores no comments and makes no claim about the post.

Most recent stored state for the pilot post: 21 of 22 comments (real authors),
observation `comments_total = 22`, `comments_complete = false`, notification
"partial". That is the true state, not a bug to retry away.

To continue, one of these is required — each is an operator decision:

1. Appeal or resolve the suspension with Nextdoor, then re-check the account in a
   normal browser before rebinding it;
2. bind an authorized replacement account/profile to the publication and re-run
   one check with `--allow-comment-expansion`;
3. leave monitoring paused and treat the 21 stored comments as the pilot's final
   evidence.

Never attempt to evade a suspension (new account, different proxy, altered
fingerprint) — that is outside this system's authorized scope.

### Transient failures and the 24-hour window

`reporting_complete_check` records `last_checked_at` for every outcome, including
`proxy_issue`, `network_error` and `profile_error`. Those three are therefore
re-planned after a 30-minute cooldown instead of a full day, capped at 6 attempts
per rolling 24 hours. Everything else keeps 24 hours, and `needs_review` never
fast-retries because it is waiting on a human decision.

What this means while operating:

- a proxy blip no longer costs a post its whole day; wait ~30 minutes and the
  next claim can pick it up;
- if a post shows `Last attempt: Proxy issue…` in the ledger for several hours,
  the proxy is persistently broken — fix or reassign it, not the post;
- after 6 failures in 24 hours the post is intentionally parked; there is no
  manual single-post requeue yet, so a genuinely dead proxy needs the profile's
  proxy replaced rather than more retries.

### Geo and proxy posture ("is Pakistan banned?")

Nextdoor availability is decided by the **egress address of the profile's proxy**,
not by where the worker machine runs. Verified 2026-10-30 inside the pilot profile
via `ipinfo.io/json`: `country: US`. So this pilot browses as a US visitor and the
banned-region risk does not apply to it.

The rule to keep: a profile whose proxy is missing, misconfigured or in a blocked
region fails closed as `proxy_issue` and is never reported as a removed post. Do
not "verify" reachability from the host machine — always from inside the profile.

### Where an undated post appears

Publications imported without a Sheet date are excluded from every dated cohort:
`/dashboard/reports` counts them in **`unknownDates`** with the coverage notice
"… post records have unknown publication dates and are excluded from day
cohorts", and `/dashboard/yesterday` will not list them. Their checks are still
visible on `/dashboard/checks` and in the post ledger. Never invent a date to
make a post appear in a report — import the date from the source or accept the
`unknownDates` accounting.

### 6. Create one work session and authorize monitoring

1. In the dashboard press **Start work** (an 8–10 hour human session).
2. Open **Worker setup** and enable monitoring for exactly the pilot binding.
3. Do not enable other profiles.

### 7. Run the agent in the foreground

```powershell
.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json
.\.venv\Scripts\python.exe agent.py --connection .monitoring/worker.json --adapter .monitoring/adapter.json --execute --confirm-authorized --once --allow-comment-expansion
```

`--allow-comment-expansion` is optional and only meaningful when the adapter
configures `comment_expand`; without it the agent reads the thread exactly as
rendered and records the collection as partial.

Run the first poll with `--once` and watch it; drop `--once` only after that poll
returns `completed` or `idle`. The agent must claim only jobs for its bound
profile and must stop at login or verification prompts. Keep the machine awake
and the operator present. A `{"state":"idle"}` reply is normal on a second run —
checks are rate-limited to one per publication per 24 hours.

### 8. Queue the first checks

`reporting_claim_check` auto-plans jobs for monitored bindings: any publication
for the bound customer and account label that has no check in the last 24 hours,
including publications whose date is unknown. No cohort run is needed for a
first check. Use **Run automation → Refresh post statuses** (cohort) only when a
prior Pacific business date is known and you want a dated, receipted batch.

### 9. Verify the chain

| Check | Expected | Observed on 2026-10-30 |
| --- | --- | --- |
| `/dashboard/automation` | worker heartbeat and job lease visible; no second concurrent lease | 1 job, `completed`, fingerprint stored |
| `/dashboard/checks` | outcome recorded with source and exact post; proxy/login errors are “could not check” | `alive` / positive / `auto_check` |
| `/dashboard/yesterday` | the prior Pacific business date includes the checked publications | activity on 2026-10-30 18:52 UTC |
| `/dashboard/reports` | snapshot counts match the checks; no invented coverage | `comments_total` null (incomplete), no invented count |
| `/dashboard/run/cohorts` | immutable receipt with per-item dispositions; replayed request creates no new jobs | no cohort used; auto-plan path |

## Stop and rollback

1. Stop the agent (Ctrl+C) and confirm the profile it opened is closed.
2. Press **End work** to close the session; pending checks for a closed session
   are cancelled by the next claim.
3. Disable monitoring for the pilot binding.
4. Revoke the worker if the credential may have been exposed.

Do not delete jobs, reset the database or retry an ambiguous submission.

## Still gated after this test

- Fudge `UPLOAD_RELEASED` / `CATALOG_DOWNLOAD_RELEASED` remain false.
- No publish adapter or enqueue action; the publish queue stays empty.
- No Sheet writeback delivery; the outbox remains queue-only.
- No automatic report archive or email delivery.
