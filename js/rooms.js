'use strict';
// Rare room variants. On some combat/elite floors one room plays (and looks) differently:
//  grand     - a hall almost twice the size, one more wave, a heart and shards when cleared
//  gauntlet  - no cover, spike plates in a grid that fire in a wave sweeping across the room
//  corridor  - long and low; enemies come in from the far end
//  conveyor  - two belts that carry you (and walkers) sideways
//  colonnade - a forest of pillars; enemy bullets bounce off walls and pillars once
//  dark      - only a few lights while the fight is on
//  chasm     - a pit across the middle: walkers cannot cross, bullets fly over, you can dash over it
const ROOM_VARIANTS = {
  grand:     { min: 4,  name: 'Great Hall', color: '#ffd44d' },
  gauntlet:  { min: 5,  name: 'Trap Hall',  color: '#ff8a3d' },
  corridor:  { min: 6,  name: 'Long Hall',  color: '#c38bff' },
  conveyor:  { min: 6,  name: 'Conveyor',   color: '#4df3ff' },
  colonnade: { min: 7,  name: 'Colonnade',  color: '#8dff6a' },
  dark:      { min: 8,  name: 'Dark Room',  color: '#8c7dff' },
  chasm:     { min: 10, name: 'Chasm',      color: '#ff4f6b' },
};
const PIT = 2; // grid value: open for bullets and sight, closed for walking (except a dashing player)

function rollVariant(floor, type) {
  if (type !== 'combat' && type !== 'elite') return null;
  if (G.forceVariant) return G.forceVariant; // tests / debug
  if (floor < 4) return null;
  if (Math.random() > Math.min(0.7, 0.3 + floor * 0.012)) return null;
  return pick(Object.keys(ROOM_VARIANTS).filter((k) => ROOM_VARIANTS[k].min <= floor));
}
// [tw, th] for variants that need a special size (others use the normal random size)
function variantSize(v) {
  if (v === 'grand') return [randInt(22, 25), randInt(16, 18)];
  if (v === 'corridor') return [randInt(24, 26), 7];
  if (v === 'chasm') return [randInt(15, 16), randInt(12, 13)];
  if (v === 'gauntlet') return [randInt(15, 16), randInt(12, 13)];
  if (v === 'colonnade') return [16, randInt(12, 13)];
  return null;
}
function variantBigCells(v) { return v === 'grand' || v === 'corridor'; }

// ---------- building ----------
function decorateVariant(rm, floor) {
  const v = rm.variant, reserve = roomReserve(rm);
  const free = (r) => !reserve.some((z) => overlaps(r, z));
  if (v === 'grand' || v === 'dark') { decorateRoom(rm, floor, true, v === 'grand'); return; }
  if (v === 'gauntlet') {
    // spike plates on a grid; their timing sweeps from one side to the other
    const cyc = TRAP_CYCLE.idle + TRAP_CYCLE.warn + TRAP_CYCLE.active;
    for (let y = rm.ty + 1; y + 2 <= rm.ty + rm.th - 1; y += 3) for (let x = rm.tx + 1; x + 2 <= rm.tx + rm.tw - 1; x += 3) {
      if (!free([x, y, 2, 2])) continue;
      G.traps.push({ ...tileRect(x, y, 2, 2), roomId: rm.id, off: ((x - rm.tx) / rm.tw) * cyc * 0.8, hitCycle: -1 });
    }
    rm.layout = 'gauntlet';
    return;
  }
  if (v === 'corridor') {
    // a couple of low crates to duck behind, nothing else
    for (const fx of [0.3, 0.7]) { const r = [rm.tx + Math.floor(rm.tw * fx), rm.ty + 3, 1, 1]; if (free(r)) { fillSolid(...r); G.pillars.push({ ...tileRect(...r), crate: true }); } }
    if (!roomConnected(rm)) for (const p of G.pillars.filter((q) => q.tx >= rm.tx && q.tx < rm.tx + rm.tw && q.ty >= rm.ty && q.ty < rm.ty + rm.th)) carve(p.tx, p.ty, 1, 1);
    rm.layout = 'corridor';
    return;
  }
  if (v === 'conveyor') {
    G.belts = G.belts || [];
    const rows = [Math.floor(rm.th * 0.28), Math.floor(rm.th * 0.72) - 1];
    rows.forEach((ry, k) => G.belts.push({ ...tileRect(rm.tx + 1, rm.ty + ry, rm.tw - 2, 2), dx: k ? -1 : 1, roomId: rm.id }));
    rm.layout = 'conveyor';
    return;
  }
  if (v === 'colonnade') {
    const placed = [];
    for (let y = rm.ty + 3; y <= rm.ty + rm.th - 4; y += 3) for (let x = rm.tx + 3; x <= rm.tx + rm.tw - 4; x += 3) {
      const r = [x, y, 1, 1];
      if (!free([x - 1, y - 1, 3, 3])) continue;
      fillSolid(...r); placed.push(r);
    }
    if (!roomConnected(rm)) { for (const r of placed) carve(...r); placed.length = 0; }
    for (const r of placed) G.pillars.push({ ...tileRect(...r), crate: false });
    rm.layout = 'colonnade';
    return;
  }
  if (v === 'chasm') {
    // a 3-tile pit band across the middle, 3 tiles short of the walls on both ends
    const g = G.grid, wide = rm.tw >= rm.th;
    const band = wide ? [rm.tx + 3, rm.ty + Math.floor(rm.th / 2) - 1, rm.tw - 6, 3] : [rm.tx + Math.floor(rm.tw / 2) - 1, rm.ty + 3, 3, rm.th - 6];
    for (let y = band[1]; y < band[1] + band[3]; y++) for (let x = band[0]; x < band[0] + band[2]; x++) {
      if (!free([x - 1, y - 1, 3, 3])) continue;
      g.solid[y * g.cols + x] = PIT;
    }
    rm.layout = 'chasm';
  }
}

