# Protected bulk cookie/proxy intake (F06–F09)

Implemented source only, **gated on explicit operator policy**: whether
cookie/session transfer is necessary instead of normal login, and which
permitted account-transfer/proxy uses the application may support. The hosted
SQL is a local candidate proposal (`supabase/proposals/protected_bulk_intake.sql`),
**not applied**, and the intake task RPC/batch table do not exist on the hosted
database yet. No cookie/proxy values, no plaintext and no service credentials
enter the database, the dashboard, tasks or journals.

## Local staging (`apps/worker/bulk_intake.py` + `private_vault.py`)

- A local manifest lists 1–100 explicit rows: exact canonical profile UUID,
  kind (`cookie_write`/`proxy_write`), absolute source file and `replace` flag.
  Duplicated profile/type mappings are refused; proxy rows can never clear cookies.
- Preview (`bulk_intake.py --manifest <file>`) is read-only and writes nothing.
- Staging additionally requires an explicit reason
  (`authorized_migration`/`authorized_recovery`/`authorized_network_proxy`),
  `--confirm-permitted-use` and `--confirm-local-protected-storage`.
- Validation is strict: every cookie row must be valid seven-column Netscape
  format (malformed rows are refused, not silently dropped; ≤5000 rows), each
  profile gets exactly one supported proxy line, and a batch byte budget caps
  files and totals. The whole batch is validated before anything is written.
- Each row is stored as a per-row Windows current-user **DPAPI** ciphertext
  (`.private.bin`, bound ≤6 MiB each) under the private per-user state root,
  expiring after **24 hours**. There is no plaintext fallback and no persisted
  key; ciphertext can only be decrypted by the same Windows user.
- Readback (`read_staged`) accepts only bounded ciphertext under the intake
  root whose embedded profile/kind/replace matches the exact authorized task
  and is not expired; validators re-run before use.

## Applying a batch through the existing dashboard queue

- The staged output shown to the dashboard is **redacted descriptors only**
  (profile UUID, kind, replace, ciphertext path); the web form
  (`enqueueIntakeBatch`) re-validates that schema, refuses expired batches,
  requires necessity/permitted-use/exact-writes confirmations, and calls the
  candidate `reporting_enqueue_intake_batch` RPC under a verified active work
  session. Identical retries replay the same receipt; changed rows are an
  identity conflict.
- Batch rows queue as **multiple pending tasks for one worker**; actual
  execution stays one-at-a-time (every claim path takes the same worker-row
  lock and refuses when any task is leased). The candidate proposal narrows the
  `automation_one_open_task` unique index to non-batch rows; worker-lock + leased
  checks still serialize all work across job families.
- A dispatch guard stops leasing further rows of a batch after any row failed
  or was cancelled, and refuses dispatch when a profile's customer binding
  changed after approval. Each row still needs the existing stopped-profile,
  lease and recovery gates.
- The worker applies a row through the **existing one-profile task queue**
  (`cookie_write`/`proxy_write` adapter); no watcher, directory polling or
  automatic intake exists anywhere (F09 remains explicitly not implemented).

## Remaining gates

- Operator decisions on necessity/permitted use (recorded in
  `REMAINING-WORK-PLAN.md`); without them the feature must stay unused.
- Hosted application of the intake proposal (separate explicit approval; it
  creates the small batch-receipt table and per-batch task columns).
- Real Windows DPAPI/apply acceptance on a real stopped profile, expiry
  behavior and failure/stop-of-batch behavior, user-present.
- No random engagement, deceptive warmup or unverified group behavior is
  ported; any legacy such behavior stays surfaced for explicit retirement.
