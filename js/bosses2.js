'use strict';
// The Architect (floor 50, the summit): raises blocks that stop all bullets, crushes with sliding walls
// (one gap), lays laser blueprints and recalls old bosses' slams.

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
    if (b.st <= 0 && b.step < rounds) {
      b.st = 1.4; b.step++; makeGridBeams(hard ? 4 : 3); sfx('charge');
      if (b.step === 1) for (let k = 0; k < (hard ? 3 : 2); k++) { const s = freeSpot(40, 20); G.wells.push({ x: s.x, y: s.y, r: 58, t: 0, warn: 0.6, life: 6 }); } // slowing fields
    }
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
      if (dist2(s.x, s.y, p.x, p.y) < R * R) hurtPlayer(s.x, s.y, false, true);
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
          hurtPlayer(o.dir > 0 ? o.x : o.x + o.w, p.y, false, true);
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
