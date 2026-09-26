'use strict';
// Run & floor flow: new run, floors, waves, rewards, doors, death, records.

function newRun(snapshot) {
  const meta = Save.data.meta;
  G.run = {
    floor: 0, upgrades: {}, order: [], kills: 0, shards: 0, dmg: 0, time: 0, bosses: 0, elites: 0,
    hurt: 0, dodges: 0, rerolls: meta.reroll | 0, windUsed: false,
    ship: Save.data.ships.includes(Save.data.ship) ? Save.data.ship : 'striker',
    asc: Math.min(Save.data.asc.selected | 0, Save.data.asc.unlocked | 0), hurtAtBoss: 0,
  };
  G.player = makePlayer();
  computeStats();
  G.player.hp = G.stats.maxHp;
  let floor = 1, type = 'combat';
  if (snapshot) {
    Object.assign(G.run, snapshot.run);
    G.run.upgrades = {}; G.run.order = [];
    for (const id of snapshot.order) if (UPG[id]) addUpgrade(id, true);
    computeStats();
    G.player.hp = clamp(snapshot.hp, 1, G.stats.maxHp);
    floor = snapshot.floor; type = snapshot.type;
  } else if ((meta.start | 0) > 0) {
    const commons = UPGRADES.filter((u) => u.rarity === 0 && u.id !== 'vital' && u.id !== 'mender');
    addUpgrade(pick(commons).id, true);
    computeStats();
    G.player.hp = G.stats.maxHp;
  }
  G.player.dashCharges = G.stats.dashCharges;
  Input.reset();
  enterFloor(floor, type, snapshot && snapshot.floorState);
  Sound.music(true, 'normal');
}

function addUpgrade(id, silent) {
  const run = G.run;
  run.upgrades[id] = (run.upgrades[id] || 0) + 1;
  if (run.order.indexOf(id) === -1) run.order.push(id);
  computeStats();
  if (!silent && UPG[id].onPick) UPG[id].onPick();
  G.hudDirty = true;
}

function resetArrays() {
  while (G.pb.length) pbPool.push(G.pb.pop());
  while (G.eb.length) ebPool.push(G.eb.pop());
  G.enemies.length = 0; G.newEnemies.length = 0; G.markers.length = 0; G.pickups.length = 0;
  G.rings.length = 0; G.texts.length = 0; G.bolts.length = 0; G.beams.length = 0; G.explosions.length = 0;
  G.stairs = []; G.stairOn = null; G.traps = []; G.shells.length = 0; G.pools.length = 0; G.waves.length = 0; G.shrine = null; G.boss = null; G.arriveT = 0; G.climb = null; G.safePos = null; G.guideEnemy = null; G.guideFar = false;
}

function enterFloor(n, type, restore, layout) {
  const run = G.run;
  run.floor = n;
  if (n % 5 === 0) type = 'boss';
  G.scale = floorScale(n);
  resetArrays();
  if (restore) restoreFloor(restore); else if (layout) restoreFloor(layout); else buildFloorGeometry(type, n);
  const p = G.player;
  p.x = G.spawn.x; p.y = G.spawn.y; p.vx = 0; p.vy = -60; p.face = -Math.PI / 2; p.trail.length = 0;
  p.iframes = 0.8; p.dashT = 0; p.dashIfr = 0; p.fireT = 0.3;
  G.room = { type, phase: 'intro', t: 0, active: null, waveT: 0, queue: [], queueT: 0, rewardShown: false,
    waveThresh: Math.max(2, Math.floor(G.scale.maxAlive / 4)) };
  if (!restore && (type === 'combat' || type === 'elite')) planFloor(n, type);
  if (type === 'rest') { const ex = G.exitRoom; G.shrine = { x: ex.x + ex.w / 2, y: ex.y + ex.h * 0.5, used: false, t: 0 }; }
  if (restore) { applyRestoreState(restore); p.vx = p.vy = 0; }
  Render.buildFloor();
  Render.snapCamera();
  UI.bossBar(null);
  UI.stairInfo(null);
  const R = ROOM[type];
  if (type !== 'boss') showBanner('FLOOR ' + n, R.name + (type === 'elite' ? ' — ' + R.sub.toLowerCase() : ''), type);
  else showBanner('FLOOR ' + n, 'Something is coming…', 'boss');
  G.state = 'play';
  G.hudDirty = true;
  makePreviews();
  checkChallenges('floor');
  saveSnapshot();
  if (!Save.data.settings.tutorialDone && n === 1) G.tutorial = 0.01; else G.tutorial = 0;
}

