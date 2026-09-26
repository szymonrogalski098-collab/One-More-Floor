'use strict';
// World geometry on a tile grid (T px per tile):
//  - single rooms (rest floors),
//  - dungeon floors: rooms joined by corridors, with gates that lock while a room fights,
//  - boss floors: one big circular hall (analytic circle collision, grid only for queries).
// Provides collision, line of sight, BFS path fields, spawn spots and doors.

const T = 20;

// Visible window in world units (the camera follows the player when the world is bigger).
function viewDims() {
  const landscape = window.innerWidth > window.innerHeight * 1.15;
  return landscape ? { VW: 600, VH: 360 } : { VW: 360, VH: 600 };
}

function rc(x, y, w, h) { return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }; }

// ---------- grid ----------
function makeGrid(cols, rows) {
  G.grid = { cols, rows, solid: new Uint8Array(cols * rows).fill(1), gate: new Uint8Array(cols * rows) };
  G.W = cols * T; G.H = rows * T;
  G.circle = null;
  G.fields = new Map();
}
function solidTile(tx, ty) {
  const g = G.grid;
  if (tx < 0 || ty < 0 || tx >= g.cols || ty >= g.rows) return true;
  return g.solid[ty * g.cols + tx] === 1;
}
function solidAt(x, y) {
  if (G.circle) { const c = G.circle; return dist2(x, y, c.x, c.y) > c.R * c.R; }
  return solidTile(Math.floor(x / T), Math.floor(y / T));
}
function carve(tx, ty, tw, th) {
  const g = G.grid;
  for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) if (x >= 0 && y >= 0 && x < g.cols && y < g.rows) g.solid[y * g.cols + x] = 0;
}
function fillSolid(tx, ty, tw, th) {
  const g = G.grid;
  for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) if (x >= 0 && y >= 0 && x < g.cols && y < g.rows) g.solid[y * g.cols + x] = 1;
}
function tileRect(tx, ty, tw, th) { return { x: tx * T, y: ty * T, w: tw * T, h: th * T, tx, ty, tw, th }; }

// ---------- collision ----------
const _tileRc = { x: 0, y: 0, w: T, h: T };
function collideWorld(o, r) {
  if (G.circle) {
    const c = G.circle, dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy), lim = c.R - r;
    if (d > lim && d > 0) { o.x = c.x + (dx / d) * lim; o.y = c.y + (dy / d) * lim; return 1; }
    return 0;
  }
  let hit = 0;
  // clamp into the world first (cheap guard against tunnelling out of the map)
  o.x = clamp(o.x, r, G.W - r); o.y = clamp(o.y, r, G.H - r);
  const x0 = Math.floor((o.x - r) / T), x1 = Math.floor((o.x + r) / T);
  const y0 = Math.floor((o.y - r) / T), y1 = Math.floor((o.y + r) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!solidTile(tx, ty)) continue;
    _tileRc.x = tx * T; _tileRc.y = ty * T;
    const h = pushOutRect(o, r, _tileRc);
    if (h) hit = h;
  }
  return hit;
}

function hasLOS(ax, ay, bx, by) {
  if (G.circle) return true; // convex hall
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  const n = Math.ceil(len / (T * 0.45));
  for (let i = 1; i < n; i++) if (solidAt(ax + (dx * i) / n, ay + (dy * i) / n)) return false;
  return true;
}

// Is a circle of radius r at (x,y) fully in open space?
function spotFree(x, y, r) {
  if (G.circle) { const c = G.circle; return dist2(x, y, c.x, c.y) < (c.R - r) * (c.R - r); }
  return !solidAt(x, y) && !solidAt(x - r, y) && !solidAt(x + r, y) && !solidAt(x, y - r) && !solidAt(x, y + r)
    && !solidAt(x - r * 0.7, y - r * 0.7) && !solidAt(x + r * 0.7, y + r * 0.7) && !solidAt(x - r * 0.7, y + r * 0.7) && !solidAt(x + r * 0.7, y - r * 0.7);
}

