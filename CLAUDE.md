# Claudragon — contributor & AI-assistant guide

Cross-platform Electron **tray monitor for Claude Code sessions** (dragon/Pokémon
themed). Reads `~/.claude` locally; no network client.

## ⚠️ This is a PUBLIC repository — security rules

**Never commit secrets, credentials, or any company/customer/internal data.**
This includes API keys, tokens, private keys, `.env` values, real customer PII,
internal hostnames/URLs, internal service or project names, and ticket IDs.

A **pre-commit hook enforces this**. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

- The hook scans the staged diff for secrets, credential files, and any pattern
  in `.githooks/deny.local`.
- `.githooks/deny.local` is **git-ignored and machine-local** — put your
  organization-specific names there; they are never published. Keep such names
  out of the committed hook and out of all tracked files.
- A false positive can be bypassed with `git commit --no-verify` (use sparingly).

If you find a secret already committed, treat it as compromised: rotate it and
flag it — deleting the file does not remove it from git history.

## Architecture

- `src/core/` — OS-agnostic, dependency-free. Reads `~/.claude/sessions/*.json`,
  derives one `fleet` snapshot (states, counts, per-session `stats`). This is the
  single source the UI renders; it is the deep module — keep logic here.
- `src/main/` — Electron main process (tray, popover window, 1.5s poll, IPC).
- `src/renderer/` — pure presentation over the preload bridge; never touches the
  filesystem. A strict CSP forbids inline styles — express dynamic widths as
  bucket **classes**, not inline `style`.
- `hooks/` — optional Claude Code hook + statusLine writer. These run under
  `ELECTRON_RUN_AS_NODE` with **no asar layer**, so they must be self-contained
  (Node built-ins only — do not `require` project files).
- `scripts/` — installers (hooks/statusLine) and icon/sprite generators.

## Conventions

- No runtime dependencies (Electron is the only devDependency; keep it that way).
- Errors defined out of existence: missing/corrupt files degrade gracefully,
  never throw (see `notes.js`, `stats.js`).
- Settings edits (`~/.claude/settings.json`) must be merge-based, backed up, and
  reversible — see `scripts/install-*.js`.

## Commands

```bash
npm start                 # run the app (dev)
npm run smoke             # boot + renderer self-test (prints SMOKE_OK)
npm run scan[:json]       # print the current fleet headlessly (no GUI)
npm run icons             # regenerate icons incl. build/icon.png
node scripts/gen-sprites.js
npm run pack | npm run dist  # build unpacked | full installers (electron-builder)
```

Release: `npm version <x>` then `git push --follow-tags` → CI builds and
publishes installers to a GitHub Release.