function buildFloorGeometry(type, floor) {
  const next = nextDoorTypes(floor + 1);
  if (type === 'boss' && BOSSES[bossKindFor(floor)].side) { buildSideElevator(); placeSideDoors(next); return; }
  if (type === 'boss') { buildBossHall(); placeStairs(next); return; }
  if (type === 'rest') { buildSingleRoom(); placeStairs(next); return; }
  for (let i = 0; i < 30; i++) {
    buildDungeon(floor, type);
    placeStairs(next);
    for (const rm of G.rooms) decorateRoom(rm, floor);
    if (dungeonConnected()) return;
  }
  const rm = buildSingleRoom(); // fallback: one big arena
  placeStairs(next);
  decorateRoom(rm, floor);
  rm.state = 'idle';
}

function dungeonConnected() {
  const ex = G.exitRoom;
  const f = distField(Math.floor((ex.x + ex.w / 2) / T), Math.floor((ex.y + ex.h / 2) / T));
  const reach = (x, y) => f[Math.floor(y / T) * G.grid.cols + Math.floor(x / T)] >= 0;
  if (!reach(G.spawn.x, G.spawn.y)) return false;
  for (const rm of G.rooms) {
    let ok = false; // any open tile of the room (decor may cover the centre)
    for (let y = rm.ty; y < rm.ty + rm.th && !ok; y++) for (let x = rm.tx; x < rm.tx + rm.tw && !ok; x++) if (!solidTile(x, y)) ok = f[y * G.grid.cols + x] >= 0;
    if (!ok) return false;
  }
  for (const st of G.stairs) if (!reach(st.x + st.w / 2, st.y + st.h + T / 2)) return false; // stair landing
  return true;
}

// The snapshot holds the run and (outside boss fights) the whole floor: layout, room progress,
// surviving enemies and a safe player position. A fight that was in progress restarts cleanly.
function saveSnapshot() {
  const run = G.run;
  if (!run || !G.room) return;
  Save.data.snapshot = {
    v: 2, floor: run.floor, type: G.room.type, hp: G.player.hp, order: expandOrder(),
    run: { kills: run.kills, shards: run.shards + pendingShards(), dmg: run.dmg, time: run.time, bosses: run.bosses, elites: run.elites,
      hurt: run.hurt, dodges: run.dodges, rerolls: run.rerolls, windUsed: run.windUsed, ship: run.ship, asc: run.asc },
    floorState: G.room.type === 'boss' && G.room.phase !== 'doors' ? null : serializeFloor(), // a boss fight restarts; a beaten boss stays beaten
  };
  Save.save();
}
function pendingShards() { let n = 0; for (const k of G.pickups) if (k.type === 'shard') n += k.value; return n; }

// Floor geometry as plain data (used by saves and by the stair previews of the next floor).
function serializeLayout() {
  if (G.side) return { side: true, stairs: G.stairs.map((st) => ({ ...st })), spawn: G.spawn };
  if (G.circle) return { circle: true, R: G.circle.R, stairs: G.stairs.map((st) => ({ ...st })), spawn: G.spawn };
  const g = G.grid, solid = g.solid.slice();
  for (const rm of G.rooms) for (const gt of rm.gates) for (const i of gt.tiles) solid[i] = 0; // gates saved open
  const active = G.room && G.room.active;
  return {
    cols: g.cols, rows: g.rows, solid: Array.from(solid).join(''),
    rooms: G.rooms.map((rm) => ({ id: rm.id, kind: rm.kind, tx: rm.tx, ty: rm.ty, tw: rm.tw, th: rm.th, layout: rm.layout,
      state: rm.state === 'active' ? 'idle' : rm.state, waves: rm.waves || [], waveIdx: rm === active ? 0 : rm.waveIdx || 0,
      gates: rm.gates.map((gt) => ({ tiles: gt.tiles, horiz: gt.horiz })) })),
    halls: G.halls, pillars: G.pillars, traps: G.traps.map((t) => ({ ...t, hitCycle: -1 })),
    stairs: G.stairs.map((st) => ({ ...st })), arrival: G.arrival, exitId: G.rooms.indexOf(G.exitRoom), spawn: G.spawn,
  };
}

function serializeFloor() {
  const R = G.room, active = R.active;
  const safe = active ? (G.safePos || G.spawn) : { x: G.player.x, y: G.player.y };
  return {
    ...serializeLayout(),
    enemies: G.enemies.filter((e) => !e.dead && e.type !== 'boss' && e.type !== 'fake' && !(active && e.roomId === active.id))
      .map((e) => ({ t: e.type, x: e.x, y: e.y, elite: e.elite, sleep: e.sleep, hp: e.hp / e.maxHp, roomId: e.roomId })),
    phase: R.phase === 'clear' ? 'fight' : R.phase, shrineUsed: !!(G.shrine && G.shrine.used),
    safe, zoneSeed: 0,
  };
}