// Random open spot, optionally inside `area` (world rect), at least minDist from the player.
function freeSpot(minDist, r = 14, area) {
  const p = G.player;
  const A = area || (G.circle ? { x: G.circle.x - G.circle.R, y: G.circle.y - G.circle.R, w: G.circle.R * 2, h: G.circle.R * 2 } : { x: 0, y: 0, w: G.W, h: G.H });
  let best = null, bd = -1;
  for (let i = 0; i < 50; i++) {
    const x = rand(A.x + r + 4, A.x + A.w - r - 4), y = rand(A.y + r + 4, A.y + A.h - r - 4);
    if (!spotFree(x, y, r + 3)) continue;
    const d = p ? dist2(x, y, p.x, p.y) : 1e9;
    if (d >= minDist * minDist) return { x, y };
    if (d > bd) { bd = d; best = { x, y }; }
  }
  return best || { x: A.x + A.w / 2, y: A.y + A.h / 2 };
}

// ---------- BFS distance fields (enemy chasing, bot navigation, guide arrow) ----------
function distField(tx, ty) {
  const key = tx + ',' + ty + ':' + G.gridVer;
  let f = G.fields.get(key);
  if (f) return f;
  const g = G.grid, n = g.cols * g.rows;
  f = new Int16Array(n).fill(-1);
  if (solidTile(tx, ty)) { // target inside a wall: start from the nearest open tile
    let bx = 0, by = 0, bd = Infinity;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const d = ox * ox + oy * oy;
      if (d < bd && !solidTile(tx + ox, ty + oy)) { bd = d; bx = ox; by = oy; }
    }
    if (bd === Infinity) return f;
    tx += bx; ty += by;
  }
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  const start = ty * g.cols + tx;
  f[start] = 0; q[tail++] = start;
  while (head < tail) {
    const i = q[head++], x = i % g.cols, y = (i / g.cols) | 0, d = f[i] + 1;
    if (x > 0 && !g.solid[i - 1] && f[i - 1] < 0) { f[i - 1] = d; q[tail++] = i - 1; }
    if (x < g.cols - 1 && !g.solid[i + 1] && f[i + 1] < 0) { f[i + 1] = d; q[tail++] = i + 1; }
    if (y > 0 && !g.solid[i - g.cols] && f[i - g.cols] < 0) { f[i - g.cols] = d; q[tail++] = i - g.cols; }
    if (y < g.rows - 1 && !g.solid[i + g.cols] && f[i + g.cols] < 0) { f[i + g.cols] = d; q[tail++] = i + g.cols; }
  }
  if (G.fields.size > 24) G.fields.clear();
  G.fields.set(key, f);
  return f;
}

// Next waypoint (tile centre) when walking from (x,y) towards (tx,ty); null when the line is clear.
function routeTo(x, y, r, tx, ty) {
  if (hasLOS(x, y, tx, ty)) return null;
  if (G.circle) return null;
  const g = G.grid, f = distField(Math.floor(tx / T), Math.floor(ty / T));
  const cx = Math.floor(x / T), cy = Math.floor(y / T);
  let best = -1, bx = 0, by = 0;
  const here = f[cy * g.cols + cx];
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const nx = cx + ox, ny = cy + oy;
    if (solidTile(nx, ny)) continue;
    if (ox && oy && (solidTile(cx + ox, cy) || solidTile(cx, cy + oy))) continue; // no corner cutting
    const d = f[ny * g.cols + nx];
    if (d < 0) continue;
    if (best < 0 || d < best) { best = d; bx = nx; by = ny; }
  }
  if (best < 0 || (here >= 0 && best >= here && here !== 0)) return null;
  return { x: (bx + 0.5) * T, y: (by + 0.5) * T };
}

// ---------- gates ----------
function setGates(room, locked) {
  const g = G.grid;
  for (const gt of room.gates) {
    for (const i of gt.tiles) { g.solid[i] = locked ? 1 : 0; g.gate[i] = locked ? 1 : 0; }
    gt.locked = locked;
  }
  G.gridVer++;
  G.fields.clear();
}

// ---------- floor builders ----------
function buildSingleRoom(type) {
  const { VW, VH } = viewDims();
  const cols = Math.round(VW / T), rows = Math.round(VH / T);
  makeGrid(cols, rows);
  carve(1, 1, cols - 2, rows - 2);
  const room = { id: 0, kind: 'exit', ...tileRect(1, 1, cols - 2, rows - 2), gates: [], state: 'clear' };
  G.rooms = [room];
  G.halls = [];
  G.exitRoom = room;
  G.pillars = [];
  G.spawn = { x: G.W / 2, y: G.H - T - 46 };
  G.gridVer = 1;
  return room;
}

