# Worker release lifecycle (F36)

Implemented source only. No release has been installed, signed, live-run or
rolled back, and no automatic installer/daemon exists. Real signing, registry,
installation and rollback behavior need a user-present Windows review with a
genuine certificate; unit tests mock signature tooling where required.

## Stable per-user state (`worker_state.py`)

- All private state lives under one per-user root: `ND_WORKER_HOME` when set,
  otherwise `%LOCALAPPDATA%/NDAutomation/worker` (POSIX fallback
  `~/.local/state/NDAutomation/worker`). Relative, linked (symlink/junction)
  and network paths are refused.
- `state/` under that root holds the four journals (monitoring, publishing,
  automation, writeback). Credentials stay in their existing private
  locations; nothing moves silently.
- `execution_lock()` takes the shared device locks (`monitor.lock`,
  `writeback.lock`) *and* the legacy `.worker-state` locks inside a checkout,
  so new releases and old checkout runners can never run simultaneously.
- Legacy `.worker-state` journals are **not auto-copied or discarded**. With
  unresolved legacy files present, every run fails closed with "Legacy
  journals require explicit worker_state.py migration". The explicit
  `--migrate-from <checkout> --confirm-stopped-all-old-workers` command copies
  journals once, records a SHA-256 fingerprint marker
  (`shared-state.json`) and never overwrites a differing shared file.
- Before any release switch, `assert_drained` re-validates every journal with
  the existing full format checks and requires all checkpoints settled
  (acknowledged/operator_reconciled) with no cleanup/inspection flags.
  Unknown formats block rather than being "fixed".

## Signed offline releases (`release_lifecycle.py`)

- A release directory contains exactly `release-manifest.ps1` plus the five
  verified worker files (`agent.py`, `worker_state.py`,
  `release_lifecycle.py`, `requirements-monitoring.txt`, `preflight.py`), each
  ≤1 MiB with pinned byte size and SHA-256. Nothing else may be present.
- The manifest is **data-only**: a `# ND-RELEASE-V1 <base64 JSON>` first line
  and comments after that, including Authenticode's signature block. It is
  parsed as data and never passed to `-File`, `Invoke-Expression` or any shell.
  Any non-comment line is rejected.
- Install requires `--trusted-publisher` with the exact uppercase 40-hex
  certificate thumbprint verified out of band, and a **Valid**
  `Get-AuthenticodeSignature` result with that exact thumbprint on a private
  temp snapshot of the manifest. There is **no unsigned bypass**. A publisher
  change after the first install requires an explicit bootstrap trust review.
- Runtime is pinned: the manifest names the reviewed Python minor version and
  dependency pins equal to the current reviewed `preflight.py` pins, and both
  must already be installed. Nothing is downloaded or installed automatically.
- Installation stages into a fresh directory, re-verifies it, then renames it
  atomically; a partial installation is never executed and never silently
  overwritten. The **atomic `active-release.json` pointer** is the only switch;
  version/previous/content-pin metadata is stored there, strictly-increasing
  sequences prevent replay, and `--rollback` restores only the exact previous
  installed release (same manifest hash).
- State, credentials and journals live outside every release directory, so a
  switch never touches them; unresolved checkpoints refuse the switch.

## Building candidates (`scripts/create_worker_release.py`)

Builds an **unsigned candidate** only: it screens worker inputs with the
package secret-pattern scan, never includes credentials/checkpoints/tests/
exports, and writes the data manifest. A genuine external publisher must then
sign it; this command cannot produce a trusted release.

## Acceptance records (`acceptance.py`)

Validates operator-supplied F01–F36 acceptance records against an immutable
candidate SHA-256: each feature is `user_present` acceptance or
`explicit_retirement_approval` with a named approver, timestamp and evidence
hash, or honestly `pending`. Pending records block; synthetic tests can never
satisfy it; the tool itself never authorizes desktop retirement.

## Remaining gates

- A real signing certificate and an externally verified publisher thumbprint;
  real `Get-AuthenticodeSignature` behavior on installed releases.
- A user-present first install, release update, interrupted-install and
  rollback test, with real journals, before any desktop-tool retirement.
- The bootstrap/virtual-environment provisioning pipeline outside the five
  reviewed files (still manual; deliberately not automated).
- F36 live parity sign-off remains open in the acceptance ledger.
