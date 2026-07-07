'use strict';

const { execFile } = require('child_process');
const { processAncestry } = require('../core/proc');

/**
 * "Jump to terminal" — best-effort, OS-aware, gracefully degrading.
 *
 * We first detect which terminal app owns the session (by walking its process
 * ancestry), then route:
 *   - iTerm2 / Terminal.app  -> focus the exact tab by its controlling TTY.
 *   - Other GUI terminals (VS Code, Cursor, Ghostty, WezTerm, kitty, Warp, …)
 *     -> bring the app to the front. These expose no API to select a specific
 *     integrated terminal pane, so we also copy `claude --resume` as a fallback.
 *   - Unknown / non-macOS -> copy `claude --resume`.
 *
 * Failure is never fatal — the board still works purely as a monitor.
 */

// `app` is a FIXED allowlist string (never process output) — it is what we hand
// to `open -a`, so there is no injection surface. `re` matches the ancestry path.
const TERMINALS = [
  { re: /iTerm/i, app: 'iTerm', kind: 'iterm' },
  { re: /Terminal\.app/i, app: 'Terminal', kind: 'terminal' },
  { re: /Visual Studio Code\.app|Code Helper|VSCode/i, app: 'Visual Studio Code', kind: 'activate' },
  { re: /Cursor\.app|Cursor Helper/i, app: 'Cursor', kind: 'activate' },
  { re: /Windsurf/i, app: 'Windsurf', kind: 'activate' },
  { re: /Ghostty/i, app: 'Ghostty', kind: 'activate' },
  { re: /WezTerm|wezterm/i, app: 'WezTerm', kind: 'activate' },
  { re: /kitty/i, app: 'kitty', kind: 'activate' },
  { re: /Warp\.app/i, app: 'Warp', kind: 'activate' },
  { re: /Hyper/i, app: 'Hyper', kind: 'activate' },
  { re: /Alacritty/i, app: 'Alacritty', kind: 'activate' },
  { re: /Tabby/i, app: 'Tabby', kind: 'activate' },
];

function detectTerminal(pid) {
  for (const comm of processAncestry(pid)) {
    for (const t of TERMINALS) if (t.re.test(comm)) return t;
  }
  return null;
}

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || '') });
    });
  });
}

async function focusTabByTty(tty) {
  const dev = tty.startsWith('/dev/') ? tty : `/dev/${tty}`;

  const itermScript = `
    tell application "iTerm2"
      set wasFound to false
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if (tty of s) is "${dev}" then
              tell s to select
              tell t to select
              set index of w to 1
              set wasFound to true
            end if
          end repeat
        end repeat
      end repeat
      if wasFound then activate
      return wasFound
    end tell`;
  let r = await run('osascript', ['-e', itermScript]);
  if (!r.err && /true/.test(r.stdout)) return { ok: true, method: 'iTerm2' };

  const terminalScript = `
    tell application "Terminal"
      set wasFound to false
      repeat with w in windows
        repeat with t in tabs of w
          if (tty of t) is "${dev}" then
            set selected tab of w to t
            set index of w to 1
            set wasFound to true
          end if
        end repeat
      end repeat
      if wasFound then activate
      return wasFound
    end tell`;
  r = await run('osascript', ['-e', terminalScript]);
  if (!r.err && /true/.test(r.stdout)) return { ok: true, method: 'Terminal' };

  return { ok: false };
}

async function focusSession(session) {
  const resume = session && session.sessionId ? `claude --resume ${session.sessionId}` : '';

  if (process.platform === 'darwin' && session) {
    const owner = session.pid ? detectTerminal(session.pid) : null;

    // iTerm2 / Terminal.app: focus the exact tab by tty.
    if (owner && (owner.kind === 'iterm' || owner.kind === 'terminal') && session.tty) {
      const res = await focusTabByTty(session.tty);
      if (res.ok) return { ok: true, method: res.method, message: `Focused ${res.method} · ${session.tty}` };
    }

    // GUI terminals without a per-pane API: bring the whole app forward.
    if (owner && owner.kind === 'activate') {
      const r = await run('open', ['-a', owner.app]);
      if (!r.err) {
        return {
          ok: true,
          method: owner.app,
          clipboard: resume,
          message: `Brought ${owner.app} to the front — can't target the exact pane, so copied "${resume}".`,
        };
      }
    }

    // Last resort: try iTerm/Terminal by tty even if ancestry detection missed.
    if (session.tty) {
      const res = await focusTabByTty(session.tty);
      if (res.ok) return { ok: true, method: res.method, message: `Focused ${res.method} · ${session.tty}` };
    }
  }

  return {
    ok: false,
    clipboard: resume,
    message: resume
      ? `Couldn't auto-focus the terminal — copied "${resume}" to your clipboard.`
      : 'Could not locate the terminal for this session.',
  };
}

module.exports = { focusSession, detectTerminal };
