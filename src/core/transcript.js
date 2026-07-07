'use strict';

const fs = require('fs');
const path = require('path');
const { projectsDir } = require('./paths');

/**
 * Pull a human-friendly name and the current topic from a session's transcript.
 *
 * Claude Code stores per-session transcripts at
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where <encoded-cwd> is the cwd with every non-alphanumeric char replaced by
 * "-". Inside, it writes (among others):
 *   {"type":"ai-title","aiTitle":"..."}      <- a generated short title
 *   {"type":"last-prompt","lastPrompt":"..."} <- the latest user prompt
 *   {"type":"assistant","message":{"model":"…"}}         <- the model in use
 * We surface the most recent title as `title`, the most recent prompt as
 * `lastPrompt`, and the model as `model` (shown as the session's "Level").
 *
 * NOTE: we intentionally do NOT estimate context/HP from the transcript. Its
 * token fields are unreliable AND the real context-window size (200k vs 1M)
 * isn't recorded here, so any percentage would be misleading. Accurate context
 * comes only from the statusLine writer (see stats.js); without it HP falls back
 * to the neutral per-state bar rather than a wrong number.
 *
 * Transcripts can be large and grow every turn, so we only read the tail and
 * cache by (size+mtime) — the 1.5s poll then re-reads a file only when it
 * actually changed.
 */

const TAIL_BYTES = 256 * 1024;
const cache = new Map(); // file -> { key, value }

function encodeCwd(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

function transcriptPath(cwd, sessionId) {
  return path.join(projectsDir(), encodeCwd(cwd), `${sessionId}.jsonl`);
}

function readTail(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return { text: buf.toString('utf8'), partial: start > 0 };
  } finally {
    fs.closeSync(fd);
  }
}

const EMPTY = { title: null, lastPrompt: null, model: null };

/** Read (cached) the title, latest prompt, and model from a transcript tail. */
function readTranscript(cwd, sessionId) {
  if (!cwd || !sessionId) return EMPTY;
  const file = transcriptPath(cwd, sessionId);

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return EMPTY; // no transcript yet (brand-new session) — not an error
  }

  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = cache.get(file);
  if (cached && cached.key === key) return cached.value;

  let title = null;
  let lastPrompt = null;
  let model = null;
  try {
    const { text, partial } = readTail(file, TAIL_BYTES);
    const lines = text.split('\n');
    if (partial && lines.length) lines.shift(); // drop the (likely partial) first line
    // Scan from the end: we want the MOST RECENT title, prompt, and model.
    for (let i = lines.length - 1; i >= 0 && (!title || !lastPrompt || !model); i -= 1) {
      const line = lines[i];
      if (!line) continue;
      if (!title && line.includes('"ai-title"')) {
        try {
          const o = JSON.parse(line);
          if (o.aiTitle) title = o.aiTitle;
        } catch {
          /* skip malformed line */
        }
      }
      if (!lastPrompt && line.includes('"last-prompt"')) {
        try {
          const o = JSON.parse(line);
          if (o.lastPrompt) lastPrompt = o.lastPrompt;
        } catch {
          /* skip malformed line */
        }
      }
      if (!model && line.includes('"model"')) {
        try {
          const o = JSON.parse(line);
          const m = (o.message && o.message.model) || o.model;
          if (typeof m === 'string' && m) model = m;
        } catch {
          /* skip malformed line */
        }
      }
    }
  } catch {
    /* unreadable tail — fall through with whatever we have */
  }

  const value = { title, lastPrompt, model };
  cache.set(file, { key, value });
  return value;
}

/** Back-compat: just the display fields the board has always used. */
function getTranscriptInfo(cwd, sessionId) {
  const { title, lastPrompt } = readTranscript(cwd, sessionId);
  return { title, lastPrompt };
}

/** The model in use (shown as the session's "Level" when statusLine is off). */
function getTranscriptModel(cwd, sessionId) {
  return readTranscript(cwd, sessionId).model;
}

module.exports = { getTranscriptInfo, getTranscriptModel, transcriptPath, encodeCwd };
