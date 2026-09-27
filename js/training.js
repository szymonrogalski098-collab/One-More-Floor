'use strict';
// Training: pick who (and how many) and practise dodging. No text lessons, no rewards.
//  - Enemies: they stay behind an energy barrier across the middle of the arena and shoot
//    through it; killed ones come back. Only ranged enemies (melee ones could never reach you).
//  - Bosses: the real fight in its own arena; the boss cannot die (HP stops at 2%).
// You cannot die either: hits are only counted. Records, checkpoints and the saved run are untouched.

const TRAIN_ENEMIES = ['spitter', 'sniper', 'sentinel', 'mortar'];
const TRAIN_FLOOR = 12; // enemy strength used for enemy drills
const TRAIN_MAX = 12;

function trainingBossFloor(kind) { return (BOSS_ORDER.indexOf(kind) + 1) * 5; }
function trainingBestFloor() { const S = Save.data; return Math.max(S.best.floor | 0, ...Object.values(S.asc.best || {}).map((v) => v | 0)); }
// Enemies and bosses you have met in a run can be trained.
function trainingUnlocked(kind) {
  const best = trainingBestFloor();
  return BOSSES[kind] ? best >= trainingBossFloor(kind) : best >= ENEMY[kind].minFloor;
}

function startTraining(cfg) {
  Sound.init();
  UI.stack = [];
  UI.show(null);
  UI.showHud(true);
  G.training = { cfg, hits: 0, t: 0, respawn: {} };
  G.run = {
    floor: 0, upgrades: {}, order: [], kills: 0, shards: 0, dmg: 0, time: 0, bosses: 0, elites: 0,
    hurt: 0, dodges: 0, rerolls: 0, windUsed: true, ship: Save.data.ships.includes(Save.data.ship) ? Save.data.ship : 'striker',
    asc: 0, hurtAtBoss: 0, start: 1, kitLeft: 0, kitTotal: 0, cpPending: {},
  };
  G.player = makePlayer();
  computeStats();
  G.player.hp = G.stats.maxHp;
  G.player.dashCharges = G.stats.dashCharges;
  Input.reset();
  if (cfg.boss) enterFloor(trainingBossFloor(cfg.boss), 'boss');
  else enterTrainingArena();
  G.tutorial = 0;
  G.fade = 1; G.fadeDir = -1;
  Sound.music(true, cfg.boss ? 'boss' : 'normal');
}

// One room split by a barrier: enemies above, you below.
function enterTrainingArena() {
  const run = G.run;
  run.floor = TRAIN_FLOOR;
  G.scale = floorScale(TRAIN_FLOOR);
  resetArrays();
  const { VW, VH } = viewDims();
  const cols = Math.round(VW / T), rows = Math.round(VH / T);
  makeGrid(cols, rows);
  carve(1, 1, cols - 2, rows - 2);
  const room = { id: 0, tx: 1, ty: 1, tw: cols - 2, th: rows - 2, kind: 'exit', ...tileRect(1, 1, cols - 2, rows - 2), gates: [], state: 'clear' };
  G.rooms = [room]; G.halls = []; G.pillars = []; G.traps = []; G.stairs = []; G.arrival = null;
  G.exitRoom = room;
  G.gridVer = 1;
  const barrierY = Math.round(G.H * (VH > VW ? 0.46 : 0.42));
  G.training.barrierY = barrierY;
  G.training.enemyArea = { x: room.x, y: room.y, w: room.w, h: barrierY - room.y - 6 };
  G.spawn = { x: G.W / 2, y: room.y + room.h - 40 };
  const p = G.player;
  p.x = G.spawn.x; p.y = G.spawn.y; p.vx = p.vy = 0; p.face = -Math.PI / 2; p.trail.length = 0; p.iframes = 0.8;
  G.room = { type: 'training', phase: 'fight', t: 0, active: null, waveT: 0, queue: [], queueT: 0, rewardShown: false, waveThresh: 0 };
  for (const k of TRAIN_ENEMIES) for (let i = 0; i < (G.training.cfg.enemies[k] | 0); i++) trainingSpawn(k, 0.3 + i * 0.12);
  Render.buildFloor();
  Render.snapCamera();
  UI.bossBar(null);
  G.state = 'play';
  G.hudDirty = true;
}

function trainingSpawn(type, delay) {
  const A = G.training.enemyArea, r = ENEMY[type].r * (G.training.cfg.elite ? 1.3 : 1);
  const spot = freeSpot(0, r, A);
  G.markers.push({ type, elite: !!G.training.cfg.elite, x: spot.x, y: Math.min(spot.y, G.training.barrierY - r - 4), t: -delay, dur: 0.8, roomId: -1, home: null, noDrop: true });
}

// Keeps the chosen count of each enemy type alive (a killed one returns after a moment).
function updateTraining(dt) {
  const tr = G.training;
  tr.t += dt;
  if (tr.cfg.boss) return;
  for (const k of TRAIN_ENEMIES) {
    const want = tr.cfg.enemies[k] | 0;
    if (!want) continue;
    let have = 0;
    for (const e of G.enemies) if (!e.dead && e.type === k) have++;
    for (const m of G.markers) if (m.type === k) have++;
    if (have < want) {
      tr.respawn[k] = (tr.respawn[k] || 0) + dt;
      if (tr.respawn[k] > 1.5) { tr.respawn[k] = 0; trainingSpawn(k, 0); }
    } else tr.respawn[k] = 0;
  }
}

// The barrier: enemies (and their spawns) stay above it, the player below it.
function trainingClampEnemy(e) {
  const tr = G.training;
  if (!tr || tr.barrierY == null || e.type === 'boss') return;
  if (e.y > tr.barrierY - e.r) { e.y = tr.barrierY - e.r; if (e.vy > 0) e.vy = 0; e.wallHit = true; }
}
function trainingClampPlayer(p) {
  const tr = G.training;
  if (!tr || tr.barrierY == null) return;
  if (p.y < tr.barrierY + p.r) { p.y = tr.barrierY + p.r; if (p.vy < 0) p.vy = 0; }
}

// A hit is only counted: no damage, no death.
function trainingHit(sx, sy) {
  const p = G.player, tr = G.training;
  tr.hits++;
  G.run.hurt++;
  p.iframes = 0.7;
  G.flash = 0.8;
  addShake(0.3); hitstop(0.05);
  sfx('hurt');
  burst(p.x, p.y, '#ff4f6b', 12, 160, 0.4, 3);
  floatText(p.x, p.y - 18, 'HIT', '#ff4f6b', 12, 0.6);
  const d = Math.hypot(p.x - sx, p.y - sy) || 1;
  p.vx = ((p.x - sx) / d) * 200; p.vy = ((p.y - sy) / d) * 200;
  clearBulletsNear(p.x, p.y, 40);
  G.hudDirty = true;
  return true;
}

function exitTraining() {
  G.training = null;
  goMenu();
  UI.renderTraining();
  UI.push('s-training');
}
