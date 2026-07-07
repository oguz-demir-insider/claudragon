#!/usr/bin/env node
'use strict';

/**
 * claude-fleet CLI — the headless entry point.
 *
 *   claude-fleet scan [--json]   Print the current fleet (great for testing /
 *                                piping; also proves the core works without a GUI)
 *   claude-fleet install-hooks   Wire optional Claude Code hooks for instant updates
 *   claude-fleet uninstall-hooks Remove them again (fully reversible)
 */

const { getFleet } = require('../src/core/fleet');

const EMOJI = {
  needs_permission: '🔴',
  needs_plan_approval: '🟣',
  waiting_input: '🟠',
  running: '🟢',
  idle: '🟡',
  stale: '⚪',
  done: '✅',
};

function fmtAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function scan() {
  const fleet = getFleet();

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(fleet, null, 2)}\n`);
    return;
  }

  if (!fleet.total) {
    console.log('No Claude Code sessions found.');
    return;
  }

  console.log(
    `CLAUDRAGON — ${fleet.total} session(s) · ${fleet.attention} need you · level: ${fleet.level}\n`,
  );
  for (const s of fleet.sessions) {
    const e = EMOJI[s.state] || '·';
    const detail =
      s.state === 'needs_permission'
        ? s.waitingFor || 'permission'
        : s.state === 'needs_plan_approval'
          ? 'plan approval'
          : s.rawStatus;
    console.log(
      `${e} ${String(s.name).padEnd(30)} ${String(detail).padEnd(18)} ${fmtAge(s.ageMs).padStart(4)}  pid:${s.pid}  tty:${s.tty || '-'}`,
    );
    if (s.topic) {
      const topic = s.topic.length > 72 ? `${s.topic.slice(0, 72)}…` : s.topic;
      console.log(`   ↳ ${topic}`);
    }
  }
}

async function main() {
  const cmd = process.argv[2] || 'scan';

  if (cmd === 'scan') {
    scan();
    return;
  }

  if (cmd === 'install-hooks' || cmd === 'uninstall-hooks') {
    const { run } = require('../scripts/install-hooks');
    const msg = await run(cmd === 'uninstall-hooks');
    console.log(msg);
    return;
  }

  console.error(
    `Unknown command: ${cmd}\n` +
      'Usage: claude-fleet [scan [--json] | install-hooks | uninstall-hooks]',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
