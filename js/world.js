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
  G.circle = null; G.side = null;
  G.fields = new Map();
}
function solidTile(tx, ty) {
  const g = G.grid;
  if (tx < 0 || ty < 0 || tx >= g.cols || ty >= g.rows) return true;
  return g.solid[ty * g.cols + tx] === 1;
}
function solidAt(x, y) {
  if (G.circle) {
    if (hallDepth(x, y) < 0) return true;
    return G.blocks.length > 0 && blockAt(x, y); // Architect blocks
  }
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
    let hit = 0;
    if (o === G.player) for (const st of G.stairs) {
      if (st.locked) continue;
      if (st.wall) { // side nook
        if (o.y < st.y + r - 2 || o.y > st.y + st.h - r + 2 || (st.wall < 0 ? o.x > st.x + st.w + 6 : o.x < st.x - 6)) continue;
        o.y = clamp(o.y, st.y + r, st.y + st.h - r); o.x = st.wall < 0 ? Math.max(o.x, st.x + r) : Math.min(o.x, st.x + st.w - r);
        return 0;
      }
      if (o.x < st.x + r - 2 || o.x > st.x + st.w - r + 2 || o.y > st.y + st.h + 6) continue;
      o.x = clamp(o.x, st.x + r, st.x + st.w - r); o.y = Math.max(o.y, st.y + r);
      return 0; // inside the nook
    }
    hit = hallClamp(o, r);
    for (const b of G.blocks) if (b.solid && pushOutRect(o, r, b)) hit = 1;
    return hit;
  }
  let hit = 0;
  // clamp into the world first (cheap guard against tunnelling out of the map)
  o.x = clamp(o.x, r, G.W - r); o.y = clamp(o.y, r, G.H - r);
  // centre inside a wall/block (shoved there by crowd pushes or knockback): per-tile resolution could
  // bounce it around inside a thick block forever, so hop to the nearest open tile first
  const ctx = Math.floor(o.x / T), cty = Math.floor(o.y / T);
  if (solidTile(ctx, cty)) {
    let bx = 0, by = 0, bd = Infinity;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      if (solidTile(ctx + ox, cty + oy)) continue;
      const px = clamp(o.x, (ctx + ox) * T, (ctx + ox + 1) * T), py = clamp(o.y, (cty + oy) * T, (cty + oy + 1) * T);
      const d = dist2(o.x, o.y, px, py);
      if (d < bd) { bd = d; bx = px; by = py; }
    }
    if (bd < Infinity) { o.x = bx; o.y = by; hit = 1; }
  }
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
  if (G.circle && hallDepth(x, y) <= r) return false;
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

// Line of sight wide enough for a body of radius r (centre line plus both edges).
function wideLOS(ax, ay, bx, by, r) {
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * r, ny = (dx / l) * r;
  return hasLOS(ax, ay, bx, by) && hasLOS(ax + nx, ay + ny, bx + nx, by + ny) && hasLOS(ax - nx, ay - ny, bx - nx, by - ny);
}

// Where the guide arrow should point: follow the BFS path a few tiles ahead and aim at the
// farthest path tile still in direct view (stable, unlike the next-tile waypoint that swings
// around as you cross a tile centre).
function guidePoint(x, y, tx, ty) {
  if (G.circle || G.side || wideLOS(x, y, tx, ty, 7)) return { x: tx, y: ty };
  const g = G.grid, f = distField(Math.floor(tx / T), Math.floor(ty / T));
  let cx = Math.floor(x / T), cy = Math.floor(y / T);
  if (f[cy * g.cols + cx] < 0) return { x: tx, y: ty };
  let best = null, first = null;
  for (let step = 0; step < 14; step++) {
    const here = f[cy * g.cols + cx];
    if (here <= 0) break;
    let nx = -1, ny = -1, nd = here;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const ax = cx + ox, ay = cy + oy;
      if (solidTile(ax, ay) || (ox && oy && (solidTile(cx + ox, cy) || solidTile(cx, cy + oy)))) continue;
      const d = f[ay * g.cols + ax];
      if (d >= 0 && d < nd) { nd = d; nx = ax; ny = ay; }
    }
    if (nx < 0) break;
    cx = nx; cy = ny;
    const px = (cx + 0.5) * T, py = (cy + 0.5) * T;
    if (!first) first = { x: px, y: py };
    if (wideLOS(x, y, px, py, 7)) best = { x: px, y: py };
    else if (best) break;
  }
  return best || first || { x: tx, y: ty };
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
  // walls are 4 tiles deep at the top (stair nook) and 3 at the bottom (arrival nook)
  carve(1, 4, cols - 2, rows - 7);
  const room = { id: 0, tx: 1, ty: 4, tw: cols - 2, th: rows - 7, kind: 'exit', ...tileRect(1, 4, cols - 2, rows - 7), gates: [], state: 'clear' };
  G.rooms = [room];
  G.halls = [];
  G.exitRoom = room;
  G.pillars = []; G.traps = [];
  placeArrival(room);
  G.gridVer = 1;
  return room;
}

