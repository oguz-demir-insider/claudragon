'use strict';

/**
 * Installs/removes the OPTIONAL statusLine writer in ~/.claude/settings.json.
 *
 * Unlike hooks (an array we merge into), `statusLine` is a SINGLE object — there
 * can be only one. So to avoid clobbering a statusLine the user already has, we
 * WRAP it:
 *  - On install, if a non-ours statusLine exists, record its command in
 *    ~/.claude/fleet/wrapped-statusline.json and set ours as the command.
 *    hooks/fleet-statusline.js then runs the original and passes its output
 *    through, so the user's bar is preserved.
 *  - On uninstall, restore the recorded original (or remove ours if there was
 *    none), delete the wrap record, and clean up the status-*.json files.
 *
 * One-time backup, idempotent, fully reversible — same safety contract as
 * install-hooks.js.
 */

const fs = require('fs');
const path = require('path');
const { settingsFile, fleetDir } = require('../src/core/paths');
const { commandFor } = require('../src/core/hook-command');

const MARKER = 'fleet-statusline.js';

function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function isOurs(statusLine) {
  return !!(
    statusLine &&
    typeof statusLine.command === 'string' &&
    statusLine.command.includes(MARKER)
  );
}

/** True when our statusLine writer is currently the active statusLine. */
function isInstalled() {
  return isOurs(readSettings(settingsFile()).statusLine);
}

function wrapFile() {
  return path.join(fleetDir(), 'wrapped-statusline.json');
}

/** Remove the per-session status snapshots (called on uninstall). */
function cleanStatusFiles() {
  try {
    const dir = fleetDir();
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('status-') && f.endsWith('.json')) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
    }
  } catch {
    /* nothing to clean */
  }
}

async function run(uninstall) {
  const file = settingsFile();
  const settings = readSettings(file);

  const backup = `${file}.fleet-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  fs.mkdirSync(fleetDir(), { recursive: true });

  if (uninstall) {
    if (isOurs(settings.statusLine)) {
      let restored = false;
      try {
        const wrapped = JSON.parse(fs.readFileSync(wrapFile(), 'utf8'));
        if (wrapped && typeof wrapped.command === 'string' && wrapped.command.trim()) {
          settings.statusLine = { type: wrapped.type || 'command', command: wrapped.command };
          restored = true;
        }
      } catch {
        /* no wrap record */
      }
      if (!restored) delete settings.statusLine;
    }
    fs.rmSync(wrapFile(), { force: true });
    cleanStatusFiles();
  } else {
    const existing = settings.statusLine;
    if (existing && !isOurs(existing) && typeof existing.command === 'string') {
      // Preserve the user's current statusLine so we can run it as a wrapper.
      fs.writeFileSync(
        wrapFile(),
        `${JSON.stringify({ type: existing.type || 'command', command: existing.command }, null, 2)}\n`,
      );
    }
    settings.statusLine = { type: 'command', command: commandFor('hooks/fleet-statusline.js') };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);

  if (uninstall) {
    return `Removed claudragon statusLine writer from ${file}\n(backup remains at ${backup})`;
  }
  return (
    `Installed claudragon statusLine writer into ${file}\n` +
    `  one-time backup: ${backup}\n` +
    'Restart your Claude Code sessions for real context/cost stats to appear.'
  );
}

module.exports = { run, isInstalled };
