'use strict';

/**
 * Installs/removes the OPTIONAL claude-fleet hooks in ~/.claude/settings.json.
 *
 * Safety properties:
 *  - Merges, never overwrites: existing hooks (e.g. your Notification sound) are
 *    preserved. We only add/remove entries whose command references fleet-hook.js.
 *  - One-time backup to settings.json.fleet-backup before the first change.
 *  - Idempotent: running install twice doesn't duplicate entries.
 *  - Fully reversible: `uninstall-hooks` removes exactly our entries.
 */

const fs = require('fs');
const path = require('path');
const { settingsFile } = require('../src/core/paths');
const { commandFor } = require('../src/core/hook-command');

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
];

function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function isOurEntry(entry) {
  return (
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some(
      (h) => typeof h.command === 'string' && h.command.includes('fleet-hook.js'),
    )
  );
}

/** True when our hooks are currently wired into settings.json. */
function isInstalled() {
  const hooks = readSettings(settingsFile()).hooks || {};
  return EVENTS.some((ev) => Array.isArray(hooks[ev]) && hooks[ev].some(isOurEntry));
}

async function run(uninstall) {
  const file = settingsFile();
  const command = commandFor('hooks/fleet-hook.js');
  const settings = readSettings(file);
  settings.hooks = settings.hooks || {};

  const backup = `${file}.fleet-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  for (const ev of EVENTS) {
    const list = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const cleaned = list.filter((entry) => !isOurEntry(entry)); // drop any prior fleet entry
    if (!uninstall) {
      cleaned.push({ matcher: '', hooks: [{ type: 'command', command }] });
    }
    if (cleaned.length) settings.hooks[ev] = cleaned;
    else delete settings.hooks[ev];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);

  if (uninstall) {
    return `Removed claude-fleet hooks from ${file}\n(backup remains at ${backup})`;
  }
  return (
    `Installed claude-fleet hooks into ${file}\n` +
    `  events: ${EVENTS.join(', ')}\n` +
    `  one-time backup: ${backup}\n` +
    'Restart your Claude Code sessions for the hooks to take effect.'
  );
}

module.exports = { run, EVENTS, isInstalled };