// ---------- boss halls: every boss has its own shape (convex polygon or circle) ----------
// Shapes are relative to the centre, R is the hall's nominal radius (all shapes stay inside 1.15 R).
function hallShape(kind, R) {
  const reg = (n, rot, k) => Array.from({ length: n }, (_, i) => { const a = rot + (i * TAU) / n; return [Math.cos(a) * R * k, Math.sin(a) * R * k]; });
  const box = (w, h) => [[-w * R, -h * R], [w * R, -h * R], [w * R, h * R], [-w * R, h * R]];
  switch (kind) {
    case 'warden': return reg(8, Math.PI / 8, 1.05);            // octagonal fort
    case 'loom': return box(0.96, 0.84);                         // weaving frame
    case 'mirror': return reg(6, 0, 1.1);                        // crystal hexagon
    case 'forge': return [[-1.08, -0.78], [1.08, -0.78], [0.62, 0.9], [-0.62, 0.9]].map(([x, y]) => [x * R, y * R]); // furnace (wide top, narrow hearth)
    case 'puppeteer': return box(1.0, 0.72);                     // theatre stage (wide, shallow)
    case 'architect': return box(0.9, 0.9);                      // blueprint square
    default: return null;                                         // circle (polarity)
  }
}
function buildHallGeometry(c, kind) {
  const rel = hallShape(kind, c.R);
  c.kind = kind || null;
  if (!rel) { c.pts = null; return c; }
  c.pts = rel.map(([x, y]) => [c.x + x, c.y + y]);
  // inward normals (polygon is convex, centre inside)
  c.edges = c.pts.map((p, i) => {
    const q = c.pts[(i + 1) % c.pts.length], ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey) || 1;
    let nx = -ey / l, ny = ex / l;
    if ((c.x - p[0]) * nx + (c.y - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
    return { x: p[0], y: p[1], nx, ny };
  });
  return c;
}
// distance from (x,y) to the hall wall, positive inside
function hallDepth(x, y) {
  const c = G.circle;
  if (!c.pts) return c.R - Math.hypot(x - c.x, y - c.y);
  let d = Infinity;
  for (const e of c.edges) { const v = (x - e.x) * e.nx + (y - e.y) * e.ny; if (v < d) d = v; }
  return d;
}
function hallInside(x, y, r) { return hallDepth(x, y) >= r; }
// push a circle of radius r back inside the hall; returns 1 when it had to
function hallClamp(o, r) {
  const c = G.circle;
  if (!c.pts) {
    const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy), lim = c.R - r;
    if (d > lim && d > 0) { o.x = c.x + (dx / d) * lim; o.y = c.y + (dy / d) * lim; return 1; }
    return 0;
  }
  let hit = 0;
  for (let k = 0; k < 10; k++) { // repeat: at sharp corners pushing off one wall can push into the other
    let moved = false;
    for (const e of c.edges) {
      const v = (o.x - e.x) * e.nx + (o.y - e.y) * e.ny;
      if (v < r - 0.01) { o.x += e.nx * (r - v); o.y += e.ny * (r - v); hit = 1; moved = true; }
    }
    if (!moved) break;
  }
  return hit;
}
// inward normal of the wall nearest to (x,y) (bullet bounces)
function hallNormal(x, y) {
  const c = G.circle;
  if (!c.pts) { const dx = c.x - x, dy = c.y - y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; }
  let best = c.edges[0], bd = Infinity;
  for (const e of c.edges) { const v = (x - e.x) * e.nx + (y - e.y) * e.ny; if (v < bd) { bd = v; best = e; } }
  return { x: best.nx, y: best.ny };
}
// distance along unit (dx,dy) from (x,y) until the wall is r away
function hallRayT(x, y, dx, dy, r) {
  const c = G.circle;
  if (!c.pts) {
    const R = c.R - r, ox = x - c.x, oy = y - c.y, bq = ox * dx + oy * dy, cq = ox * ox + oy * oy - R * R, disc = bq * bq - cq;
    return disc > 0 ? Math.max(0, -bq + Math.sqrt(disc)) : 0;
  }
  let t = Infinity;
  for (const e of c.edges) {
    const dn = dx * e.nx + dy * e.ny;
    if (dn >= 0) continue;
    const v = (x - e.x) * e.nx + (y - e.y) * e.ny;
    t = Math.min(t, (v - r) / -dn);
  }
  return Math.max(0, t === Infinity ? 0 : t);
}
function hallPath(g, c = G.circle, inset = 0) {
  g.beginPath();
  if (!c.pts) { g.arc(c.x, c.y, c.R - inset, 0, TAU); return; }
  c.pts.forEach(([x, y], i) => { const kx = x + (c.x - x) * (inset / c.R), ky = y + (c.y - y) * (inset / c.R); if (i) g.lineTo(kx, ky); else g.moveTo(kx, ky); });
  g.closePath();
}