// ---------- queries ----------
function pitTile(tx, ty) { const g = G.grid; return !!g && tx >= 0 && ty >= 0 && tx < g.cols && ty < g.rows && g.solid[ty * g.cols + tx] === PIT; }
function pitAt(x, y) { return !G.circle && !G.side && pitTile(Math.floor(x / T), Math.floor(y / T)); }
// does the straight walk from a to b cross a pit?
function pitOnLine(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, n = Math.ceil(Math.hypot(dx, dy) / (T * 0.45));
  for (let i = 1; i < n; i++) if (pitAt(ax + (dx * i) / n, ay + (dy * i) / n)) return true;
  return false;
}
function variantRoomAt(x, y, v) { const rm = roomAt(x, y); return rm && rm.variant === v ? rm : null; }

// where a wave enemy appears: the Long Hall sends them in from the far end
function variantSpawnArea(room) {
  if (!room || room.variant !== 'corridor') return room;
  const p = G.player, third = room.w / 3, farRight = p.x < room.x + room.w / 2;
  return { x: farRight ? room.x + room.w - third : room.x, y: room.y, w: third, h: room.h };
}

// ---------- per-frame ----------
function roomsStep(dt) {
  if (!G.belts || !G.belts.length) return;
  const p = G.player;
  for (const bt of G.belts) {
    const rm = G.rooms[bt.roomId];
    if (!rm || rm.state !== 'active') continue;
    if (p.alive && p.dashT <= 0 && pointInRect(p.x, p.y, bt, 0)) { p.x += bt.dx * 80 * dt; collideWorld(p, p.r); }
    for (const e of G.enemies) if (!e.dead && !e.air && e.type !== 'boss' && pointInRect(e.x, e.y, bt, 0)) { e.x += bt.dx * 60 * dt; collideWorld(e, e.r); }
  }
}
// Colonnade: an enemy bullet hitting a wall inside it bounces once instead of dying
function variantBounce(b, dt) {
  if (b.bounced || !variantRoomAt(b.x - b.vx * dt, b.y - b.vy * dt, 'colonnade')) return false;
  const px = b.x - b.vx * dt, py = b.y - b.vy * dt;
  if (solidAt(px, b.y)) b.vy = -b.vy; else if (solidAt(b.x, py)) b.vx = -b.vx; else { b.vx = -b.vx; b.vy = -b.vy; }
  b.x = px; b.y = py; b.bounced = true;
  return true;
}
// Great Hall reward
function variantCleared(rm) {
  if (rm.variant !== 'grand') return;
  const cx = rm.x + rm.w / 2, cy = rm.y + rm.h / 2;
  dropPickup(cx, cy, 'heart', 1);
  for (let k = 0; k < 6; k++) dropPickup(cx, cy, 'shard', 2);
  floatText(cx, cy - 20, 'GREAT HALL CLEARED', ROOM_VARIANTS.grand.color, 13, 1.4);
}
// Dark Room lights (null = not dark)
function darkRoomLights() {
  const rm = G.room && G.room.active;
  if (!rm || rm.variant !== 'dark' || G.room.phase !== 'fight') return null;
  const p = G.player, L = [[p.x, p.y, 120]];
  for (const e of G.enemies) if (!e.dead) L.push([e.x, e.y, 26]);
  for (const o of G.eb) L.push([o.x, o.y, 14]);
  for (const m of G.markers) L.push([m.x, m.y, 20]);
  return L;
}
