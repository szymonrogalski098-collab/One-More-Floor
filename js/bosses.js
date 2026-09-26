'use strict';
// Bosses: each has a learnable pattern set and a phase-2 escalation below 50% HP.
//  - Warden: spiral streams, telegraphed jump-slams (watch the shadow), aimed fans.
//  - Loom: rotating laser sweeps (chevrons show direction), laser grids, homing orbs you can shoot down.
//  - Mirror (Lustro): splits into copies (only the real one has a solid core), wall-to-wall dashes leaving bullet trails, summons.

const SLAM_R = 56; // Warden slam radius (also drawn by the renderer)

function spawnBoss(floor) {
  const kind = BOSS_ORDER[(Math.floor(floor / 5) - 1) % BOSS_ORDER.length];
  const cyc = Math.floor((floor - 5) / 15);
  const def = BOSSES[kind];
  const hp = def.hp * G.scale.hp * (floor === 5 ? 0.75 : 0.88) * (1 + cyc * 0.2) * (ascMod(5) ? 1.25 : 1);
  const b = {
    id: G.nextId++, t: 0, type: 'boss', kind, name: def.name + (cyc > 0 ? ' ' + roman(cyc + 1) : ''),
    x: arenaCenter().x, y: arenaCenter().y - (G.circle ? G.circle.R : G.H / 2) + def.r + 4, r: def.r, hp, maxHp: hp, color: def.color, hard: cyc > 0 || ascMod(9), phase2: false,
    enter: 1.6, pat: null, pt: 0, cool: 1.2, sub: '', st: 0, step: 0, last: '', spinA: 0, spinDir: 1,
    alpha: 1, air: false, untarget: true, invuln: true, charge: 0,
    vx: 0, vy: 0, kx: 0, ky: 0, flash: 0, slowT: 0, slowAmt: 0, burnT: 0, burnDps: 0, burnAcc: 0, orbitCd: 0,
    tx: arenaCenter().x, ty: arenaCenter().y, dead: false, spawnIn: 0, eyeA: Math.PI / 2, atk: 1.5, oa: 0, fakes: [],
  };
  G.enemies.push(b);
  G.boss = b;
  G.run.hurtAtBoss = G.run.hurt;
  showBanner(b.name, def.sub, 'boss');
  UI.bossBar(b);
  sfx('roar');
  addShake(0.4);
  Sound.music(true, 'boss');
  return b;
}

function updateBoss(b, dt, sm) {
  if (b.enter > 0) {
    b.enter -= dt;
    const c = arenaCenter();
    b.y = lerp(b.y, c.y - (G.circle ? G.circle.R * 0.45 : G.H * 0.22), 1 - Math.exp(-dt * 3));
    b.vx = b.vy = 0;
    if (b.enter <= 0) { b.invuln = false; b.untarget = false; }
    return;
  }
  if (!b.phase2 && b.hp < b.maxHp * 0.5) {
    b.phase2 = true;
    hitstop(0.12); addShake(0.5); sfx('roar');
    ring(b.x, b.y, b.r, b.r * 5, 0.5, b.color, 5);
    burst(b.x, b.y, b.color, 24, 220, 0.6, 4);
    floatText(b.x, b.y - b.r - 10, 'RAGE!', '#ff4f6b', 16, 1.2);
    if (b.pat && b.kind !== 'mirror') endPattern(b, 0.6);
  }
  const hard = b.phase2 || b.hard;
  BOSS_AI[b.kind](b, dt, hard, sm);
}

