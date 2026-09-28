'use strict';
// Floors 35-50: four bosses with their own mechanics.
//  - Eclipse (35): the hall goes dark. It hides (cannot be hit), leaves glowing eyes that fire,
//    throws flares that light up and burst, and runs a blackout with bullets from the dark.
//  - Serpent (40): a long body follows the head; the body blocks your bullets and hurts on contact,
//    only the head takes damage. Lunges, spits from every segment, burrows and coils around you.
//  - Chronos (45): clock hands (two rotating lasers), rewind (your past positions explode),
//    time stop (every bullet freezes, then flies at where you stood).
//  - Architect (50, the summit): raises blocks that stop all bullets, crushes with sliding walls
//    (one gap), lays laser blueprints and recalls old bosses' slams.

// ================= ECLIPSE =================
BOSS_AI.eclipse = function (b, dt, hard, sm) {
  const p = G.player;
  b.eyes = b.eyes || []; b.flares = b.flares || [];
  updateEclipseEyes(b, dt, hard);
  G.darkK += ((b.blackout ? 0.42 : 1) - G.darkK) * Math.min(1, dt * 4);
  if (!b.pat) {
    b.blackout = false; // also after a rage interrupt
    eclipseShow(b, dt, true);
    bossDrift(b, dt, 55 * sm);
    b.atk -= dt;
    if (b.atk <= 0) { b.atk = hard ? 0.9 : 1.25; for (let k = -1; k <= 1; k++) fireEB(b.x, b.y, angToPlayer(b) + k * 0.16, 150, { color: COL.eclipse }); sfx('eshoot'); }
    b.cool -= dt;
    if (b.cool <= 0) startPattern(b, ['vanish', 'flare', 'blackout', 'crescent']);
    return;
  }
  b.pt += dt;
  if (b.pat === 'vanish') {
    // hide, move, leave eyes in the dark, reappear somewhere else
    eclipseShow(b, dt, b.pt > 2.8);
    brake(b, dt, 10);
    if (b.step === 0 && b.pt > 0.35) {
      b.step = 1;
      const n = hard ? 5 : 3;
      for (let k = 0; k < n; k++) { const s = freeSpot(110, 12); b.eyes.push({ x: s.x, y: s.y, t: -k * 0.25, fire: 1.1 }); }
      const t = freeSpot(160, b.r); b.x = t.x; b.y = t.y;
      sfx('shatter');
    }
    if (b.pt > 2.8 && b.step === 1) {
      b.step = 2;
      const n = hard ? 16 : 12, off = Math.random() * TAU;
      for (let k = 0; k < n; k++) fireEB(b.x, b.y, off + (k * TAU) / n, 100, { color: COL.eclipse });
      ring(b.x, b.y, b.r, b.r * 3, 0.4, COL.eclipse, 3);
    }
    if (b.pt > 3.4) endPattern(b, 1.0);
  } else if (b.pat === 'flare') {
    eclipseShow(b, dt, true);
    brake(b, dt, 6);
    b.st -= dt;
    const n = hard ? 5 : 4;
    if (b.st <= 0 && b.step < n) {
      b.st = 0.35; b.step++;
      const a = angToPlayer(b) + rand(-0.9, 0.9), sp = rand(90, 140);
      b.flares.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, fuse: 1.5 });
      sfx('jump');
    }
    if (b.step >= n && b.pt > n * 0.35 + 1.8) endPattern(b, 0.9);
  } else if (b.pat === 'blackout') {
    // the light shrinks; bullets come out of the dark from the edge of the hall
    eclipseShow(b, dt, false);
    b.blackout = true;
    brake(b, dt, 8);
    b.st -= dt;
    if (b.st <= 0 && b.pt > 0.6) {
      b.st = hard ? 0.16 : 0.22;
      const c = arenaCenter(), R = G.circle ? G.circle.R : 200, a = Math.random() * TAU;
      const x = c.x + Math.cos(a) * (R - 8), y = c.y + Math.sin(a) * (R - 8);
      fireEB(x, y, Math.atan2(p.y - y, p.x - x) + rand(-0.25, 0.25), hard ? 125 : 110, { color: '#dfe4ff' });
    }
    if (b.pt > (hard ? 4.2 : 3.6)) { b.blackout = false; endPattern(b, 1.1); }
  } else if (b.pat === 'crescent') {
    eclipseShow(b, dt, true);
    brake(b, dt, 6);
    if (b.pt < 0.5) { b.charge = b.pt / 0.5; if (b.step === 0) { b.step = 1; b.spinA = angToPlayer(b); b.spinDir = chance(0.5) ? 1 : -1; } return; }
    b.charge = 0;
    b.st -= dt;
    while (b.st <= 0) {
      b.st += hard ? 0.09 : 0.12;
      for (const k of [0, Math.PI]) fireEB(b.x, b.y, b.spinA + k, 120, { color: COL.eclipse });
      b.spinA += 0.28 * b.spinDir;
    }
    if (b.pt > 3.4) endPattern(b, 1.0);
  }
};
// visible & hittable, or hidden in the dark
function eclipseShow(b, dt, on) {
  b.alpha = clamp((b.alpha == null ? 1 : b.alpha) + (on ? 1 : -1) * dt * 4, 0, 1);
  b.untarget = b.alpha < 0.5;
  b.air = b.alpha < 0.5; // no contact damage while hidden
}
function updateEclipseEyes(b, dt, hard) {
  const p = G.player;
  for (let i = b.eyes.length - 1; i >= 0; i--) {
    const e = b.eyes[i];
    e.t += dt;
    if (e.t >= e.fire) {
      const a = Math.atan2(p.y - e.y, p.x - e.x), n = hard ? 5 : 3;
      for (let k = 0; k < n; k++) fireEB(e.x, e.y, a + (k - (n - 1) / 2) * 0.2, 135, { color: '#ff4f6b' });
      burst(e.x, e.y, '#ff4f6b', 6, 80, 0.3, 2);
      sfx('eshoot');
      b.eyes.splice(i, 1);
    }
  }
  for (let i = b.flares.length - 1; i >= 0; i--) {
    const f = b.flares[i];
    f.t += dt;
    const k = Math.exp(-dt * 1.4); f.vx *= k; f.vy *= k;
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.t >= f.fuse) {
      const n = hard ? 14 : 10, off = Math.random() * TAU;
      for (let k2 = 0; k2 < n; k2++) fireEB(f.x, f.y, off + (k2 * TAU) / n, 95, { color: '#ffe9a8' });
      ring(f.x, f.y, 4, 50, 0.35, '#ffe9a8', 3);
      sfx('explode');
      b.flares.splice(i, 1);
    }
  }
}