function buildBossHall() {
  const R = viewDims().VW > viewDims().VH ? 215 : 250; // smaller in landscape (short view)
  const size = Math.ceil((R * 2 + T * 4) / T);
  makeGrid(size, size);
  const c = { x: G.W / 2, y: G.H / 2, R };
  // grid mirrors the circle for spawn/queries; collision uses the exact circle
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
    if (dist2((tx + 0.5) * T, (ty + 0.5) * T, c.x, c.y) < (R - T * 0.5) * (R - T * 0.5)) G.grid.solid[ty * size + tx] = 0;
  }
  G.circle = c;
  G.rooms = []; G.halls = []; G.pillars = [];
  G.exitRoom = { x: c.x - R * 0.6, y: c.y - R, w: R * 1.2, h: R * 2, circleTop: true };
  G.spawn = { x: c.x, y: c.y + R - 60 };
  G.gridVer = 1;
}

// Dungeon: rooms on a coarse lattice, walked upwards/sideways from a start room to the exit room.
const CELL_W = 20, CELL_H = 17;
function buildDungeon(floor, type) {
  const nFight = floor <= 2 ? 2 : floor < 10 ? 3 : randInt(3, 4);
  const path = [{ c: randInt(0, 2), r: 0 }];
  while (path.length < nFight + 1) {
    const cur = path[path.length - 1];
    const opts = [{ c: cur.c, r: cur.r - 1, w: 3 }];
    for (const dc of [-1, 1]) {
      const c = cur.c + dc;
      if (c >= 0 && c <= 2 && !path.some((p) => p.c === c && p.r === cur.r)) opts.push({ c, r: cur.r, w: 2 });
    }
    const n = weightedPick(opts, (o) => o.w);
    path.push({ c: n.c, r: n.r });
  }
  const minR = Math.min(...path.map((p) => p.r)), minC = Math.min(...path.map((p) => p.c)), maxC = Math.max(...path.map((p) => p.c));
  const rowsCells = -minR + 1, colsCells = maxC - minC + 1;
  makeGrid(colsCells * CELL_W + 2, rowsCells * CELL_H + 2);
  G.gridVer = 1;

  // rooms (tile coords), each constrained to overlap its predecessor so a straight corridor fits
  const rooms = [];
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const kind = i === 0 ? 'start' : i === path.length - 1 ? 'exit' : 'fight';
    const tw = kind === 'start' ? 9 : kind === 'exit' ? randInt(13, 16) : randInt(11, 16);
    const th = kind === 'start' ? 9 : randInt(9, 13);
    const cx0 = 1 + (cell.c - minC) * CELL_W, cy0 = 1 + (cell.r - minR) * CELL_H;
    let tx = cx0 + randInt(2, CELL_W - tw - 2), ty = cy0 + randInt(2, CELL_H - th - 2);
    const prev = rooms[i - 1];
    if (prev) {
      if (cell.r === path[i - 1].r) { // horizontal neighbour: need >= 5 rows overlap
        const lo = Math.max(cy0 + 2, prev.ty - th + 5), hi = Math.min(cy0 + CELL_H - th - 2, prev.ty + prev.th - 5);
        if (lo <= hi) ty = randInt(lo, hi);
      } else { // vertical neighbour: need >= 5 cols overlap
        const lo = Math.max(cx0 + 2, prev.tx - tw + 5), hi = Math.min(cx0 + CELL_W - tw - 2, prev.tx + prev.tw - 5);
        if (lo <= hi) tx = randInt(lo, hi);
      }
    }
    rooms.push({ id: i, kind, tx, ty, tw, th, gates: [], state: kind === 'start' ? 'clear' : 'idle' });
  }
  for (const rm of rooms) { carve(rm.tx, rm.ty, rm.tw, rm.th); Object.assign(rm, tileRect(rm.tx, rm.ty, rm.tw, rm.th)); }

  // corridors (3 tiles wide) with a gate tile-strip at each end
  const halls = [];
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    let hall;
    if (path[i].r === path[i - 1].r) {
      const left = a.tx < b.tx ? a : b, right = left === a ? b : a;
      const lo = Math.max(a.ty, b.ty) + 1, hi = Math.min(a.ty + a.th, b.ty + b.th) - 4;
      const y = hi >= lo ? randInt(lo, hi) : Math.max(a.ty, b.ty);
      const x0 = left.tx + left.tw, x1 = right.tx; // exclusive
      carve(x0, y, x1 - x0, 3);
      hall = { ...tileRect(x0, y, x1 - x0, 3), horiz: true };
      const g = G.grid;
      const col = (x) => [0, 1, 2].map((k) => (y + k) * g.cols + x);
      left.gates.push({ tiles: col(x0), horiz: true, locked: false });
      right.gates.push({ tiles: col(x1 - 1), horiz: true, locked: false });
    } else {
      const low = a.ty > b.ty ? a : b, high = low === a ? b : a; // a is below b
      const lo = Math.max(a.tx, b.tx) + 1, hi = Math.min(a.tx + a.tw, b.tx + b.tw) - 4;
      const x = hi >= lo ? randInt(lo, hi) : Math.max(a.tx, b.tx);
      const y0 = high.ty + high.th, y1 = low.ty;
      carve(x, y0, 3, y1 - y0);
      hall = { ...tileRect(x, y0, 3, y1 - y0), horiz: false };
      const g = G.grid;
      const row = (y) => [0, 1, 2].map((k) => y * g.cols + x + k);
      high.gates.push({ tiles: row(y0), horiz: false, locked: false });
      low.gates.push({ tiles: row(y1 - 1), horiz: false, locked: false });
    }
    halls.push(hall);
  }

  // cover pillars in bigger fight rooms (2x2 tiles, kept away from walls so paths stay open)
  const pillars = [];
  for (const rm of rooms) {
    if (rm.kind === 'start' || rm.tw < 13 || rm.th < 11 || Math.random() < 0.35) continue;
    const py = rm.ty + Math.floor(rm.th / 2) - 1;
    const pxL = rm.tx + Math.floor(rm.tw * 0.3) - 1, pxR = rm.tx + rm.tw - Math.floor(rm.tw * 0.3) - 1;
    for (const px of [pxL, pxR]) { fillSolid(px, py, 2, 2); pillars.push(tileRect(px, py, 2, 2)); }
  }

  G.rooms = rooms;
  G.halls = halls;
  G.pillars = pillars;
  G.exitRoom = rooms[rooms.length - 1];
  const st = rooms[0];
  G.spawn = { x: st.x + st.w / 2, y: st.y + st.h / 2 };
  return rooms;
}