function restoreFloor(fs) {
  if (fs.side) { buildSideElevator(); G.stairs = fs.stairs.map((st) => ({ ...st })); if (fs.safe) G.spawn.x = fs.safe.x; return; }
  if (fs.circle) { buildBossHall(); G.stairs = fs.stairs.map((st) => ({ ...st })); if (fs.safe) G.spawn = { x: fs.safe.x, y: fs.safe.y }; return; }
  makeGrid(fs.cols, fs.rows);
  for (let i = 0; i < fs.solid.length; i++) G.grid.solid[i] = fs.solid.charCodeAt(i) === 49 ? 1 : 0;
  G.gridVer = 1;
  G.rooms = fs.rooms.map((r) => ({ ...r, ...tileRect(r.tx, r.ty, r.tw, r.th), gates: r.gates.map((gt) => ({ ...gt, locked: false })) }));
  G.halls = fs.halls; G.pillars = fs.pillars; G.traps = fs.traps;
  G.stairs = fs.stairs.map((st) => ({ ...st })); G.arrival = fs.arrival;
  G.exitRoom = G.rooms[fs.exitId] || G.rooms[G.rooms.length - 1];
  const sp = fs.safe || fs.spawn;
  G.spawn = { x: sp.x, y: sp.y };
}

// Pre-build the floor behind every staircase so standing on it can show its full map,
// and climbing it leads to exactly that floor.
const WORLD_KEYS = ['grid', 'W', 'H', 'circle', 'side', 'fields', 'gridVer', 'rooms', 'halls', 'pillars', 'traps', 'stairs', 'exitRoom', 'spawn', 'arrival'];
function makePreviews() {
  const saved = {};
  for (const k of WORLD_KEYS) saved[k] = G[k];
  const next = G.run.floor + 1;
  G.previews = saved.stairs.map((st) => {
    buildFloorGeometry(st.type, next);
    const lay = serializeLayout();
    lay.type = st.type; lay.floor = next;
    return lay;
  });
  for (const k of WORLD_KEYS) G[k] = saved[k];
}

function applyRestoreState(fs) {
  for (const e of fs.enemies) {
    const en = spawnEnemy(e.t, e.x, e.y, e.elite, G.enemies);
    en.sleep = e.sleep; en.hp = Math.max(1, en.maxHp * e.hp); en.roomId = e.roomId; en.spawnIn = 0;
  }
  if (G.shrine && fs.shrineUsed) G.shrine.used = true;
  if (fs.phase === 'doors') { G.room.restorePhase = 'doors'; }
  else if (fs.phase === 'rest') G.room.restorePhase = 'rest';
  G.restored = true;
}

// Snapshot keeps upgrades as a flat list with repeats (id per stack).
function expandOrder() {
  const out = [];
  for (const id of G.run.order) for (let k = 0; k < G.run.upgrades[id]; k++) out.push(id);
  return out;
}

function rollEnemies(budget, pool, n) {
  const weight = (k) => (k === 'grunt' ? Math.max(1, ENEMY[k].w - n * 0.1) : ENEMY[k].w);
  const list = [];
  let guard = 0;
  while (budget > 0 && guard++ < 80) {
    const k = weightedPick(pool, weight);
    list.push(k);
    budget -= ENEMY[k].cost;
  }
  return shuffle(list);
}

function splitWaves(list, nWaves) {
  const weights = nWaves === 1 ? [1] : nWaves === 2 ? [0.42, 0.58] : [0.28, 0.34, 0.38];
  const waves = [];
  let idx = 0;
  for (let w = 0; w < nWaves; w++) {
    const cnt = w === nWaves - 1 ? list.length - idx : Math.max(1, Math.round(list.length * weights[w]));
    waves.push(list.slice(idx, idx + cnt).map((t) => ({ t, elite: false })));
    idx += cnt;
  }
  return waves.filter((w) => w.length);
}