// ================= SERPENT =================
const SERPENT_GAP = 15;
function serpentInit(b) {
  b.segN = b.hard ? 18 : 14;
  b.path = [];
  for (let i = 0; i < b.segN * SERPENT_GAP + 20; i += 3) b.path.push(b.x, b.y - i);
  b.segs = [];
  b.orbitA = 0;
}
// the body follows the head's trail
function serpentBody(b) {
  const P = b.path;
  if (!P.length || Math.hypot(b.x - P[0], b.y - P[1]) > 3) { P.unshift(b.x, b.y); if (P.length > (b.segN * SERPENT_GAP) / 1.5 + 40) P.length = Math.floor(((b.segN * SERPENT_GAP) / 1.5 + 40) / 2) * 2; }
  b.segs.length = 0;
  let want = SERPENT_GAP, acc = 0, px = b.x, py = b.y;
  for (let i = 0; i < P.length && b.segs.length < b.segN; i += 2) {
    const d = Math.hypot(P[i] - px, P[i + 1] - py);
    acc += d; px = P[i]; py = P[i + 1];
    if (acc >= want) { b.segs.push({ x: px, y: py, r: Math.max(7, 13 - b.segs.length * 0.35) }); want += SERPENT_GAP; }
  }
}
BOSS_AI.serpent = function (b, dt, hard, sm) {
  const p = G.player;
  if (!b.segs) serpentInit(b);
  serpentBody(b);
  // the body hurts on contact (not while burrowed)
  if (!b.air && p.alive) for (const s of b.segs) { const rr = s.r + PLAYER_HITBOX; if (dist2(s.x, s.y, p.x, p.y) < rr * rr) { hurtPlayer(s.x, s.y); break; } }
  if (!b.pat) {
    if (b.air) { b.air = false; b.untarget = false; b.alpha = 1; } // a burrow cut short by the rage phase
    b.orbitA += dt * (hard ? 1.1 : 0.85);
    const R = 150 + Math.sin(b.t * 0.7) * 30;
    const tg = clampInArena(p.x + Math.cos(b.orbitA) * R, p.y + Math.sin(b.orbitA) * R, b.r + 6);
    steer(b, tg.x, tg.y, (hard ? 150 : 125) * sm, dt, 3);
    b.cool -= dt;
    if (b.cool <= 0) startPattern(b, ['lunge', 'spit', 'burrow', 'coil']);
    return;
  }
  b.pt += dt;
  if (b.pat === 'lunge') {
    const total = hard ? 3 : 2;
    if (b.sub === '') {
      b.sub = 'aim'; b.st = 0;
      const a = angToPlayer(b); b.dx = Math.cos(a); b.dy = Math.sin(a);
      const e = rayToEdge(b.x, b.y, b.dx, b.dy, b.r); b.ex = e.x; b.ey = e.y;
      G.beams.push({ rot: false, ax: b.x, ay: b.y, bx: e.x, by: e.y, w: b.r * 1.6, warn: hard ? 0.6 : 0.75, fire: 0, t: 0, color: COL.serpent, dashLine: true });
      sfx('charge');
    }
    b.st += dt;
    if (b.sub === 'aim') { brake(b, dt, 12); if (b.st >= (hard ? 0.6 : 0.75)) { b.sub = 'go'; b.st = 0; sfx('dash'); } }
    else if (b.sub === 'go') {
      b.vx = b.dx * 520; b.vy = b.dy * 520;
      const remain = (b.ex - b.x) * b.dx + (b.ey - b.y) * b.dy;
      if (remain <= 8 || b.st > 1.2) { b.vx = b.vy = 0; b.sub = 'rest'; b.st = 0; b.step++; addShake(0.2); }
    } else if (b.sub === 'rest') { brake(b, dt, 10); if (b.st > 0.35) { if (b.step >= total) endPattern(b, 0.9); else b.sub = ''; } }
  } else if (b.pat === 'spit') {
    // every segment fires sideways, head to tail
    steer(b, arenaCenter().x, arenaCenter().y, 70 * sm, dt, 2);
    b.st -= dt;
    if (b.st <= 0 && b.step < b.segs.length) {
      b.st = hard ? 0.05 : 0.07;
      const s = b.segs[b.step++], nxt = b.segs[Math.min(b.segs.length - 1, b.step)] || b;
      const a = Math.atan2(nxt.y - s.y, nxt.x - s.x);
      for (const side of [-1, 1]) fireEB(s.x, s.y, a + side * Math.PI / 2, 105, { color: COL.serpent });
      sfx('eshoot');
    }
    if (b.step >= b.segs.length && b.pt > 1) endPattern(b, 1.0);
  } else if (b.pat === 'burrow') {
    if (b.sub === '') { b.sub = 'down'; b.st = 0; b.air = true; b.untarget = true; sfx('slam'); burst(b.x, b.y, COL.serpent, 14, 160, 0.4, 3); }
    b.st += dt;
    b.vx = b.vy = 0;
    if (b.sub === 'down') {
      b.alpha = Math.max(0, 1 - b.st * 4);
      if (b.st > 0.5) { b.sub = 'mark'; b.st = 0; const t = clampInArena(p.x, p.y, b.r + 4); b.tx = t.x; b.ty = t.y; }
    } else if (b.sub === 'mark') {
      if (b.st > (hard ? 0.8 : 1.0)) {
        b.x = b.tx; b.y = b.ty; b.path.length = 0;
        { // the body comes up behind the head, pointing away from you
          const a = Math.atan2(b.y - p.y, b.x - p.x) + rand(-0.6, 0.6);
          for (let i = 0; i < (b.segN * SERPENT_GAP) / 3 + 10; i++) { const q = clampInArena(b.x + Math.cos(a) * i * 3, b.y + Math.sin(a) * i * 3, 10); b.path.push(q.x, q.y); }
        }
        b.air = false; b.untarget = false; b.alpha = 1; b.sub = 'up'; b.st = 0;
        addShake(0.5); sfx('slam');
        const n = hard ? 18 : 14, off = Math.random() * TAU;
        for (let k = 0; k < n; k++) fireEB(b.x, b.y, off + (k * TAU) / n, 110, { color: COL.serpent });
        const R = 44 + PLAYER_HITBOX;
        if (dist2(b.x, b.y, p.x, p.y) < R * R) hurtPlayer(b.x, b.y);
      }
    } else if (b.st > 0.5) endPattern(b, 1.0);
  } else if (b.pat === 'coil') {
    // circles you, tightening, so the body closes in
    if (b.step === 0) { b.step = 1; b.orbitA = Math.atan2(b.y - p.y, b.x - p.x); b.cx0 = p.x; b.cy0 = p.y; }
    const k = Math.min(1, b.pt / 3.2), R = 190 - 80 * k;
    b.orbitA += dt * (hard ? 2.6 : 2.1);
    const tg = clampInArena(b.cx0 + Math.cos(b.orbitA) * R, b.cy0 + Math.sin(b.orbitA) * R, b.r + 4);
    steer(b, tg.x, tg.y, 330, dt, 8);
    if (b.pt > 3.4) endPattern(b, 1.0);
  }
};
// the body stops your bullets
function serpentBlocks(bl) {
  const b = G.boss;
  if (!b || b.kind !== 'serpent' || !b.segs || b.air) return false;
  for (const s of b.segs) {
    const rr = s.r + bl.r;
    if (segPointDist2(s.x, s.y, bl.px, bl.py, bl.x, bl.y) < rr * rr) { sparks(bl.x, bl.y, Math.atan2(-bl.vy, -bl.vx), 1.2, COL.serpent, 3, 100); return true; }
  }
  return false;
}

