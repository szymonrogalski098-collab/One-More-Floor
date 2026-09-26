'use strict';
// THE COUNTERWEIGHT: a side-view elevator boss. It cannot be hurt and cannot be shot. You win
// by surviving the ride. Movement is left/right plus dash, and the dash gives NO invulnerability
// against its attacks (it only moves you faster).
//  - Drops: telegraphed balls falling from the shaft above (aimed, curtain with one gap, sweep, splitters).
//  - Special "CRUSH": the counterweight drops into the cabin over your half (later: both sides at once).

const ELEV = { cabinW: 260, fallH: 380, gravity: 900 };

function buildSideElevator() {
  const { VW, VH } = viewDims();
  makeGrid(Math.round(VW / T), Math.round(VH / T));
  const portrait = VH > VW;
  const w = Math.min(ELEV.cabinW + (portrait ? 0 : 40), VW - 60);
  const L = Math.round(VW / 2 - w / 2), R = Math.round(VW / 2 + w / 2);
  const ceilY = portrait ? 130 : 70, floorY = VH - (portrait ? 90 : 40);
  carve(Math.floor(L / T), Math.floor(ceilY / T), Math.ceil((R - L) / T), Math.ceil((floorY - ceilY) / T));
  G.side = {
    L, R, ceilY, floorY, gravity: ELEV.gravity * ((floorY - ceilY) / ELEV.fallH),
    t: 0, dur: 55, cool: 1.6, slamT: 12, bx: VW / 2, btx: VW / 2, by: ceilY - 44,
    drops: [], slam: null, gapWarn: null, scroll: 0, cyc: 0, hard: false,
  };
  G.rooms = []; G.halls = []; G.pillars = []; G.traps = [];
  G.exitRoom = { x: L, y: ceilY, w: R - L, h: floorY - ceilY, side: true };
  G.spawn = { x: VW / 2, y: floorY - 9 };
  G.arrival = null;
  G.gridVer = 1;
}

// Exits are doors in the cabin's side walls (right one first when there is only one).
function placeSideDoors(types) {
  const S = G.side;
  G.stairs = types.map((type, i) => {
    const dir = types.length === 2 && i === 0 ? -1 : 1;
    return { type, x: dir < 0 ? S.L - 10 : S.R - 6, y: S.floorY - 64, w: 16, h: 64, locked: true, side: true, dir };
  });
}

function startElevator(floor) {
  const S = G.side, cyc = bossCycle(floor);
  S.cyc = cyc;
  S.dur = 55 + cyc * 8;
  S.hard = cyc > 0 || ascMod(9);
  const def = BOSSES.elevator;
  G.boss = { side: true, kind: 'elevator', name: def.name + (cyc > 0 ? ' ' + roman(cyc + 1) : ''), hp: 1, maxHp: 1, x: S.bx, y: S.by, r: def.r, dead: false, color: def.color };
  G.run.hurtAtBoss = G.run.hurt;
  showBanner(G.boss.name, def.sub, 'boss');
  UI.bossBar(G.boss);
  sfx('roar'); addShake(0.4);
  Sound.music(true, 'boss');
}

// ---------- simulation (replaces the top-down step while G.side is set) ----------
function stepSide(dt) {
  if (G.state === 'play') G.run.time += dt;
  if (G.arriveT > 0) { G.arriveT -= dt; G.fade = clamp(G.arriveT * 2.2, 0, 1); Input.consumeDash(); }
  else if (G.state === 'play') updateSidePlayer(dt);
  updateBlades(dt);
  if (G.state === 'play') updateSide(dt);
  else if (G.state === 'dying') {
    updateDrops(dt);
    G.dyingT += dt;
    if (G.dyingT > 0.5) { G.state = 'dead'; UI.showDeath(finalizeRun(false)); }
  }
}

