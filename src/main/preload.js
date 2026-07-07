'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderer runs with contextIsolation + no nodeIntegration. This is the
// only bridge it gets — a small, explicit surface.
contextBridge.exposeInMainWorld('fleetAPI', {
  /** Subscribe to fleet snapshots. Returns an unsubscribe function. */
  onUpdate(cb) {
    const listener = (_e, fleet) => cb(fleet);
    ipcRenderer.on('fleet:update', listener);
    return () => ipcRenderer.removeListener('fleet:update', listener);
  },
  /** Fetch the latest snapshot on demand. */
  get: () => ipcRenderer.invoke('fleet:get'),
  /** Jump to a session's terminal (best-effort). */
  focus: (session) => ipcRenderer.invoke('session:focus', session),
  /** Open a session's working directory in the OS file manager. */
  reveal: (cwd) => ipcRenderer.invoke('session:reveal', cwd),
  /** Saved research threads — the Notes tab. */
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    save: (note) => ipcRenderer.invoke('notes:save', note),
    remove: (id) => ipcRenderer.invoke('notes:remove', id),
  },
  /** Copy text (e.g. a `claude --resume` command) to the OS clipboard. */
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
});