// ================= CHRONOS =================
BOSS_AI.chronos = function (b, dt, hard, sm) {
  const p = G.player;
  b.marks = b.marks || [];
  updateChronosMarks(b, dt, hard);
  if (!b.pat) {
    b.froze = false;
    bossDrift(b, dt, 50 * sm);
    b.atk -= dt;
    if (b.atk <= 0) { b.atk = hard ? 0.7 : 0.95; for (let k = -1; k <= 1; k++) fireEB(b.x, b.y, angToPlayer(b) + k * 0.12, 160, { color: COL.chronos, r: 5 }); sfx('fuse'); }
    b.cool -= dt;
    if (b.cool <= 0) startPattern(b, ['hands', 'rewind', 'stop']);
    return;
  }
  b.pt += dt;
  if (b.pat === 'hands') {
    if (b.sub === '') b.sub = 'move';
    if (b.sub === 'move') {
      const c = arenaCenter();
      steer(b, c.x, c.y, 160, dt, 5);
      if (dist2(b.x, b.y, c.x, c.y) < 12 * 12 || b.pt > 1.5) {
        b.sub = 'tick'; b.st = 0;
        const dir = chance(0.5) ? 1 : -1, a0 = angToPlayer(b) + Math.PI * 0.6;
        const dur = hard ? 6.5 : 5.5;
        G.beams.push({ rot: true, cx: b.x, cy: b.y, a: a0, spd: (hard ? 1.05 : 0.85) * dir, len: 900, w: 10, warn: 1.1, fire: dur, t: 0, color: COL.chronos, owner: b.id, ax: 0, ay: 0, bx: 0, by: 0 });
        G.beams.push({ rot: true, cx: b.x, cy: b.y, a: a0 + Math.PI * 0.9, spd: (hard ? 0.45 : 0.35) * dir, len: 900, w: 22, warn: 1.1, fire: dur, t: 0, color: '#ffb13d', owner: b.id, ax: 0, ay: 0, bx: 0, by: 0 });
        sfx('charge');
      }
    } else {
      brake(b, dt, 10);
      b.st += dt;
      if (b.st > 1.1 + (hard ? 6.5 : 5.5)) endPattern(b, 1.0);
    }
  } else if (b.pat === 'rewind') {
    // your recent positions come back as bombs
    brake(b, dt, 6);
    const n = hard ? 5 : 4;
    b.st -= dt;
    if (b.st <= 0 && b.step < n) { b.st = 0.42; b.step++; b.marks.push({ x: p.x, y: p.y, t: 0, fuse: 1.5 }); sfx('fuse'); }
    if (b.step >= n && !b.marks.length) endPattern(b, 0.9);
  } else if (b.pat === 'stop') {
    brake(b, dt, 6);
    b.st -= dt;
    if (b.step < 2 && b.st <= 0) {
      b.st = 0.45; b.step++;
      const n = hard ? 22 : 18, off = b.step * 0.17 + Math.random();
      for (let k = 0; k < n; k++) fireEB(b.x, b.y, off + (k * TAU) / n, 115, { color: COL.chronos });
      sfx('eshoot');
    }
    if (b.step === 2 && b.pt > 1.2 && !b.froze) {
      // TIME STOP: every bullet halts, then flies at where you are now
      b.froze = true;
      for (const o of G.eb) {
        const sp = Math.max(110, Math.hypot(o.vx, o.vy)), a = Math.atan2(p.y - o.y, p.x - o.x);
        o.vx = o.vy = 0; o.delay = hard ? 0.9 : 1.1; o.dvx = Math.cos(a) * sp; o.dvy = Math.sin(a) * sp;
      }
      floatText(b.x, b.y - b.r - 12, 'TIME STOP', COL.chronos, 15, 1.2);
      G.flash = Math.max(G.flash, 0.25); sfx('charge'); addShake(0.25);
    }
    if (b.pt > 3.2) { b.froze = false; endPattern(b, 1.0); }
  }
};
function updateChronosMarks(b, dt, hard) {
  const p = G.player;
  for (let i = b.marks.length - 1; i >= 0; i--) {
    const m = b.marks[i];
    m.t += dt;
    if (m.t >= m.fuse) {
      ring(m.x, m.y, 6, 46, 0.3, COL.chronos, 3);
      burst(m.x, m.y, COL.chronos, 12, 160, 0.4, 3);
      addShake(0.15); sfx('explode');
      const R = 42 + PLAYER_HITBOX;
      if (dist2(m.x, m.y, p.x, p.y) < R * R) hurtPlayer(m.x, m.y);
      if (hard) for (let k = 0; k < 6; k++) fireEB(m.x, m.y, (k * TAU) / 6, 90, { color: COL.chronos });
      b.marks.splice(i, 1);
    }
  }
}

