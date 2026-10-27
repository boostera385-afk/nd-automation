# Sheet-first workflow and dashboard review

Implementation follow-up: the five-section navigation, one-time mapping selector,
safe master-tab preview, mapped link sync, batch monitoring controls and consolidated
Results are now implemented/tested. See `SHEET-FIRST-WORKFLOW.md` and the latest
`IMPLEMENTATION-STATUS.md` entry. The findings below are the original review;
the remaining desktop execution/writeback gaps are not claimed resolved.

Reviewed 2026-10-27 following the user's complaint that the dashboard increases
work. Scope: supplied screenshot, current dashboard source/routes, desktop source,
offline workbook ZIP/XML aggregates, and public Fudge GitHub source (README,
manifest, sheets client). No authenticated whole-dashboard browser walkthrough,
live Sheet inspection, extension execution or Incogniton operation was performed.

Fudge was initially cloned into a sibling folder, then that newly created clone
was removed on the user's correction. Fudge is not retained in this workspace,
not embedded in `nd-automation`, and was subsequently reviewed over HTTPS only.
No Fudge code was run or changed. No application or database changes accompany
this review.

## Finding: the current product adds a second work queue

The desired daily workflow is:

```
Fudge -> separate source Sheet -> human cleanup/QC -> ND master Sheet
                                                      |
                                      desktop / local Incogniton worker
                                                      |
                                   execution results + next-session checks
                                                      |
                                      dashboard and mapped Sheet outputs
```

Fudge source confirms review inventory (`Reviews`), requested work (`Structure`),
QC replacement, source review IDs, picture links, and optional rewritten content.
Its Used status denotes inventory assignment, not a Nextdoor submission. Source
review identity/QC must remain separate from master-task and publication identity.
Original source/provenance and publication authorization must be retained; a
rewrite must not become proof of a customer's real experience or photo ownership.

The dashboard is currently a reporting-first foundation with adjacent preparation
tools, not a complete web replacement for the desktop. Smaller fonts or fewer
warnings alone will not fix the duplicated work.

## Concrete friction in the current source

| Finding | Source / impact |
|---|---|
| 16 staff sidebar destinations | `components/navigation.tsx`: operational, reporting, administrative and incomplete protocol pages have equal prominence. Important daily actions require scrolling. |
| Home asks for manual entry | `app/dashboard/page.tsx`: Record post link is a primary action; setup checklist asks for observations/comments instead of guiding master-Sheet connection. |
| Manual checks are the default story | Checks/comments pages ask the operator to open posts and type results. These should be exception/recovery tools after monitoring works, not daily requirements. |
| Repeated parallel preparation | Content drafts ask for already-cleaned Sheet content; profile inventory asks for another CSV. Neither is integrated as a direct master-Sheet execution queue. |
| Import requires another workflow | `sheet-sync-panel.tsx`: tab analysis, client/profile assignment, preview and confirm. Known client choices are inferred from existing ledger posts; there is no single persistent source-row/customer/profile execution mapping. |
| Sheet connector covers reporting only | `lib/sheet-status.ts`: Auto Posting and Auto Listing only, four safe columns. It cannot drive profile creation, media posting, cookies, proxies or onboarding. |
| Export/paste instead of writeback | Sheet-sync page exports results for someone to paste. This increases manual work and is not automatic result synchronization. |
| Setup and daily use are mixed | Worker registration, credential handling, UUID binding, enablement and lease recovery share the Automation control page. Operators should not repeat machine setup daily. |
| Incomplete tools appear as workflow | Publishing protocol inspection is visible despite no publisher/release action. Keep incomplete tools in advanced setup, labelled honestly. |
| Repeated technical wording | Claims, leases, source observations and migration notices dominate routine pages. Preserve these details under status/help, not as mandatory operator reading. |

## Rechecked workbook copy

- Auto Posting: 82 Posted claims, 77 links, missing links at rows 6/29/45/51/68.
- Auto Listing: 63 Posted claims, 15 failures, 17 empty statuses, no post links.
- Profile creation: 87 mapped rows; actual UUID bindings still require validation.
- Bulk proxy import is the legacy cookie tab, not a proxy-input table.
- Unheaded side data exists in the other tabs and must not become executable work.

Only aggregate/schema findings are retained here, not secrets, post links or
customer content. The workbook is an offline copy, not evidence of live state.

## Recommended experience (not yet implemented)

Five primary destinations:

1. **Home** — master-Sheet connection, laptop/Incogniton status, pending/running/
   completed/needs-attention work, last synchronization, Start/Pause/Stop controls
   enabled only for implemented and explicitly authorized capabilities.
2. **Master Sheet** — familiar tabs and safe previews of cleaned input; refresh and
   delta synchronization, no routine CSV export or retyping. Surface only actual
   mapping/missing-link/validation exceptions.
3. **Run automation** — familiar desktop task types, per-profile grouping,
   reviewed batch selection, bounded concurrency and actual progress. Unimplemented
   operations must remain unavailable, not pretend buttons.
4. **Profiles** — actual local UUID inventory, one-time bulk-confirmed customer
   mapping; select by name/group while retaining exact IDs internally. Resolve
   duplicate names rather than guessing. Secrets remain local/private.
5. **Results** — execution status, exact links, last-check outcomes/comments and
   synchronization results. Today/Yesterday become filters rather than extra
   main destinations. Manual observations are exceptions, not setup completion.

Move customers, worker pairing, mappings, clocks/session history, advanced
diagnostics, draft composer and detailed reports under Settings/More. Keep all
existing routes/data accessible; simplify navigation without deleting features.

## Implementation priorities after this review

1. Agree the sheet-first experience; stop adding isolated forms as substitutes
   for desktop parity. Keep Fudge and its connector untouched.
2. Build a persistent master-row/customer/profile mapping and safe delta ingestion.
   Use stable source IDs (not row positions alone), explicit bulk authorization,
   credential exclusion and real Incogniton inventory.
3. Connect the approved local task adapters to reviewed master rows. During
   transition, prevent desktop and worker execution of the same task/profile;
   do not introduce two independent publishers.
4. Commit typed execution/check results and authenticated, idempotent Sheet
   writeback with separate monitoring columns. Never blank execution Status to
   trigger checks; never treat Fudge Used as Posted or Posted as observed live.
5. Validate the full daily path on authorized examples, then refine the main
   screen around actual working actions. Cosmetics alone are not completion.

The prior plan's eventual Supabase-ledger source-of-truth objective must not force
operators to maintain a second independent queue. Any cutover remains explicit;
the current master Sheet/desktop flow stays available until its tested replacement
is signed off. Live connection details and exact cleaned-content mapping remain
unverified and must be configured privately, not pasted into a public repository.