// Distribute the floor's enemy budget: dormant enemies in corridors, waves in every fight room.
function planFloor(n, type) {
  const sc = G.scale;
  const pool = Object.keys(ENEMY).filter((k) => ENEMY[k].minFloor <= n && ENEMY[k].w > 0);
  const rooms = G.rooms.filter((r) => r.state === 'idle');
  let budget = sc.budget * (1 + 0.15 * (rooms.length - 1)) * (type === 'elite' ? 0.75 : 1);

  const hallPool = pool.filter((k) => !['sentinel', 'bomber', 'brood', 'mortar'].includes(k));
  for (const h of G.halls) {
    const len = h.horiz ? h.tw : h.th;
    if (n < 2 || len < 6 || Math.random() < 0.3) continue;
    const cnt = len >= 9 ? randInt(1, 3) : randInt(1, 2);
    for (let k = 0; k < cnt; k++) {
      const t = pick(hallPool), f = (k + 1) / (cnt + 1);
      const x = h.horiz ? h.x + T * 1.5 + (h.w - T * 3) * f : h.x + h.w / 2;
      const y = h.horiz ? h.y + h.h / 2 : h.y + T * 1.5 + (h.h - T * 3) * f;
      const e = spawnEnemy(t, x, y, false, G.enemies);
      e.sleep = true; e.roomId = -1;
      budget -= ENEMY[t].cost;
    }
  }

  const shares = rooms.map((r) => (r.kind === 'exit' ? 1.3 : 1));
  const total = shares.reduce((a, b) => a + b, 0);
  rooms.forEach((rm, i) => {
    const b = Math.max(2, (budget * shares[i]) / total);
    const list = rollEnemies(b, pool, n);
    const nW = rooms.length === 1 ? (n < 3 ? 2 : 3) : rm.kind === 'exit' && n >= 3 ? 3 : 2;
    rm.waves = splitWaves(list, Math.min(nW, list.length));
    rm.waveIdx = 0;
    if (type === 'combat' && rm.kind === 'exit' && ascMod(3)) rm.waves[rm.waves.length - 1].push({ t: pick(pool.filter((k) => k !== 'bomber')), elite: true });
    if (type === 'elite' && rm.kind === 'exit') {
      const elitePool = pool.filter((k) => k !== 'bomber');
      const ne = n < 9 ? 1 : 2;
      for (let k = 0; k < ne; k++) rm.waves[Math.min(rm.waves.length - 1, 1 + k)].push({ t: pick(elitePool), elite: true });
    }
  });
}

function activateRoom(rm) {
  const R = G.room;
  rm.state = 'active';
  R.active = rm;
  R.waveT = 0;
  if (rm.gates.length) { setGates(rm, true); sfx('charge'); addShake(0.12); }
  startNextWave();
}

function clearRoomSection(rm) {
  const R = G.room;
  rm.state = 'clear';
  R.active = null;
  if (rm.gates.length) setGates(rm, false);
  for (const k of G.pickups) k.magnet = true;
  saveSnapshot();
  const more = G.rooms.some((r) => r.state === 'idle');
  if (more) {
    sfx('clear');
    slowmo(0.3, 0.4);
    floatText(G.player.x, G.player.y - 22, 'ROOM CLEAR', '#8dff6a', 13, 1.1);
  }
}

function startNextWave() {
  const R = G.room, rm = R.active;
  R.waveT = 0;
  if (!rm) return;
  const w = rm.waves[rm.waveIdx++];
  if (!w) return;
  for (const s of w) R.queue.push({ t: s.t, elite: s.elite, room: rm });
  sfx('spawn');
}

function aliveCount() {
  let n = 0;
  for (const e of G.enemies) if (!e.dead) n++;
  return n + G.markers.length;
}
function aliveIn(rm) {
  let n = 0;
  for (const e of G.enemies) {
    if (e.dead || e.roomId !== rm.id) continue;
    // an enemy that somehow left its room no longer holds the room hostage: it becomes a wanderer
    if (e.x < rm.x - 4 || e.x > rm.x + rm.w + 4 || e.y < rm.y - 4 || e.y > rm.y + rm.h + 4) { e.roomId = -1; e.sleep = false; continue; }
    n++;
  }
  for (const m of G.markers) if (m.roomId === rm.id) n++;
  return n;
}

