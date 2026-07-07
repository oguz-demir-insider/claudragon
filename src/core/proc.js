'use strict';

const { execFileSync } = require('child_process');

/**
 * Is a process alive? Cross-platform.
 *
 * Sending signal 0 performs error checking without actually delivering a
 * signal. ESRCH => no such process. EPERM => the process exists but we lack
 * permission to signal it (still alive). On Windows, process.kill(pid, 0)
 * likewise throws only when the process is gone.
 */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

/**
 * Best-effort controlling TTY for a pid (POSIX only), e.g. "ttys004".
 * Returns null on Windows or when there is no tty. Used only by the optional
 * "jump to terminal" action, so a null result simply disables that jump.
 */
function ttyForPid(pid) {
  if (process.platform === 'win32') return null;
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const out = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1500,
    }).trim();
    if (!out || out === '??' || out === '-') return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * The chain of executable paths from a pid up through its ancestors, e.g.
 * ["claude", "/bin/zsh", ".../Code Helper", ".../Visual Studio Code"]. POSIX
 * only (returns [] on Windows / on error). Used to figure out which terminal
 * app owns a session.
 */
function processAncestry(pid, maxDepth = 8) {
  if (process.platform === 'win32') return [];
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const chain = [];
  let cur = pid;
  for (let i = 0; i < maxDepth && cur > 1; i += 1) {
    let out;
    try {
      out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(cur)], {
        encoding: 'utf8',
        timeout: 1500,
      }).trim();
    } catch {
      break;
    }
    const m = out.match(/^(\d+)\s+(.+)$/);
    if (!m) break;
    chain.push(m[2]);
    cur = Number(m[1]);
  }
  return chain;
}

module.exports = { isAlive, ttyForPid, processAncestry };
