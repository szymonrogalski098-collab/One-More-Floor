'use strict';
// Special-room bosses (like the Counterweight's elevator, each changes the rules of the fight):
//  - The Polarity (25): your dash becomes a colour swap. Bullets of your colour are absorbed and charge
//    a beam, the other colour hurts. Your guns cannot hurt it; only full charges do.
//  - The Warden of Keys (35): a dark labyrinth with a hunter you cannot shoot. Light 4 seals; it hears dashes.
//  - The Collapse (40): an auto-scrolling bridge whose plates crack under you, then the giant on a wide plaza.
//  - The Puppeteer (45): fans of strings that seal your upgrades, slow you and can be yanked, until you
//    pull away to cut them.
// Plus the shared pressure tools for late bosses: sealed upgrades, slows and shield-piercing hits.

// ================= sealed upgrades & slows =================
function sealUpgrade(id, secs) {
  const run = G.run;
  if (!run || !id || !run.upgrades[id]) return false;
  run.sealed = run.sealed || {};
  run.sealed[id] = secs == null ? Infinity : Math.max(run.sealed[id] || 0, secs);
  computeStats();
  if (id === 'aegis') G.player.shield = 0; // a sealed Aegis drops the charge it was holding
  floatText(G.player.x, G.player.y - 30, UPG[id].name.toUpperCase() + ' SEALED', '#c38bff', 11, 1.2);
  sfx('shield');
  return true;
}
function unsealUpgrade(id) {
  const run = G.run;
  if (!run || !run.sealed || !(id in run.sealed)) return;
  delete run.sealed[id];
  computeStats();
}
function isSealed(id) { return !!(G.run && G.run.sealed && G.run.sealed[id]); }
function updateSeals(dt) {
  const s = G.run && G.run.sealed;
  if (!s) return;
  for (const id in s) { if (s[id] === Infinity) continue; s[id] -= dt; if (s[id] <= 0) { delete s[id]; computeStats(); } }
}
// a random owned upgrade that is not sealed yet (the shield first when you have one)
function pickSealTarget(preferShield) {
  const run = G.run, owned = run.order.filter((id) => !isSealed(id));
  if (!owned.length) return null;
  if (preferShield && owned.includes('aegis')) return 'aegis';
  return pick(owned);
}
// Movement multiplier from everything that slows you right now.
function playerSlow() {
  let k = 1;
  const p = G.player;
  if (G.threads) k *= Math.pow(0.85, G.threads.length);
  for (const pl of G.pools) if (pl.t > 0.2 && dist2(pl.x, pl.y, p.x, p.y) < pl.r * pl.r) { k *= 0.65; break; }
  for (const w of G.wells || []) if (w.t > w.warn && dist2(w.x, w.y, p.x, p.y) < w.r * w.r) { k *= 0.7; break; }
  return k;
}
// bosses from floor 30 on seal one of your upgrades now and then
function updateBossSeal(b, dt) {
  if (G.run.floor < 30 || b.kind === 'puppeteer' || b.enter > 0) return;
  b.sealT = (b.sealT == null ? 8 : b.sealT) - dt;
  if (b.sealT <= 0) { b.sealT = b.hard ? 10 : 13; const id = pickSealTarget(false); if (id) { sealUpgrade(id, 5); ring(b.x, b.y, b.r, b.r * 3, 0.4, '#c38bff', 3); } }
}
function updateWells(dt) {
  if (!G.wells) return;
  for (let i = G.wells.length - 1; i >= 0; i--) { const w = G.wells[i]; w.t += dt; if (w.t > w.warn + w.life) G.wells.splice(i, 1); }
}

