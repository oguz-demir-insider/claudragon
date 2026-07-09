'use strict';

/* Renderer: pure presentation. Receives fleet snapshots over the preload bridge
   (window.fleetAPI) and renders them in either the "classic" board or the
   "pixel" Pokémon-style party screen. Never touches the filesystem. */

const STATE_META = {
  needs_permission: { dot: '🔴', label: 'NEEDS PERMISSION', cls: 'st-perm', badge: 'WAIT!' },
  needs_plan_approval: { dot: '🟣', label: 'APPROVE PLAN', cls: 'st-plan', badge: 'PLAN?' },
  waiting_input: { dot: '🟠', label: 'WAITING', cls: 'st-wait', badge: 'INPUT' },
  running: { dot: '🟢', label: 'RUNNING', cls: 'st-run', badge: 'RUN' },
  idle: { dot: '🟡', label: 'IDLE', cls: 'st-idle', badge: 'ZZ' },
  stale: { dot: '⚪', label: 'STALE', cls: 'st-stale', badge: '—' },
  done: { dot: '✅', label: 'DONE', cls: 'st-done', badge: 'DONE' },
};

const $list = document.getElementById('list');
const $pills = document.getElementById('pills');
const $banner = document.getElementById('banner');
const $meta = document.getElementById('meta');
const $toast = document.getElementById('toast');
const $mana = document.getElementById('mana');
const $mana5h = document.getElementById('mana5h');
const $manaBar = document.getElementById('manaBar');
const $manaPct = document.getElementById('manaPct');
const $mana7d = document.getElementById('mana7d');
const $weekBar = document.getElementById('weekBar');
const $weekPct = document.getElementById('weekPct');
const $dialogue = document.getElementById('dialogue');
const $dlgName = document.getElementById('dlgName');
const $dlgText = document.getElementById('dlgText');
const $themeBtn = document.getElementById('theme');
const $tabs = document.getElementById('tabs');
const $tabParty = document.getElementById('tabParty');
const $tabNotes = document.getElementById('tabNotes');
const $notes = document.getElementById('notes');
const $dlgActions = document.getElementById('dlgActions');
const $dlgSaveForm = document.getElementById('dlgSaveForm');
const $noteInput = document.getElementById('noteInput');
const $prioChips = document.getElementById('prioChips');
const $btnSave = document.getElementById('btnSave');
const $btnGo = document.getElementById('btnGo');
const $btnSaveConfirm = document.getElementById('btnSaveConfirm');
const $btnSaveCancel = document.getElementById('btnSaveCancel');

let current = { sessions: [] };
let toastTimer = null;
let theme = 'classic';
let audioCtx = null;
let prevPerm = new Set();
let prevPlan = new Set();
let primed = false;
let activeTab = 'party'; // 'party' (live) | 'notes' (saved)
let selectedSession = null; // what the bubble's Save / Go act on
let bubbleOpen = false; // party tab: the bubble pops up only after a click
let savedNotes = []; // cache of the Notes tab
let chosenPriority = 'normal'; // priority picked in the save form
let confirmingDelete = new Set(); // note ids whose "Done" is armed for confirm

function fmtAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function escapeHTML(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

// ---- gamification helpers ----
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// Fallback "level" (5..60) for a session with no real model yet — a stable
// per-session number, like a Pokémon's. Real sessions show their model instead.
function levelFor(s) {
  return 5 + (hashStr(s.sessionId) % 56);
}

// ---- real-stat helpers: context = HP, reasoning effort = Power, model = Level ----

// Prettify the model into a short "Level" tag: display names pass through;
// ids like "claude-opus-4-8" become "Opus 4.8"; missing → the Lv.N fallback.
function modelLabel(s) {
  const m = s.stats && s.stats.model;
  if (!m) return `Lv.${levelFor(s)}`;
  if (/^claude-/i.test(m)) {
    const rest = m.replace(/^claude-/i, '').replace(/\[1m\]/i, '');
    const parts = rest.split('-').filter(Boolean);
    const fam = parts.shift() || '';
    const ver = parts.join('.');
    const name = fam.charAt(0).toUpperCase() + fam.slice(1);
    return ver ? `${name} ${ver}` : name;
  }
  return m;
}

// HP = context remaining, bucketed to 10s so width is a CSS class (CSP-safe).
// Color: ≤15% critical ("compact soon"), ≤40% warning, else healthy. Returns
// null when there's no real data, so the card keeps its decorative per-state HP.
function hpInfo(s) {
  const p = s.stats && s.stats.contextRemainingPct;
  if (p == null) return null;
  const pct = Math.round(p);
  return {
    pct,
    bucket: Math.round(pct / 10) * 10,
    colorCls: pct <= 15 ? 'hpc-crit' : pct <= 40 ? 'hpc-warn' : 'hpc-ok',
  };
}

// Power = reasoning effort, as 1..5 lit pips. null when effort is unknown.
const EFFORT_PIPS = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
function powerPipsHTML(s) {
  const eff = s.stats && s.stats.effort;
  const n = EFFORT_PIPS[eff];
  if (!n) return null;
  let pips = '';
  for (let i = 0; i < 5; i += 1) pips += `<b${i < n ? '' : ' class="off"'}>⚡</b>`;
  return `<span class="pwr" title="effort: ${escapeHTML(eff)}">${pips}</span>`;
}

// Cost + lines changed, shown small when available (live source only).
function secondaryStats(s) {
  const st = s.stats || {};
  const bits = [];
  if (st.costUsd != null) bits.push(`$${st.costUsd.toFixed(2)}`);
  if (st.linesAdded != null || st.linesRemoved != null)
    bits.push(`+${st.linesAdded || 0}/-${st.linesRemoved || 0}`);
  return bits.join(' · ');
}
// Type by the kind of work, inferred from name + topic.
function typeFor(s) {
  const t = `${s.name} ${s.topic || ''}`.toLowerCase();
  if (/mesaj|message|communic|chat|webchat|whatsapp|sms|e-?mail|mail|notif|push|inbox/.test(t))
    return { label: 'MSG', cls: 'ty-msg' };
  if (/code|kod|migrat|build|refactor|deploy|fix|bug|api|backend|frontend|pipeline|registry|nexus|server/.test(t))
    return { label: 'CODE', cls: 'ty-code' };
  if (/learn|öğren|ogren|research|araşt|arast|study|guide|rehber|explor|understand|\bdoc|analiz|review|mentor/.test(t))
    return { label: 'LEARN', cls: 'ty-learn' };
  return { label: 'TASK', cls: 'ty-task' };
}
// Pokémon-style dialogue line per state.
const LINES = {
  needs_permission: 'wants to act — allow it?',
  needs_plan_approval: 'presents a plan — approve it?',
  waiting_input: 'awaits your orders.',
  running: 'is on the hunt!',
  idle: 'is fast asleep… Zzz',
  stale: 'has fainted.',
  done: 'finished its quest!',
};

function pill(count, label, cls) {
  return count ? `<span class="pill ${cls}">${count} ${label}</span>` : '';
}

// Fill one rate-limit gauge row. A null value hides that row. Width is a bucket
// class (CSP-safe), turning red past 80%. Returns whether the row is visible.
function fillGauge($row, $bar, $pct, pct) {
  if (pct == null) {
    $row.hidden = true;
    return false;
  }
  const p = Math.round(pct);
  $bar.className = `manafill mb-${Math.round(p / 10) * 10}${p >= 80 ? ' mb-hot' : ''}`;
  $pct.textContent = `${p}%`;
  $row.hidden = false;
  return true;
}

// The shared account-wide rate-limit gauges (5-hour + 7-day/weekly). Each row
// hides independently; the container hides only when neither is available (i.e.
// the statusLine writer isn't opted in).
function updateMana(pct5h, pct7d) {
  if (!$mana) return;
  const any5h = fillGauge($mana5h, $manaBar, $manaPct, pct5h);
  const any7d = fillGauge($mana7d, $weekBar, $weekPct, pct7d);
  $mana.hidden = !(any5h || any7d);
}

function cardHTML(s) {
  const m = STATE_META[s.state] || STATE_META.idle;
  const detail =
    s.state === 'needs_permission' ? s.waitingFor || 'permission prompt' : s.rawStatus;
  const topic = s.topic ? `↳ ${escapeHTML(s.topic)}` : '';
  const type = typeFor(s);

  // Real stats: context → HP, effort → Power pips, model → Level, cost/lines.
  const hp = hpInfo(s);
  const hpClasses = hp ? ` hpb-${hp.bucket} ${hp.colorCls}` : '';
  const hpPct = hp ? `<span class="hp-pct">${hp.pct}%</span>` : '';
  const pips = powerPipsHTML(s) || '<span class="pwr muted">—</span>';
  const sec = secondaryStats(s);
  const secHTML = sec ? ` · ${escapeHTML(sec)}` : '';

  return `
    <div class="card ${m.cls}${hp ? ' hpreal' : ''}" data-id="${escapeHTML(s.sessionId)}" title="${escapeHTML(s.cwd)}">
      <div class="sprite" data-state="${s.state}"></div>
      <div class="dot">${m.dot}</div>
      <div class="body">
        <div class="line1">
          <span class="proj">${escapeHTML(s.name)}</span>
          <span class="lvl">${escapeHTML(modelLabel(s))}</span>
          <span class="type ${type.cls}">${type.label}</span>
          <span class="age">${fmtAge(s.ageMs)}</span>
        </div>
        <div class="hpwrap">
          <span class="hp-label">HP</span>
          <div class="hp${hpClasses}"><i></i></div>
          ${hpPct}
        </div>
        <div class="pwrwrap">
          <span class="xp-label">PWR</span>
          ${pips}
        </div>
        <div class="line2">
          <span class="status">${m.label}</span>
          <span class="detail">${escapeHTML(String(detail))}</span>
        </div>
        <div class="topic">${topic}</div>
        <div class="line3">pid ${s.pid} · ${escapeHTML(s.tty || 'no tty')} · v${escapeHTML(s.version || '?')}${secHTML}</div>
      </div>
      <div class="badge">${m.badge}</div>
      <div class="go">→</div>
    </div>`;
}

function setDialogue(s) {
  closeSaveForm();
  if (!s) {
    $dlgName.textContent = '';
    $dlgText.textContent = 'No creatures in your party.';
    $dlgActions.hidden = true;
    return;
  }
  $dlgActions.hidden = false;
  const line = LINES[s.state] || 'is here.';
  const topic = s.topic ? ` «${s.topic.length > 88 ? `${s.topic.slice(0, 88)}…` : s.topic}»` : '';
  $dlgName.textContent = s.name;
  $dlgText.textContent = `${line}${topic}`;
}

// Clicking a creature pops up its dialogue bubble with the actions you can take.
function openBubble(id) {
  bubbleOpen = true;
  selectedSession = (current.sessions || []).find((x) => x.sessionId === id) || null;
  setDialogue(selectedSession); // fills the line, shows Save/Go, closes the form
  $dialogue.hidden = !(theme === 'pixel' && activeTab === 'party' && selectedSession);
}

// Everything that affects a card's DOM (not its age/time). When this is
// unchanged between polls we update ages in place instead of rebuilding — so
// the mascot's CSS animations keep running uninterrupted.
let lastSignature = '';
function signature(fleet) {
  return fleet.sessions
    .map((s) => {
      // Include the HP bucket / effort / model so a real-stat change triggers a
      // rebuild — but only on a bucket boundary, so sprite animations aren't
      // restarted on every 1% context tick.
      const hp = hpInfo(s);
      const st = s.stats || {};
      return `${s.sessionId}|${s.state}|${s.name}|${s.topic || ''}|${hp ? hp.bucket : ''}|${st.effort || ''}|${st.model || ''}`;
    })
    .join('§');
}

function selectCard(el) {
  for (const c of $list.querySelectorAll('.card.selected')) c.classList.remove('selected');
  if (el) el.classList.add('selected');
}

function rebuildList(fleet) {
  $list.innerHTML = fleet.sessions.map(cardHTML).join('');
  const cards = $list.querySelectorAll('.card');
  for (const el of cards) {
    const id = el.dataset.id;
    el.addEventListener('click', () => {
      playBlip();
      selectCard(el);
      if (theme === 'pixel') {
        // Party tab: clicking a creature pops up its bubble; act via Save / Go.
        openBubble(id);
      } else {
        // Classic board: a click still jumps straight to the terminal.
        onJump(id);
      }
    });
  }
  // Keep the open bubble's creature highlighted across list rebuilds.
  if (bubbleOpen && selectedSession) {
    const el = $list.querySelector(`.card[data-id="${selectedSession.sessionId}"]`);
    if (el) selectCard(el);
  }
}

function render(fleet) {
  if (!fleet) return;
  current = fleet;
  // Keep the Notes tab's 🟢 live / ⚪ ended badges in sync with the live fleet.
  if (theme === 'pixel' && activeTab === 'notes') renderNotes();
  const c = fleet.counts || {};

  // Chime when a session NEWLY blocks on you (not on the first load). Permission
  // and plan-approval get distinct sounds so you can tell them apart by ear.
  const idsFor = (state) =>
    new Set(fleet.sessions.filter((s) => s.state === state).map((s) => s.sessionId));
  const permIds = idsFor('needs_permission');
  const planIds = idsFor('needs_plan_approval');
  if (primed && [...permIds].some((id) => !prevPerm.has(id))) playAlert();
  if (primed && [...planIds].some((id) => !prevPlan.has(id))) playPlanChime();
  prevPerm = permIds;
  prevPlan = planIds;
  primed = true;

  // Header bits refresh every tick (no animated sprite nodes here).
  $pills.innerHTML =
    [
      pill(c.needs_permission, 'need you', 'st-perm'),
      pill(c.needs_plan_approval, 'plan', 'st-plan'),
      pill(c.running, 'running', 'st-run'),
      pill(c.idle, 'idle', 'st-idle'),
      pill(c.done, 'done', 'st-done'),
    ].join('') || '<span class="pill">no sessions</span>';

  // Both permission and plan-approval block you — the banner covers both.
  const blockers = (c.needs_permission || 0) + (c.needs_plan_approval || 0);
  if (blockers) {
    $banner.hidden = false;
    $banner.textContent = `${blockers} session${blockers > 1 ? 's' : ''} waiting for you`;
  } else {
    $banner.hidden = true;
  }

  const when = fleet.generatedAt ? new Date(fleet.generatedAt).toLocaleTimeString() : '—';
  $meta.textContent = `${fleet.total} session${fleet.total !== 1 ? 's' : ''} · ${when}`;

  // Account-wide rate limits — the shared "mana pool" across all sessions (5h + 7d).
  updateMana(fleet.rateLimit5h, fleet.rateLimit7d);

  if (!fleet.total) {
    bubbleOpen = false;
    selectedSession = null;
    $dialogue.hidden = true;
    if (lastSignature !== '∅') {
      lastSignature = '∅';
      $list.innerHTML = `
        <div class="empty">
          <img class="empty-bee" src="../../assets/sprites/mascot.png" alt="Claudragon mascot" draggable="false" />
          <div class="empty-emoji">🐉</div>
          No Claude Code sessions running.<br />
          <span>Claudragon is waiting — start one in any terminal.</span>
        </div>`;
      setDialogue(null);
    }
    return;
  }

  const sig = signature(fleet);
  if (sig === lastSignature && $list.querySelectorAll('.card').length === fleet.total) {
    // Light update: ages only — keeps sprite nodes (and their animations) alive.
    for (const s of fleet.sessions) {
      const el = $list.querySelector(`.card[data-id="${s.sessionId}"] .age`);
      if (el) el.textContent = fmtAge(s.ageMs);
    }
    return;
  }
  lastSignature = sig;
  rebuildList(fleet);
}

async function onJump(id) {
  const s = (current.sessions || []).find((x) => x.sessionId === id);
  if (!s) return;
  toast(`Jumping to ${s.name}…`);
  try {
    const res = await window.fleetAPI.focus(s);
    if (res && res.message) toast(res.message, res.ok ? 'ok' : 'warn');
  } catch {
    toast('Could not focus the terminal.', 'warn');
  }
}

function toast(msg, kind) {
  $toast.textContent = msg;
  $toast.className = `toast ${kind || ''}`;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $toast.hidden = true;
  }, 4000);
}

