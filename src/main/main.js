'use strict';

const path = require('path');
const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  ipcMain,
  shell,
  clipboard,
  screen,
  dialog,
} = require('electron');

const { getFleet } = require('../core/fleet');
const { listNotes, saveNote, removeNote } = require('../core/notes');
const { trayIcon } = require('./icon');
const { focusSession } = require('../actions/focus-terminal');
const hooksInstaller = require('../../scripts/install-hooks');
const statuslineInstaller = require('../../scripts/install-statusline');

const POLL_MS = 1500;
// Self-test: boot fully (tray, window, icon, first poll), report, and quit.
// Used by `npm run smoke` to verify the app starts without a persistent UI.
const SMOKE = process.argv.includes('--smoke');

let tray = null;
let win = null;
let pollTimer = null;
let lastFleet = { sessions: [], counts: {}, total: 0, attention: 0, level: 'calm', generatedAt: 0 };

// Single instance: a second launch just reveals the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(init);
}

function init() {
  // Menubar/tray app: no dock icon on macOS, no taskbar entry elsewhere.
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  createTray();
  poll();
  pollTimer = setInterval(poll, POLL_MS);

  if (SMOKE) {
    // Hard backstop: this process MUST exit even if the probe never resolves,
    // otherwise a stray instance keeps the single-instance lock.
    const backstop = setTimeout(() => app.quit(), 4000);
    win.webContents.on('console-message', (...a) => {
      const m = a.find((x) => typeof x === 'string') || (a[0] && a[0].message) || '';
      if (m) console.log('RENDERER:', m);
    });
    setTimeout(async () => {
      // If the page CSP blocked app.js, fleetAPI still exists (preload runs in
      // an isolated world) but no cards render. So card count is the real test;
      // spriteW > 0 proves the sprite PNGs loaded under CSP via file://.
      const evalP = win.webContents
        .executeJavaScript(
          '(function(){' +
            // Drive the REAL pixel theme (not just the dataset) so the tab/bubble
            // visibility logic runs, then snapshot what is actually shown.
            'if(typeof applyTheme==="function")applyTheme("pixel");' +
            'var disp=function(id){var e=document.getElementById(id);return e?getComputedStyle(e).display:"none"};' +
            'var party={list:disp("list"),notes:disp("notes"),dialogue:disp("dialogue")};' +
            'var c0=document.querySelector(".card");if(c0)c0.click();' +
            'var clicked={dialogue:disp("dialogue"),actions:disp("dlgActions"),saveform:disp("dlgSaveForm")};' +
            'if(typeof switchTab==="function")switchTab("notes");' +
            'var notesTab={list:disp("list"),notes:disp("notes"),dialogue:disp("dialogue")};' +
            'if(typeof switchTab==="function")switchTab("party");' +
            'var im=document.querySelector(".card.st-run .sprite")||document.querySelector(".sprite");' +
            'var hp=document.querySelector(".card.st-run .hp > i")||document.querySelector(".hp > i");' +
            'return {api:typeof window.fleetAPI,' +
            'cards:document.getElementById("list")?document.getElementById("list").children.length:-1,' +
            'spriteState:im?im.getAttribute("data-state"):null,' +
            'spriteBg:im?(getComputedStyle(im).backgroundImage||"").slice(0,72):null,' +
            'hpComputed:hp?getComputedStyle(hp).width:null,' +
            'names:Array.prototype.slice.call(document.querySelectorAll(".proj")).slice(0,3).map(function(n){return n.textContent;}),' +
            'topic:(document.querySelector(".topic")||{}).textContent||null,' +
            'lvl:(document.querySelector(".lvl")||{}).textContent||null,' +
            'type:(document.querySelector(".type")||{}).textContent||null,' +
            'xp:(document.querySelector(".xpfill")||{}).className||null,' +
            'party:party,clicked:clicked,notesTab:notesTab,' +
            'selected:document.querySelectorAll(".card.selected").length};' +
            '})()',
        )
        .catch((err) => ({ error: String((err && err.message) || err) }));
      const timeoutP = new Promise((res) =>
        setTimeout(() => res({ error: 'probe-timeout' }), 1500),
      );
      const probe = await Promise.race([evalP, timeoutP]);
      console.log(
        `SMOKE_OK ${JSON.stringify({
          level: lastFleet.level,
          total: lastFleet.total,
          counts: lastFleet.counts,
          render: probe,
        })}`,
      );
      clearTimeout(backstop);
      app.quit();
    }, 1400);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep animations + alert sound alive while hidden
      autoplayPolicy: 'no-user-gesture-required', // allow the permission chime to play
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Hide when it loses focus, like a typical menubar popover.
  win.on('blur', () => {
    if (win && !win.webContents.isDevToolsOpened()) win.hide();
  });
}

/** True when BOTH the hooks and the statusLine writer are wired in. */
function richStatsInstalled() {
  try {
    return hooksInstaller.isInstalled() && statuslineInstaller.isInstalled();
  } catch {
    return false;
  }
}

/**
 * Opt-in toggle for real stats + plan-approval detection. Wires (or removes)
 * both the hooks and the statusLine writer in ~/.claude/settings.json. Safe and
 * fully reversible — see the installers.
 */
async function setExtras(enable) {
  try {
    const messages = [
      await hooksInstaller.run(!enable),
      await statuslineInstaller.run(!enable),
    ];
    dialog.showMessageBox({
      type: 'info',
      title: enable ? 'Rich stats enabled' : 'Rich stats disabled',
      message: enable
        ? 'Claudragon can now show real context, effort, cost and the plan-approval state.'
        : 'Reverted to polling only.',
      detail:
        (enable ? 'Restart your Claude Code sessions for it to take effect.\n\n' : '') +
        messages.join('\n'),
    });
    poll();
  } catch (err) {
    dialog.showErrorBox('Claudragon', String((err && err.message) || err));
  }
}

function createTray() {
  tray = new Tray(trayIcon('calm'));
  tray.setToolTip('Claudragon');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    const on = richStatsInstalled();
    const menu = Menu.buildFromTemplate([
      { label: 'Open board', click: showWindow },
      { label: 'Refresh now', click: poll },
      { type: 'separator' },
      {
        label: on ? '✓ Rich stats & plan detection' : 'Enable rich stats & plan detection…',
        click: () => setExtras(!on),
      },
      { type: 'separator' },
      { label: 'Quit Claudragon', click: () => app.quit() },
    ]);
    tray.popUpContextMenu(menu);
  });
}