function roomAt(x, y, inset = 0) {
  for (const rm of G.rooms) if (x > rm.x + inset && x < rm.x + rm.w - inset && y > rm.y + inset && y < rm.y + rm.h - inset) return rm;
  return null;
}

// ---------- doors (top wall of the exit room) ----------
function makeDoors(types) {
  const w = 66, h = 26, ex = G.exitRoom;
  let xs, y;
  if (ex.circleTop) {
    const c = G.circle;
    xs = types.length === 1 ? [c.x] : [c.x - 70, c.x + 70];
    y = c.y - c.R + 18;
  } else {
    const cx = ex.x + ex.w / 2;
    xs = types.length === 1 ? [cx] : [ex.x + ex.w * 0.28, ex.x + ex.w * 0.72];
    y = ex.y - h + 4;
  }
  G.doors = types.map((type, i) => ({ type, x: xs[i] - w / 2, y, w, h, t: 0 }));
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

// ---------- arena helpers used by bosses ----------
function arenaCenter() { return G.circle ? { x: G.circle.x, y: G.circle.y } : { x: G.W / 2, y: G.H / 2 }; }
function clampInArena(x, y, r) {
  if (G.circle) {
    const c = G.circle, dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy), lim = c.R - r;
    if (d > lim) return { x: c.x + (dx / d) * lim, y: c.y + (dy / d) * lim };
    return { x, y };
  }
  return { x: clamp(x, T + r, G.W - T - r), y: clamp(y, T + r, G.H - T - r) };
}
// Ray from (x,y) along unit (dx,dy) to the arena edge (inset by r).
function rayToEdge(x, y, dx, dy, r) {
  if (G.circle) {
    const c = G.circle, R = c.R - r, ox = x - c.x, oy = y - c.y;
    const bq = ox * dx + oy * dy, cq = ox * ox + oy * oy - R * R;
    const disc = bq * bq - cq;
    const t = disc > 0 ? -bq + Math.sqrt(disc) : 0;
    return { x: x + dx * Math.max(0, t), y: y + dy * Math.max(0, t) };
  }
  let t = 0;
  while (t < 2000 && spotFree(x + dx * (t + 6), y + dy * (t + 6), r)) t += 6;
  return { x: x + dx * t, y: y + dy * t };
}