function updateRoom(dt) {
  const R = G.room;
  R.t += dt;
  if (R.phase === 'intro') {
    if (R.t > 0.75) {
      if (R.restorePhase === 'doors') { R.phase = 'doors'; unlockStairs(); }
      else if (R.type === 'boss') { R.phase = 'fight'; spawnBoss(G.run.floor); }
      else if (R.type === 'rest') R.phase = G.shrine && G.shrine.used ? 'doors' : 'rest';
      else R.phase = 'fight';
      if (R.type === 'rest' && R.phase === 'doors') unlockStairs();
    }
    return;
  }
  if (R.phase === 'fight') {
    R.queueT -= dt;
    // the spawn cap only counts the room being fought (sleepers/stragglers elsewhere must not stall it)
    const capCount = R.queue.length ? (R.queue[0].room ? aliveIn(R.queue[0].room) : aliveCount()) : 0;
    if (R.queue.length && R.queueT <= 0 && capCount < G.scale.maxAlive) {
      const s = R.queue.shift();
      addMarker(s.t, s.elite, s.room);
      R.queueT = 0.12;
    }
    if (R.type === 'boss') {
      if (!G.boss && aliveCount() === 0 && !R.queue.length) roomCleared();
      return;
    }
    const p = G.player;
    if (!R.active) {
      const rm = roomAt(p.x, p.y, 14);
      if (rm && rm.state === 'idle') activateRoom(rm);
    } else {
      const rm = R.active;
      R.waveT += dt;
      const alive = aliveIn(rm) + R.queue.length;
      if (rm.waveIdx < rm.waves.length && (alive <= R.waveThresh || R.waveT > 11)) startNextWave();
      if (rm.waveIdx >= rm.waves.length && alive === 0) clearRoomSection(rm);
    }
    const roomsDone = !R.active && !R.queue.length && G.rooms.every((r) => r.state !== 'idle' && r.state !== 'active');
    if (roomsDone) {
      // every room is clear: stragglers asleep in corridors wake up and come to you (no hunting for them)
      for (const e of G.enemies) if (!e.dead && e.sleep) { e.sleep = false; floatText(e.x, e.y - e.r - 6, '!', '#ffffff', 14, 0.6); }
      if (aliveCount() === 0) roomCleared();
    }
    return;
  }
  if (R.phase === 'clear') {
    if (R.t > 1.0 && !R.rewardShown) { R.rewardShown = true; giveReward(); }
    return;
  }
  if (R.phase === 'rest') {
    const s = G.shrine, p = G.player;
    s.t += dt;
    if (!s.used && dist2(s.x, s.y, p.x, p.y) < 26 * 26) {
      s.used = true;
      sfx('select');
      openRestChoice();
    }
    return;
  }
  updateStairs();
}

// Standing on (or against) a staircase shows what is up there; reaching its top climbs.
function updateStairs() {
  const p = G.player;
  let near = null;
  for (const st of G.stairs) {
    if (p.x > st.x - 4 && p.x < st.x + st.w + 4 && p.y > st.y - 4 && p.y < st.y + st.h + 24) { near = st; break; }
  }
  if (near !== G.stairOn) { G.stairOn = near; UI.stairInfo(near); }
  if (near && !near.locked && G.room.phase === 'doors' && p.y - p.r < near.y + 10) startClimb(near);
}

// Where the guide arrow should point (next room, a straggler, or the doors).
function guideTarget() {
  const R = G.room;
  if (!R) return null;
  if (R.phase === 'doors' && G.stairOn && !G.stairOn.locked) return null; // already on the stairs
  if (R.phase === 'doors' && G.side && G.stairs.length) { const d = G.stairOn || G.stairs[0]; return { x: d.dir < 0 ? G.side.L + 4 : G.side.R - 4, y: G.player.y }; }
  if (R.phase === 'doors' && G.stairs.length) { const d = G.stairOn || G.stairs[0]; return { x: d.x + d.w / 2, y: d.y + d.h + 16 }; }
  if (R.phase !== 'fight' || R.active || R.type === 'boss') return null;
  const next = G.rooms.find((r) => r.state === 'idle');
  if (next) return { x: next.x + next.w / 2, y: next.y + next.h / 2 };
  // a straggler somewhere: stick to one until it dies (no flipping between enemies),
  // hide the arrow once it is close (with hysteresis so it does not blink)
  const p = G.player;
  let e = G.guideEnemy;
  if (!e || e.dead || G.enemies.indexOf(e) === -1) {
    e = null; let bd = Infinity;
    for (const x of G.enemies) { if (x.dead) continue; const d = dist2(x.x, x.y, p.x, p.y); if (d < bd) { bd = d; e = x; } }
    G.guideEnemy = e;
  }
  if (!e) return null;
  const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
  G.guideFar = d > (G.guideFar ? 150 : 220);
  return G.guideFar ? { x: e.x, y: e.y } : null;
}

function roomCleared() {
  const R = G.room;
  R.phase = 'clear'; R.t = 0;
  sfx('clear');
  if (R.type !== 'boss') slowmo(0.45, 0.35);
  for (const k of G.pickups) k.magnet = true;
  clearEnemyBullets(true);
  if (G.stats.regen > 0) healPlayer(G.stats.regen);
  if (G.tutorial) { Save.data.settings.tutorialDone = true; Save.save(); G.tutorial = 0; }
}