function buildBossHall(kind) {
  const R = viewDims().VW > viewDims().VH ? 215 : 250; // smaller in landscape (short view)
  const size = Math.ceil((R * 2.3 + T * 10) / T); // room around the hall for the stair nooks
  makeGrid(size, size);
  const c = buildHallGeometry({ x: G.W / 2, y: G.H / 2, R }, kind);
  G.circle = c;
  // grid mirrors the hall for spawn/queries; collision uses the exact shape
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
    if (hallDepth((tx + 0.5) * T, (ty + 0.5) * T) > T * 0.5) G.grid.solid[ty * size + tx] = 0;
  }
  G.rooms = []; G.halls = []; G.pillars = []; G.traps = [];
  const top = c.y - hallRayT(c.x, c.y, 0, -1, 0);
  G.exitRoom = { x: c.x - R * 0.6, y: top, w: R * 1.2, h: R * 2, circleTop: true };
  placeArrival(null);
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
  makeGrid(colsCells * CELL_W + 2, rowsCells * CELL_H + 4);
  G.gridVer = 1;

  // rooms (tile coords), each constrained to overlap its predecessor so a straight corridor fits
  const rooms = [];
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const kind = i === 0 ? 'start' : i === path.length - 1 ? 'exit' : 'fight';
    const tw = kind === 'start' ? 9 : kind === 'exit' ? randInt(13, 16) : randInt(11, 16);
    const th = kind === 'start' ? 9 : randInt(9, 13);
    const cx0 = 1 + (cell.c - minC) * CELL_W, cy0 = 3 + (cell.r - minR) * CELL_H;
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

  G.rooms = rooms;
  G.halls = halls;
  G.pillars = []; G.traps = [];
  G.exitRoom = rooms[rooms.length - 1];
  placeArrival(rooms[0]);
  return rooms;
}

function roomAt(x, y, inset = 0) {
  for (const rm of G.rooms) if (x > rm.x + inset && x < rm.x + rm.w - inset && y > rm.y + inset && y < rm.y + rm.h - inset) return rm;
  return null;
}