function startPattern(b, list) {
  const opts = list.filter((x) => x !== b.last);
  b.pat = pick(opts); b.last = b.pat;
  b.pt = 0; b.st = 0; b.step = 0; b.sub = ''; b.charge = 0;
}
function endPattern(b, cool) {
  b.pat = null; b.sub = ''; b.charge = 0;
  b.cool = cool * (b.phase2 || b.hard ? 0.7 : 1);
  pickDrift(b);
}
function pickDrift(b) {
  const p = G.player;
  for (let i = 0; i < 10; i++) {
    const c = arenaCenter(), R = (G.circle ? G.circle.R : Math.min(G.W, G.H) / 2) * 0.65;
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R;
    const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.8 - R * 0.2;
    if (dist2(x, y, p.x, p.y) > 140 * 140) { b.tx = x; b.ty = y; return; }
  }
  b.tx = arenaCenter().x; b.ty = arenaCenter().y;
}
function bossDrift(b, dt, speed) {
  if (dist2(b.x, b.y, b.tx, b.ty) < 12 * 12) pickDrift(b);
  steer(b, b.tx, b.ty, speed, dt, 3);
}
function angToPlayer(b) { return Math.atan2(G.player.y - b.y, G.player.x - b.x); }

const BOSS_AI = {
  // ---------------- WARDEN ----------------
  warden(b, dt, hard, sm) {
    const p = G.player;
    if (!b.pat) {
      bossDrift(b, dt, 55 * sm);
      b.cool -= dt;
      if (b.cool <= 0) startPattern(b, ['spiral', 'slam', 'fan']);
      return;
    }
    b.pt += dt;
    if (b.pat === 'spiral') {
      brake(b, dt, 8);
      if (b.pt < 0.7) { b.charge = b.pt / 0.7; if (b.step === 0) { b.step = 1; sfx('charge'); b.spinDir = chance(0.5) ? 1 : -1; b.spinA = angToPlayer(b); } return; }
      b.charge = 0;
      b.st -= dt;
      while (b.st <= 0) {
        b.st += hard ? 0.085 : 0.11;
        const arms = hard ? 3 : 2;
        for (let k = 0; k < arms; k++) fireEB(b.x, b.y, b.spinA + (k * TAU) / arms, hard ? 132 : 118, { color: COL.warden });
        b.spinA += 0.2 * b.spinDir;
        sfx('eshoot');
      }
      if (b.pt > 3.9) endPattern(b, 1.1);
    } else if (b.pat === 'slam') {
      const total = hard ? 4 : 3;
      if (b.sub === '') {
        b.sub = 'aim'; b.st = 0; b.air = true; b.untarget = true;
        // target is locked at take-off: the red circle never moves, so walking out of it
        // during the flight always works (dash is a bonus, not a requirement)
        b.sx = b.x; b.sy = b.y;
        const tg = clampInArena(p.x, p.y, b.r);
        b.tx = tg.x; b.ty = tg.y;
        sfx('jump');
        burst(b.x, b.y, b.color, 8, 100, 0.3, 3);
      }
      b.st += dt;
      b.vx = b.vy = 0;
      if (b.sub === 'aim') {
        const aimT = hard ? 0.85 : 1.0;
        b.airK = Math.min(1, b.st / aimT);
        b.alpha = 1 - Math.sin(b.airK * Math.PI) * 0.85;
        const k = easeOut(b.airK);
        b.x = lerp(b.sx, b.tx, k); b.y = lerp(b.sy, b.ty, k);
        if (b.st >= aimT) {
          b.x = b.tx; b.y = b.ty; b.air = false; b.untarget = false; b.alpha = 1; b.airK = 0;
          addShake(0.55); sfx('slam');
          ring(b.x, b.y, 10, SLAM_R + 6, 0.35, COL.warden, 4);
          burst(b.x, b.y, COL.warden, 16, 220, 0.5, 4);
          const R = SLAM_R + PLAYER_HITBOX;
          if (dist2(b.x, b.y, p.x, p.y) < R * R) hurtPlayer(b.x, b.y);
          const n = hard ? 18 : 14, off = Math.random() * TAU;
          for (let i = 0; i < n; i++) fireEB(b.x, b.y, off + (i * TAU) / n, 112, { color: COL.warden });
          b.sub = 'rest'; b.st = 0; b.step++;
        }
      } else if (b.sub === 'rest') {
        if (b.st > (hard ? 0.4 : 0.6)) {
          if (b.step >= total) endPattern(b, 1.3);
          else b.sub = '';
        }
      }
    } else if (b.pat === 'fan') {
      brake(b, dt, 6);
      const vol = hard ? 4 : 3;
      if (b.pt < 0.5) { b.charge = b.pt / 0.5; b.eyeA = angToPlayer(b); return; }
      b.charge = 0;
      b.st -= dt;
      if (b.st <= 0 && b.step < vol) {
        b.st = hard ? 0.42 : 0.52; b.step++;
        const a = angToPlayer(b), n = hard ? 7 : 5;
        for (let k = 0; k < n; k++) fireEB(b.x, b.y, a + (k - (n - 1) / 2) * 0.14, 180, { color: COL.warden, r: 6 });
        sfx('eshoot'); addShake(0.06);
      }
      if (b.step >= vol && b.st <= 0) endPattern(b, 1.0);
    }
  },

  // ---------------- LOOM ----------------
  loom(b, dt, hard, sm) {
    b.eyeA += angleDiff(b.eyeA, angToPlayer(b)) * Math.min(1, dt * 6);
    if (!b.pat) {
      bossDrift(b, dt, 45 * sm);
      b.cool -= dt;
      if (b.cool <= 0) startPattern(b, ['sweep', 'grid', 'orbs', 'burst']);
      return;
    }
    b.pt += dt;
    if (b.pat === 'sweep') {
      if (b.sub === '') b.sub = 'move';
      if (b.sub === 'move') {
        const c = arenaCenter();
        steer(b, c.x, c.y, 150, dt, 5);
        if (dist2(b.x, b.y, c.x, c.y) < 10 * 10 || b.pt > 1.6) {
          b.sub = 'beams'; b.st = 0;
          const n = hard ? 3 : 2, dir = chance(0.5) ? 1 : -1;
          const a0 = angToPlayer(b) + Math.PI / n + rand(-0.3, 0.3);
          for (let k = 0; k < n; k++) {
            G.beams.push({ rot: true, cx: b.x, cy: b.y, a: a0 + (k * TAU) / n, spd: (hard ? 0.95 : 0.72) * dir, len: 900, w: 13,
              warn: 1.15, fire: hard ? 4.6 : 4.0, t: 0, color: COL.loom, ax: 0, ay: 0, bx: 0, by: 0, owner: b.id });
          }
          sfx('charge');
        }
      } else {
        brake(b, dt, 10);
        b.st += dt;
        if (b.st > 1.15 + (hard ? 4.6 : 4.0)) endPattern(b, 1.1);
      }
    } else if (b.pat === 'grid') {
      brake(b, dt, 5);
      const rounds = hard ? 3 : 2;
      b.st -= dt;
      if (b.st <= 0 && b.step < rounds) {
        b.st = 1.5; b.step++;
        makeGridBeams(hard ? 4 : 3);
        sfx('charge');
      }
      if (b.step >= rounds && b.st <= 0.2) endPattern(b, 0.9);
    } else if (b.pat === 'orbs') {
      brake(b, dt, 5);
      b.charge = Math.min(1, b.pt / 0.6);
      if (b.pt >= 0.6 && b.step === 0) {
        b.step = 1; b.charge = 0;
        const n = hard ? 6 : 4;
        for (let k = 0; k < n; k++) {
          const a = (k * TAU) / n + b.eyeA;
          fireEB(b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r, a, 78, { homing: 1, turn: 1.6, hp: 3, r: 8, life: 6.5, color: '#e0a8ff' });
        }
        sfx('eshoot');
      }
      if (b.pt > 2.4) endPattern(b, 0.8);
    } else if (b.pat === 'burst') {
      brake(b, dt, 5);
      const waves = hard ? 4 : 3;
      b.st -= dt;
      if (b.pt < 0.45) { b.charge = b.pt / 0.45; return; }
      b.charge = 0;
      if (b.st <= 0 && b.step < waves) {
        b.st = 0.5; b.step++;
        const n = hard ? 20 : 16, off = (b.step % 2) * (Math.PI / n) + b.eyeA;
        for (let k = 0; k < n; k++) fireEB(b.x, b.y, off + (k * TAU) / n, 105, { color: COL.loom });
        ring(b.x, b.y, b.r, b.r + 20, 0.25, COL.loom, 3);
        sfx('eshoot');
      }
      if (b.step >= waves && b.st <= 0) endPattern(b, 1.0);
    }
  },

  // ---------------- MIRROR ----------------
  mirror(b, dt, hard, sm) {
    const p = G.player;
    if (!b.pat) {
      bossDrift(b, dt, 70 * sm);
      b.atk -= dt;
      if (b.atk <= 0) { b.atk = hard ? 0.9 : 1.3; fireEB(b.x, b.y, angToPlayer(b), 170, { color: COL.mirror }); sfx('eshoot'); }
      b.cool -= dt;
      if (b.cool <= 0) startPattern(b, ['split', 'dash', 'summon', 'prism']);
      return;
    }
    b.pt += dt;
    if (b.pat === 'split') {
      if (b.sub === '') { b.sub = 'vanish'; b.st = 0; b.untarget = true; sfx('shatter'); }
      b.st += dt;
      if (b.sub === 'vanish') {
        brake(b, dt, 10);
        b.alpha = Math.max(0, 1 - b.st / 0.3);
        if (b.st >= 0.35) {
          const n = hard ? 4 : 3, cx = arenaCenter().x, cy = arenaCenter().y, R = mirrorOrbitR();
          const off = Math.random() * TAU, real = randInt(0, n - 1);
          b.fakes = [];
          for (let k = 0; k < n; k++) {
            const a = off + (k * TAU) / n, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
            if (k === real) { b.x = x; b.y = y; b.oa = a; }
            else {
              const f = spawnEnemy('fake', x, y, false, G.enemies);
              f.r = b.r; f.hp = f.maxHp = b.maxHp * 0.03; f.oa = a; f.bossId = b.id; f.atk = rand(0.8, 1.6); f.spawnIn = 0.4;
              b.fakes.push(f);
            }
            burst(x, y, COL.mirror, 10, 120, 0.4, 3);
          }
          b.sub = 'active'; b.st = 0; b.alpha = 1; b.untarget = false; b.atk = rand(0.8, 1.4);
        }
      } else if (b.sub === 'active') {
        mirrorCopyAI(b, dt, sm);
        const alive = b.fakes.some((f) => !f.dead);
        if (b.st > (hard ? 8 : 7) || (!alive && b.st > 1.5)) {
          for (const f of b.fakes) if (!f.dead) killEnemy(f, true);
          b.fakes = [];
          endPattern(b, 1.0);
        }
      }
    } else if (b.pat === 'dash') {
      const total = hard ? 4 : 3;
      if (b.sub === '') { b.sub = 'vanish'; b.st = 0; b.untarget = true; }
      b.st += dt;
      if (b.sub === 'vanish') {
        b.vx = b.vy = 0;
        b.alpha = Math.max(0, 1 - b.st / 0.25);
        if (b.st >= 0.28) {
          // pick an edge start far from the player
          let sx = 0, sy = 0;
          for (let i = 0; i < 12; i++) {
            const e = rayToEdge(arenaCenter().x, arenaCenter().y, Math.cos(i * 2.4 + b.t), Math.sin(i * 2.4 + b.t), b.r + 6);
            sx = e.x; sy = e.y;
            if (dist2(sx, sy, p.x, p.y) > 170 * 170) break;
          }
          b.x = sx; b.y = sy;
          const a = Math.atan2(p.y - sy, p.x - sx);
          b.dx = Math.cos(a); b.dy = Math.sin(a);
          const end = rayToEdge(sx, sy, b.dx, b.dy, b.r);
          b.ex = end.x; b.ey = end.y;
          b.sub = 'warn'; b.st = 0; b.alpha = 1; b.untarget = false;
          G.beams.push({ rot: false, ax: sx, ay: sy, bx: end.x, by: end.y, w: b.r * 1.6, warn: hard ? 0.5 : 0.62, fire: 0, t: 0, color: COL.mirror, dashLine: true });
          sfx('charge');
        }
      } else if (b.sub === 'warn') {
        b.vx = b.vy = 0;
        if (b.st >= (hard ? 0.5 : 0.62)) { b.sub = 'go'; b.st = 0; b.dropD = 0; sfx('dash'); }
      } else if (b.sub === 'go') {
        const sp = 640;
        const stepX = b.dx * sp * dt, stepY = b.dy * sp * dt;
        b.vx = 0; b.vy = 0;
        b.x += stepX; b.y += stepY;
        b.dropD += sp * dt;
        while (b.dropD >= 26) {
          b.dropD -= 26;
          const side = (b.step + ((b.x + b.y) | 0)) % 2 ? 1 : -1;
          const nx = -b.dy * side, ny = b.dx * side;
          fireEB(b.x, b.y, 0, 0, { color: COL.mirror, delay: 0.55, dvx: nx * 85, dvy: ny * 85, life: 6 });
        }
        part(b.x, b.y, 0, 0, 0.25, 10, 'rgba(92,242,196,0.45)', 0);
        const remain = (b.ex - b.x) * b.dx + (b.ey - b.y) * b.dy;
        if (remain <= 0) { b.x = b.ex; b.y = b.ey; b.sub = 'pause'; b.st = 0; b.step++; addShake(0.2); }
      } else if (b.sub === 'pause') {
        if (b.st > (hard ? 0.25 : 0.4)) {
          if (b.step >= total) endPattern(b, 1.2);
          else b.sub = 'vanish';
          b.st = 0;
        }
      }
    } else if (b.pat === 'summon') {
      brake(b, dt, 6);
      if (b.step === 0) {
        b.step = 1;
        const list = ['grunt', 'grunt', 'grunt', 'spitter'];
        if (hard) list.push('bomber', 'bomber');
        for (const t of list) addMarker(t, false);
        sfx('spawn');
      }
      b.st -= dt;
      if (b.st <= 0 && b.pt < 2.2) {
        b.st = 0.28; b.spinA += 0.35;
        for (let k = 0; k < 6; k++) fireEB(b.x, b.y, b.spinA + (k * TAU) / 6, 95, { color: COL.mirror });
      }
      if (b.pt > 2.6) endPattern(b, 1.4);
    } else if (b.pat === 'prism') {
      brake(b, dt, 6);
      const waves = hard ? 4 : 3;
      if (b.pt < 0.45) { b.charge = b.pt / 0.45; return; }
      b.charge = 0;
      b.st -= dt;
      if (b.st <= 0 && b.step < waves) {
        b.st = 0.45; b.step++;
        const n = 12, off = b.step * (Math.PI / 12) + angToPlayer(b);
        for (let k = 0; k < n; k++) fireEB(b.x, b.y, off + (k * TAU) / n, 108, { color: COL.mirror });
        if (hard) fireEB(b.x, b.y, angToPlayer(b), 190, { color: '#ffffff', r: 6 });
        sfx('eshoot');
      }
      if (b.step >= waves && b.st <= 0) endPattern(b, 1.0);
    }
  },
};

