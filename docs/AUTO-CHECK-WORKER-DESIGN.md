# Automatic next-day post checking: design for review

Implementation update: the initial dashboard bridge and `apps/worker/agent.py`
now exist in source; see `WORKER-BRIDGE.md`. The staging migrations are applied,
selectors and browser compatibility remain unvalidated, and no live pilot has
run. The following design sections describe the original proposal, not evidence
of full delivery. The standalone pilot is still documented separately.

**The remainder is the historical proposal, not the current acceptance report.** A dashboard agent and staging schema now exist, but pairing and validated page selectors are still required. The separate local pilot is documented in `apps/worker/MONITORING.md`. No successful live profile/post/comment check or Sheet writeback is claimed.

## What it will do

1. During an active work session, find posts that need a check (never checked, result older than 24 h, or last attempt could not finish).
2. Group them by Incogniton profile (`account_label` already holds the sheet's *Profile Name*), open each profile once, and open each exact post link.
3. Classify what it sees, save the result with a short evidence snippet, and close only the profiles it opened.
4. The dashboard shows the result at once: bell badge, toast and a soft sound, with a plain message such as *"Post is alive"* (positive), *"Post was removed from Nextdoor"* (negative) or *"Proxy issue: post could not be checked"* (needs attention).

The sheet scenarios map one-to-one: **Alive** → `alive`, **Post Deleted from ND** → `deleted_from_nd`, **Proxy Issue** → `proxy_issue`. Login, verification, network and profile problems are separate, so a technical failure is never mistaken for a deletion.

## Why it must run on your PC

Only your computer can reach your Incogniton profiles and their proxies. The cloud cannot. A small agent runs beside Incogniton, calls out over HTTPS, and never exposes a port. This matches the plan's rule of no 24/7 worker: it runs only while a work session is active.

## How it reuses what you already have

Your tool already uses Incogniton's local API at `127.0.0.1:35000`: `/profile/all`, `/automation/launch/puppeteer/{id}` (returns the debugging address), `/profile/stop/{id}`, `/profile/force-stop/{id}`. The checker uses the same calls and attaches a browser-automation library to the debugging address. It only reads: it opens the link and observes the page. It never types, clicks Post, comments, or changes anything.

## Classification (conservative by design)

| What happened | Result | Changes post status? |
|---|---|---|
| Profile would not start | `profile_error` | No |
| Proxy error codes (proxy/tunnel connection failed) | `proxy_issue` | No |
| Other network error or timeout | `network_error` | No |
| Redirected to sign-in | `login_required` | No |
| Captcha, phone or identity prompt | `verification_required` | No |
| Page loads and shows that exact post | `alive` | Yes → live |
| Nextdoor shows an explicit removal message (text saved as evidence) | `deleted_from_nd` | Yes → confirmed removed |
| Not found without a removal message | `unavailable` | Yes → unavailable |
| Anything unclear | `needs_review` | No |

Rule that never bends: **an error, timeout or login problem is never recorded as a removal.**

## What still needs to be built

1. **Migration 3** (needs your approval): `reporting_workers` (a hashed, revocable credential per machine), a small job table with leases, and two RPCs, `claim checks` and `submit result`. The worker never gets a service-role key and can only touch its own organization's due checks. The existing `source = 'auto_check'` value is already reserved in `reporting_post_checks`.
2. **The agent** (`apps/worker`): Incogniton start/stop, navigation, classification, result submission, a `--dry-run` mode that prints what it would record without writing anything.
3. **Dashboard**: worker status (last seen), start/stop of automatic checking tied to the work session, and a review queue for `needs_review`.

## Why a pilot is required before it goes live

I cannot run Incogniton or Nextdoor from here, so the page signals above (the exact removal wording, the sign-in redirect, what an alive post looks like in your profiles' region) are **assumptions until tested on your machine**. Plan:

1. Choose 3 posts whose real state you know (one alive, one removed, one on a profile with a bad proxy).
2. Run the agent with `--dry-run`; compare its answers with yours. Adjust the rules.
3. Enable writes for 10 posts, review the results, then scale up gradually with low concurrency (start with one profile at a time).

## Decisions needed from you

1. **Language:** Node (matches the web app; Python is not currently on your PATH) or Python (reuses your existing Incogniton code).
2. **Evidence:** examples or screenshots of how a removed Nextdoor post looks in your profiles.
3. **Profile names:** are they unique in Incogniton? Duplicates are reported as `profile_error`, never guessed.
4. **Scope:** `AGENTS.md` currently forbids automatic platform checking and a browser bridge. Say the word and I will change it for this read-only checker and keep posting, profile creation and engagement out of it.

## Guardrails

Genuine, customer-authorized accounts only; people handle captcha/OTP/identity prompts; no random engagement; no cookies, passwords or proxy strings sent to the cloud; low concurrency with pauses between profiles; an end-of-work-session stop; every result carries its source (`manual_review` or `auto_check`) so you can always tell a person's finding from the agent's.