function updateSide(dt) {
  const S = G.side, R = G.room, p = G.player;
  R.t += dt;
  S.scroll += dt * (R.phase === 'fight' ? 240 : R.phase === 'intro' ? 60 : 0);
  if (R.phase === 'intro') {
    if (R.t > 1.0) {
      if (R.restorePhase === 'doors') { R.phase = 'doors'; unlockStairs(); }
      else { R.phase = 'fight'; startElevator(G.run.floor); }
    }
  } else if (R.phase === 'fight') {
    S.t += dt;
    const prog = Math.min(1, S.t / S.dur);
    G.boss.hp = 1 - prog; // the boss bar shows the ride left
    sideAttacks(dt, prog);
    updateDrops(dt);
    updateSlam(dt);
    S.bx += (S.btx - S.bx) * Math.min(1, dt * 3);
    G.boss.x = S.bx; G.boss.y = S.by;
    if (prog >= 1 && G.state === 'play') finishElevator();
  } else if (R.phase === 'clear') {
    updateDrops(dt);
    if (R.t > 1.3 && !R.rewardShown) { R.rewardShown = true; giveReward(); }
  } else if (R.phase === 'doors') {
    let near = null;
    for (const st of G.stairs) if (Math.abs(p.x - (st.dir < 0 ? S.L : S.R)) < 44) near = st;
    if (near !== G.stairOn) { G.stairOn = near; UI.stairInfo(near); }
    if (near && !near.locked && (near.dir < 0 ? p.x - p.r <= S.L + 1 : p.x + p.r >= S.R - 1)) startClimb(near);
  }
}

function updateSidePlayer(dt) {
  const S = G.side, p = G.player, s = G.stats;
  if (!p.alive) return;
  p.iframes = Math.max(0, p.iframes - dt);
  p.frenzy = Math.max(0, p.frenzy - dt);
  p.dashIfr = 0;
  if (s.aegis > 0 && p.shield === 0) { p.shieldT -= dt; if (p.shieldT <= 0) { p.shield = 1; sfx('shieldUp'); } }
  if (p.dashCharges < s.dashCharges) {
    p.dashRecharge += dt;
    if (p.dashRecharge >= s.dashCd) { p.dashRecharge = 0; p.dashCharges++; G.hudDirty = true; }
  } else p.dashRecharge = 0;
  const v = Input.vector();
  if (Input.consumeDash() && p.dashCharges > 0 && p.dashT <= 0) {
    p.dashCharges--;
    p.dashDx = Math.abs(v.x) > 0.15 ? Math.sign(v.x) : (p.sideDir || 1);
    p.dashDy = 0;
    p.dashT = DASH_TIME; // no dashIfr: its attacks ignore dashing
    sfx('dash');
    sparks(p.x, p.y, p.dashDx > 0 ? Math.PI : 0, 0.8, COL.player, 8, 200);
    G.hudDirty = true;
  }
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.dashDx * DASH_SPEED * dt;
    if (Math.random() < 0.7) part(p.x, p.y, 0, 0, 0.2, 7, 'rgba(77,243,255,0.5)', 0, 0);
    if (p.dashT <= 0) p.vx = p.dashDx * s.move;
  } else {
    const k = 1 - Math.exp(-dt * 18);
    p.vx += (v.x * s.move - p.vx) * k;
    p.x += p.vx * dt;
    if (Math.abs(v.x) > 0.1) p.sideDir = Math.sign(v.x);
  }
  p.vy = 0;
  // the crushing counterweight is solid while it sits in the cabin
  if (S.slam && S.slam.state !== 'warn') for (const z of S.slam.zones) {
    if (p.x <= z.x0 - p.r || p.x >= z.x1 + p.r) continue;
    // out to the open side (a plate against a wall always pushes toward the middle)
    const toLeft = z.x1 >= S.R - 1 || (z.x0 > S.L + 1 && p.x < (z.x0 + z.x1) / 2);
    p.x = toLeft ? z.x0 - p.r : z.x1 + p.r;
  }
  p.x = clamp(p.x, S.L + p.r, S.R - p.r);
  p.y = S.floorY - p.r - 1;
  p.face = -Math.PI / 2;
  p.trailT -= dt;
  if (p.trailT <= 0) { p.trailT = 0.03; p.trail.push(p.x, p.y); if (p.trail.length > 16) p.trail.splice(0, 2); }
}

