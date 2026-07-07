#!/usr/bin/env node
'use strict';

/**
 * Generates the Claude Fleet mascot — a cute little bear, recolored per session
 * state — and its per-state animation sprite sheets (committed PNG assets).
 * 100% original art (no third-party IP), safe for an open-source repo.
 *
 * Each state is a horizontal strip of 32x32 frames; the renderer animates them
 * with CSS steps(). Run: node scripts/gen-sprites.js
 *
 *   mascot-running.png             2 frames  green, happy, little paw wave
 *   mascot-idle.png                3 frames  yellow, asleep: snore bubble + zzz
 *   mascot-needs_permission.png    2 frames  red, POLICE CAP + STOP sign (shakes)
 *   mascot-needs_plan_approval.png 2 frames  purple, big GOLD "?" (plan review)
 *   mascot-waiting_input.png       2 frames  orange, "?" look
 *   mascot-done.png                2 frames  blue, happy + sparkle
 *   mascot-stale.png               1 frame   grey, drowsy
 *   mascot.png                     1 frame   neutral tan bear (branding/empty)
 */

const fs = require('fs');
const path = require('path');
const { encodePNG, canvas } = require('./png-encoder');

const S = 32;

const K = [34, 30, 28]; // outline / black
const WHITE = [248, 248, 250];
const COL = {
  cap: [44, 60, 122],
  capD: [26, 38, 92],
  badge: [248, 212, 78],
  red: [222, 54, 54],
  bubble: [224, 244, 255],
  bubbleE: [150, 196, 236],
  spark: [255, 244, 150],
  zzz: [150, 168, 205],
};

// state -> { body, belly, dark } — Claudragon neon-turquoise palette
const PAL = {
  running: { body: [46, 232, 224], belly: [150, 248, 244], dark: [14, 110, 120] }, // neon-cyan
  needs_permission: { body: [255, 61, 110], belly: [255, 150, 178], dark: [150, 30, 64] }, // dragon-red
  idle: { body: [255, 194, 60], belly: [255, 224, 150], dark: [176, 130, 28] }, // gold
  waiting_input: { body: [155, 92, 255], belly: [200, 170, 255], dark: [88, 44, 158] }, // neon-purple
  needs_plan_approval: { body: [178, 116, 255], belly: [222, 198, 255], dark: [96, 52, 170] }, // violet
  done: { body: [95, 246, 255], belly: [190, 250, 255], dark: [42, 154, 166] }, // electric
  stale: { body: [90, 120, 132], belly: [150, 178, 188], dark: [40, 70, 82] }, // teal-dark
  neutral: { body: [24, 198, 192], belly: [120, 240, 234], dark: [14, 110, 120] }, // turquoise
};

// ---- primitives -------------------------------------------------------------
function ell(c, cx, cy, rx, ry, col) {
  for (let y = 0; y < c.size; y += 1) {
    for (let x = 0; x < c.size; x += 1) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) c.set(x, y, col);
    }
  }
}
function blob(c, cx, cy, rx, ry, body, dark) {
  ell(c, cx, cy, rx, ry, dark);
  ell(c, cx, cy, rx - 1.3, ry - 1.3, body);
}
function rect(c, x, y, w, h, col) {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) c.set(xx, yy, col);
}
function octagon(c, cx, cy, r, col) {
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (Math.abs(x) + Math.abs(y) <= r * 1.42 && Math.abs(x) <= r && Math.abs(y) <= r) {
        c.set(cx + x, cy + y, col);
      }
    }
  }
}

// ---- the dragon ------------------------------------------------------------
// opts: { pal, eyes:'open'|'closed'|'happy'|'stern'|'up', mouth:'smile'|'snore'|'flat',
//         cap:bool, wing:'up'|'down' }
function drawWing(c, bx, by, dir, body, dark) {
  // membrane triangle with a darker leading-edge rib
  for (let r = 0; r < 6; r += 1) {
    for (let k = 0; k <= r; k += 1) c.set(bx + dir * (1 + k), by - 4 + r, body);
  }
  for (let r = 0; r < 6; r += 1) c.set(bx + dir * (1 + r), by - 4 + r, dark);
}

