#!/usr/bin/env node
'use strict';

/**
 * OPTIONAL Claude Code statusLine writer (installed via the app's "enable rich
 * stats" toggle / `scripts/install-statusline.js`).
 *
 * Claude Code pipes accurate per-session JSON to the statusLine command each
 * turn — context window usage, cost, model, reasoning effort, rate limits. That
 * is the ONLY accurate source of those numbers (the JSONL transcript token
 * counts are unreliable). We capture them into
 *   ~/.claude/fleet/status-<session_id>.json
 * which src/core/stats.js reads to power real HP / Power in the board.
 *
 * Being a good statusLine citizen:
 *  - If the user already had a statusLine, the installer records it and we run
 *    it here with the same stdin, passing its output through unchanged — their
 *    bar keeps working.
 *  - Otherwise we print a tiny context indicator so the bar isn't blank.
 *  - We NEVER fail the host: any error just prints nothing and exits 0.
 *
 * IMPORTANT: this runs under `ELECTRON_RUN_AS_NODE` (pure Node, no Electron
 * asar layer), so it must stay self-contained — Node built-ins only, no
 * requiring project files that may live inside app.asar.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function claudeDir() {
  const o = process.env.CLAUDE_CONFIG_DIR;
  return o && o.trim() ? o.trim() : path.join(os.homedir(), '.claude');
}

function fleetDir() {
  return path.join(claudeDir(), 'fleet');
}

/** Atomic write: temp file + rename, so a crash can't leave a half file. */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Normalize the statusLine payload into the shape stats.js consumes. */
function toRecord(evt) {
  const ctx = evt.context_window || {};
  const cost = evt.cost || {};
  const model = evt.model || {};
  const effort = evt.effort || {};
  const rl = evt.rate_limits || {};
  const usedPct = num(ctx.used_percentage);
  let remaining = num(ctx.remaining_percentage);
  if (remaining == null && usedPct != null) remaining = 100 - usedPct;
  return {
    writtenAt: Date.now(),
    sessionId: evt.session_id || null,
    contextRemainingPct: remaining,
    contextUsedPct: usedPct,
    contextWindowSize: num(ctx.context_window_size),
    effort: effort.level || null,
    model: model.display_name || model.id || null,
    costUsd: num(cost.total_cost_usd),
    linesAdded: num(cost.total_lines_added),
    linesRemoved: num(cost.total_lines_removed),
    rateLimit5h: num(rl.five_hour && rl.five_hour.used_percentage),
    rateLimit7d: num(rl.seven_day && rl.seven_day.used_percentage),
  };
}

/**
 * Reproduce the bar output. If a wrapped original command was recorded, run it
 * with the same stdin and pass through. Otherwise print a compact indicator.
 */
function emitBar(rawStdin, rec) {
  try {
    const wrapFile = path.join(fleetDir(), 'wrapped-statusline.json');
    const wrapped = JSON.parse(fs.readFileSync(wrapFile, 'utf8'));
    if (wrapped && typeof wrapped.command === 'string' && wrapped.command.trim()) {
      const r = spawnSync(wrapped.command, {
        shell: true,
        input: rawStdin,
        encoding: 'utf8',
        timeout: 1500,
      });
      if (r.stdout) process.stdout.write(r.stdout);
      return;
    }
  } catch {
    /* no wrapped command — fall through to our own minimal bar */
  }
  const used = rec.contextUsedPct != null ? Math.round(rec.contextUsedPct) : null;
  if (used != null) process.stdout.write(`🐉 ${used}% ctx`);
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  data += c;
});
process.stdin.on('end', () => {
  let evt = {};
  try {
    evt = JSON.parse(data || '{}');
  } catch {
    /* malformed payload — still exit cleanly */
  }

  const rec = toRecord(evt);
  try {
    if (rec.sessionId) {
      const dir = fleetDir();
      fs.mkdirSync(dir, { recursive: true });
      writeAtomic(path.join(dir, `status-${rec.sessionId}.json`), JSON.stringify(rec));
    }
  } catch {
    /* never fail the host statusLine */
  }

  try {
    emitBar(data, rec);
  } catch {
    /* printing is best-effort */
  }
  process.exit(0);
});

// Safety valve: never hang a Claude Code turn waiting on stdin.
setTimeout(() => process.exit(0), 2000);