// ================= ARCHITECT =================
// Blocks live in G.blocks: they stop everything (collision in world.js).
BOSS_AI.architect = function (b, dt, hard, sm) {
  const p = G.player;
  b.slams = b.slams || [];
  updateArchitectSlams(b, dt, hard);
  if (!b.pat) {
    bossDrift(b, dt, 55 * sm);
    b.atk -= dt;
    if (b.atk <= 0) { b.atk = hard ? 0.75 : 1.05; for (let k = -1; k <= 1; k += 2) fireEB(b.x, b.y, angToPlayer(b) + k * 0.1, 165, { color: COL.architect, r: 5 }); sfx('eshoot'); }
    b.cool -= dt;
    if (b.cool <= 0) startPattern(b, ['build', 'crush', 'blueprint', 'recall']);
    return;
  }
  b.pt += dt;
  const c = arenaCenter(), R = G.circle ? G.circle.R : 220;
  if (b.pat === 'build') {
    brake(b, dt, 6);
    if (b.step === 0) {
      b.step = 1;
      const n = hard ? 7 : 5;
      for (let k = 0; k < n; k++) {
        for (let tries = 0; tries < 20; tries++) {
          const w = rand(26, 44), h = rand(26, 44), a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (R - 60);
          const x = c.x + Math.cos(a) * d - w / 2, y = c.y + Math.sin(a) * d - h / 2;
          const blk = { x, y, w, h, t: 0, warn: 0.9, life: hard ? 10 : 8, kind: 'block' };
          if (pointInRect(p.x, p.y, blk, 40) || pointInRect(b.x, b.y, blk, b.r + 10) || G.blocks.some((o) => o.kind === 'block' && overlapsRect(o, blk, 16))) continue;
          G.blocks.push(blk); break;
        }
      }
      sfx('charge');
    }
    if (b.pt > 1.4) endPattern(b, 0.8);
  } else if (b.pat === 'crush') {
    // two walls slide in from the sides and leave one gap
    brake(b, dt, 8);
    if (b.step === 0) {
      b.step = 1;
      const gap = hard ? 64 : 76, gx = clamp(p.x + rand(-90, 90), c.x - R + 70, c.x + R - 70), H = R * 2 + 40, y = c.y - H / 2;
      G.blocks.push({ x: c.x - R - 40 - 300, y, w: 300, h: H, t: 0, warn: 1.0, life: 99, kind: 'wall', tx: gx - gap / 2 - 300, dir: 1, gx, gap });
      G.blocks.push({ x: c.x + R + 40, y, w: 300, h: H, t: 0, warn: 1.0, life: 99, kind: 'wall', tx: gx + gap / 2, dir: -1, gx, gap });
      sfx('charge');
    }
    if (b.pt > 1.0 + 1.6 + 1.0) { for (const o of G.blocks) if (o.kind === 'wall') o.retract = true; }
    if (b.pt > 4.2) endPattern(b, 1.0);
  } else if (b.pat === 'blueprint') {
    brake(b, dt, 6);
    const rounds = hard ? 3 : 2;
    b.st -= dt;
    if (b.st <= 0 && b.step < rounds) { b.st = 1.4; b.step++; makeGridBeams(hard ? 4 : 3); sfx('charge'); }
    if (b.step >= rounds && b.st <= 0.2) endPattern(b, 0.9);
  } else if (b.pat === 'recall') {
    // echoes of the Warden: slams where you stand
    brake(b, dt, 6);
    const n = hard ? 4 : 3;
    b.st -= dt;
    if (b.st <= 0 && b.step < n) { b.st = hard ? 0.6 : 0.75; b.step++; const t = clampInArena(p.x, p.y, 20); b.slams.push({ x: t.x, y: t.y, t: 0, fuse: 0.95 }); sfx('jump'); }
    if (b.step >= n && !b.slams.length) endPattern(b, 1.0);
  }
};
function updateArchitectSlams(b, dt, hard) {
  const p = G.player;
  for (let i = b.slams.length - 1; i >= 0; i--) {
    const s = b.slams[i];
    s.t += dt;
    if (s.t >= s.fuse) {
      addShake(0.4); sfx('slam');
      ring(s.x, s.y, 8, SLAM_R + 6, 0.35, COL.architect, 4);
      burst(s.x, s.y, COL.architect, 14, 200, 0.45, 3);
      const R = SLAM_R + PLAYER_HITBOX;
      if (dist2(s.x, s.y, p.x, p.y) < R * R) hurtPlayer(s.x, s.y);
      const n = hard ? 14 : 10, off = Math.random() * TAU;
      for (let k = 0; k < n; k++) fireEB(s.x, s.y, off + (k * TAU) / n, 105, { color: COL.architect });
      b.slams.splice(i, 1);
    }
  }
}
function overlapsRect(a, b, pad) { return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y; }