// An original 8-bit-style "alert" — a short ascending square-wave arpeggio,
// synthesized live (no audio file, no CSP/media concerns, no copyright).
function playAlert() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const notes = [
      [784, 0.0], // G5
      [1047, 0.08], // C6
      [1568, 0.16], // G6
    ];
    for (const [freq, t] of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.16, now + t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.11);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.13);
    }
  } catch {
    /* audio unavailable — no-op */
  }
}

// A gentle two-note RISING "question" tone for a plan awaiting approval —
// softer and more inquisitive than the insistent permission alert, so the two
// are distinguishable by ear. Triangle wave, quieter.
function playPlanChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const notes = [
      [587, 0.0], // D5
      [880, 0.12], // A5 — rising interval reads as a question
    ];
    for (const [freq, t] of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.1, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.2);
    }
  } catch {
    /* audio unavailable — no-op */
  }
}

// A short single "blip" on selection (distinct from the permission chime).
function playBlip() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {
    /* audio unavailable — no-op */
  }
}

// ---- save form (in the party-tab bubble) ----
function setPriority(p) {
  chosenPriority = p === 'urgent' || p === 'important' ? p : 'normal';
  for (const chip of $prioChips.querySelectorAll('.prio-chip')) {
    chip.classList.toggle('selected', chip.dataset.prio === chosenPriority);
  }
}

