# OpenCode project setup

This project uses OpenCode **V2** configuration. No global settings, provider/model choice, secrets or unrelated projects were changed.

## Project location

OpenCode loads project settings from the folder you start it in **and the folders above it**, never from folders below. This workspace therefore has the same MCP configuration in two places, so it works from either:

- `ND AUTOMATION DASHBOARD/opencode.json` (outer folder)
- `ND AUTOMATION DASHBOARD/nd-automation/opencode.json` (application folder, which also holds `AGENTS.md`, `apps/` and `docs/`)

**Keep the two `mcp` blocks identical.** Earlier the servers existed only in the inner file, so a session started in the outer folder silently had no Supabase, Context7 or Playwright tools; that is why sign-in appeared to do nothing. Check any folder with `opencode mcp list`.

## MCP servers

| Server | Purpose | Configuration |
|---|---|---|
| Context7 | Current framework/library documentation | `https://mcp.context7.com/mcp` |
| Playwright | Local web-app UI inspection | Pinned `@playwright/mcp@0.0.83`; headless, isolated profile; local origins only; image responses omitted; unsafe run-code tool denied |
| Supabase | User-authorized additive database setup and Edge Function work | Scoped to `xtefjnfdjnxwrpkoydaj` with tool groups `database,docs,development,debugging,functions`; read-only mode removed on 2026-10-28 following explicit authorization. Account, branching and Storage tools are excluded. Verify the runtime project URL and catalog after reconnection; saved configuration alone does not prove a live connection. |

**Verified 2026-10-27:** `opencode mcp list` reports all three connected from both folders. Through the Supabase MCP the project URL, migration history and table list were read, `post_checks_and_notifications` was applied (version `20261026210947`), and the security advisor was run. No personal access token is stored anywhere; sign-in is OAuth through `/mcps`.

**Safety on writes:** `supabase_apply_migration`, `supabase_execute_sql` and `supabase_deploy_edge_function` are set to **ask** in `permissions`. No `skip_elicitations` parameter is set; server confirmations are retained where available. To return to read-only when not migrating, add `&read_only=true` to the Supabase URL in both files. Deployment authorization does not release uploads, publishing or profile operations.

The Playwright local-origin option is a guardrail, not a security boundary. Do not use it with customer browser profiles or production credentials. It may require its supported browser installation; report that as a setup step rather than claiming browser testing passed.

The configured Supabase URL is project-scoped; the reusable URL shape is:

```text
https://mcp.supabase.com/mcp?project_ref=YOUR_STAGING_REF&read_only=true&features=database,docs,development
```

Use OAuth through OpenCode's `/mcps` interface. Do not paste a personal access token into chat/config. Read-only MCP cannot apply migrations, so migrating needs the write-enabled URL above. Schema changes require separate explicit approval and a staging connection; never grant broad production access merely to speed development.

## Useful commands

```powershell
opencode.cmd mcp list
```

Inside OpenCode:

- `/mcps`: inspect connection/authentication status; choose a server to sign in when required.
- `/nd-next`: continue the next bounded reporting milestone.
- `/nd-check`: run checks and update implementation status.
- `/nd-review`: review security and data correctness.
- `/reload`: force reload if automatic configuration discovery has not picked up a change. No full restart is required for ordinary config changes.

## What actually improves speed

Use targeted reads, batch related patches, run independent checks in parallel, keep implementation status current and avoid reloading the full plan. MCP does **not** make file writes intrinsically faster and extra servers add context/startup cost. Existing search/read/patch/shell tools already cover filesystem work, so no redundant filesystem, shell or GitHub MCP was added.

## References

- <https://opencode.ai/v2/docs/config>
- <https://opencode.ai/v2/docs/mcp-servers>
- <https://opencode.ai/v2/docs/commands>
- <https://github.com/microsoft/playwright-mcp>
- <https://supabase.com/docs/guides/getting-started/mcp>

Some third-party setup examples still show V1 syntax. This project intentionally uses V2 `mcp.servers` and does not use deprecated `enabled` fields.