// ================= THE POLARITY =================
const POL_COL = ['#4d8cff', '#ff4f6b'];
function polarityActive() { return !!(G.boss && !G.boss.dead && G.boss.kind === 'polarity'); }
function polaritySwap() {
  const p = G.player;
  if (G.time - (p.polT || -9) < 0.15) return; // no machine-gun swapping
  p.polT = G.time;
  p.pol = p.pol ? 0 : 1;
  ring(p.x, p.y, 4, 22, 0.2, POL_COL[p.pol], 2);
  sfx('select');
}
// a bullet of your colour is absorbed: it charges the beam
function polarityAbsorb(bl) {
  const p = G.player, b = G.boss;
  b.charge2 = (b.charge2 || 0) + 1;
  part(bl.x, bl.y, (p.x - bl.x) * 3, (p.y - bl.y) * 3, 0.2, 3, POL_COL[p.pol], 4);
  if (Math.random() < 0.3) sfx('pickup');
  if (b.charge2 >= polarityNeed(b)) polarityBeam(b);
}
function polarityNeed(b) { return b.hard ? 30 : 26; }
function polarityBeam(b) {
  const p = G.player;
  b.charge2 = 0;
  G.polBeam = { x1: p.x, y1: p.y, x2: b.x, y2: b.y, t: 0, col: POL_COL[p.pol] };
  G._polBeam = true;
  damageEnemy(b, b.maxHp / 6 + 1, true, 0, 0, false);
  G._polBeam = false;
  addShake(0.5); hitstop(0.08); sfx('laser');
  burst(b.x, b.y, '#ffffff', 20, 220, 0.5, 4);
}
BOSS_AI.polarity = function (b, dt, hard, sm) {
  const p = G.player;
  if (p.pol == null) p.pol = 0;
  b.zones = b.zones || [];
  updatePolarityZones(b, dt);
  if (!b.pat) {
    bossDrift(b, dt, 50 * sm);
    b.atk -= dt;
    if (b.atk <= 0) { b.atk = hard ? 0.55 : 0.75; const c = (b.flip = !b.flip) ? 1 : 0; fireEB(b.x, b.y, angToPlayer(b) + rand(-0.15, 0.15), 150, { color: POL_COL[c], pol: c, r: 6 }); sfx('eshoot'); }
    b.cool -= dt;
    if (b.cool <= 0) startPattern(b, hard ? ['wave', 'zebra', 'floor', 'spiral', 'cross'] : ['wave', 'zebra', 'floor', 'spiral']);
    return;
  }
  b.pt += dt;
  if (b.pat === 'wave') {
    // rings in coloured sectors: turn so the sector coming at you is your colour
    brake(b, dt, 6);
    b.st -= dt;
    const waves = hard ? 4 : 3;
    if (b.st <= 0 && b.step < waves) {
      b.st = 0.75; b.step++;
      const n = 24, off = Math.random() * TAU, grp = hard ? 3 : 4;
      for (let k = 0; k < n; k++) { const c = Math.floor(k / grp) % 2; fireEB(b.x, b.y, off + (k * TAU) / n, 105, { color: POL_COL[c], pol: c, r: 6 }); }
      sfx('eshoot');
    }
    if (b.step >= waves && b.st <= 0) endPattern(b, 1.0);
  } else if (b.pat === 'zebra') {
    // colours alternate every bullet: swapping cannot keep up, step out of the line
    brake(b, dt, 8);
    if (b.pt < 0.5) { b.charge = b.pt / 0.5; b.ang = angToPlayer(b); return; }
    b.charge = 0;
    b.st -= dt;
    const n = hard ? 22 : 16;
    if (b.st <= 0 && b.step < n) {
      b.st = 0.085; b.step++;
      b.ang += angleDiff(b.ang, angToPlayer(b)) * 0.12;
      const c = b.step % 2;
      fireEB(b.x, b.y, b.ang, 175, { color: POL_COL[c], pol: c, r: 6 });
      sfx('eshoot');
    }
    if (b.step >= n && b.pt > 2.4) endPattern(b, 1.0);
  } else if (b.pat === 'floor') {
    // the floor takes a colour: like the bullets, only the other colour burns (swap to match the zone)
    brake(b, dt, 6);
    if (b.step === 0) {
      b.step = 1;
      const n = hard ? 4 : 3;
      for (let k = 0; k < n; k++) {
        const t = k === 0 ? { x: p.x, y: p.y } : clampInArena(p.x + rand(-110, 110), p.y + rand(-110, 110), 30);
        b.zones.push({ x: t.x, y: t.y, r: 58, pol: k === 0 ? 1 - p.pol : (Math.random() < 0.5 ? 0 : 1), t: -k * 0.35, warn: 1.15, life: 0.6 });
      }
      sfx('charge');
    }
    if (b.pt > 2.8) endPattern(b, 0.9);
  } else if (b.pat === 'spiral') {
    brake(b, dt, 6);
    if (b.step === 0) { b.step = 1; b.spinA = Math.random() * TAU; b.spinDir = chance(0.5) ? 1 : -1; }
    b.st -= dt;
    while (b.st <= 0) {
      b.st += hard ? 0.08 : 0.1;
      for (let c = 0; c < 2; c++) fireEB(b.x, b.y, b.spinA + c * Math.PI, 115, { color: POL_COL[c], pol: c, r: 6 });
      b.spinA += 0.23 * b.spinDir;
    }
    if (b.pt > 3.6) endPattern(b, 1.0);
  } else if (b.pat === 'cross') {
    // two streams from opposite walls in opposite colours
    brake(b, dt, 6);
    b.st -= dt;
    if (b.st <= 0 && b.pt < 3) {
      b.st = 0.16;
      const c = arenaCenter();
      for (let s = 0; s < 2; s++) {
        const a = b.pt * 0.9 + s * Math.PI, e = rayToEdge(c.x, c.y, Math.cos(a), Math.sin(a), 8);
        fireEB(e.x, e.y, Math.atan2(p.y - e.y, p.x - e.x), 140, { color: POL_COL[s], pol: s, r: 6 });
      }
    }
    if (b.pt > 3.4) endPattern(b, 1.0);
  }
};
function updatePolarityZones(b, dt) {
  const p = G.player;
  for (let i = b.zones.length - 1; i >= 0; i--) {
    const z = b.zones[i];
    z.t += dt;
    if (z.t >= z.warn && !z.done) {
      z.done = true;
      ring(z.x, z.y, 6, z.r, 0.3, POL_COL[z.pol], 3);
      if (p.alive && p.pol !== z.pol && dist2(z.x, z.y, p.x, p.y) < (z.r + PLAYER_HITBOX) ** 2) hurtPlayer(z.x, z.y, true, true);
      sfx('explode');
    }
    if (z.t > z.warn + z.life) b.zones.splice(i, 1);
  }
}

