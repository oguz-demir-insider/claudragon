'use strict';

const os = require('os');
const path = require('path');

/**
 * Resolve Claude Code's config directory in an OS-agnostic way.
 *
 * Honors CLAUDE_CONFIG_DIR (the same override Claude Code itself respects),
 * otherwise falls back to ~/.claude — which is the location on macOS, Linux
 * and Windows (%USERPROFILE%\.claude) alike. os.homedir() handles the per-OS
 * home directory, so callers never deal with platform paths.
 */
function claudeDir() {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), '.claude');
}

function sessionsDir() {
  return path.join(claudeDir(), 'sessions');
}

function settingsFile() {
  return path.join(claudeDir(), 'settings.json');
}

function projectsDir() {
  return path.join(claudeDir(), 'projects');
}

/** Where claude-fleet keeps its own optional state (event log from hooks). */
function fleetDir() {
  return path.join(claudeDir(), 'fleet');
}

module.exports = { claudeDir, sessionsDir, settingsFile, projectsDir, fleetDir };