// ---------- attacks ----------
function sideAttacks(dt, prog) {
  const S = G.side, p = G.player;
  const pace = 1 + prog * 0.45 + (S.hard ? 0.25 : 0);
  S.cool -= dt * pace;
  S.slamT -= dt * pace;
  if (S.slam) return; // one big thing at a time
  if (S.slamT <= 0) { startSlam(prog); S.slamT = rand(11, 14); S.cool = Math.max(S.cool, 2.4); return; }
  if (S.cool > 0) return;
  const opts = [{ k: 'aimed', w: 3 }, { k: 'curtain', w: 2 }, { k: 'sweep', w: 1.6 }, { k: 'split', w: prog > 0.35 ? 1.8 : 0 }];
  const k = weightedPick(opts, (o) => o.w).k;
  const warn = Math.max(0.45, 0.7 - prog * 0.25);
  if (k === 'aimed') {
    const n = prog > 0.5 ? 4 : 3;
    for (let i = 0; i < n; i++) addDrop(clamp(p.x + rand(-50, 50) + (i - (n - 1) / 2) * 34, S.L + 12, S.R - 12), warn + i * 0.2, 10);
    S.btx = p.x; S.cool = 2.0;
  } else if (k === 'curtain') {
    const gapW = 66, gx = rand(S.L + gapW / 2 + 6, S.R - gapW / 2 - 6);
    for (let x = S.L + 15; x < S.R - 8; x += 30) if (Math.abs(x - gx) > gapW / 2) addDrop(x, warn + 0.4, 11);
    S.gapWarn = { x: gx, w: gapW, t: warn + 0.4 + 0.8 };
    S.btx = gx; S.cool = 2.3;
  } else if (k === 'sweep') {
    const cols = [];
    for (let x = S.L + 14; x < S.R - 8; x += 26) cols.push(x);
    if (chance(0.5)) cols.reverse();
    const gap = randInt(2, cols.length - 3);
    cols.forEach((x, i) => { if (i !== gap && i !== gap + 1) addDrop(x, warn + i * 0.09, 9); });
    S.btx = cols[cols.length - 1]; S.cool = 2.5;
  } else {
    const n = prog > 0.7 ? 2 : 1;
    for (let i = 0; i < n; i++) addDrop(clamp(p.x + rand(-40, 40), S.L + 20, S.R - 20), warn + 0.1 + i * 0.55, 13, true);
    S.btx = p.x; S.cool = 2.2;
  }
  sfx('eshoot');
}

function addDrop(x, warn, r, split) {
  const S = G.side;
  S.drops.push({ x, y: S.ceilY + 4, vx: 0, vy: 0, r, warn, t: 0, split: !!split });
}

function updateDrops(dt) {
  const S = G.side, p = G.player;
  if (S.gapWarn) { S.gapWarn.t -= dt; if (S.gapWarn.t <= 0) S.gapWarn = null; }
  for (let i = S.drops.length - 1; i >= 0; i--) {
    const d = S.drops[i];
    d.t += dt;
    if (d.t < d.warn) continue;
    const px = d.x, py = d.y;
    d.vy += S.gravity * dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
    // swept test: a ball moves ~14 px per step near the floor, more than the player's hitbox
    const rr = d.r + PLAYER_HITBOX;
    if (p.alive && segPointDist2(p.x, p.y, px, py, d.x, d.y) < rr * rr && hurtPlayer(d.x, d.y, true)) { S.drops.splice(i, 1); continue; }
    if (d.x < S.L + d.r || d.x > S.R - d.r) { d.vx = -d.vx; d.x = clamp(d.x, S.L + d.r, S.R - d.r); }
    if (d.split && d.y > S.ceilY + (S.floorY - S.ceilY) * 0.36) {
      for (const vx of [-85, 0, 85]) S.drops.push({ x: d.x, y: d.y, vx, vy: d.vy * 0.55, r: 8, warn: 0, t: 0, split: false });
      burst(d.x, d.y, COL.counter, 8, 120, 0.3, 2);
      sfx('shatter');
      S.drops.splice(i, 1); continue;
    }
    if (d.y + d.r >= S.floorY) {
      burst(d.x, S.floorY - 2, COL.counter, 6, 110, 0.3, 2);
      if (Math.random() < 0.35) sfx('hit');
      S.drops.splice(i, 1); continue;
    }
  }
}

