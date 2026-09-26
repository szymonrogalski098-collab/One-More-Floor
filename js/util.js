'use strict';
// Math & collision helpers shared by every module (classic scripts share global scope).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;
const easeOut = (t) => 1 - (1 - t) * (1 - t);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function weightedPick(items, weightOf) {
  let total = 0;
  for (const it of items) total += Math.max(0, weightOf(it));
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, weightOf(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Squared distance from point P to segment AB.
function segPointDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + abx * t, ay + aby * t);
}

// Pushes circle object `o` (radius rad) out of rect. Returns 0 (no hit), 1 (x-axis normal), 2 (y-axis normal).
function pushOutRect(o, rad, rc) {
  const nx = clamp(o.x, rc.x, rc.x + rc.w), ny = clamp(o.y, rc.y, rc.y + rc.h);
  const dx = o.x - nx, dy = o.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rad * rad) return 0;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2), push = rad - d;
    o.x += (dx / d) * push;
    o.y += (dy / d) * push;
    return Math.abs(dx) > Math.abs(dy) ? 1 : 2;
  }
  const left = o.x - rc.x, right = rc.x + rc.w - o.x, top = o.y - rc.y, bottom = rc.y + rc.h - o.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) { o.x = rc.x - rad; return 1; }
  if (m === right) { o.x = rc.x + rc.w + rad; return 1; }
  if (m === top) { o.y = rc.y - rad; return 2; }
  o.y = rc.y + rc.h + rad; return 2;
}

// Liang–Barsky: does segment AB intersect rect?
function segHitsRect(ax, ay, bx, by, rc) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const ps = [-dx, dx, -dy, dy];
  const qs = [ax - rc.x, rc.x + rc.w - ax, ay - rc.y, rc.y + rc.h - ay];
  for (let i = 0; i < 4; i++) {
    const p = ps[i], q = qs[i];
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function pointInRect(x, y, rc, pad) {
  return x > rc.x - pad && x < rc.x + rc.w + pad && y > rc.y - pad && y < rc.y + rc.h + pad;
}

function swapRemove(arr, i) {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function roman(n) {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
}
