'use strict';

const path = require('path');
const { nativeImage } = require('electron');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

/** Tray icon for a fleet level: 'alert' (red), 'active' (green), else grey. */
function trayIcon(level) {
  const name =
    level === 'alert' ? 'tray-alert' : level === 'active' ? 'tray-active' : 'tray-calm';
  const img = nativeImage.createFromPath(path.join(ASSETS, `${name}.png`));
  // Menubar wants a small glyph; resize for crispness. Not a template image —
  // the color is the whole point.
  const size = process.platform === 'darwin' ? 18 : 16;
  return img.isEmpty() ? img : img.resize({ width: size, height: size });
}

function appIcon() {
  return nativeImage.createFromPath(path.join(ASSETS, 'app.png'));
}

module.exports = { trayIcon, appIcon };
