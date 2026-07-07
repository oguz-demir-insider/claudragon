#!/usr/bin/env node
'use strict';

/**
 * Generates the tray icons as committed PNG assets — pixel-art *gem lights*
 * (a faceted diamond, deliberately NOT a circle) in the status colors:
 *   tray-alert.png  red    (a session needs permission)
 *   tray-active.png green  (something is running)
 *   tray-calm.png   gold   (idle / nothing needs you)
 *   app.png         turquoise (app/window icon)
 * Run: node scripts/gen-icons.js
 */

const fs = require('fs');
const path = require('path');
const { encodePNG, canvas } = require('./png-encoder');

const RIM = [8, 18, 30];
const WHITE = [255, 255, 255];

function lighten(c, t) {
  return [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ];
}

/** A faceted diamond "gem light": bright upper facet, base lower facet, dark rim, sparkle. */
function drawGem(size, base) {
  const c = canvas(size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size * 0.4;
  const facet = lighten(base, 0.5);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.abs(dx) / r + Math.abs(dy) / r; // rhombus metric
      if (d <= 1.0) {
        if (d > 0.8) c.set(x, y, RIM); // dark facet edge
        else if (dy < 0) c.set(x, y, facet); // top facet (lit)
        else c.set(x, y, base); // bottom facet
      }
    }
  }
  // sparkle highlight on the upper-left facet
  const hx = Math.round(cx - r * 0.32);
  const hy = Math.round(cy - r * 0.42);
  c.set(hx, hy, WHITE);
  c.set(hx + 1, hy, WHITE);
  c.set(hx, hy + 1, WHITE);
  return c.rgba;
}

const COLORS = {
  calm: [255, 194, 60], // gold   — idle / nothing needs you
  active: [43, 232, 106], // green  — something is running
  alert: [255, 61, 110], // red    — a session needs permission
  app: [24, 198, 192], // turquoise — app/window icon
};

const SIZE = 32;
const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, color] of Object.entries(COLORS)) {
  const file = name === 'app' ? 'app.png' : `tray-${name}.png`;
  fs.writeFileSync(path.join(outDir, file), encodePNG(SIZE, SIZE, drawGem(SIZE, color)));
  console.log('wrote', file);
}

// High-resolution app icon for packaging. electron-builder derives the per-OS
// icons (.icns / .ico / png set) from build/icon.png. The gem is computed
// per-pixel so it scales to 1024 cleanly; a hand-designed icon can replace this
// later without touching the build config.
const ICON_SIZE = 1024;
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(
  path.join(buildDir, 'icon.png'),
  encodePNG(ICON_SIZE, ICON_SIZE, drawGem(ICON_SIZE, COLORS.app)),
);
console.log('wrote build/icon.png');

console.log('done');