function openSaveForm() {
  if (!selectedSession) return;
  $noteInput.value = '';
  setPriority('normal');
  $dlgActions.hidden = true;
  $dlgSaveForm.hidden = false;
  $noteInput.focus();
}

function closeSaveForm() {
  if ($dlgSaveForm) $dlgSaveForm.hidden = true;
  if ($dlgActions) $dlgActions.hidden = false;
}

async function doSave() {
  if (!selectedSession) return;
  const s = selectedSession;
  try {
    savedNotes = await window.fleetAPI.notes.save({
      id: s.sessionId,
      name: s.name,
      topic: s.topic || '',
      cwd: s.cwd || '',
      note: $noteInput.value.trim(),
      priority: chosenPriority,
    });
    updateNotesTab();
    toast(`Saved “${s.name}” to Notes`, 'ok');
    playBlip();
  } catch {
    toast('Could not save the note.', 'warn');
  }
  closeSaveForm();
}

// ---- notes tab ----
const PRIO_META = {
  urgent: { cls: 'prio-urgent', group: '🔥 URGENT' },
  important: { cls: 'prio-important', group: '⭐ IMPORTANT' },
  normal: { cls: 'prio-normal', group: 'NORMAL' },
};
const PRIO_ORDER = ['urgent', 'important', 'normal'];

