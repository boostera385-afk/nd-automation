# ND reporting development instructions

## Current authorized implementation scope
- Build the standalone reporting app in `apps/web` and versioned reporting migrations in `supabase/migrations`.
- Existing `core/`, `gui/`, desktop launchers and legacy automation are preserved, not connected to this milestone.
- No Nextdoor API, account creation, random engagement, cookie/proxy operations, or multi-profile execution bridge in the reporting application.
- Read `docs/IMPLEMENTATION-STATUS.md` for what actually exists; the long implementation plan is historical requirements, not a claim of delivered functionality.

## Efficient work
- Use targeted searches/reads; do not rescan dependencies or repeatedly reload the entire plan.
- Batch related file edits. Parallelize independent checks, not writes to the same configuration.
- Reuse installed packages and npm scripts. Do not install generic filesystem/shell MCPs that duplicate built-in tools.
- Context7 is for framework documentation. Playwright MCP is for the local reporting UI only, in an isolated browser; never attach it to Incogniton or customer sessions.
- Use built-in file tools for edits. MCP does not replace the patch tool or its safety requirements.

## Required validation
From `apps/web`, run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, then `npm.cmd run build` when applicable. Record exact results, blockers and deferred tests. Never call an unrun check passed.

## Security and data accuracy
- This GitHub repository is public. Never stage `.env*` (except examples), `config.json`, customer exports, cookies, proxies, screenshots or historical live-writing test scripts.
- No commits/pushes, destructive migrations, production writes or paid resource creation without explicit user approval.
- No service-role key in the web application. All user requests use verified Supabase auth plus database RLS.
- Default business timezone: `America/Los_Angeles`. Detect device timezone separately; persist UTC. Handle DST and unknown historical dates honestly.
- Reporting sessions are 8–10 hour human work records, not browser controls. No 24/7 execution.
- Never manufacture customers, metrics, live status, comments or platform observations. Imported post claims are unverified until an explicit sourced observation is recorded.
- Update `docs/IMPLEMENTATION-STATUS.md` after meaningful implementation/test changes.