// ================= THE WARDEN OF KEYS (labyrinth) =================
const MAZE = { cell: 3 }; // a cell is 2 open tiles + 1 wall tile
function buildLabyrinth() {
  const { VW, VH } = viewDims(), portrait = VH > VW;
  const cx = portrait ? 9 : 13, cy = portrait ? 12 : 8, ox = 0, oy = 4;
  const cols = cx * 3 + 1, rows = oy + cy * 3 + 1 + 3;
  makeGrid(cols, rows);
  const cellT = (i, j) => [ox + 1 + i * 3, oy + 1 + j * 3];
  const open = (i, j) => { const [x, y] = cellT(i, j); carve(x, y, 2, 2); };
  const link = (i, j, i2, j2) => { const [x, y] = cellT(i, j); if (i2 > i) carve(x + 2, y, 1, 2); else if (i2 < i) carve(x - 1, y, 1, 2); else if (j2 > j) carve(x, y + 2, 2, 1); else carve(x, y - 1, 2, 1); };
  // depth-first maze, then some extra openings so there is always a way around the hunter
  const seen = new Uint8Array(cx * cy), stack = [[randInt(0, cx - 1), cy - 1]];
  seen[stack[0][1] * cx + stack[0][0]] = 1; open(...stack[0]);
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]).map(([a, b2]) => [i + a, j + b2]).filter(([a, b2]) => a >= 0 && b2 >= 0 && a < cx && b2 < cy && !seen[b2 * cx + a]);
    if (!nb.length) { stack.pop(); continue; }
    const [a, b2] = nb[0];
    seen[b2 * cx + a] = 1; open(a, b2); link(i, j, a, b2); stack.push([a, b2]);
  }
  const doors = []; // internal walls between two cells: candidates for shifting
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const [x, y] = cellT(i, j);
    if (i < cx - 1) doors.push({ tiles: [[x + 2, y], [x + 2, y + 1]] });
    if (j < cy - 1) doors.push({ tiles: [[x, y + 2], [x + 1, y + 2]] });
  }
  for (const d of doors) if (Math.random() < 0.12) for (const [x, y] of d.tiles) carve(x, y, 1, 1);
  // plazas: the arrival at the bottom, the exit (stairs) at the top
  const mid = Math.floor(cx / 2);
  const [tx0] = cellT(mid - 1, 0), [, tyTop] = cellT(0, 0), [, tyBot] = cellT(0, cy - 1);
  carve(tx0, tyTop, 8, 2); carve(tx0, tyBot, 8, 2);
  const start = { id: 0, kind: 'start', state: 'clear', gates: [], ...tileRect(tx0, tyBot, 8, 2) };
  const exit = { id: 1, kind: 'exit', state: 'clear', gates: [], ...tileRect(tx0, tyTop, 8, 2) };
  G.rooms = [start, exit]; G.halls = []; G.pillars = []; G.traps = [];
  G.exitRoom = exit;
  placeArrival(start);
  const corner = (i, j) => { const [x, y] = cellT(i, j); return { x: (x + 1) * T, y: (y + 1) * T, lit: false, t: 0 }; };
  G.maze = { cx, cy, doors: doors.filter((d) => d.tiles.every(([x, y]) => solidTile(x, y))), seals: [corner(0, 0), corner(cx - 1, 0), corner(0, cy - 1), corner(cx - 1, cy - 1)], shiftT: 15, shifting: null };
  G.gridVer = 1;
}
// a saved labyrinth (stair preview or save & quit): the fight starts over with dark seals
function restoreMaze(m) {
  G.maze = JSON.parse(JSON.stringify(m));
  for (const s of G.maze.seals) { s.lit = false; s.t = 0; }
  G.maze.shiftT = 15; G.maze.shifting = null;
}
// every 15 s a few walls move (they blink first); the maze always stays connected
function mazeShift(dt) {
  const M = G.maze;
  M.shiftT -= dt;
  if (M.shifting) {
    M.shifting.t += dt;
    if (M.shifting.t >= 1.5) {
      const { open: op, close: cl } = M.shifting;
      const busy = (d) => d.tiles.some(([x, y]) => pointInRect(G.player.x, G.player.y, tileRect(x, y, 1, 1), 12) || (G.boss && pointInRect(G.boss.x, G.boss.y, tileRect(x, y, 1, 1), G.boss.r + 4)));
      const closeNow = cl.filter((d) => !busy(d));
      for (const d of op) for (const [x, y] of d.tiles) carve(x, y, 1, 1);
      for (const d of closeNow) for (const [x, y] of d.tiles) fillSolid(x, y, 1, 1);
      G.gridVer++; G.fields.clear();
      if (!mazeConnected()) { for (const d of closeNow) for (const [x, y] of d.tiles) carve(x, y, 1, 1); G.gridVer++; G.fields.clear(); }
      M.closed = (M.closed || []).filter((d) => !op.includes(d)).concat(closeNow);
      M.shifting = null; addShake(0.2); sfx('slam'); Render.buildFloor();
    }
    return;
  }
  if (M.shiftT > 0) return;
  M.shiftT = 15;
  const closed = M.doors.filter((d) => d.tiles.every(([x, y]) => solidTile(x, y)));
  const openD = M.doors.filter((d) => d.tiles.every(([x, y]) => !solidTile(x, y)));
  M.shifting = { t: 0, open: shuffle(closed).slice(0, 3), close: shuffle(openD).slice(0, 3) };
}
function mazeConnected() {
  const p = G.player, f = distField(Math.floor(p.x / T), Math.floor(p.y / T));
  const ok = (x, y) => f[Math.floor(y / T) * G.grid.cols + Math.floor(x / T)] >= 0;
  return G.maze.seals.every((s) => ok(s.x, s.y)) && ok(G.exitRoom.x + G.exitRoom.w / 2, G.exitRoom.y + 10);
}
function keysActive() { return !!(G.maze && G.boss && !G.boss.dead && G.boss.kind === 'keys'); }
function updateMaze(dt) {
  if (!keysActive()) return;
  const M = G.maze, p = G.player, b = G.boss;
  mazeShift(dt);
  for (const s of M.seals) {
    if (s.lit) continue;
    if (p.alive && dist2(s.x, s.y, p.x, p.y) < 26 * 26) {
      s.t += dt;
      if (s.t >= 2) {
        s.lit = true; b.alertT = 3; b.alertX = s.x; b.alertY = s.y;
        ring(s.x, s.y, 6, 60, 0.5, COL.keys, 4); sfx('upgrade'); addShake(0.2);
        const lit = M.seals.filter((x) => x.lit).length;
        b.hp = b.maxHp * (4 - lit) / 4;
        if (lit >= 4) {
          if (G.training) { for (const x of M.seals) { x.lit = false; x.t = 0; } b.hp = b.maxHp; }
          else { showBanner('THE CEILING FALLS', 'The hunter is buried', 'boss'); b.hp = 0; b.invuln = false; b.untarget = false; killEnemy(b); }
        }
      }
    } else s.t = Math.max(0, s.t - dt * 0.5);
  }
}
BOSS_AI.keys = function (b, dt, hard, sm) {
  const p = G.player, s = G.stats;
  b.invuln = true; b.untarget = true; b.air = true; // its own contact check below (not the generic one)
  b.alertT = Math.max(0, (b.alertT || 0) - dt);
  if (p.dashT > 0 && !b.heard) { b.heard = true; b.alertT = Math.max(b.alertT, 2); b.alertX = p.x; b.alertY = p.y; ring(p.x, p.y, 8, 70, 0.4, COL.keys, 2); }
  if (p.dashT <= 0) b.heard = false;
  if (b.stunT > 0) { b.stunT -= dt; brake(b, dt, 8); return; }
  const los = hasLOS(b.x, b.y, p.x, p.y), d = Math.sqrt(dist2(b.x, b.y, p.x, p.y));
  let tx, ty, speed;
  if (b.alertT > 0) { tx = p.x; ty = p.y; speed = s.move * 1.2; }            // it heard you: straight for you
  else if (los && d < 170) { tx = p.x; ty = p.y; speed = s.move * 1.1; }     // sees you
  else {                                                                      // patrols the maze
    if (!b.wander || dist2(b.x, b.y, b.wander.x, b.wander.y) < 20 * 20 || b.wanderT <= 0) { b.wander = freeSpot(0, 12); b.wanderT = 6; }
    b.wanderT -= dt; tx = b.wander.x; ty = b.wander.y; speed = s.move * 0.6;
  }
  const w = routeTo(b.x, b.y, b.r, tx, ty);
  if (w) speed *= 0.72; // slower around corners, fast on a straight line
  steer(b, w ? w.x : tx, w ? w.y : ty, speed * (hard ? 1.08 : 1), dt, 6);
  b.face = Math.atan2(b.vy, b.vx);
  // contact: shields do not help against it
  const rr = b.r + PLAYER_HITBOX + 2;
  if (p.alive && d < rr) { if (hurtPlayer(b.x, b.y, true, true)) { b.stunT = 1.5; b.alertT = 0; b.vx = -b.vx; b.vy = -b.vy; } }
};

