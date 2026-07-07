'use strict';

const fs = require('fs');
const path = require('path');
const { fleetDir } = require('./paths');

/*
 * Saved research threads — the persistent half of Claudragon.
 *
 * A note is a snapshot of a Claude Code session the user wants to return to,
 * plus their own one-line reason and a priority. It outlives the session: even
 * after the conversation is closed, the note keeps the session id, so it can be
 * reopened later with `claude --resume <id>`.
 *
 * Storage is a single JSON file under ~/.claude/fleet/ so BOTH Claudragon
 * (Electron) and Wyvern (Tauri) read the same list with no extra wiring. Every
 * filesystem error is defined out of existence — a missing or corrupt file
 * reads as an empty list, and writes create the directory and replace the file
 * atomically so a crash mid-write can never leave a half-written notes file.
 */

const PRIORITIES = new Set(['urgent', 'important', 'normal']);

function notesFile() {
  return path.join(fleetDir(), 'notes.json');
}

/** All saved notes, or [] if there are none / the file is unreadable. */
function listNotes() {
  let text;
  try {
    text = fs.readFileSync(notesFile(), 'utf8');
  } catch {
    return []; // no file yet => no notes (not an error)
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return []; // corrupt file => behave as empty rather than crash the UI
  }
  if (!Array.isArray(data)) return [];
  return data.filter((n) => n && typeof n.id === 'string');
}

function writeAll(notes) {
  fs.mkdirSync(fleetDir(), { recursive: true });
  const file = notesFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
  fs.renameSync(tmp, file); // atomic replace — never a partial notes.json
}

/**
 * Save (or refresh) a note for a session. Dedupes by session id, so re-saving
 * the same conversation updates its snapshot in place instead of duplicating
 * it. A missing id is a no-op rather than an error. Returns the updated list.
 */
function saveNote(input = {}) {
  const id = String(input.id || '').trim();
  if (!id) return listNotes();

  const note = {
    id,
    name: String(input.name || id),
    topic: input.topic ? String(input.topic) : '',
    cwd: String(input.cwd || ''),
    note: input.note ? String(input.note).slice(0, 280) : '',
    priority: PRIORITIES.has(input.priority) ? input.priority : 'normal',
    savedAt: Number(input.savedAt) || Date.now(),
  };

  const notes = listNotes().filter((n) => n.id !== id);
  notes.push(note);
  writeAll(notes);
  return notes;
}

/** Remove a note (the "Done" action). Returns the updated list. */
function removeNote(id) {
  const key = String(id || '');
  const notes = listNotes().filter((n) => n.id !== key);
  writeAll(notes);
  return notes;
}

module.exports = { listNotes, saveNote, removeNote, notesFile };
