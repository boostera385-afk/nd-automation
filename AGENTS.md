# ND dashboard development instructions

## Current authorized implementation scope
- Build the browser dashboard and a phased, secure local-worker bridge to the existing desktop capabilities. Preserve `core/`, `gui/` and desktop launchers until each replacement is tested and explicitly signed off.
- The user requests no silent loss of desktop functionality, plus new browser features. Track each F01–F36 item in the implementation plan through a tested replacement or a clearly documented decision requiring user approval; never claim unimplemented features work.
- Reuse and adapt existing authorized browser flows through a local worker. Do not add a Nextdoor API, expose Incogniton or browser debugging ports, accept arbitrary remotely supplied code, or put service-role credentials in the web app or worker.
- Account onboarding, profile management, cookie/proxy handling and controlled publishing require secure, explicit user-directed workflows and staged tests. Identity challenges require human handoff; destructive actions require explicit confirmation. Do not silently carry over artificial/random engagement or unverified group behavior; surface it for an explicit decision and do not falsely claim parity.
- Read `docs/IMPLEMENTATION-STATUS.md` for actual delivery and `docs/DASHBOARD-PARITY-ROADMAP.md` for the migration sequence; the full plan is requirements, not a claim of delivered functionality.

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
- No service-role key in the web application or worker. Human requests use verified Supabase auth plus database RLS. Worker requests must use narrowly scoped, revocable credentials checked by allowlisted database RPCs; no direct privileged table access.
- Default business timezone: `America/Los_Angeles`. Detect device timezone separately; persist UTC. Handle DST and unknown historical dates honestly.
- Work sessions are 8–10 hour human work records; future worker dispatch must be explicitly authorized and tied to an active session. Existing session controls do not yet control browsers. No 24/7 execution.
- Never manufacture customers, metrics, live status, comments or platform observations. Imported post claims are unverified until an explicit sourced observation is recorded.
- Update `docs/IMPLEMENTATION-STATUS.md` after meaningful implementation/test changes.