// ================= THE COLLAPSE (bridge) =================
// An auto-scrolling bridge (3 lanes of plates that crack under you) leads to a wide stone plaza where the
// giant waits. The fight itself happens on the plaza: solid ground, room to move.
const BR = { lanes: 3, pw: 3, ph: 2 }; // a plate is 3x2 tiles
function buildBridge() {
  const { VW, VH } = viewDims();
  const pwT = Math.max(20, Math.min(30, Math.round(VW / T) - 2)), phT = VH > VW ? 20 : 16; // plaza size in tiles
  const cols = pwT + 10, bw = BR.lanes * BR.pw, bx = Math.floor((cols - bw) / 2);
  const plateRows = 56, startRows = 3, pTop = 3;
  const y0 = pTop + phT; // top of the bridge = bottom of the plaza
  const rows = y0 + (plateRows + startRows) * BR.ph + 3;
  makeGrid(cols, rows);
  const px = Math.floor((cols - pwT) / 2);
  carve(px, pTop, pwT, phT);
  carve(bx, y0, bw, (plateRows + startRows) * BR.ph);
  const exit = { id: 1, kind: 'exit', state: 'clear', gates: [], sideStairs: true, ...tileRect(px, pTop, pwT, phT) };
  const start = { id: 0, kind: 'start', state: 'clear', gates: [], ...tileRect(bx, y0 + plateRows * BR.ph, bw, startRows * BR.ph) };
  G.rooms = [start, exit]; G.halls = []; G.pillars = []; G.traps = [];
  G.exitRoom = exit;
  placeArrival(start);
  // plates: row 0 touches the plaza, the last rows are the start
  const total = plateRows + startRows, plates = [];
  for (let r = 0; r < total; r++) {
    const row = [];
    const stable = r >= plateRows;
    for (let l = 0; l < BR.lanes; l++) row.push({ s: stable ? 's' : 'ok', t: 0, safe: 0 }); // s = stable, ok, crack, gone
    if (!stable && r > 1 && r < plateRows - 3 && Math.random() < 0.18 && !plates[r - 1].some((q) => q.s === 'gone')) { const q = row[randInt(0, 2)]; q.s = 'gone'; q.h = true; } // holes, never in two rows running
    plates.push(row);
  }
  G.bridge = { bx: bx * T, y0: y0 * T, pw: BR.pw * T, ph: BR.ph * T, plates, plateRows, total, plaza: exit,
    camY: 0, speed: 0, phase: 'wait', boulders: [], lanesWarn: [], rowsWarn: [], t: 0, rockT: 2.5, breakT: 6 };
  G.gridVer = 1;
}
// a saved bridge starts over: only the holes it was built with stay open
function restoreBridge(src) {
  const B = G.bridge = JSON.parse(JSON.stringify(src));
  B.plates.forEach((row, r) => row.forEach((q) => { q.s = q.h ? 'gone' : r >= B.plateRows ? 's' : 'ok'; q.t = 0; q.safe = 0; }));
  Object.assign(B, { camY: 0, speed: 0, phase: 'wait', boulders: [], lanesWarn: [], rowsWarn: [], t: 0, rockT: 2.5, breakT: 6 });
}
function bridgeActive() { return !!(G.bridge && G.room && G.room.type === 'boss'); }
function plateAt(x, y) {
  const B = G.bridge, l = Math.floor((x - B.bx) / B.pw), r = Math.floor((y - B.y0) / B.ph);
  if (l < 0 || l >= BR.lanes || r < 0 || r >= B.total) return null;
  return B.plates[r][l];
}
function bridgeRect(r, l) { const B = G.bridge; return { x: B.bx + l * B.pw, y: B.y0 + r * B.ph, w: B.pw, h: B.ph }; }
function startBridge() {
  const B = G.bridge, { VH } = viewDims();
  B.phase = 'run';
  B.camY = G.spawn.y - VH / 2 + 60;
  B.endCam = B.y0 - 40; // the scrolling stops with the plaza's edge in view
}
function updateBridge(dt) {
  const B = G.bridge;
  if (!B || G.state !== 'play') return;
  const p = G.player, { VH } = viewDims(), R = G.room;
  B.t += dt;
  if (R.type === 'boss' && R.phase === 'fight' && B.phase === 'wait' && G.boss && G.boss.enter <= 0) startBridge();
  if (B.phase === 'run') {
    B.speed = Math.min(58, 36 + B.t * 0.35) * (G.boss && G.boss.hard ? 1.1 : 1);
    B.camY = Math.max(B.endCam, B.camY - B.speed * dt);
    if (B.camY <= B.endCam) B.phase = 'arrive';
  }
  if ((B.phase === 'run' || B.phase === 'arrive') && p.y < B.y0 - 12) { // stepped onto the plaza
    B.phase = 'final'; B.finalT = 0; B.boulders.length = 0; B.lanesWarn.length = 0;
    if (G.boss) { G.boss.untarget = false; G.boss.invuln = false; }
    showBanner('SOLID GROUND', 'Bring it down', 'boss');
  }
  if (B.phase === 'final') B.finalT += dt;
  // plates crack under your feet (not while you are in the air dashing)
  const pl = plateAt(p.x, p.y);
  if (p.alive && p.dashT <= 0 && B.phase !== 'done') {
    if (pl && pl.s === 'gone') bridgeFall();
    else if (pl && pl.s === 'ok' && pl.safe <= 0) { pl.s = 'crack'; pl.t = 0; }
  }
  for (let r = 0; r < B.total; r++) for (const q of B.plates[r]) {
    if (q.safe > 0) q.safe -= dt;
    if (q.s === 'crack') { q.t += dt; if (q.t >= 1.6) { q.s = 'gone'; if (Math.random() < 0.4) sfx('hit'); } }
  }
  if (B.phase === 'run' || B.phase === 'arrive') {
    const top = B.camY - VH / 2, bot = B.camY + VH / 2;
    if (p.y > bot - 8 && p.alive) bridgeFall();          // left behind by the scrolling
    if (B.phase === 'run' && p.y < top + 26) p.y = top + 26; // cannot run ahead of the view
    bridgeAttacks(dt, top, bot);
  }
  if (B.phase === 'final') plazaAttacks(dt);
  updateBoulders(dt);
}
// Falling puts you back on solid plates in the middle of the view (not at the edge you fell from),
// and those plates hold for a moment so you can get your bearings.
function bridgeFall() {
  const B = G.bridge, p = G.player;
  if (G.time - (p.fallAt || -9) < 1.2) return;
  p.fallAt = G.time;
  hurtPlayer(p.x, p.y + 20, true, true);
  const rc0 = clamp(Math.floor((B.camY + 30 - B.y0) / B.ph), 0, B.total - 1);
  for (let k = 0; k < B.total; k++) {
    const r = clamp(rc0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2), 0, B.total - 1);
    const lanes = [1, 0, 2];
    for (const l of lanes) {
      const q = B.plates[r][l];
      if (q.s === 'gone') continue;
      for (const rr of [r - 1, r, r + 1]) { const o = B.plates[rr] && B.plates[rr][l]; if (o && o.s !== 'gone') { if (o.s === 'crack') { o.s = 'ok'; o.t = 0; } o.safe = 1.8; } }
      const rect = bridgeRect(r, l);
      p.x = rect.x + rect.w / 2; p.y = rect.y + rect.h / 2; p.vx = p.vy = 0; p.iframes = Math.max(p.iframes, 1.5);
      ring(p.x, p.y, 6, 40, 0.4, COL.collapse, 3);
      return;
    }
  }
}
function bridgeAttacks(dt, top, bot) {
  const B = G.bridge, p = G.player, b = G.boss;
  if (!b || b.dead) return;
  const hard = b.hard || b.phase2;
  // boulders roll down a lane (it glows first)
  B.rockT -= dt;
  if (B.rockT <= 0) {
    B.rockT = hard ? 1.9 : 2.5;
    const lane = Math.random() < 0.6 ? clamp(Math.floor((p.x - B.bx) / B.pw), 0, 2) : randInt(0, 2);
    B.lanesWarn.push({ lane, t: 0, warn: 1.0 });
    sfx('charge');
  }
  for (let i = B.lanesWarn.length - 1; i >= 0; i--) {
    const w = B.lanesWarn[i];
    w.t += dt;
    if (w.t >= w.warn) { B.boulders.push({ x: B.bx + (w.lane + 0.5) * B.pw, y: top - 20, r: 20, vx: 0, vy: 250, a: 0, bot: bot + 40 }); B.lanesWarn.splice(i, 1); }
  }
  // the giant tears a plate out ahead of you now and then (never the last one of a row)
  if (B.phase !== 'run') return;
  B.breakT -= dt;
  if (B.breakT <= 0) {
    B.breakT = hard ? 4.5 : 5.5;
    const rp = Math.floor((p.y - B.y0) / B.ph);
    for (const r of [rp - 4, rp - 6]) {
      if (r < 1 || r >= B.plateRows) continue;
      const l = randInt(0, 2), q = B.plates[r][l];
      if (q.s === 'ok' && B.plates[r].filter((x) => x.s !== 'gone').length > 2) { q.s = 'crack'; q.t = 0.1; }
    }
    addShake(0.25); sfx('slam');
  }
}
// On the plaza: boulders roll sideways along glowing rows; step above or below them.
function plazaAttacks(dt) {
  const B = G.bridge, b = G.boss, P = B.plaza;
  if (!b || b.dead) return;
  const hard = b.hard || b.phase2;
  B.rockT -= dt;
  if (B.rockT <= 0) {
    B.rockT = hard ? 2.6 : 3.3;
    const n = hard ? 3 : 2, p = G.player, dir = chance(0.5) ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const y = clamp(k === 0 ? p.y : P.y + 30 + Math.random() * (P.h - 60), P.y + 24, P.y + P.h - 24);
      B.rowsWarn.push({ y, dir, t: -k * 0.25, warn: 1.1 });
    }
    sfx('charge');
  }
  for (let i = B.rowsWarn.length - 1; i >= 0; i--) {
    const w = B.rowsWarn[i];
    w.t += dt;
    if (w.t >= w.warn) {
      B.boulders.push({ x: w.dir > 0 ? P.x - 20 : P.x + P.w + 20, y: w.y, r: 20, vx: w.dir * 300, vy: 0, a: 0 });
      B.rowsWarn.splice(i, 1); addShake(0.1);
    }
  }
}
function updateBoulders(dt) {
  const B = G.bridge, p = G.player, P = B.plaza;
  for (let i = B.boulders.length - 1; i >= 0; i--) {
    const o = B.boulders[i];
    o.x += o.vx * dt; o.y += o.vy * dt; o.a += dt * 6;
    if ((o.vy && o.y > o.bot) || (o.vx && (o.x < P.x - 60 || o.x > P.x + P.w + 60))) { B.boulders.splice(i, 1); continue; }
    const rr = o.r + PLAYER_HITBOX;
    if (p.alive && dist2(o.x, o.y, p.x, p.y) < rr * rr) hurtPlayer(o.x, o.y);
  }
}
BOSS_AI.collapse = function (b, dt, hard, sm) {
  const B = G.bridge, p = G.player, P = B && B.plaza;
  if (!B) return;
  if (B.phase !== 'final') {
    // waits at the far side of the plaza, watching the bridge
    b.x = P.x + P.w / 2 + Math.sin(b.t * 0.8) * 12; b.y = P.y + 50; b.vx = b.vy = 0;
    b.untarget = true; b.invuln = true; return;
  }
  // on the plaza it keeps a middle distance and turns to face you
  const d = Math.sqrt(dist2(b.x, b.y, p.x, p.y)), want = 150;
  const tx = clamp(p.x + (b.x - p.x) / (d || 1) * want, P.x + b.r + 6, P.x + P.w - b.r - 6);
  const ty = clamp(p.y + (b.y - p.y) / (d || 1) * want, P.y + b.r + 6, P.y + P.h - b.r - 6);
  steer(b, tx, ty, 55 * sm, dt, 3);
  b.x = clamp(b.x, P.x + b.r, P.x + P.w - b.r); b.y = clamp(b.y, P.y + b.r, P.y + P.h - b.r);
  b.atk -= dt;
  if (b.atk <= 0) {
    b.atk = hard ? 1.1 : 1.45;
    const n = hard ? 9 : 7, a0 = angToPlayer(b);
    for (let k = 0; k < n; k++) fireEB(b.x, b.y, a0 + (k - (n - 1) / 2) * 0.14, 130, { color: COL.collapse, r: 7 });
    sfx('eshoot');
  }
};