function startSlam(prog) {
  const S = G.side, p = G.player, w = S.R - S.L;
  let zones;
  if (prog > 0.5 && chance(0.6)) zones = [{ x0: S.L, x1: S.L + w * 0.37 }, { x0: S.R - w * 0.37, x1: S.R }];
  else zones = [p.x < (S.L + S.R) / 2 ? { x0: S.L, x1: S.L + w * 0.46 } : { x0: S.R - w * 0.46, x1: S.R }]; // it goes for your half
  S.slam = { zones, state: 'warn', t: 0, warn: S.hard ? 1.1 : 1.3 };
  S.btx = zones.length === 2 ? (S.L + S.R) / 2 : (zones[0].x0 + zones[0].x1) / 2;
  sfx('charge');
  floatText((S.L + S.R) / 2, S.ceilY + 80, 'CRUSH!', '#ff4f6b', 16, 1.0);
}

function updateSlam(dt) {
  const S = G.side, sl = S.slam, p = G.player;
  if (!sl) return;
  sl.t += dt;
  if (sl.state === 'warn' && sl.t >= sl.warn) {
    sl.state = 'down'; sl.t = 0;
    addShake(0.6); sfx('slam');
    for (const z of sl.zones) {
      burst((z.x0 + z.x1) / 2, S.floorY - 4, '#ffb13d', 18, 220, 0.5, 4);
      if (p.alive && p.x + PLAYER_HITBOX > z.x0 && p.x - PLAYER_HITBOX < z.x1) hurtPlayer((z.x0 + z.x1) / 2, S.floorY, true);
    }
  } else if (sl.state === 'down' && sl.t >= 1.1) { sl.state = 'up'; sl.t = 0; }
  else if (sl.state === 'up' && sl.t >= 0.45) S.slam = null;
}
// 0 = at the ceiling, 1 = on the floor
function slamDepth(sl) {
  if (sl.state === 'warn') return Math.min(0.12, sl.t * 0.1);
  if (sl.state === 'down') return Math.min(1, 0.12 + sl.t * 12);
  return Math.max(0, 1 - sl.t / 0.45);
}

function finishElevator() {
  const S = G.side, run = G.run, R = G.room, p = G.player;
  const noHit = run.hurt === run.hurtAtBoss;
  run.bosses++;
  R.phase = 'clear'; R.t = 0;
  for (const d of S.drops) part(d.x, d.y, 0, -20, 0.4, 4, COL.counter, 1, 0);
  S.drops.length = 0; S.slam = null; S.gapWarn = null;
  G.boss = null;
  UI.bossBar(null);
  slowmo(0.8, 0.35); addShake(0.5);
  sfx('bossdie');
  showBanner('YOU MADE IT', 'The counterweight falls away', 'boss');
  const total = 30 + S.cyc * 12;
  run.shards += total;
  floatText(p.x, p.y - 26, '+' + total, COL.shard, 14, 1.4);
  ring(p.x, p.y, 6, 80, 0.5, COL.player, 3);
  if (G.stats.regen > 0) healPlayer(G.stats.regen);
  Sound.music(true, 'normal');
  checkChallenges('boss', { kind: 'elevator', noHit });
}
