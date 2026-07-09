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

  // The 5-hour and 7-day rate limits are ACCOUNT-wide figures (same across
  // sessions), so any session that reports them gives the shared "mana pool"
  // gauges. null until a session has live stats (the statusLine writer is opted
  // in); max across sessions guards against a stale mid-write report.
  let rateLimit5h = null;
  let rateLimit7d = null;
  for (const s of sessions) {
    const st = s.stats;
    if (!st) continue;
    if (st.rateLimit5h != null) {
      rateLimit5h = rateLimit5h == null ? st.rateLimit5h : Math.max(rateLimit5h, st.rateLimit5h);
    }
    if (st.rateLimit7d != null) {
      rateLimit7d = rateLimit7d == null ? st.rateLimit7d : Math.max(rateLimit7d, st.rateLimit7d);
    }
  }

  return {
    generatedAt: opts.now != null ? opts.now : Date.now(),
    sessions,
    counts,
    total: sessions.length,
    attention,
    level,
    rateLimit5h,
    rateLimit7d,
  };
}

module.exports = { getFleet, STATE };