// ================= THE PUPPETEER =================
function puppeteerActive() { return !!(G.boss && !G.boss.dead && G.boss.kind === 'puppeteer'); }
function shootString(b, fromX, fromY, delay, off) {
  const p = G.player;
  b.needles.push({ x: fromX, y: fromY, ax: fromX, ay: fromY, a: Math.atan2(p.y - fromY, p.x - fromX) + (off || 0), off: off || 0, t: -(delay || 0), warn: 0.55, sp: 520, flying: false });
  sfx('charge');
}
// a fan of strings: the middle one aims at you, the others close the sides
function stringFan(b, n, delay) { for (let k = 0; k < n; k++) shootString(b, b.x, b.y, delay, (k - (n - 1) / 2) * 0.3); }
function updateStrings(b, dt) {
  const p = G.player;
  for (let i = b.needles.length - 1; i >= 0; i--) {
    const n = b.needles[i];
    n.t += dt;
    if (n.t < n.warn) { if (n.t > 0) n.a += angleDiff(n.a, Math.atan2(p.y - n.ay, p.x - n.ax) + n.off) * Math.min(1, dt * 2); continue; }
    n.flying = true;
    n.x += Math.cos(n.a) * n.sp * dt; n.y += Math.sin(n.a) * n.sp * dt;
    if (solidAt(n.x, n.y) || n.t > 3) { b.needles.splice(i, 1); continue; }
    if (p.alive && dist2(n.x, n.y, p.x, p.y) < (6 + PLAYER_HITBOX) ** 2 && G.threads.length < 3) {
      const id = pickSealTarget(true);
      G.threads.push({ px: n.ax, py: n.ay, id, tension: 0 });
      if (id) sealUpgrade(id, null);
      floatText(p.x, p.y - 18, 'STRUNG', '#ff5c8a', 13, 0.8);
      sfx('hurt'); addShake(0.15);
      b.needles.splice(i, 1);
    }
  }
  // the yank: every thread drags you toward its pin (you pull against it; dashing still works)
  if (b.yankT > 0 && G.threads.length) {
    b.yankT -= dt;
    for (const th of G.threads) {
      const dx = th.px - p.x, dy = th.py - p.y, l = Math.hypot(dx, dy) || 1;
      if (l > 30) { p.x += (dx / l) * 150 * dt; p.y += (dy / l) * 150 * dt; }
    }
    collideWorld(p, p.r);
  }
  // pull far enough away (not by dashing: the string stretches) to snap a thread
  for (let i = G.threads.length - 1; i >= 0; i--) {
    const th = G.threads[i], d = Math.sqrt(dist2(th.px, th.py, p.x, p.y));
    if (d > 190 && p.dashT <= 0) th.tension += dt; else th.tension = Math.max(0, th.tension - dt * 0.5);
    if (th.tension >= 0.55) {
      if (th.id) unsealUpgrade(th.id);
      burst((th.px + p.x) / 2, (th.py + p.y) / 2, '#ff5c8a', 10, 140, 0.4, 2);
      floatText(p.x, p.y - 18, 'SNAP!', '#ffffff', 12, 0.6);
      sfx('shatter');
      G.threads.splice(i, 1);
    }
  }
}
function clearStrings() {
  for (const th of G.threads || []) if (th.id) unsealUpgrade(th.id);
  G.threads = [];
}
BOSS_AI.puppeteer = function (b, dt, hard, sm) {
  const p = G.player;
  b.needles = b.needles || []; b.puppets = b.puppets || [];
  if (!G.threads) G.threads = [];
  updateStrings(b, dt);
  updatePuppets(b, dt);
  if (b.curtain) { b.curtain.t += dt; if (b.curtain.t > b.curtain.dur) b.curtain = null; }
  if (!b.pat) {
    bossDrift(b, dt, 55 * sm);
    b.atk -= dt;
    if (b.atk <= 0) { b.atk = hard ? 0.8 : 1.05; for (let k = -2; k <= 2; k++) fireEB(b.x, b.y, angToPlayer(b) + k * 0.17, 165, { color: COL.puppeteer }); sfx('eshoot'); }
    b.cool -= dt;
    // with threads on you it prefers to yank them
    if (b.cool <= 0) startPattern(b, G.threads.length ? ['yank', 'string', 'puppets', 'curtain', 'finale'] : ['string', 'string', 'puppets', 'curtain', 'finale']);
    return;
  }
  b.pt += dt;
  if (b.pat === 'string') {
    // two fans of strings; the second one waits for where you dodged to
    brake(b, dt, 6);
    if (b.step === 0) { b.step = 1; stringFan(b, hard ? 5 : 3, 0); }
    if (b.step === 1 && b.pt > 0.9) { b.step = 2; stringFan(b, hard ? 5 : 3, 0); }
    if (b.pt > 2.6) endPattern(b, 0.8);
  } else if (b.pat === 'yank') {
    // every thread pulls you toward its pin while bullets fall where you are being dragged
    brake(b, dt, 6);
    if (b.step === 0) { b.step = 1; b.yankT = hard ? 1.6 : 1.3; addShake(0.2); sfx('charge'); for (const th of G.threads) ring(th.px, th.py, 4, 30, 0.3, COL.puppeteer, 2); }
    b.st -= dt;
    if (b.st <= 0 && b.pt < 1.4) {
      b.st = 0.3;
      const n = hard ? 10 : 8, off = Math.random() * TAU;
      for (let k = 0; k < n; k++) fireEB(b.x, b.y, off + (k * TAU) / n, 120, { color: COL.puppeteer });
    }
    if (b.pt > 1.8) endPattern(b, 0.9);
  } else if (b.pat === 'puppets') {
    // copies of you replay your moves a moment late and shoot at you
    brake(b, dt, 6);
    if (b.step === 0) { b.step = 1; b.puppets = [{ delay: 1.0, t: 0, atk: 1.0 }, { delay: 1.7, t: 0, atk: 1.6 }]; if (hard) b.puppets.push({ delay: 2.4, t: 0, atk: 2.1 }); sfx('spawn'); }
    if (b.pt > 1.5) endPattern(b, 1.2);
  } else if (b.pat === 'curtain') {
    // half the stage goes behind a curtain while bullets fly in there
    brake(b, dt, 6);
    if (b.step === 0) { b.step = 1; b.curtain = { side: p.x < arenaCenter().x ? -1 : 1, t: 0, dur: 3.5 }; sfx('door'); }
    b.st -= dt;
    if (b.st <= 0 && b.pt > 0.6 && b.pt < 3.4) {
      b.st = hard ? 0.12 : 0.16;
      const c = arenaCenter(), R = G.circle ? G.circle.R : 200;
      const x = c.x + b.curtain.side * rand(20, R * 0.9), y = c.y - R;
      fireEB(x, y, Math.PI / 2 + rand(-0.4, 0.4), 120, { color: COL.puppeteer });
    }
    if (b.pt > 3.6) endPattern(b, 1.0);
  } else if (b.pat === 'finale') {
    // three strings at once: run the one way that pulls against all of them
    brake(b, dt, 8);
    if (b.step === 0) {
      b.step = 1;
      const c = arenaCenter(), R = G.circle ? G.circle.R : 200;
      shootString(b, b.x, b.y, 0);
      shootString(b, c.x - R * 0.8, c.y - R * 0.4, 0.15);
      shootString(b, c.x + R * 0.8, c.y - R * 0.4, 0.3);
      if (hard) { shootString(b, c.x - R * 0.8, c.y + R * 0.3, 0.45); shootString(b, c.x + R * 0.8, c.y + R * 0.3, 0.6); }
    }
    if (b.pt > 2.6) endPattern(b, 1.2);
  }
};
function updatePuppets(b, dt) {
  const p = G.player, H = (G.pupTrail = G.pupTrail || []);
  H.push({ t: G.time, x: p.x, y: p.y });
  while (H.length && G.time - H[0].t > 3) H.shift();
  for (let i = b.puppets.length - 1; i >= 0; i--) {
    const q = b.puppets[i];
    q.t += dt;
    const want = G.time - q.delay;
    let at = H[0];
    for (const h of H) { if (h.t > want) break; at = h; }
    if (at) { q.x = at.x; q.y = at.y; }
    q.atk -= dt;
    if (q.atk <= 0 && q.x != null && q.t > 0.4) { q.atk = b.hard ? 0.85 : 1.05; fireEB(q.x, q.y, Math.atan2(p.y - q.y, p.x - q.x), 140, { color: '#ffb3c9' }); sfx('eshoot'); }
    if (q.t > (b.hard ? 7 : 6)) { burst(q.x, q.y, '#ffb3c9', 8, 90, 0.3, 2); b.puppets.splice(i, 1); }
  }
}

