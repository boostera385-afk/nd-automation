# Read-only monitoring pilot runner

This document describes the standalone `monitor.py` pilot. A separate dashboard
agent, `agent.py`, now has source implementation using the new worker migration;
see `docs/WORKER-BRIDGE.md` from the project root. The staging migrations are
applied; worker pairing and live acceptance remain deferred. The original pilot
limitations still apply.

## What is implemented

`monitor.py` validates a bounded batch (up to 100 exact post links and explicit
profile UUIDs), groups posts per profile, opens profiles sequentially through the
local Incogniton API, attaches Playwright over a loopback CDP endpoint, reads each
exact post page and writes incremental local JSONL results. It never posts,
comments, likes, changes proxies/cookies, or bypasses verification prompts.

This is a **local pilot tool**, not the completed dashboard automation bridge.
No scheduling, Supabase submission, automatic Sheet input/writeback, worker
pairing, dashboard dispatch, session synchronization or checkpoint-resume is
implemented here. The dashboard still records checks manually. Do not run this
unattended or label it production-ready.

## Safe dry-run

From `apps/worker`:

```powershell
python monitor.py --manifest monitoring-manifest.example.json
python -m unittest discover -v
```

The example uses fictitious identifiers. Dry-run validates and counts input;
it makes no network calls, does not import Playwright and does not open profiles.

## Before an explicitly authorized pilot

1. Stop legacy jobs for the selected profiles. Keep the operator at the machine.
2. Install a reviewed Playwright Python version compatible with the installed
   Incogniton Chromium version in an isolated environment. The runner uses the
   existing Incogniton browser, not a newly downloaded browser. Compatibility
   has not been tested on this laptop.
   The candidate exact pins and offline `preflight.py` are documented in
   [README.md](README.md). Runtime checks now gate both execution entrypoints;
   installing the pinned package set still does not prove browser compatibility.
3. Create a local `.monitoring` directory, which is ignored by Git. Copy the
   example manifest there and replace all sample identifiers with real assigned
   publication/profile UUIDs and authorized post links. No profile-name guessing.
4. Copy the adapter example there. All its selectors are intentionally empty
   and **execution will reject it until configured**. Validate selectors on an
   authorized page and fixtures: exactly one visible post root must contain the
   exact permalink and visible non-empty post body. Comments must be children
   of that root with stable IDs. Login, verification and error selectors must
   match notices, not arbitrary page text. Do not copy sensitive page content
   into the public repository.
5. Start Incogniton, then run an authorized small pilot using the command below.
   Neither this documentation nor the example config confirms live DOM signals.

```powershell
python monitor.py --manifest .monitoring/manifest.json --adapter .monitoring/adapter.json --execute --confirm-authorized --output .monitoring/results.jsonl
```

The output must be a new file. Every result has UTC observation time, source,
publication/profile IDs and adapter fingerprint. It contains actual available
comment text and must be treated as private customer data. Local filesystem
permissions are inherited; this tool does not encrypt output or upload it.

## Interpretation and limits

- A visible exact permalink and post body inside the configured root is the
  positive signal. It is only as accurate as the pilot-validated adapter.
- Removal-like notices are **needs review**, not confirmed deletion, until the
  actual notice semantics have been validated. Unknown/conflicting layouts and
  HTTP access errors are not assumed to be removals.
- Only initially rendered comments with stable IDs are collected (at most 200).
  No expansion, pagination, replies traversal or inferred totals. Every result
  says `comments_complete: false` and `comments_total: null`; comment creation
  timestamps remain unknown. Missing comments are not zero comments.
- New dispatch stops after one hour, but an already-started request/cleanup may
  run beyond that limit. This is not integrated with dashboard End work yet.
- Ctrl+C attempts cleanup through `finally`. A crash/forced termination may
  leave a profile open. Inspect partial results and the profile before restarting;
  automatic resume/deduplication of results across runs is not implemented.
- The runner checks for an explicitly stopped profile; unknown/running profiles
  are skipped. No force-stop, retries, or closing pre-existing tabs. A cleanup
  failure aborts subsequent profiles rather than leaving many browsers open.
- An OS lock prevents two copies in this checkout, not the legacy app, another
  checkout or another machine. The local status-check/launch sequence is not an
  atomic Incogniton lease: operator coordination remains mandatory for the pilot.
- Navigation is limited on the worker-created page to HTTPS on `nextdoor.com`
  or `www.nextdoor.com`. Other regional domains and external identity redirects
  need a separately reviewed adapter/allowlist change. Browser background traffic
  is not intercepted; "read-only" means no intentional platform write actions,
  not a guarantee that visiting a page cannot change read counters/session state.

Next integration milestone: secure pairing and scoped job/result protocol,
database-source attribution, active-work-session checks and automatic sanitized
Sheet input, followed by a supervised end-to-end pilot before enabling dispatch.