function drawDragon(c, opts) {
  const o = Object.assign({ cx: 16, cy: 17, eyes: 'open', mouth: 'smile', wing: 'down' }, opts);
  const { body, belly, dark } = o.pal;
  const { cx, cy } = o;

  // wings (behind the body); flap up while running
  const lift = o.wing === 'up' ? 3 : 0;
  drawWing(c, cx - 8, cy - 2 - lift, -1, body, dark);
  drawWing(c, cx + 8, cy - 2 - lift, 1, body, dark);

  // tail with a spade tip (behind, lower-right)
  ell(c, cx + 8, cy + 7, 2, 2, body);
  c.set(cx + 11, cy + 7, dark);
  c.set(cx + 11, cy + 9, dark);
  c.set(cx + 12, cy + 8, dark);

  // horns (swept back)
  for (const dir of [-1, 1]) {
    const hx = cx + dir * 4;
    c.set(hx, cy - 8, dark);
    c.set(hx + dir, cy - 9, body);
    c.set(hx + dir, cy - 10, body);
    c.set(hx + dir * 2, cy - 11, dark);
  }

  // body
  blob(c, cx, cy, 9, 9, body, dark);

  // dorsal spikes on the crown
  for (const sx of [cx - 3, cx, cx + 3]) {
    c.set(sx, cy - 8, dark);
    c.set(sx, cy - 9, body);
  }

  // belly + snout + nostrils
  ell(c, cx, cy + 3, 5.5, 5, belly);
  ell(c, cx, cy + 5, 3.5, 2.4, belly);
  c.set(cx - 1, cy + 4, dark);
  c.set(cx + 1, cy + 4, dark);

  // eyes (big, cute)
  const ex = [cx - 6, cx + 3];
  if (o.eyes === 'closed') {
    for (const x of ex) {
      c.set(x, cy - 1, K);
      c.set(x + 1, cy, K);
      c.set(x + 2, cy, K);
      c.set(x + 3, cy - 1, K);
    }
  } else if (o.eyes === 'happy') {
    for (const x of ex) {
      c.set(x, cy, K);
      c.set(x + 1, cy - 1, K);
      c.set(x + 2, cy - 1, K);
      c.set(x + 3, cy, K);
    }
  } else {
    for (const x of ex) {
      const ey = cy - 2 - (o.eyes === 'up' ? 1 : 0);
      rect(c, x, ey, 3, 4, K); // big dark eye
      c.set(x + 2, ey, WHITE); // shiny highlight
    }
    if (o.eyes === 'stern') {
      for (let i = 0; i < 4; i += 1) {
        c.set(cx - 7 + i, cy - 4 + Math.floor(i * 0.7), K);
        c.set(cx + 6 - i, cy - 4 + Math.floor(i * 0.7), K);
      }
    }
  }

  // mouth
  if (o.mouth === 'snore') {
    rect(c, cx - 1, cy + 6, 3, 2, K);
  } else if (o.mouth === 'flat') {
    rect(c, cx - 2, cy + 6, 4, 1, K);
  } else {
    c.set(cx - 2, cy + 6, K);
    c.set(cx - 1, cy + 7, K);
    c.set(cx, cy + 7, K);
    c.set(cx + 1, cy + 7, K);
    c.set(cx + 2, cy + 6, K);
  }

  // police cap
  if (o.cap) {
    ell(c, cx, cy - 8, 9, 4, COL.capD);
    ell(c, cx, cy - 9, 8, 3.4, COL.cap);
    rect(c, cx - 9, cy - 6, 18, 2, COL.capD); // brim
    rect(c, cx - 2, cy - 10, 4, 2, COL.badge); // badge
  }
}

function snoreBubble(c, size) {
  ell(c, 25, 23, size + 0.6, size + 0.6, COL.bubbleE);
  ell(c, 25, 23, size, size, COL.bubble);
}
function zzz(c, n) {
  const spots = [[22, 8], [25, 6], [28, 3]];
  for (let i = 0; i < n && i < spots.length; i += 1) {
    const [x, y] = spots[i];
    c.set(x, y, COL.zzz);
    c.set(x + 1, y, COL.zzz);
    c.set(x + 2, y, COL.zzz);
    c.set(x + 2, y + 1, COL.zzz);
    c.set(x + 1, y + 2, COL.zzz);
    c.set(x, y + 2, COL.zzz);
    c.set(x + 1, y + 2, COL.zzz);
    c.set(x + 2, y + 2, COL.zzz);
  }
}
function stopSign(c, cy) {
  const cx = 27;
  octagon(c, cx, cy, 5, WHITE);
  octagon(c, cx, cy, 4, COL.red);
  rect(c, cx - 2, cy - 1, 5, 2, WHITE);
  c.set(cx, cy + 6, K);
  c.set(cx, cy + 7, K);
}
function sparkle(c, on) {
  const pts = on ? [[26, 5], [6, 9], [27, 22]] : [[7, 6], [27, 11], [6, 22]];
  for (const [x, y] of pts) {
    c.set(x, y, COL.spark);
    c.set(x - 1, y, COL.spark);
    c.set(x + 1, y, COL.spark);
    c.set(x, y - 1, COL.spark);
    c.set(x, y + 1, COL.spark);
  }
}
function question(c, big) {
  const x = 26;
  const y = 4;
  c.set(x, y, K);
  c.set(x + 1, y, K);
  c.set(x + 2, y, K);
  c.set(x + 3, y + 1, K);
  c.set(x + 2, y + 2, K);
  c.set(x + 1, y + 3, K);
  c.set(x + 1, y + 5, K);
  if (big) {
    c.set(x + 1, y + 4, K);
    c.set(x, y + 1, K);
  }
}
// A big, bold GOLD "?" (dark-outlined so it pops on the violet body) — the
// dragon is presenting a plan and awaiting your approval. `lift` bobs it.
function planQuestion(c, lift) {
  const x = 23;
  const y = 3 - lift;
  const shape = [
    [1, 0], [2, 0], [3, 0], // top curve
    [0, 1], [4, 1],
    [4, 2],
    [3, 3], // hook in
    [2, 4],
    [2, 5], // stem
    [2, 7], // dot
  ];
  for (const [dx, dy] of shape) {
    // dark halo for contrast
    c.set(x + dx - 1, y + dy, K);
    c.set(x + dx + 1, y + dy, K);
    c.set(x + dx, y + dy - 1, K);
    c.set(x + dx, y + dy + 1, K);
  }
  for (const [dx, dy] of shape) c.set(x + dx, y + dy, COL.badge); // gold fill on top
}