// ================= shared hooks =================
function specialsStep(dt) {
  updateSeals(dt);
  updateWells(dt);
  updateMaze(dt);
  updateBridge(dt);
  if (G.polBeam) { G.polBeam.t += dt; if (G.polBeam.t > 0.35) G.polBeam = null; }
}
function specialsOnBossDeath() {
  clearStrings();
  G.wells = [];
  if (G.run && G.run.sealed) { G.run.sealed = {}; computeStats(); }
  if (G.bridge) { G.bridge.phase = 'done'; G.bridge.boulders.length = 0; G.bridge.lanesWarn.length = 0; G.bridge.rowsWarn.length = 0; for (const row of G.bridge.plates) for (const q of row) if (q.s !== 'gone') { q.s = 's'; q.t = 0; } }
  if (G.player) G.player.pol = null;
}
// the labyrinth is dark: only a few lights
function darknessLights() {
  if (!keysActive()) return darkRoomLights();
  const p = G.player, b = G.boss, L = [[p.x, p.y, 110]];
  for (const s of G.maze.seals) L.push([s.x, s.y, s.lit ? 70 : 30]);
  L.push([b.x, b.y, b.alertT > 0 ? 40 : 18]); // its eyes
  for (const o of G.eb) L.push([o.x, o.y, 14]);
  return L;
}