// Shared AI for the Mirror boss and its copies while split: orbit the centre, fire aimed shots.
function mirrorCopyAI(e, dt, sm) {
  const cx = arenaCenter().x, cy = arenaCenter().y, R = mirrorOrbitR();
  e.oa += dt * 0.45;
  steer(e, cx + Math.cos(e.oa) * R, cy + Math.sin(e.oa) * R, 90 * sm, dt, 4);
  e.atk -= dt;
  if (e.atk <= 0) {
    e.atk = rand(1.2, 1.6);
    fireEB(e.x, e.y, angToPlayer(e), 150, { color: COL.mirror });
    sfx('eshoot');
  }
}

function mirrorOrbitR() { return G.circle ? G.circle.R * 0.5 : Math.min(G.W, G.H) * 0.3; }

function onFakeDeath(f) {
  const boss = G.boss;
  const n = boss && (boss.phase2 || boss.hard) ? 12 : 8, off = Math.random() * TAU;
  for (let k = 0; k < n; k++) fireEB(f.x, f.y, off + (k * TAU) / n, 100, { color: COL.mirror });
  burst(f.x, f.y, COL.mirror, 16, 180, 0.5, 3);
  ring(f.x, f.y, 6, 40, 0.3, COL.mirror, 3);
  sfx('shatter');
  addShake(0.15);
}