function giveReward() {
  const type = G.room.type;
  if (type === 'boss') healPlayer(Math.ceil(G.stats.maxHp / 2) + (Save.metaLvl('medic') | 0));
  openUpgradeChoice(type === 'boss' ? 'boss' : type === 'elite' ? 'elite' : 'normal');
}

// ---------- upgrade choice ----------
function rollChoices(kind) {
  const run = G.run;
  const odds = kind === 'boss' ? [0, 50, 50] : kind === 'elite' ? [20, 55, 25] : [64 - Math.min(14, run.floor), 29 + Math.min(10, run.floor * 0.7), 7 + Math.min(6, run.floor * 0.3)];
  const luck = Save.metaLvl('luck') | 0; // Workshop "Lucky Draw": shifts weight from common to rare/epic
  if (luck) { const shift = Math.min(odds[0], 6 * luck); odds[0] -= shift; odds[1] += shift / 2; odds[2] += shift / 2; }
  const ownedTags = {};
  for (const id in run.upgrades) ownedTags[UPG[id].tag] = (ownedTags[UPG[id].tag] || 0) + run.upgrades[id];
  const avail = UPGRADES.filter((u) => (run.upgrades[u.id] || 0) < u.max && Save.isUnlocked(u.id) && (!u.req || G.stats[u.req] > 0));
  const out = [];
  const count = 3 + (Save.metaLvl('choice') | 0);
  for (let i = 0; i < count; i++) {
    let r = weightedPick([0, 1, 2], (x) => odds[x]);
    let cands = [];
    for (let tries = 0; tries < 3 && !cands.length; tries++) {
      cands = avail.filter((u) => u.rarity === r && out.indexOf(u) === -1);
      if (!cands.length) r = (r + 2) % 3;
    }
    if (!cands.length) cands = avail.filter((u) => out.indexOf(u) === -1);
    if (!cands.length) break;
    const u = weightedPick(cands, (c) => 1 + Math.min(2, (ownedTags[c.tag] || 0) * 0.35) + (run.upgrades[c.id] ? 0.4 : 0));
    out.push(u);
  }
  return out;
}

function openUpgradeChoice(kind) {
  G.state = 'reward';
  G.rewardKind = kind;
  const choices = rollChoices(kind);
  if (!choices.length) { G.run.shards += 10; afterReward(); return; }
  UI.showUpgrade(choices, kind);
}

function chooseUpgrade(id) {
  if (id === '__heal') healPlayer(restHealAmount());
  else if (id === '__train') { const c = rollChoices('normal'); if (c.length) { addUpgrade(c[0].id); floatText(G.player.x, G.player.y - 20, c[0].name, '#ffffff', 12, 1.4); } }
  else if (id === '__skip') { G.run.shards += 8; }
  else addUpgrade(id);
  sfx('upgrade');
  const p = G.player;
  ring(p.x, p.y, 6, 60, 0.4, COL.player, 3);
  burst(p.x, p.y, COL.player, 16, 160, 0.5, 3);
  afterReward();
}

function rerollChoices() {
  if (G.run.rerolls <= 0) return;
  G.run.rerolls--;
  sfx('select');
  UI.showUpgrade(rollChoices(G.rewardKind), G.rewardKind);
}

function restHealAmount() { return Math.max(2, Math.ceil(G.stats.maxHp * 0.5)) + (Save.metaLvl('medic') | 0); }

function openRestChoice() {
  G.state = 'reward';
  G.rewardKind = 'rest';
  UI.showRest();
}

function afterReward() {
  G.state = 'play';
  Input.reset();
  G.room.phase = 'doors'; G.room.t = 0;
  unlockStairs();
  sfx('door');
  floatText(G.player.x, G.player.y - 24, 'STAIRS OPEN', '#8dff6a', 13, 1.2);
  saveSnapshot();
  G.hudDirty = true;
}

// Walk up the stairs: the player keeps moving up while the view darkens, then arrives on the next floor.
function startClimb(st) {
  if (G.state !== 'play') return;
  sfx('door');
  G.state = 'climb';
  G.climb = { st, t: 0 };
  Input.reset();
  UI.stairInfo(null);
}
function updateClimb(dt) {
  const c = G.climb, p = G.player;
  c.t += dt;
  if (c.st.side) { p.x += c.st.dir * 80 * dt; p.vx = c.st.dir * 80; p.vy = 0; } // out through the side door
  else {
    p.x += (c.st.x + c.st.w / 2 - p.x) * Math.min(1, dt * 8);
    p.y -= 70 * dt;
    p.face = -Math.PI / 2; p.vx = 0; p.vy = -70;
  }
  G.fade = clamp((c.t - 0.2) / 0.45, 0, 1);
  if (c.t > 0.7) {
    const idx = G.stairs.indexOf(c.st), lay = G.previews && G.previews[idx];
    G.climb = null; enterFloor(G.run.floor + 1, c.st.type, null, lay && lay.type === c.st.type ? lay : null); G.arriveT = 0.55; G.fade = 1;
  }
}
function goThroughDoor(st) { startClimb(st); } // kept for tests/debug

