# ND Automations — reporting foundation

An initial **standalone customer-reporting web app**, built with Next.js, TypeScript and Supabase. It records authorized customer post links, explicit manual visibility observations, observed comments and daily reporting sessions.

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
- Daily **8–10 hour reporting sessions**, not a continuously running automation worker.
- **No Nextdoor API** and no automatic platform checking, posting, account creation, random engagement or multi-profile orchestration.
- Existing `core/`, `gui/` and desktop launchers are preserved but **not connected** to this reporting app.
- Reviewed CSV imports accept only post-reference fields and remain unverified until a sourced manual review is recorded.
- Supabase Row Level Security separates organizations and explicitly assigned customer access. No service-role key is used by the application.

The earlier full automation plan is historical requirements, **not** a claim that all its capabilities are implemented or enabled. See the implementation status for the delivered scope and deferred features.

## Public repository safety

Do not commit local configuration, environment secrets, workbooks, Incogniton exports, cookies, proxies, screenshots or customer data. `.gitignore` excludes known sensitive/runtime artifacts and historical live-writing scratch tests; it is a guardrail, not a substitute for reviewing every staged file. No credentials or private customer dataset is included in this scaffold.