function makeGridBeams(n) {
  const used = { h: [], v: [] };
  for (let i = 0; i < n; i++) {
    const horiz = chance(0.5);
    const key = horiz ? 'h' : 'v';
    const c = arenaCenter(), R = G.circle ? G.circle.R : Math.min(G.W, G.H) / 2;
    const lo = (horiz ? c.y : c.x) - R + 30, hi = (horiz ? c.y : c.x) + R - 30;
    let pos = 0;
    for (let tries = 0; tries < 12; tries++) {
      pos = rand(lo, hi);
      if (used[key].every((u) => Math.abs(u - pos) > 70)) break;
    }
    used[key].push(pos);
    const bm = horiz
      ? { ax: c.x - R, ay: pos, bx: c.x + R, by: pos }
      : { ax: pos, ay: c.y - R, bx: pos, by: c.y + R };
    Object.assign(bm, { rot: false, w: 16, warn: 0.95, fire: 0.3, t: 0, color: COL.loom });
    G.beams.push(bm);
  }
}

function updateBeams(dt) {
  const p = G.player;
  for (let i = G.beams.length - 1; i >= 0; i--) {
    const bm = G.beams[i];
    bm.t += dt;
    if (bm.rot) {
      const owner = G.boss;
      if (owner && owner.id === bm.owner) { bm.cx = owner.x; bm.cy = owner.y; }
      if (bm.t > bm.warn) bm.a += bm.spd * dt;
      else bm.a += bm.spd * dt * 0.08;
      bm.ax = bm.cx; bm.ay = bm.cy;
      bm.bx = bm.cx + Math.cos(bm.a) * bm.len; bm.by = bm.cy + Math.sin(bm.a) * bm.len;
    }
    if (bm.t > bm.warn + bm.fire) { G.beams.splice(i, 1); continue; }
    const firing = bm.t > bm.warn && bm.fire > 0;
    if (firing && !bm.sounded) { bm.sounded = true; sfx('laser'); addShake(0.12); }
    if (firing && p.alive) {
      const rr = bm.w / 2 + PLAYER_HITBOX;
      if (segPointDist2(p.x, p.y, bm.ax, bm.ay, bm.bx, bm.by) < rr * rr) hurtPlayer(p.x - Math.cos(bm.a || 0), p.y);
    }
  }
}