// ---------- death ----------
function playerDie() {
  const p = G.player;
  p.alive = false;
  G.state = 'dying'; G.dyingT = 0;
  sfx('death');
  slowmo(1.2, 0.3);
  hitstop(0.15);
  addShake(1);
  burst(p.x, p.y, COL.player, 40, 260, 1.0, 4);
  burst(p.x, p.y, '#ffffff', 16, 180, 0.6, 3);
  ring(p.x, p.y, 4, 120, 0.7, COL.player, 5);
  Sound.music(false);
}

function finalizeRun(abandon) {
  const run = G.run, S = Save.data;
  const salv = (1 + 0.15 * (S.meta.salvage | 0)) * (1 + 0.15 * (run.asc | 0));
  const floorBonus = run.floor * 2;
  // quitting a run on floors 1-3 pays nothing (prevents farming quick restarts)
  const noPay = !!abandon && run.floor <= 3;
  const earned = noPay ? 0 : Math.round((run.shards + floorBonus) * salv);
  const prevBest = S.best.floor;
  const record = run.floor > prevBest;
  S.shards += earned;
  S.lifetimeShards += earned;
  S.runs++;
  S.totals.kills += run.kills;
  S.totals.bosses += run.bosses;
  S.totals.floors += run.floor;
  S.totals.time += run.time;
  if (record) S.best.floor = run.floor;
  if (run.kills > S.best.kills) S.best.kills = run.kills;
  S.asc.best[run.asc | 0] = Math.max(S.asc.best[run.asc | 0] | 0, run.floor);
  checkChallenges('end');
  S.history.unshift({ floor: run.floor, kills: run.kills, time: Math.round(run.time), build: topBuild(), date: Date.now() });
  S.history = S.history.slice(0, 8);
  S.snapshot = null;
  Save.save();
  return { floor: run.floor, kills: run.kills, time: run.time, dmg: run.dmg, bosses: run.bosses, dodges: run.dodges,
    earned, floorBonus, record, prevBest, asc: run.asc | 0, abandon: !!abandon, noPay, order: run.order.slice(), upgrades: Object.assign({}, run.upgrades) };
}

function topBuild() {
  const tags = {};
  for (const id in G.run.upgrades) tags[UPG[id].tag] = (tags[UPG[id].tag] || 0) + G.run.upgrades[id];
  const best = Object.keys(tags).sort((a, b) => tags[b] - tags[a])[0];
  return best || 'core';
}

function abandonRun() {
  const res = finalizeRun(true);
  G.state = 'dead';
  Sound.music(false);
  UI.showDeath(res);
}

// ---------- main simulation step ----------
function step(dt) {
  G.time += dt;
  if (G.state === 'climb') { updateClimb(dt); updatePickups(dt); updateFx(dt); return; }
  if (G.side) { stepSide(dt); updateFx(dt); return; } // elevator boss: side view
  if (G.state === 'play' || G.state === 'dying') {
    G.run.time += G.state === 'play' ? dt : 0;
    if (G.arriveT > 0) { // stepping off the arrival stairs
      const p = G.player;
      G.arriveT -= dt; p.y -= 75 * dt; p.vx = 0; p.vy = -75; p.face = -Math.PI / 2;
      collideWorld(p, p.r);
      G.fade = clamp(G.arriveT * 2.2, 0, 1);
      Input.consumeDash();
    } else if (G.state === 'play') updatePlayer(dt);
    updateTraps(dt);
    if (G.player.alive) { // safe = corridor or an already cleared room (never a room that is or will be fought)
      const here = roomAt(G.player.x, G.player.y, -2);
      if (!here || here.state === 'clear') G.safePos = { x: G.player.x, y: G.player.y };
    }
    updateMarkers(dt);
    updateEnemies(dt);
    if (G.newEnemies.length) { for (const e of G.newEnemies) G.enemies.push(e); G.newEnemies.length = 0; }
    updateBeams(dt);
    updateShells(dt);
    updateBossHazards(dt);
    updatePlayerBullets(dt);
    updateEnemyBullets(dt);
    processExplosions();
    if (G.newEnemies.length) { for (const e of G.newEnemies) G.enemies.push(e); G.newEnemies.length = 0; }
    for (let i = G.enemies.length - 1; i >= 0; i--) if (G.enemies[i].dead) swapRemove(G.enemies, i);
    if (G.state === 'play') { updatePickups(dt); updateRoom(dt); }
    if (G.tutorial) G.tutorial += dt;
    if (G.state === 'dying') {
      G.dyingT += dt;
      if (G.dyingT > 0.5) {
        G.state = 'dead';
        UI.showDeath(finalizeRun(false));
      }
    }
  }
  updateFx(dt);
}