// ---- frames per state -------------------------------------------------------
function frame(fn) {
  const c = canvas(S);
  fn(c);
  return c.rgba;
}

const SHEETS = {
  running: [
    frame((c) => drawDragon(c, { pal: PAL.running, eyes: 'open', mouth: 'smile', wing: 'down' })),
    frame((c) => drawDragon(c, { pal: PAL.running, eyes: 'open', mouth: 'smile', wing: 'up' })),
  ],
  idle: [
    frame((c) => {
      drawDragon(c, { pal: PAL.idle, eyes: 'closed', mouth: 'snore' });
      snoreBubble(c, 1.5);
      zzz(c, 1);
    }),
    frame((c) => {
      drawDragon(c, { pal: PAL.idle, eyes: 'closed', mouth: 'snore' });
      snoreBubble(c, 3);
      zzz(c, 2);
    }),
    frame((c) => {
      drawDragon(c, { pal: PAL.idle, eyes: 'closed', mouth: 'snore' });
      snoreBubble(c, 4.5);
      zzz(c, 3);
    }),
  ],
  needs_permission: [
    frame((c) => {
      drawDragon(c, { pal: PAL.needs_permission, cap: true, eyes: 'stern', mouth: 'flat' });
      stopSign(c, 15);
    }),
    frame((c) => {
      drawDragon(c, { pal: PAL.needs_permission, cap: true, eyes: 'stern', mouth: 'flat' });
      stopSign(c, 10);
    }),
  ],
  waiting_input: [
    frame((c) => {
      drawDragon(c, { pal: PAL.waiting_input, eyes: 'up', mouth: 'flat' });
      question(c, false);
    }),
    frame((c) => {
      drawDragon(c, { pal: PAL.waiting_input, eyes: 'up', mouth: 'flat' });
      question(c, true);
    }),
  ],
  needs_plan_approval: [
    frame((c) => {
      drawDragon(c, { pal: PAL.needs_plan_approval, eyes: 'up', mouth: 'smile' });
      planQuestion(c, 0);
    }),
    frame((c) => {
      drawDragon(c, { pal: PAL.needs_plan_approval, eyes: 'up', mouth: 'smile' });
      planQuestion(c, 1);
    }),
  ],
  done: [
    frame((c) => {
      drawDragon(c, { pal: PAL.done, eyes: 'happy', mouth: 'smile' });
      sparkle(c, true);
    }),
    frame((c) => {
      drawDragon(c, { pal: PAL.done, eyes: 'happy', mouth: 'smile' });
      sparkle(c, false);
    }),
  ],
  stale: [frame((c) => drawDragon(c, { pal: PAL.stale, eyes: 'closed', mouth: 'flat' }))],
};

const NEUTRAL = frame((c) => drawDragon(c, { pal: PAL.neutral, eyes: 'open', mouth: 'smile' }));

// ---- compose & write --------------------------------------------------------
function composeSheet(frames) {
  const n = frames.length;
  const w = S * n;
  const out = Buffer.alloc(w * S * 4);
  for (let f = 0; f < n; f += 1) {
    for (let y = 0; y < S; y += 1) {
      const srcStart = y * S * 4;
      frames[f].copy(out, (y * w + f * S) * 4, srcStart, srcStart + S * 4);
    }
  }
  return encodePNG(w, S, out);
}

const outDir = path.join(__dirname, '..', 'assets', 'sprites');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const [state, frames] of Object.entries(SHEETS)) {
  fs.writeFileSync(path.join(outDir, `mascot-${state}.png`), composeSheet(frames));
  console.log('wrote', `mascot-${state}.png  (${frames.length}f)`);
}
fs.writeFileSync(path.join(outDir, 'mascot.png'), encodePNG(S, S, NEUTRAL));
console.log('wrote', 'mascot.png  (neutral)');
console.log('done');