// ---------- room variety: shapes, cover layouts, spike traps ----------
// Layouts return tile rects relative to the room interior (x, y, w, h in tiles).
const ROOM_LAYOUTS = {
  pillars4: (w, h) => [[Math.floor(w * 0.25) - 1, Math.floor(h * 0.3) - 1, 2, 2], [w - Math.floor(w * 0.25) - 1, Math.floor(h * 0.3) - 1, 2, 2],
    [Math.floor(w * 0.25) - 1, h - Math.floor(h * 0.3) - 1, 2, 2], [w - Math.floor(w * 0.25) - 1, h - Math.floor(h * 0.3) - 1, 2, 2]],
  twin: (w, h) => [[Math.floor(w * 0.3) - 1, Math.floor(h / 2) - 1, 2, 2], [w - Math.floor(w * 0.3) - 1, Math.floor(h / 2) - 1, 2, 2]],
  block: (w, h) => [[Math.floor(w / 2) - 2, Math.floor(h / 2) - 1, 4, 2 + (h > 11 ? 1 : 0)]],
  zigzag: (w, h) => [[2, Math.floor(h * 0.35), Math.floor(w * 0.45), 1], [w - 2 - Math.floor(w * 0.45), Math.floor(h * 0.68), Math.floor(w * 0.45), 1]],
  columns: (w, h) => [[Math.floor(w * 0.3), 3, 1, Math.max(3, h - 7)], [w - 1 - Math.floor(w * 0.3), 3, 1, Math.max(3, h - 7)]],
  ring: (w, h) => { const out = [], cx = w / 2, cy = h / 2, rx = w * 0.3, ry = h * 0.3; for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8 + TAU / 16; out.push([Math.round(cx + Math.cos(a) * rx - 0.5), Math.round(cy + Math.sin(a) * ry - 0.5), 1, 1]); } return out; },
  crates: (w, h) => { const out = []; const n = randInt(4, 7); for (let i = 0; i < n; i++) out.push([randInt(2, w - 4), randInt(2, h - 4), chance(0.3) ? 2 : 1, 1]); return out; },
  cross: (w, h) => [[Math.floor(w / 2) - 3, Math.floor(h / 2), 6, 1], [Math.floor(w / 2), Math.floor(h / 2) - 2, 1, 5]],
  diagonal: (w, h) => { const out = []; for (let i = 0; i < 5; i++) out.push([Math.round(2 + ((w - 5) * i) / 4), Math.round(2 + ((h - 5) * i) / 4), 1, 1]); return out; },
};
const LAYOUT_KEYS = Object.keys(ROOM_LAYOUTS);

// Tiles that must stay open inside a room: corridor mouths, stairs landings, spawn areas.
function roomReserve(rm) {
  const res = [];
  const g = G.grid;
  for (const gt of rm.gates) {
    for (const i of gt.tiles) {
      const x = i % g.cols, y = (i / g.cols) | 0;
      res.push([x - 2, y - 2, 5, 5]);
    }
  }
  for (const s of G.stairs || []) if (s.tx !== undefined) res.push([s.tx - 1, s.ty + s.th, s.tw + 2, 3]); // landing in front of the nook
  if (G.arrival && G.arrival.tx !== undefined) res.push([G.arrival.tx - 1, G.arrival.ty - 3, G.arrival.tw + 2, 3]);
  return res;
}
const overlaps = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

// All open tiles of the room must form one connected area touching every corridor mouth.
function roomConnected(rm) {
  const g = G.grid, inRoom = (x, y) => x >= rm.tx && x < rm.tx + rm.tw && y >= rm.ty && y < rm.ty + rm.th;
  let start = -1, total = 0;
  for (let y = rm.ty; y < rm.ty + rm.th; y++) for (let x = rm.tx; x < rm.tx + rm.tw; x++) if (!solidTile(x, y)) { total++; if (start < 0) start = y * g.cols + x; }
  if (start < 0) return false;
  const seen = new Uint8Array(g.cols * g.rows), q = [start];
  seen[start] = 1;
  let n = 0;
  while (q.length) {
    const i = q.pop(); n++;
    const x = i % g.cols, y = (i / g.cols) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * g.cols + nx;
      if (inRoom(nx, ny) && !seen[j] && !solidTile(nx, ny)) { seen[j] = 1; q.push(j); }
    }
  }
  if (n !== total) return false;
  for (const gt of rm.gates) { // tile just inside each corridor mouth must be open
    const i = gt.tiles[1], x = i % g.cols, y = (i / g.cols) | 0;
    const inner = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].find(([ix, iy]) => inRoom(ix, iy));
    if (inner && solidTile(inner[0], inner[1])) return false;
  }
  return true;
}