// Debug/test helper: finish every room of the current floor at once.
function debugClearFloor() {
  const R = G.room;
  R.queue.length = 0; G.markers.length = 0;
  for (const e of G.enemies) if (!e.dead) killEnemy(e);
  for (const rm of G.rooms) { if (rm.gates.length) setGates(rm, false); rm.state = 'clear'; rm.waveIdx = (rm.waves || []).length; }
  R.active = null;
  if (R.phase === 'intro') R.phase = 'fight';
}

// ---------- spike traps (only armed while their room is being fought) ----------
function trapState(tr) {
  const cyc = TRAP_CYCLE.idle + TRAP_CYCLE.warn + TRAP_CYCLE.active;
  const t = (G.time + tr.off) % cyc;
  return { cycle: Math.floor((G.time + tr.off) / cyc), s: t < TRAP_CYCLE.idle ? 0 : t < TRAP_CYCLE.idle + TRAP_CYCLE.warn ? 1 : 2, k: t };
}
function trapArmed(tr) { const rm = G.rooms[tr.roomId]; return !!rm && rm.state === 'active'; }
function updateTraps() {
  if (!G.traps.length) return;
  const p = G.player;
  for (const tr of G.traps) {
    if (!trapArmed(tr)) continue;
    const st = trapState(tr);
    if (st.s !== 2) continue;
    if (p.alive && pointInRect(p.x, p.y, tr, 2)) hurtPlayer(tr.x + tr.w / 2, tr.y + tr.h / 2);
    if (tr.hitCycle !== st.cycle) {
      tr.hitCycle = st.cycle;
      for (const e of G.enemies) if (!e.dead && e.type !== 'boss' && pointInRect(e.x, e.y, tr, e.r * 0.5)) damageEnemy(e, 22 * G.scale.hp, false, 0, 0, true);
      sfx('fuse');
    }
  }
}

// ---------- challenges ----------
function challengeDone(id) { return !!Save.data.challenges[id]; }
function checkChallenges(evt, info) {
  const S = Save.data, run = G.run;
  if (!run) return;
  const done = [];
  const hit = (id, cond) => { if (cond && !challengeDone(id)) done.push(id); };
  hit('f5', run.floor >= 5);
  hit('f20', run.floor >= 20);
  hit('f30', run.floor >= 30);
  hit('speed10', evt === 'floor' && run.floor >= 10 && run.time < 480);
  hit('build12', run.order.length >= 12);
  hit('hoard', run.shards >= 200);
  hit('dodge25', run.dodges >= 25);
  hit('elite20', run.elites >= 20);
  hit('kills1k', S.totals.kills + (evt === 'end' ? 0 : run.kills) >= 1000);
  hit('ships', SHIPS.every((sh) => S.ships.includes(sh.id)));
  if (evt === 'boss') {
    hit('warden', info.kind === 'warden');
    hit('loom', info.kind === 'loom');
    hit('mirror', info.kind === 'mirror');
    hit('counter', info.kind === 'elevator');
    hit('orrery', info.kind === 'orrery');
    hit('forge', info.kind === 'forge');
    hit('nohit', info.noHit);
    hit('asc3', info.kind === 'mirror' && (run.asc | 0) >= 3);
    hit('asc10', info.kind === 'mirror' && (run.asc | 0) >= 10);
  }
  for (const id of done) grantChallenge(id);
}
function grantChallenge(id) {
  const S = Save.data, c = CHALLENGES.find((x) => x.id === id);
  if (!c || S.challenges[id]) return;
  S.challenges[id] = Date.now();
  let reward = '';
  if (c.reward.shards) { S.shards += c.reward.shards; reward = '+' + c.reward.shards + ' shards'; }
  if (c.reward.ship && !S.ships.includes(c.reward.ship)) { S.ships.push(c.reward.ship); reward = 'New ship: ' + SHIP[c.reward.ship].name; }
  Save.save();
  UI.toast('CHALLENGE · ' + c.name.toUpperCase(), reward);
  sfx('record');
  if (id !== 'ships') checkChallenges('meta');
}
