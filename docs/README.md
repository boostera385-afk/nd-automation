# ND Automations Documentation

## Start here

[Sheet-first dashboard](SHEET-FIRST-WORKFLOW.md) — five daily sections, one-time
connections/profile mappings, and the exact desktop-versus-dashboard boundary.

[Publishing preparation and protocol](PUBLISHING-PROTOCOL.md) — staged drafts and
inventory, locally tested publish jobs, and the missing browser-execution gates.

[Operational workbook workflow review](WORKBOOK-WORKFLOW-REVIEW.md) — read-only review of the supplied workbook copy, execution-versus-monitoring status mapping, missing-link reconciliation and unsafe column-layout assumptions.

[Monitoring worker bridge](WORKER-BRIDGE.md) — dashboard controls, scoped agent protocol, automatic due-check policy and applied staging database setup. Worker pairing, live testing and the remaining desktop features are still deferred.

[Current automation readiness audit](AUTOMATION-READINESS-AUDIT.md) — verified gaps across F01–F36, local connection blockers, and setup that is actually supported now. Full dashboard automation is not complete.

[Actual implementation status](IMPLEMENTATION-STATUS.md) · [Development guide](DEVELOPMENT.md) · [OpenCode setup](OPENCODE-SETUP.md)

**Current milestone:** Standalone reporting foundation. Existing Python/browser automation remains unchanged and unconnected. The historical plan below includes later/deferred capabilities; it is not a statement of what this release executes.

[ND Automations Dashboard — Implementation Plan](ND-AUTOMATIONS-DASHBOARD-IMPLEMENTATION-PLAN.md)

[Desktop-to-dashboard parity roadmap](DASHBOARD-PARITY-ROADMAP.md) — feature-family gaps and delivery gates for the authorized phased migration.

The plan prioritizes **post today → verify the exact post during the next daily work session → collect available comments → update the dashboard and connected sheets**, while retaining the existing **Incogniton + Playwright browser system as the only Nextdoor execution path** and Supabase as the operational database.

## Confirmed operating model

- **No Nextdoor API integration or fallback**, and no Nextdoor developer-application approval or OAuth/token setup. Reuse the existing working browser flows and the current Apps Script sheet connection, with necessary hardening.
- Work runs on the operator's computer for approximately **8–10 hours daily**, not 24/7.
- **Start work / End work** controls dispatch; planned shutdown is normal. Pending checks/sync resume next session; expired publishing schedules require review rather than automatic bulk posting.
- Default business timezone is **US Pacific (`America/Los_Angeles`)**, automatically switching PST/PDT. Customer location overrides are explicit.
- Detect device timezone separately for local display and conversion; this review machine currently detects `Asia/Karachi`. Do not replace US business time with device/proxy time.
- **Today/Yesterday** use the selected business timezone. **This work session** remains a separate filter for shifts crossing Pacific midnight.
- No fresh platform checks are promised while the computer is off; the dashboard shows stored results and actual last-check times.

## How to use the plan

1. Read sections 1–3 for the scope, source-data issues and daily workflow.
2. Use section 4's F01–F36 checklist to prevent silent loss of existing functionality. Controlled or unverified behavior has an explicit disposition rather than an unsupported promise.
3. Follow section 12's implementation phases in order; prove monitoring before expanding bulk automation.
4. Complete section 13's next-day 20-publication acceptance test.
5. Follow section 14 for staging, deployment, worker availability, cutover and rollback.
6. Confirm section 15's integration/permission decisions before production enablement.
7. Use section 16 as the first developer task sequence.
8. Use sections 3.6 and 7.4 for session lifecycle, Pacific/local time conversion, automatic detection and daylight-saving rules.

**Current status:** Reporting implementation has started in `apps/web`, with a versioned `reporting_*` migration and local tests. No legacy worker, Nextdoor API, automatic platform checks, account-creation system or live sheet/portal connector is connected. Hosted authentication/deployment require staging configuration. See the implementation-status file for exact validation results and pending features; no live customer accounts or spreadsheet contents were changed.
