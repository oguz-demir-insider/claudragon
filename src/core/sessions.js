'use strict';

const fs = require('fs');
const path = require('path');
const { sessionsDir, fleetDir } = require('./paths');
const { isAlive, ttyForPid } = require('./proc');
const { getTranscriptInfo } = require('./transcript');
const { statsFor } = require('./stats');

/** Canonical session states the UI renders. */
const STATE = {
  NEEDS_PERMISSION: 'needs_permission',
  NEEDS_PLAN_APPROVAL: 'needs_plan_approval',
  WAITING_INPUT: 'waiting_input',
  RUNNING: 'running',
  IDLE: 'idle',
  STALE: 'stale',
  DONE: 'done',
};

/** Lower number = higher urgency = sorted toward the top of the board. */
const STATE_PRIORITY = {
  [STATE.NEEDS_PERMISSION]: 0,
  [STATE.NEEDS_PLAN_APPROVAL]: 1,
  [STATE.WAITING_INPUT]: 2,
  [STATE.RUNNING]: 3,
  [STATE.STALE]: 4,
  [STATE.IDLE]: 5,
  [STATE.DONE]: 6,
};

// A plan-approval marker is written by the optional ExitPlanMode hook and
// cleared when the plan is answered. If a marker lingers (e.g. Claude Code
// crashed), we stop trusting it after this long rather than pin a stale state.
const PLAN_TTL_MS = 15 * 60 * 1000;

/**
 * True when a session is currently blocked on ExitPlanMode approval. This is
 * detected by the optional hook (hooks/fleet-hook.js), which writes
 * ~/.claude/fleet/plan-<sessionId>.json when ExitPlanMode is invoked and removes
 * it once the plan is answered. Without hooks installed this is always false —
 * plan approvals then fall back to their polled state (needs_permission /
 * waiting_input), i.e. today's behavior.
 */
function planMarkerFresh(sessionId, now) {
  if (!sessionId) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(fleetDir(), `plan-${sessionId}.json`), 'utf8'));
    const ts = Number(raw.ts) || 0;
    return ts > 0 && now - ts < PLAN_TTL_MS;
  } catch {
    return false; // no marker (or unreadable) — not awaiting plan approval
  }
}

/**
 * Decide a session's state from Claude Code's own fields plus liveness.
 *
 * Claude Code writes `status` (busy | idle | waiting) into the session file
 * and, when waiting, a `waitingFor` string (e.g. "permission prompt"). We
 * treat those as authoritative — that is what makes "needs permission"
 * detection reliable instead of guessed from logs.
 */
function deriveState(raw, alive) {
  if (!alive) return STATE.DONE;

  const status = String(raw.status || '').toLowerCase();
  const waitingFor = String(raw.waitingFor || '').toLowerCase();

  if (status === 'waiting') {
    if (waitingFor.includes('permission')) return STATE.NEEDS_PERMISSION;
    return STATE.WAITING_INPUT;
  }
  if (status === 'busy') {
    // NOTE: Claude Code's updatedAt tracks the last *status change*, not a live
    // heartbeat — so a long-running "busy" session is not necessarily stuck.
    // We do not infer STALE from age here (that would fabricate a state we
    // can't verify). The UI just shows the age. Real stuck-detection is left to
    // the optional hooks (a genuine activity signal); STATE.STALE is reserved
    // for that and is not produced by polling alone.
    return STATE.RUNNING;
  }
  return STATE.IDLE; // idle or any unknown status
}

function readSessionFile(file, now) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Half-written or corrupt file: skip it rather than crash the board.
    return null;
  }

  const pid = Number(raw.pid);
  const alive = isAlive(pid);
  const lastUpdate = raw.statusUpdatedAt || raw.updatedAt || 0;
  const sessionId = raw.sessionId || path.basename(file, '.json');

  // A live session sitting on an ExitPlanMode prompt gets its own state, which
  // otherwise looks just like a generic permission prompt. Requires the hook.
  let state = deriveState(raw, alive);
  if (alive && planMarkerFresh(sessionId, now)) state = STATE.NEEDS_PLAN_APPROVAL;
  const project = raw.cwd ? path.basename(raw.cwd) || raw.cwd : '(unknown)';

  // Friendly name + current topic, read (cached) from the session transcript.
  const { title, lastPrompt } = getTranscriptInfo(raw.cwd, sessionId);

  // Real stats (context / effort / model / cost), from the statusLine writer if
  // the user opted in, else a coarse transcript estimate, else nulls.
  const stats = statsFor({ sessionId, cwd: raw.cwd || '' });

  return {
    pid,
    sessionId,
    cwd: raw.cwd || '',
    project,
    name: title || project, // prefer Claude Code's generated title
    title: title || null,
    topic: lastPrompt || null, // what this session is currently working on
    rawStatus: raw.status || 'unknown',
    waitingFor: raw.waitingFor || null,
    state,
    stats,
    alive,
    kind: raw.kind || 'interactive',
    version: raw.version || null,
    startedAt: raw.startedAt || null,
    updatedAt: lastUpdate,
    ageMs: Math.max(0, now - lastUpdate),
    tty: alive ? ttyForPid(pid) : null,
    file,
  };
}

/**
 * List sessions sorted by urgency. Dead sessions are included only if they
 * ended recently (so the board can briefly show "✅ done"); long-dead ones
 * whose files linger are dropped.
 */
function listSessions(opts = {}) {
  const o = {
    keepDoneMs: opts.keepDoneMs != null ? opts.keepDoneMs : 10 * 60 * 1000,
    now: opts.now != null ? opts.now : Date.now(),
  };

  const dir = sessionsDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return []; // no sessions directory yet => empty fleet, not an error
  }

  const out = [];
  for (const f of files) {
    const s = readSessionFile(path.join(dir, f), o.now);
    if (!s) continue;
    if (s.state === STATE.DONE && s.ageMs > o.keepDoneMs) continue;
    out.push(s);
  }

  out.sort((a, b) => {
    const pa = STATE_PRIORITY[a.state] != null ? STATE_PRIORITY[a.state] : 9;
    const pb = STATE_PRIORITY[b.state] != null ? STATE_PRIORITY[b.state] : 9;
    if (pa !== pb) return pa - pb;
    // Among sessions blocking on you (permission or plan), oldest-waiting first.
    if (a.state === STATE.NEEDS_PERMISSION || a.state === STATE.NEEDS_PLAN_APPROVAL) {
      return a.updatedAt - b.updatedAt;
    }
    return b.updatedAt - a.updatedAt; // otherwise most-recently-active first
  });

  return out;
}

module.exports = { listSessions, deriveState, STATE, STATE_PRIORITY };
