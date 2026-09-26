'use strict';
// Run & floor flow: new run, floors, waves, rewards, doors, death, records.

function newRun(snapshot) {
  const meta = Save.data.meta;
  G.run = {
    floor: 0, upgrades: {}, order: [], kills: 0, shards: 0, dmg: 0, time: 0, bosses: 0, elites: 0,
    hurt: 0, dodges: 0, rerolls: meta.reroll | 0, windUsed: false,
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
  enterFloor(floor, type);
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
  G.doors = []; G.shrine = null; G.boss = null;
}

function enterFloor(n, type) {
  const run = G.run;
  run.floor = n;
  if (n % 5 === 0) type = 'boss';
  const dims = arenaDims();
  G.W = dims.W; G.H = dims.H;
  G.scale = floorScale(n);
  resetArrays();
  G.pillars = generatePillars(type);
  const p = G.player, sp = spawnPoint();
  p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = -60; p.face = -Math.PI / 2; p.trail.length = 0;
  p.iframes = 0.8; p.dashT = 0; p.dashIfr = 0; p.fireT = 0.3;
  G.room = { type, phase: 'intro', t: 0, waves: [], waveIdx: 0, waveT: 0, queue: [], queueT: 0, rewardShown: false };
  if (type === 'combat' || type === 'elite') planWaves(n, type);
  if (type === 'rest') G.shrine = { x: G.W / 2, y: G.H * 0.45, used: false, t: 0 };
  Render.buildFloor();
  UI.bossBar(null);
  const R = ROOM[type];
  if (type !== 'boss') showBanner('FLOOR ' + n, R.name + (type === 'elite' ? ' — ' + R.sub.toLowerCase() : ''), type);
  else showBanner('FLOOR ' + n, 'Something is coming…', 'boss');
  G.state = 'play';
  G.hudDirty = true;
  saveSnapshot(n, type);
  if (!Save.data.settings.tutorialDone && n === 1) G.tutorial = 0.01; else G.tutorial = 0;
}

function saveSnapshot(floor, type) {
  const run = G.run;
  Save.data.snapshot = {
    floor, type, hp: G.player.hp, order: expandOrder(),
    run: { kills: run.kills, shards: run.shards, dmg: run.dmg, time: run.time, bosses: run.bosses, elites: run.elites,
      hurt: run.hurt, dodges: run.dodges, rerolls: run.rerolls, windUsed: run.windUsed },
  };
  Save.save();
}

// Snapshot keeps upgrades as a flat list with repeats (id per stack).
function expandOrder() {
  const out = [];
  for (const id of G.run.order) for (let k = 0; k < G.run.upgrades[id]; k++) out.push(id);
  return out;
}

function planWaves(n, type) {
  const sc = G.scale;
  let budget = sc.budget * (type === 'elite' ? 0.7 : 1);
  const pool = Object.keys(ENEMY).filter((k) => ENEMY[k].minFloor <= n && ENEMY[k].w > 0);
  const weight = (k) => (k === 'grunt' ? Math.max(1, ENEMY[k].w - n * 0.1) : ENEMY[k].w);
  const list = [];
  let guard = 0;
  while (budget > 0 && guard++ < 80) {
    const k = weightedPick(pool, weight);
    list.push(k);
    budget -= ENEMY[k].cost;
  }
  shuffle(list);
  const nWaves = n < 3 ? 2 : 3;
  const waves = [];
  // first wave slightly smaller, later waves bigger
  const weights = nWaves === 2 ? [0.42, 0.58] : [0.28, 0.34, 0.38];
  let idx = 0;
  for (let w = 0; w < nWaves; w++) {
    const cnt = w === nWaves - 1 ? list.length - idx : Math.max(1, Math.round(list.length * weights[w]));
    waves.push(list.slice(idx, idx + cnt).map((t) => ({ t, elite: false })));
    idx += cnt;
  }
  if (type === 'elite') {
    const elitePool = pool.filter((k) => k !== 'bomber');
    const ne = n < 9 ? 1 : 2;
    for (let k = 0; k < ne; k++) waves[Math.min(waves.length - 1, 1 + k)].push({ t: pick(elitePool), elite: true });
  }
  G.room.waves = waves;
  G.room.waveThresh = Math.max(2, Math.floor(sc.maxAlive / 4));
}

function startNextWave() {
  const R = G.room;
  const w = R.waves[R.waveIdx++];
  R.waveT = 0;
  if (!w) return;
  for (const s of w) R.queue.push(s);
  sfx('spawn');
}

function aliveCount() {
  let n = 0;
  for (const e of G.enemies) if (!e.dead) n++;
  return n + G.markers.length;
}

function updateRoom(dt) {
  const R = G.room;
  R.t += dt;
  if (R.phase === 'intro') {
    if (R.t > 0.75) {
      if (R.type === 'boss') { R.phase = 'fight'; spawnBoss(G.run.floor); }
      else if (R.type === 'rest') R.phase = 'rest';
      else { R.phase = 'fight'; startNextWave(); }
    }
    return;
  }
  if (R.phase === 'fight') {
    R.waveT += dt;
    // drip-feed queued spawns under the alive cap
    R.queueT -= dt;
    if (R.queue.length && R.queueT <= 0 && aliveCount() < G.scale.maxAlive) {
      const s = R.queue.shift();
      addMarker(s.t, s.elite);
      R.queueT = 0.12;
    }
    const alive = aliveCount() + R.queue.length;
    if (R.waveIdx < R.waves.length && (alive <= R.waveThresh || R.waveT > 11)) startNextWave();
    if (R.waveIdx >= R.waves.length && alive === 0 && !G.boss) roomCleared();
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
  if (R.phase === 'doors') {
    const p = G.player;
    for (const d of G.doors) {
      d.t += dt;
      if (p.x > d.x - 2 && p.x < d.x + d.w + 2 && p.y - p.r < d.y + d.h + 8) {
        goThroughDoor(d);
        break;
      }
    }
  }
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
  if (type === 'boss') healPlayer(Math.ceil(G.stats.maxHp / 2));
  openUpgradeChoice(type === 'boss' ? 'boss' : type === 'elite' ? 'elite' : 'normal');
}

// ---------- upgrade choice ----------
function rollChoices(kind) {
  const run = G.run;
  const odds = kind === 'boss' ? [0, 50, 50] : kind === 'elite' ? [20, 55, 25] : [64 - Math.min(14, run.floor), 29 + Math.min(10, run.floor * 0.7), 7 + Math.min(6, run.floor * 0.3)];
  const ownedTags = {};
  for (const id in run.upgrades) ownedTags[UPG[id].tag] = (ownedTags[UPG[id].tag] || 0) + run.upgrades[id];
  const avail = UPGRADES.filter((u) => (run.upgrades[u.id] || 0) < u.max && Save.isUnlocked(u.id) && (!u.req || G.stats[u.req] > 0));
  const out = [];
  for (let i = 0; i < 3; i++) {
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
  if (id === '__heal') healPlayer(Math.max(2, Math.ceil(G.stats.maxHp * 0.5)));
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

function openRestChoice() {
  G.state = 'reward';
  G.rewardKind = 'rest';
  UI.showRest();
}

function afterReward() {
  G.state = 'play';
  Input.reset();
  G.room.phase = 'doors'; G.room.t = 0;
  makeDoors(nextDoorTypes(G.run.floor + 1));
  sfx('door');
  G.hudDirty = true;
}

function goThroughDoor(d) {
  if (G.state !== 'play') return;
  sfx('door');
  G.state = 'trans';
  G.fadeDir = 1;
  G.transCb = () => enterFloor(G.run.floor + 1, d.type);
}

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
  const salv = 1 + 0.15 * (S.meta.salvage | 0);
  const floorBonus = run.floor * 2;
  const earned = Math.round((run.shards + floorBonus) * salv);
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
  S.history.unshift({ floor: run.floor, kills: run.kills, time: Math.round(run.time), build: topBuild(), date: Date.now() });
  S.history = S.history.slice(0, 8);
  S.snapshot = null;
  Save.save();
  return { floor: run.floor, kills: run.kills, time: run.time, dmg: run.dmg, bosses: run.bosses, dodges: run.dodges,
    earned, floorBonus, record, prevBest, abandon: !!abandon, order: run.order.slice(), upgrades: Object.assign({}, run.upgrades) };
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
  if (G.state === 'play' || G.state === 'dying') {
    G.run.time += G.state === 'play' ? dt : 0;
    if (G.state === 'play') updatePlayer(dt);
    updateMarkers(dt);
    updateEnemies(dt);
    if (G.newEnemies.length) { for (const e of G.newEnemies) G.enemies.push(e); G.newEnemies.length = 0; }
    updateBeams(dt);
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
