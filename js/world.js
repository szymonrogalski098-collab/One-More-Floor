'use strict';
// Arena geometry: dimensions, pillar layouts, spawn points, world collision, line of sight, doors.

function arenaDims() {
  const landscape = window.innerWidth > window.innerHeight * 1.15;
  return landscape ? { W: 600, H: 360 } : { W: 360, H: 600 };
}

function rc(x, y, w, h) { return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }; }

// Layouts are functions of arena size so they work in both orientations.
const LAYOUTS = [
  () => [],
  (W, H) => { const s = 34; return [rc(W * 0.27 - s / 2, H * 0.36 - s / 2, s, s), rc(W * 0.73 - s / 2, H * 0.36 - s / 2, s, s), rc(W * 0.27 - s / 2, H * 0.64 - s / 2, s, s), rc(W * 0.73 - s / 2, H * 0.64 - s / 2, s, s)]; },
  (W, H) => [rc(W / 2 - 30, H / 2 - 30, 60, 60)],
  (W, H) => [rc(WALL, H * 0.47, W * 0.26, 22), rc(W - WALL - W * 0.26, H * 0.47, W * 0.26, 22)],
  (W, H) => { const out = []; const R = Math.min(W, H) * 0.26; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; out.push(rc(W / 2 + Math.cos(a) * R - 11, H / 2 + Math.sin(a) * R - 11, 22, 22)); } return out; },
  (W, H) => { const tall = H > W; return tall
      ? [rc(W * 0.3 - 11, H * 0.28, 22, H * 0.15), rc(W * 0.7 - 11, H * 0.28, 22, H * 0.15), rc(W * 0.5 - 11, H * 0.56, 22, H * 0.12)]
      : [rc(W * 0.28 - 11, H * 0.3, 22, H * 0.3), rc(W * 0.72 - 11, H * 0.3, 22, H * 0.3)]; },
  (W, H) => { const out = []; const n = randInt(2, 3); for (let i = 0; i < n; i++) { const w = randInt(20, 38), h = randInt(20, 38); const x = rand(W * 0.12, W * 0.5 - w - 14), y = rand(H * 0.22, H * 0.7); out.push(rc(x, y, w, h), rc(W - x - w, y, w, h)); } return out; },
  (W, H) => [rc(W / 2 - W * 0.18, H * 0.33, W * 0.36, 18), rc(W / 2 - W * 0.18, H * 0.66 - 18, W * 0.36, 18)],
];

function spawnPoint() { return { x: G.W / 2, y: G.H - 58 }; }

function pillarIsValid(p) {
  const sp = spawnPoint();
  const cx = clamp(sp.x, p.x, p.x + p.w), cy = clamp(sp.y, p.y, p.y + p.h);
  if (dist2(sp.x, sp.y, cx, cy) < 70 * 70) return false;
  if (p.y < WALL + 76) return false; // keep door approach clear
  if (p.x < WALL - 1 || p.y < WALL - 1 || p.x + p.w > G.W - WALL + 1 || p.y + p.h > G.H - WALL + 1) return false;
  return true;
}

function generatePillars(type) {
  if (type === 'boss' || type === 'rest') return [];
  const idx = G.run.floor <= 1 ? pick([0, 1, 2]) : randInt(0, LAYOUTS.length - 1);
  return LAYOUTS[idx](G.W, G.H).filter(pillarIsValid);
}

function collideWorld(o, r) {
  let hit = 0;
  const minX = WALL + r, maxX = G.W - WALL - r, minY = WALL + r, maxY = G.H - WALL - r;
  if (o.x < minX) { o.x = minX; hit = 1; } else if (o.x > maxX) { o.x = maxX; hit = 1; }
  if (o.y < minY) { o.y = minY; hit = 2; } else if (o.y > maxY) { o.y = maxY; hit = 2; }
  for (const p of G.pillars) { const h = pushOutRect(o, r, p); if (h) hit = h; }
  return hit;
}

function hasLOS(ax, ay, bx, by) {
  for (const p of G.pillars) if (segHitsRect(ax, ay, bx, by, p)) return false;
  return true;
}

function freeSpot(minDistFromPlayer, r = 14) {
  const p = G.player;
  for (let i = 0; i < 40; i++) {
    const x = rand(WALL + r + 6, G.W - WALL - r - 6), y = rand(WALL + r + 6, G.H - WALL - r - 6);
    if (p && dist2(x, y, p.x, p.y) < minDistFromPlayer * minDistFromPlayer) continue;
    let ok = true;
    for (const pl of G.pillars) if (pointInRect(x, y, pl, r + 4)) { ok = false; break; }
    if (ok) return { x, y };
  }
  // fallback: farthest corner from player
  const corners = [[WALL + 30, WALL + 30], [G.W - WALL - 30, WALL + 30], [WALL + 30, G.H - WALL - 30], [G.W - WALL - 30, G.H - WALL - 30]];
  let best = corners[0], bd = -1;
  for (const c of corners) { const d = p ? dist2(c[0], c[1], p.x, p.y) : 0; if (d > bd) { bd = d; best = c; } }
  return { x: best[0], y: best[1] };
}

// Ray from (x,y) along (dx,dy) until arena bound (inset by r). Returns end point.
function rayToWall(x, y, dx, dy, r) {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (G.W - WALL - r - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, (WALL + r - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (G.H - WALL - r - y) / dy);
  else if (dy < -1e-6) t = Math.min(t, (WALL + r - y) / dy);
  if (!isFinite(t) || t < 0) t = 0;
  return { x: x + dx * t, y: y + dy * t };
}

// ---------- doors ----------
function makeDoors(types) {
  const w = 66, h = 28;
  const xs = types.length === 1 ? [G.W / 2] : [G.W * 0.28, G.W * 0.72];
  G.doors = types.map((type, i) => ({ type, x: xs[i] - w / 2, y: WALL - 4, w, h, t: 0 }));
}

function nextDoorTypes(nextFloor) {
  if (nextFloor % 5 === 0) return ['boss'];
  if (nextFloor <= 2) return ['combat'];
  const p = G.player, s = G.stats;
  const hurt = p.hp <= s.maxHp * 0.5;
  const pool = [
    { t: 'combat', w: 5 },
    { t: 'elite', w: nextFloor >= 3 ? 3 : 0 },
    { t: 'rest', w: p.hp >= s.maxHp ? 0.8 : hurt ? 4 : 2 },
  ];
  const a = weightedPick(pool, (o) => o.w).t;
  const b = weightedPick(pool.filter((o) => o.t !== a), (o) => o.w).t;
  return Math.random() < 0.5 ? [a, b] : [b, a];
}