function decorateRoom(rm, floor) {
  if (rm.kind === 'start' || rm.tw < 9 || rm.th < 8) return;
  const reserve = roomReserve(rm);
  for (let attempt = 0; attempt < 6; attempt++) {
    const placed = [], shape = [];
    // 1) room shape: cut corners (chamfer / L / plus)
    const shapeRoll = Math.random();
    const cw = Math.max(2, Math.floor(rm.tw * 0.3)), ch = Math.max(2, Math.floor(rm.th * 0.3));
    if (shapeRoll < 0.25) for (const [cx, cy] of [[0, 0], [rm.tw - 2, 0], [0, rm.th - 2], [rm.tw - 2, rm.th - 2]]) shape.push([cx, cy, 2, 2]);
    else if (shapeRoll < 0.45) { const c = pick([[0, 0], [rm.tw - cw, 0], [0, rm.th - ch], [rm.tw - cw, rm.th - ch]]); shape.push([c[0], c[1], cw, ch]); }
    else if (shapeRoll < 0.6) for (const [cx, cy] of [[0, 0], [rm.tw - cw, 0], [0, rm.th - ch], [rm.tw - cw, rm.th - ch]]) shape.push([cx, cy, Math.max(2, cw - 1), Math.max(2, ch - 1)]);
    // 2) cover layout (never empty)
    const key = pick(LAYOUT_KEYS);
    for (const r of ROOM_LAYOUTS[key](rm.tw, rm.th)) placed.push(r);
    const abs = (r) => [rm.tx + r[0], rm.ty + r[1], r[2], r[3]];
    const ok = (r) => r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= rm.tw && r[1] + r[3] <= rm.th && !reserve.some((z) => overlaps(abs(r), z));
    const shapeOk = shape.filter(ok), placedOk = placed.filter((r) => ok(r) && r[0] >= 1 && r[1] >= 1 && r[0] + r[2] <= rm.tw - 1 && r[1] + r[3] <= rm.th - 1);
    if (!placedOk.length) continue;
    for (const r of shapeOk) fillSolid(...abs(r));
    // obstacles keep >= 2 open tiles to walls and to each other, so big enemies never jam in a 1-tile slot
    const kept = [];
    for (const r of placedOk) {
      const a = abs(r);
      let clear = true;
      for (let y = a[1] - 2; y < a[1] + a[3] + 2 && clear; y++) for (let x = a[0] - 2; x < a[0] + a[2] + 2 && clear; x++) {
        const inside = x >= rm.tx && x < rm.tx + rm.tw && y >= rm.ty && y < rm.ty + rm.th;
        if (inside && solidTile(x, y)) clear = false;
        if (!inside && (x === rm.tx - 1 || x === rm.tx + rm.tw || y === rm.ty - 1 || y === rm.ty + rm.th) && (x === a[0] - 1 || x === a[0] + a[2] || y === a[1] - 1 || y === a[1] + a[3])) clear = false; // 1-tile gap to the room wall
      }
      if (clear) { fillSolid(...a); kept.push(r); }
    }
    placedOk.length = 0; placedOk.push(...kept);
    if (!placedOk.length) { for (const r of shapeOk) carve(...abs(r)); continue; }
    if (roomConnected(rm)) {
      for (const r of placedOk) G.pillars.push({ ...tileRect(...abs(r)), crate: key === 'crates' || (r[2] === 1 && r[3] === 1) });
      rm.layout = key;
      placeTraps(rm, floor, reserve);
      return;
    }
    // undo and retry
    for (const r of shapeOk.concat(placedOk)) carve(...abs(r));
  }
}

function placeTraps(rm, floor, reserve) {
  if (ascMod(7) ? Math.random() < 0.15 : (floor < 3 || Math.random() < 0.55)) return;
  const n = randInt(2, floor >= 10 ? 5 : 3);
  for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
    const tx = rm.tx + randInt(1, rm.tw - 3), ty = rm.ty + randInt(1, rm.th - 3);
    const r = [tx, ty, 2, 2];
    if (reserve.some((z) => overlaps(r, z))) continue;
    if (solidTile(tx, ty) || solidTile(tx + 1, ty) || solidTile(tx, ty + 1) || solidTile(tx + 1, ty + 1)) continue;
    if (G.traps.some((t) => overlaps(r, [t.tx - 1, t.ty - 1, 4, 4]))) continue;
    G.traps.push({ ...tileRect(tx, ty, 2, 2), roomId: rm.id, off: k * 0.7 + Math.random() * 0.4, hitCycle: -1 });
    k++;
  }
}