async function loadNotes() {
  try {
    savedNotes = await window.fleetAPI.notes.list();
  } catch {
    savedNotes = [];
  }
  updateNotesTab();
}

function updateNotesTab() {
  $tabNotes.textContent = savedNotes.length ? `📌 NOTES · ${savedNotes.length}` : '📌 NOTES';
  if (theme === 'pixel' && activeTab === 'notes') renderNotes();
}

// The `claude --resume` command — cwd single-quoted so paths with spaces work,
// id stripped to uuid-safe characters. Pasting this into any terminal reopens
// the conversation, even long after the session ended.
function resumeCommand(n) {
  const id = String(n.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = String(n.cwd || '').replace(/'/g, `'\\''`);
  return dir ? `cd '${dir}' && claude --resume ${id}` : `claude --resume ${id}`;
}

function noteHTML(n) {
  const meta = PRIO_META[n.priority] || PRIO_META.normal;
  const live = (current.sessions || []).some((x) => x.sessionId === n.id);
  const when = `saved ${fmtAge(Math.max(0, Date.now() - (n.savedAt || 0)))} ago`;
  const topic = n.topic ? `<div class="note-topic">↳ ${escapeHTML(n.topic)}</div>` : '';
  const user = n.note ? `<div class="note-user">“${escapeHTML(n.note)}”</div>` : '';
  const id = escapeHTML(n.id);
  const go = live ? `<button class="dlg-btn" data-action="go" data-id="${id}">→ Go</button>` : '';

  // "Done" is a two-step confirm so a stray click never loses a saved thread.
  const actions = confirmingDelete.has(n.id)
    ? `<span class="note-confirm">Remove this note?</span>
        <button class="dlg-btn danger" data-action="confirm-done" data-id="${id}">✓ Yes, remove</button>
        <button class="dlg-btn ghost" data-action="cancel-done" data-id="${id}">Keep it</button>`
    : `<button class="dlg-btn" data-action="resume" data-id="${id}">📋 Resume</button>
        ${go}
        <button class="dlg-btn ghost" data-action="done" data-id="${id}">✓ Done</button>`;

  return `
    <div class="note ${meta.cls}" title="${escapeHTML(n.cwd)}">
      <div class="note-head">
        <span class="note-name">${escapeHTML(n.name)}</span>
        <span class="note-when">${when}</span>
        <span class="note-live">${live ? '🟢 live' : '⚪ ended'}</span>
      </div>
      ${topic}
      ${user}
      <div class="note-actions">
        ${actions}
      </div>
    </div>`;
}

function renderNotes() {
  if (!savedNotes.length) {
    $notes.innerHTML = `
      <div class="notes-empty">
        No saved threads yet.<br />
        <span>On the PARTY tab, pick a creature and hit 💾 Save to keep it here.</span>
      </div>`;
    return;
  }
  // newest first within each priority group; groups ordered urgent → normal
  const sorted = [...savedNotes].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const html = [];
  for (const p of PRIO_ORDER) {
    const group = sorted.filter((n) => (n.priority || 'normal') === p);
    if (!group.length) continue;
    html.push(`<div class="note-group">${PRIO_META[p].group}</div>`);
    for (const n of group) html.push(noteHTML(n));
  }
  $notes.innerHTML = html.join('');
}

async function onNotesClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { id, action } = btn.dataset;
  const note = savedNotes.find((n) => n.id === id);
  if (action === 'resume') {
    if (!note) return;
    try {
      await window.fleetAPI.copy(resumeCommand(note));
      toast('Resume command copied — paste it in a terminal', 'ok');
      playBlip();
    } catch {
      toast('Could not copy the resume command.', 'warn');
    }
  } else if (action === 'go') {
    onJump(id);
  } else if (action === 'done') {
    // First click only arms the confirm — nothing is removed yet.
    confirmingDelete.add(id);
    renderNotes();
  } else if (action === 'cancel-done') {
    confirmingDelete.delete(id);
    renderNotes();
  } else if (action === 'confirm-done') {
    try {
      savedNotes = await window.fleetAPI.notes.remove(id);
      confirmingDelete.delete(id);
      updateNotesTab();
      renderNotes();
    } catch {
      toast('Could not remove the note.', 'warn');
    }
  }
}

// ---- tabs / view ----
function switchTab(tab) {
  activeTab = tab === 'notes' ? 'notes' : 'party';
  bubbleOpen = false; // each tab starts clean; the bubble pops only on a click
  confirmingDelete.clear(); // don't carry an armed "Remove?" across views
  closeSaveForm();
  updateView();
}

function updateView() {
  const pixel = theme === 'pixel';
  $tabs.hidden = !pixel;
  if (!pixel) activeTab = 'party'; // the classic board has no Notes view
  const showNotes = pixel && activeTab === 'notes';

  $list.hidden = showNotes;
  $notes.hidden = !showNotes;
  // The bubble shows only on the party tab, and only after a creature is clicked.
  $dialogue.hidden = !(pixel && activeTab === 'party' && bubbleOpen);

  $tabParty.classList.toggle('selected', activeTab === 'party');
  $tabNotes.classList.toggle('selected', activeTab === 'notes');

  if (showNotes) renderNotes();
}

function applyTheme(next) {
  theme = next === 'pixel' ? 'pixel' : 'classic';
  document.body.dataset.theme = theme;
  bubbleOpen = false; // switching views starts the party tab clean
  $themeBtn.textContent = theme === 'pixel' ? '📋' : '🎮';
  $themeBtn.title = theme === 'pixel' ? 'Switch to classic board' : 'Switch to pixel party screen';
  updateView();
  try {
    localStorage.setItem('fleet-theme', theme);
  } catch {
    /* localStorage may be unavailable; theme just won't persist */
  }
}

$themeBtn.addEventListener('click', () => applyTheme(theme === 'pixel' ? 'classic' : 'pixel'));
document.getElementById('quit').addEventListener('click', () => window.fleetAPI.quit());

// bubble actions
$btnGo.addEventListener('click', () => selectedSession && onJump(selectedSession.sessionId));
$btnSave.addEventListener('click', openSaveForm);
$btnSaveConfirm.addEventListener('click', doSave);
$btnSaveCancel.addEventListener('click', closeSaveForm);
$prioChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.prio-chip');
  if (chip) setPriority(chip.dataset.prio);
});
$noteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSave();
  else if (e.key === 'Escape') closeSaveForm();
});

// tabs + notes
$tabParty.addEventListener('click', () => switchTab('party'));
$tabNotes.addEventListener('click', () => switchTab('notes'));
$notes.addEventListener('click', onNotesClick);

let saved = 'classic';
try {
  saved = localStorage.getItem('fleet-theme') || 'classic';
} catch {
  /* ignore */
}
applyTheme(saved);
loadNotes();

window.fleetAPI.onUpdate(render);
window.fleetAPI.get().then(render);
