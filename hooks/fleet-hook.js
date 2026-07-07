#!/usr/bin/env node
'use strict';

/**
 * OPTIONAL Claude Code hook (installed via `claude-fleet install-hooks`).
 *
 * Reads the hook JSON on stdin and appends one compact event line to
 * ~/.claude/fleet/events.jsonl. This is the substrate for richer "last action"
 * detail and the future gamification stats. It is intentionally tiny, never
 * blocks, and never fails the host hook.
 *
 * The status board itself does NOT depend on this — it works from polling
 * sessions/*.json alone. This only adds an activity log.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function claudeDir() {
  const o = process.env.CLAUDE_CONFIG_DIR;
  return o && o.trim() ? o.trim() : path.join(os.homedir(), '.claude');
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
    /* ignore malformed payloads */
  }

  const event = evt.hook_event_name || 'unknown';
  const sessionId = evt.session_id || null;
  const tool = evt.tool_name || null;

  const rec = {
    ts: Date.now(),
    event,
    session_id: sessionId,
    cwd: evt.cwd || null,
    tool,
    message: evt.message || null,
  };

  try {
    const dir = path.join(claudeDir(), 'fleet');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'events.jsonl');
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);

    // Keep the log bounded: above ~2MB, retain only the last 1000 lines.
    const st = fs.statSync(file);
    if (st.size > 2 * 1024 * 1024) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      fs.writeFileSync(file, `${lines.slice(-1000).join('\n')}\n`);
    }

    // Plan-approval marker lifecycle. ExitPlanMode is the tool Claude Code runs
    // to ask you to approve a plan: PreToolUse fires as the prompt appears, and
    // the next activity (the tool completing, a new prompt, a stop, or session
    // end) means the plan was answered — so the marker is removed. The board
    // reads this marker to show the distinct "approve plan" state.
    if (sessionId) {
      const planFile = path.join(dir, `plan-${sessionId}.json`);
      if (event === 'PreToolUse' && tool === 'ExitPlanMode') {
        fs.writeFileSync(planFile, JSON.stringify({ ts: Date.now() }));
      } else if (
        (event === 'PostToolUse' && tool === 'ExitPlanMode') ||
        event === 'UserPromptSubmit' ||
        event === 'Stop' ||
        event === 'SessionEnd'
      ) {
        fs.rmSync(planFile, { force: true });
      }
      // Ended sessions leave no live stats behind.
      if (event === 'SessionEnd') {
        fs.rmSync(path.join(dir, `status-${sessionId}.json`), { force: true });
      }
    }
  } catch {
    /* never fail the host hook */
  }
  process.exit(0);
});

// Safety valve: never hang a Claude Code turn waiting on stdin.
setTimeout(() => process.exit(0), 2000);
