'use strict';

/**
 * Per-session "real stats" — context remaining, reasoning effort, model, cost.
 *
 * This is a deep module hiding WHERE the numbers come from. Callers just ask
 * `statsFor(session)` and get one shape back plus a `source` tag:
 *
 *   'live'     — accurate, from the statusLine writer (hooks/fleet-statusline.js
 *                writes ~/.claude/fleet/status-<sessionId>.json each turn). This
 *                is Claude Code's OWN computed context_window / cost / effort /
 *                rate-limit data — the only accurate source, and the ONLY source
 *                that yields a context/HP percentage.
 *   'estimate' — the model is known from the transcript, but nothing else. We do
 *                NOT estimate context % here: the transcript can't tell us the
 *                real window (200k vs 1M), so any % would be misleading. HP is
 *                left null so the UI shows its neutral per-state bar instead.
 *   'none'     — nothing available (brand-new session, no transcript).
 *
 * Missing/corrupt files are not errors — they degrade the source, never throw.
 */

const fs = require('fs');
const path = require('path');
const { fleetDir } = require('./paths');
const { getTranscriptModel } = require('./transcript');

function statusFile(sessionId) {
  return path.join(fleetDir(), `status-${sessionId}.json`);
}

/** Read the statusLine writer's file for a session, or null. */
function readLive(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statusFile(sessionId), 'utf8'));
  } catch {
    return null; // not written yet, or mid-write — not an error
  }
}

function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

function numOrNull(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

const EMPTY = {
  contextRemainingPct: null,
  effort: null,
  model: null,
  costUsd: null,
  linesAdded: null,
  linesRemoved: null,
  rateLimit5h: null,
  source: 'none',
};

/**
 * @param {{sessionId?: string, cwd?: string}} session
 * @returns stats shape above
 */
function statsFor(session) {
  const sessionId = session && session.sessionId;
  if (!sessionId) return { ...EMPTY };

  const live = readLive(sessionId);
  if (live) {
    return {
      contextRemainingPct: clampPct(live.contextRemainingPct),
      effort: live.effort || null,
      model: live.model || null,
      costUsd: numOrNull(live.costUsd),
      linesAdded: numOrNull(live.linesAdded),
      linesRemoved: numOrNull(live.linesRemoved),
      rateLimit5h: clampPct(live.rateLimit5h),
      source: 'live',
    };
  }

  // Fallback: the model is knowable from the transcript, but context % is not
  // (unknown window) — so we report the model only and leave HP to the neutral
  // per-state bar. This is why an un-opted-in session never shows a false
  // "low HP" alarm.
  const model = session.cwd ? getTranscriptModel(session.cwd, sessionId) : null;
  if (model) return { ...EMPTY, model, source: 'estimate' };

  return { ...EMPTY };
}

module.exports = { statsFor, statusFile };