// Blocks and walls: warn (outline only), then solid; walls slide to their target and back.
function updateBlocks(dt) {
  const p = G.player;
  for (let i = G.blocks.length - 1; i >= 0; i--) {
    const o = G.blocks[i];
    o.t += dt;
    o.solid = o.t >= o.warn;
    if (o.kind === 'wall' && o.solid) {
      const sp = 260 * dt;
      if (o.retract) { o.x -= o.dir * sp * 1.4; if ((o.dir > 0 && o.x + o.w < o.tx - 400) || (o.dir < 0 && o.x > o.tx + 400)) { G.blocks.splice(i, 1); continue; } }
      else if (o.dir > 0 ? o.x < o.tx : o.x > o.tx) {
        o.x = o.dir > 0 ? Math.min(o.tx, o.x + sp) : Math.max(o.tx, o.x - sp);
        // a moving wall that reaches you hurts and shoves you
        if (p.alive && p.x + p.r > o.x && p.x - p.r < o.x + o.w && p.y + p.r > o.y && p.y - p.r < o.y + o.h) {
          hurtPlayer(o.dir > 0 ? o.x : o.x + o.w, p.y);
          p.x = o.dir > 0 ? o.x + o.w + p.r + 1 : o.x - p.r - 1;
        }
      }
    }
    if (o.kind === 'block' && o.t > o.warn + o.life) { burst(o.x + o.w / 2, o.y + o.h / 2, COL.architect, 8, 80, 0.3, 2); G.blocks.splice(i, 1); continue; }
    // enemy bullets stop on blocks (player bullets use solidAt)
    if (o.solid) for (let j = G.eb.length - 1; j >= 0; j--) { const e = G.eb[j]; if (pointInRect(e.x, e.y, o, 0)) { sparks(e.x, e.y, 0, TAU, e.color, 2, 60); killEB(j); } }
  }
}
function blockAt(x, y) {
  for (const o of G.blocks) if (o.solid && pointInRect(x, y, o, 0)) return true;
  return false;
}
