# Supabase

Project: `xtefjnfdjnxwrpkoydaj` (staging). Everything here is versioned and additive.

| Path | What it is |
|---|---|
| `migrations/202610260001_reporting_foundation.sql` | Tables, Row Level Security and RPCs. **Already applied** to staging (2026-10-26). |
| `migrations/202610270001_post_checks_and_notifications.sql` | Post check results (Alive / Removed from Nextdoor / Proxy issue / …) and notifications. **Applied** to staging on 2026-10-27 through the Supabase MCP (recorded as version `20261026210947`, name `post_checks_and_notifications`). |
| `templates/` | Branded auth emails, see `templates/README.md`. |

## Applying a migration (reference)

The migration above is already applied; this is how it was done and how to do the next one. Applying adds tables and functions and changes no existing data. If it is ever missing, the dashboard keeps working: **Post checks** and the notification bell show a short "database update needed" message instead of failing.

Preferred (records migration history): use the Supabase MCP from a session started in this folder, with `apply_migration`, after checking `list_migrations` and `list_tables` first. The other options:

1. **Supabase MCP in OpenCode.** The project's MCP entry is read-only for safety. Reconnect it with write access for this one step (`/mcps`, sign in), ask OpenCode to apply `202610270001_post_checks_and_notifications.sql` as a migration named `post_checks_and_notifications`, then switch it back to read-only.
2. **Dashboard SQL editor.** Open the file, paste its whole contents into *SQL Editor → New query* and run it once.
3. **CLI.** `supabase link --project-ref xtefjnfdjnxwrpkoydaj` then `supabase db push` (needs your database password).

## Verify

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('reporting_post_checks','reporting_notifications','reporting_notification_state');
-- expect 3 rows

select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('reporting_record_checks','reporting_mark_notifications_seen');
-- expect 2 rows
```

Then run the Security Advisor. Expect one intentional notice per new function: the two RPCs are callable by signed-in users and check their own permissions inside.

## Tested before you apply

`apps/web/tests/checks.test.ts` loads both migrations into a real Postgres engine and checks: results and notifications are written together or not at all; a proxy/login/network problem never changes a post's visibility; removal needs written evidence; one bad item cancels a whole batch; organizations and customers cannot see each other's results; nobody can write the tables directly; the SQL outcome table equals the one in the app.

## Undo (only if ever needed)

The change is additive. To remove it: drop the three `reporting_*` tables above and the two functions, then `alter table public.reporting_publications drop column last_check_outcome, drop column last_checked_at;`. Results recorded since would be lost.
