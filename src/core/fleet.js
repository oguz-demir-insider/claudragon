'use strict';

const { listSessions, STATE } = require('./sessions');

/**
 * Build the full fleet snapshot the UI consumes. This is the single output
 * of the core "deep module": the tray and renderer never read files directly,
 * they only render this object.
 */
function getFleet(opts = {}) {
  const sessions = listSessions(opts);

  const counts = {
    needs_permission: 0,
    needs_plan_approval: 0,
    waiting_input: 0,
    running: 0,
    idle: 0,
    stale: 0,
    done: 0,
  };
  for (const s of sessions) {
    counts[s.state] = (counts[s.state] || 0) + 1;
  }

  // How many sessions are blocking on YOU right now.
  const attention = counts.needs_permission + counts.needs_plan_approval + counts.waiting_input;

  // Drives the tray color/icon. A pending plan approval blocks you just like a
  // permission prompt, so it also raises the alert level.
  const level =
    counts.needs_permission > 0 || counts.needs_plan_approval > 0
      ? 'alert'
      : counts.running > 0
        ? 'active'
        : 'calm';

  // The 5-hour rate limit is an ACCOUNT-wide figure (same across sessions), so
  // any session that reports it gives the shared "mana pool" gauge. null until
  // a session has live stats (the statusLine writer is opted in).
  let rateLimit5h = null;
  for (const s of sessions) {
    const r = s.stats && s.stats.rateLimit5h;
    if (r != null) rateLimit5h = rateLimit5h == null ? r : Math.max(rateLimit5h, r);
  }

  return {
    generatedAt: opts.now != null ? opts.now : Date.now(),
    sessions,
    counts,
    total: sessions.length,
    attention,
    level,
    rateLimit5h,
  };
}

module.exports = { getFleet, STATE };
