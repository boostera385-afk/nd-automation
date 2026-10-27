# ND Automations — reporting foundation

A **customer-reporting web app**, built with Next.js, TypeScript and Supabase, plus an initial read-only local monitoring bridge. It records authorized post links, sourced visibility observations, observed comments and daily work sessions. Full desktop automation parity is not yet implemented.

The monitoring bridge's staging database setup is applied, but the laptop worker is not paired and live browser acceptance is pending. See [worker setup and exact limits](docs/WORKER-BRIDGE.md) before enabling any monitoring.

## Start here

- [Development and Windows setup](docs/DEVELOPMENT.md)
- [Actual implementation status and blockers](docs/IMPLEMENTATION-STATUS.md)
- [OpenCode MCP and project commands](docs/OPENCODE-SETUP.md)
- [Documentation index](docs/README.md)

```powershell
cd apps/web
npm.cmd ci
npm.cmd run dev
```

Open <http://localhost:3000>. Visitors see the sign-in page, never database/migration setup instructions. Until the backend is configured, an attempted sign-in returns a friendly availability message rather than simulating success. Follow the developer guide to configure a **staging** project and apply the reporting migration; these are administrator tasks outside the customer UI.

## Current boundary

- Default business timezone: **America/Los_Angeles**, with automatic PST/PDT. Device timezone is detected separately.
- Daily **8–10 hour work sessions**. Explicitly configured local monitoring is session-gated; no 24/7 execution.
- **No Nextdoor API**, dashboard publishing, account creation or random engagement. Initial read-only post checks require a paired local agent, validated selectors and an approved pilot.
- Existing `core/`, `gui/` and desktop launchers are preserved but **not connected** to this reporting app.
- Reviewed CSV imports accept only post-reference fields and remain unverified until a sourced manual review is recorded.
- Supabase Row Level Security separates organizations and explicitly assigned customer access. No service-role key is used by the application.

The earlier full automation plan is historical requirements, **not** a claim that all its capabilities are implemented or enabled. See the implementation status for the delivered scope and deferred features.

## Public repository safety

Do not commit local configuration, environment secrets, workbooks, Incogniton exports, cookies, proxies, screenshots or customer data. `.gitignore` excludes known sensitive/runtime artifacts and historical live-writing scratch tests; it is a guardrail, not a substitute for reviewing every staged file. No credentials or private customer dataset is included in this scaffold.