function positionWindow() {
  if (!tray || !win) return;
  const tb = tray.getBounds();
  const wb = win.getBounds();

  // Some Linux desktops report empty tray bounds — just center on screen then.
  if (!tb.width && !tb.height) {
    win.center();
    return;
  }

  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
  const area = display.workArea;

  let x = Math.round(tb.x + tb.width / 2 - wb.width / 2);
  let y;
  if (process.platform === 'darwin') {
    y = Math.round(tb.y + tb.height + 4); // menubar lives at the top
  } else {
    // Windows/Linux trays are usually at the bottom — open above the icon.
    y = Math.round(tb.y - wb.height - 4);
    if (y < area.y) y = Math.round(tb.y + tb.height + 4);
  }
  x = Math.max(area.x + 4, Math.min(x, area.x + area.width - wb.width - 4));
  win.setPosition(x, y, false);
}

function showWindow() {
  if (!win) return;
  positionWindow();
  win.show();
  win.focus();
  win.webContents.send('fleet:update', lastFleet);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

function poll() {
  let fleet;
  try {
    fleet = getFleet();
  } catch (err) {
    fleet = {
      sessions: [],
      counts: {},
      total: 0,
      attention: 0,
      level: 'calm',
      generatedAt: Date.now(),
      error: String((err && err.message) || err),
    };
  }
  lastFleet = fleet;
  updateTray(fleet);
  if (win) win.webContents.send('fleet:update', fleet);
}

function updateTray(fleet) {
  if (!tray) return;
  tray.setImage(trayIcon(fleet.level));

  const c = fleet.counts || {};

  // Hover tooltip: full breakdown (incl. zeros), all platforms.
  tray.setToolTip(
    fleet.total
      ? `Claudragon — 🔴 ${c.needs_permission || 0} need permission · 🟣 ${c.waiting_input || 0} need input · 🟡 ${c.idle || 0} idle · 🟢 ${c.running || 0} running`
      : 'Claudragon — no sessions',
  );

  // macOS menubar text next to the gem: only NON-ZERO counts, so zeros don't clutter.
  if (process.platform === 'darwin') {
    const seg = [];
    if (c.needs_permission) seg.push(`🔴${c.needs_permission}`);
    if (c.waiting_input) seg.push(`🟣${c.waiting_input}`);
    if (c.idle) seg.push(`🟡${c.idle}`);
    if (c.running) seg.push(`🟢${c.running}`);
    tray.setTitle(seg.length ? ` ${seg.join(' ')}` : '');
  }
}

// ---- IPC ----
ipcMain.handle('fleet:get', () => lastFleet);
ipcMain.handle('session:focus', async (_e, session) => {
  const res = await focusSession(session);
  if (res && res.clipboard) clipboard.writeText(res.clipboard);
  return res;
});
ipcMain.handle('session:reveal', (_e, cwd) => {
  if (cwd) shell.openPath(cwd);
});

// Saved research threads (the Notes tab).
ipcMain.handle('notes:list', () => listNotes());
ipcMain.handle('notes:save', (_e, note) => saveNote(note));
ipcMain.handle('notes:remove', (_e, id) => removeNote(id));

// Copy text to the OS clipboard — used by the "Resume" action to hand the
// `claude --resume` command to the user, ready to paste into any terminal.
ipcMain.handle('clipboard:write', (_e, text) => {
  if (typeof text === 'string' && text) clipboard.writeText(text);
  return true;
});
ipcMain.on('window:hide', () => {
  if (win) win.hide();
});
ipcMain.on('app:quit', () => app.quit());

// Keep running in the tray even with no visible window.
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
});