function onBossDeath(b) {
  const run = G.run;
  run.bosses++;
  const noHit = run.hurt === run.hurtAtBoss;
  if (b.kind === 'mirror') {
    const S = Save.data, next = Math.min(10, (run.asc | 0) + 1);
    if (next > (S.asc.unlocked | 0)) { S.asc.unlocked = next; Save.save(); setTimeout(() => UI.toast('ASCENSION ' + next + ' UNLOCKED', 'Pick it in the menu for more shards'), 1800); }
  }
  checkChallenges('boss', { kind: b.kind, noHit });
  G.boss = null;
  slowmo(1.4, 0.25);
  hitstop(0.2);
  addShake(0.9);
  sfx('bossdie');
  for (let k = 0; k < 3; k++) burst(b.x, b.y, k === 1 ? '#ffffff' : b.color, 30, 260 + k * 60, 0.9, 5);
  ring(b.x, b.y, b.r, 200, 0.8, b.color, 6);
  ring(b.x, b.y, b.r, 120, 0.5, '#ffffff', 3);
  clearEnemyBullets(true);
  G.beams.length = 0;
  G.markers.length = 0;
  G.room.queue.length = 0;
  for (const e of G.enemies) if (!e.dead && e !== b) killEnemy(e, true);
  const cyc = Math.floor((run.floor - 5) / 15);
  const total = 25 + cyc * 10;
  for (let k = 0; k < 10; k++) dropPickup(b.x, b.y, 'shard', Math.ceil(total / 10));
  dropPickup(b.x, b.y, 'heart', 1);
  dropPickup(b.x, b.y, 'heart', 1);
  UI.bossBar(null);
  Sound.music(true, 'normal');
}
