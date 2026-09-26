'use strict';
// Global game state container + juice: particles, rings, bolts, floating text, shake, hitstop, slow-mo.

const G = {
  state: 'boot',   // boot | menu | play | reward | paused | dying | dead | trans
  W: 360, H: 600,
  time: 0,
  player: null, stats: null, run: null, room: null, scale: null,
  enemies: [], newEnemies: [], pb: [], eb: [], markers: [], pickups: [],
  parts: [], rings: [], texts: [], bolts: [], beams: [], explosions: [],
  pillars: [], doors: [], shrine: null, boss: null,
  grid: null, gridVer: 1, fields: new Map(), circle: null, rooms: [], halls: [], exitRoom: null, spawn: null,
  trauma: 0, hitstop: 0, slowT: 0, slowScale: 1,
  flash: 0, fade: 0, fadeDir: 0, transCb: null,
  nextId: 1,
  dyingT: 0,
  hudDirty: true,
};

const Q = { level: 2, dpr: 2, partMult: 1, glow: true, maxParts: 320 };

const pbPool = [], ebPool = [], partPool = [];

function applyQuality(level) {
  Q.level = level;
  const dev = window.devicePixelRatio || 1;
  if (level >= 2) { Q.dpr = Math.min(dev, 2); Q.partMult = 1; Q.glow = true; Q.maxParts = 320; }
  else if (level === 1) { Q.dpr = Math.min(dev, 1.5); Q.partMult = 0.6; Q.glow = true; Q.maxParts = 180; }
  else { Q.dpr = 1; Q.partMult = 0.35; Q.glow = false; Q.maxParts = 90; }
}

// ---------- particles ----------
// shape: 0 = square, 1 = streak (drawn along velocity)
function part(x, y, vx, vy, life, size, color, drag = 3, shape = 0) {
  if (G.parts.length >= Q.maxParts) return;
  const p = partPool.pop() || {};
  p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
  p.size = size; p.color = color; p.drag = drag; p.shape = shape;
  G.parts.push(p);
}

function burst(x, y, color, n, speed, life = 0.45, size = 3, shape = 0) {
  n = Math.max(1, Math.round(n * Q.partMult));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.65);
    part(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.7), color, 4, shape);
  }
}

function sparks(x, y, ang, spread, color, n, speed, life = 0.25) {
  n = Math.max(1, Math.round(n * Q.partMult));
  for (let i = 0; i < n; i++) {
    const a = ang + (Math.random() - 0.5) * spread, s = speed * (0.4 + Math.random() * 0.6);
    part(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), 2 + Math.random() * 1.5, color, 6, 1);
  }
}

function ring(x, y, r0, r1, dur, color, width = 3) {
  if (G.rings.length > 40) G.rings.shift();
  G.rings.push({ x, y, r0, r1, t: 0, dur, color, width });
}

function floatText(x, y, text, color = '#fff', size = 12, life = 0.8) {
  if (G.texts.length > 24) G.texts.shift();
  G.texts.push({ x, y, text, color, size, t: 0, life });
}

function bolt(x1, y1, x2, y2, color = COL.arc) {
  if (G.bolts.length > 24) G.bolts.shift();
  const pts = [x1, y1];
  const segs = 5, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs, off = (Math.random() - 0.5) * 14;
    pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
  }
  pts.push(x2, y2);
  G.bolts.push({ pts, t: 0, life: 0.14, color });
}

function addShake(a) {
  if (!Save.data.settings.shake) return;
  G.trauma = Math.min(1, G.trauma + a);
}
function hitstop(t) { G.hitstop = Math.max(G.hitstop, t); }
function slowmo(t, scale) { G.slowT = Math.max(G.slowT, t); G.slowScale = scale; }

function updateFx(dt) {
  const ps = G.parts;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { partPool.push(p); swapRemove(ps, i); continue; }
    const d = Math.max(0, 1 - p.drag * dt);
    p.vx *= d; p.vy *= d;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = G.rings.length - 1; i >= 0; i--) {
    const r = G.rings[i]; r.t += dt;
    if (r.t >= r.dur) G.rings.splice(i, 1);
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i]; t.t += dt; t.y -= 26 * dt;
    if (t.t >= t.life) G.texts.splice(i, 1);
  }
  for (let i = G.bolts.length - 1; i >= 0; i--) {
    const b = G.bolts[i]; b.t += dt;
    if (b.t >= b.life) G.bolts.splice(i, 1);
  }
}

function updateFeel(realDt) {
  G.trauma = Math.max(0, G.trauma - realDt * 1.6);
  G.flash = Math.max(0, G.flash - realDt * 1.8);
}