// ---------- stairs (exit) & arrival stairs ----------
const TRAP_CYCLE = { idle: 2.2, warn: 0.6, active: 0.5 };
function placeStairs(types) {
  G.stairs = [];
  const ex = G.exitRoom, tw = 3, th = 3;
  if (G.circle) {
    // boss halls: the way out is cut into the side walls (left / right), away from the boss at the top
    const c = G.circle, walls = types.length === 1 ? [1] : [-1, 1];
    types.forEach((type, i) => {
      const wall = walls[i], y = c.y + 10, edge = c.x + wall * hallRayT(c.x, y, wall, 0, 0);
      G.stairs.push({ type, x: wall < 0 ? edge - 58 : edge - 4, y: y - 28, w: 62, h: 56, locked: true, circle: true, wall });
    });
    return;
  }
  if (ex.sideStairs) { // grid rooms with side exits (the Collapse's plaza)
    const walls = types.length === 1 ? [1] : [-1, 1], ty = ex.ty + Math.floor(ex.th / 2) - 1;
    types.forEach((type, i) => {
      const wall = walls[i], s = { type, ...tileRect(wall < 0 ? ex.tx - th : ex.tx + ex.tw, ty, th, tw), locked: true, wall };
      fillSolid(s.tx, s.ty, s.tw, s.th);
      G.stairs.push(s);
    });
    return;
  }
  const ctx = ex.tx + Math.floor(ex.tw / 2);
  // two staircases leave a 2-tile passage between them (no 1-tile pockets)
  const xs = types.length === 1 ? [ctx - 1] : [ctx - 4, ctx + 1];
  types.forEach((type, i) => {
    const s = { type, ...tileRect(xs[i], ex.ty - th, tw, th), locked: true };
    fillSolid(s.tx, s.ty, tw, th); // stays wall until unlocked
    G.stairs.push(s);
  });
}
function unlockStairs() {
  for (const s of G.stairs) {
    s.locked = false;
    if (!G.circle && !s.side) carve(s.tx, s.ty, s.tw, s.th);
  }
  G.gridVer++; G.fields.clear();
}
function placeArrival(rm) {
  if (G.circle) { const c = G.circle, bot = c.y + hallRayT(c.x, c.y, 0, 1, 0); G.arrival = { x: c.x - 28, y: bot - 2, w: 56, h: 40 }; G.spawn = { x: c.x, y: bot - 16 }; return; } // nook below the wall line
  // arrival stairs: a nook in the bottom wall, the top step flush with the wall line
  const tx = rm.tx + Math.floor(rm.tw / 2) - 1, ty = rm.ty + rm.th;
  carve(tx, ty, 3, 2);
  G.arrival = tileRect(tx, ty, 3, 2);
  G.spawn = { x: G.arrival.x + G.arrival.w / 2, y: G.arrival.y + G.arrival.h - 12 };
}
function stairAt(x, y) {
  for (const s of G.stairs || []) if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h + 10) return s;
  return null;
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
    { t: 'shop', w: nextFloor >= 4 ? 1.5 : 0 },
    { t: 'risk', w: nextFloor >= 6 ? 1.1 : 0 },
  ];
  const a = weightedPick(pool, (o) => o.w).t;
  const b = weightedPick(pool.filter((o) => o.t !== a), (o) => o.w).t;
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

// ---------- arena helpers used by bosses ----------
function arenaCenter() { return G.circle ? { x: G.circle.x, y: G.circle.y } : { x: G.W / 2, y: G.H / 2 }; }
function clampInArena(x, y, r) {
  if (G.circle) { const o = { x, y }; hallClamp(o, r); return o; }
  return { x: clamp(x, T + r, G.W - T - r), y: clamp(y, T + r, G.H - T - r) };
}
// Ray from (x,y) along unit (dx,dy) to the arena edge (inset by r).
function rayToEdge(x, y, dx, dy, r) {
  if (G.circle) { const t = hallRayT(x, y, dx, dy, r); return { x: x + dx * t, y: y + dy * t }; }
  let t = 0;
  while (t < 2000 && spotFree(x + dx * (t + 6), y + dy * (t + 6), r)) t += 6;
  return { x: x + dx * t, y: y + dy * t };
}
