'use strict';

/**
 * Builds the shell command Claude Code should run for a bundled script — a hook
 * (hooks/fleet-hook.js) or the statusLine writer (hooks/fleet-statusline.js).
 *
 * This exists because the naive `"<execPath>" "<script>"` form breaks once the
 * app is packaged:
 *   - In dev / via the CLI, `process.execPath` is node (or the dev Electron
 *     binary) and the script lives in the repo.
 *   - In a packaged app, `process.execPath` is the GUI binary and the script
 *     lives inside app.asar (not directly executable). Passing a script path to
 *     the GUI binary just launches the app again.
 *
 * The fix, applied in one place so the hook and statusLine installers stay
 * consistent (and so callers never think about it):
 *   - Resolve the script to its real on-disk path (app.asar.unpacked when
 *     packaged — we `asarUnpack` hooks/** in the build config).
 *   - Set ELECTRON_RUN_AS_NODE=1 so an Electron binary behaves as plain node.
 *     A real node binary ignores the variable, so the form is safe either way.
 *
 * This module is loaded both from the Electron main process and from bin/cli.js
 * under plain node, so it never hard-depends on electron being present.
 */

const path = require('path');

/** The Electron `app` object when running inside Electron, else null. */
function electronApp() {
  try {
    const electron = require('electron');
    return electron && typeof electron === 'object' && electron.app ? electron.app : null;
  } catch {
    return null;
  }
}

/**
 * Absolute on-disk path of a bundled script given its path relative to the
 * project root (e.g. 'hooks/fleet-hook.js').
 */
function resolveScriptPath(scriptRelToRoot) {
  const app = electronApp();
  if (app && app.isPackaged) {
    // asarUnpack in electron-builder puts these under Resources/app.asar.unpacked.
    return path.join(process.resourcesPath, 'app.asar.unpacked', scriptRelToRoot);
  }
  // Dev or CLI: <repo root>/<script>. This file lives at src/core/.
  return path.join(__dirname, '..', '..', scriptRelToRoot);
}

/**
 * The full command string for a bundled script, ready to store in
 * ~/.claude/settings.json. Quoted for paths with spaces; sets
 * ELECTRON_RUN_AS_NODE so the Electron binary runs it as node.
 */
function commandFor(scriptRelToRoot) {
  const exec = process.execPath;
  const script = resolveScriptPath(scriptRelToRoot);
  if (process.platform === 'win32') {
    // cmd.exe: set the var then run, in a single invocation. The `&&` has no
    // spaces around it on purpose so cmd doesn't capture a trailing space.
    return `cmd /c "set ELECTRON_RUN_AS_NODE=1&& "${exec}" "${script}""`;
  }
  return `ELECTRON_RUN_AS_NODE=1 "${exec}" "${script}"`;
}

module.exports = { commandFor, resolveScriptPath };
