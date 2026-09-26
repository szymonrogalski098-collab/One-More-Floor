'use strict';
// Player, projectiles, regular enemies, damage & death, pickups.

const DASH_SPEED = 560, DASH_TIME = 0.15, DASH_IFR_TAIL = 0.07;
const PLAYER_HITBOX = 5.5; // forgiving: smaller than the drawn body

// ================= Stats =================
function computeStats() {
  const meta = Save.data.meta;
  const s = {
    dmgMul: 1 + 0.05 * (meta.core | 0), rofMul: 1,
    baseDmg: 10, baseRof: 3.1,
    proj: 1, pierce: 0, bounce: 0,
    bSpeed: 400, bSize: 3.6, range: 330,
    crit: 0.05, critMult: 2,
    move: 150, dashCd: 1.5, dashCharges: 1,
    maxHp: 5 + (meta.hull | 0),
    chain: 0, frost: 0, burn: 0, orbit: 0, orbitSpd: 1, volatile: 0, nova: 0, adren: 0, homing: 0,
    // support-upgrade multipliers
    chainD: 1, burnD: 1, burnDur: 0, frostDur: 0, aegisCdr: 0, volR: 1, volD: 1, novaExtra: 0, novaD: 1,
    homTurn: 1, homRange: 1, adrenDur: 0, dodgeWin: 0,
    dashCdMeta: 1 - 0.06 * (meta.reflexes | 0), magnet: 1 + 0.4 * (meta.magnet | 0),
    vamp: 0, aegis: 0, regen: 0, back: 0, knock: 1,
  };
  const run = G.run;
  (SHIP[run.ship] || SHIP.striker).mod(s);
  if (ascMod(8)) s.maxHp -= 1;
  for (const id in run.upgrades) UPG[id].mod(s, run.upgrades[id]);
  s.dmg = s.baseDmg * s.dmgMul;
  s.rof = s.baseRof * Math.max(0.4, s.rofMul);
  s.maxHp = Math.max(1, s.maxHp);
  s.crit = Math.min(0.85, s.crit);
  s.aegisCd = Math.max(4, 16 - 4 * s.aegis - s.aegisCdr);
  s.dashCd *= s.dashCdMeta;
  G.stats = s;
  const p = G.player;
  if (p) {
    if (p.hp > s.maxHp) p.hp = s.maxHp;
    if (p.dashCharges > s.dashCharges) p.dashCharges = s.dashCharges;
    if (s.aegis > 0 && p.shield === 0 && p.shieldT <= 0) p.shieldT = 0.5;
  }
  G.hudDirty = true;
  return s;
}

// ================= Player =================
function makePlayer() {
  const sp = G.spawn || { x: G.W / 2, y: G.H - 60 };
  return {
    x: sp.x, y: sp.y, r: 8, vx: 0, vy: 0, face: -Math.PI / 2, aim: -Math.PI / 2,
    hp: 5, iframes: 0, alive: true,
    dashT: 0, dashIfr: 0, dashDx: 0, dashDy: -1, dashCharges: 1, dashRecharge: 0, dashBuffer: 0, dodged: false,
    fireT: 0.2, frenzy: 0, shield: 0, shieldT: 0, orbitA: 0, blades: [],
    trail: [], trailT: 0, lastDodge: -9,
  };
}

function healPlayer(n) {
  const p = G.player;
  if (!p) return;
  const before = p.hp;
  p.hp = Math.min(G.stats ? G.stats.maxHp : p.hp + n, p.hp + n);
  if (p.hp > before) {
    floatText(p.x, p.y - 16, '+' + (p.hp - before) + ' HP', COL.heart, 13);
    burst(p.x, p.y, COL.heart, 10, 90, 0.5, 3);
    sfx('heal');
  }
  G.hudDirty = true;
}

function tryDash() {
  const p = G.player;
  if (!p.alive) return;
  if (p.dashCharges <= 0 || p.dashT > 0) { p.dashBuffer = 0.15; return; }
  p.dashBuffer = 0;
  p.dashCharges--;
  const v = Input.vector();
  let dx, dy;
  if (v.mag > 0.15) { dx = v.x / v.mag; dy = v.y / v.mag; }
  else if (Input.pc && Input.mouse.seen) { const m = mouseWorld(), l = Math.hypot(m.x - p.x, m.y - p.y) || 1; dx = (m.x - p.x) / l; dy = (m.y - p.y) / l; }
  else { dx = Math.cos(p.face); dy = Math.sin(p.face); }
  p.dashDx = dx; p.dashDy = dy;
  p.dashT = DASH_TIME; p.dashIfr = DASH_TIME + DASH_IFR_TAIL + G.stats.dodgeWin; p.dodged = false;
  p.face = Math.atan2(dy, dx);
  sfx('dash');
  addShake(0.08);
  sparks(p.x, p.y, Math.atan2(-dy, -dx), 0.9, COL.player, 8, 220);
  G.hudDirty = true;
}

function endDash() {
  const p = G.player, s = G.stats;
  p.vx = p.dashDx * s.move; p.vy = p.dashDy * s.move;
  if (s.nova > 0) {
    const n = 10 + 6 * (s.nova - 1) + s.novaExtra, off = Math.random() * TAU;
    for (let i = 0; i < n; i++) spawnPB(p.x, p.y, off + (i * TAU) / n, s.dmg * 0.7 * s.novaD, false, s.bSpeed * 0.8, 0.45);
    ring(p.x, p.y, 6, 46, 0.25, COL.player, 3);
  }
}

function perfectDodge() {
  const p = G.player, s = G.stats;
  if (G.time - p.lastDodge < 0.6) return;
  p.lastDodge = G.time;
  slowmo(0.35, 0.3);
  floatText(p.x, p.y - 18, 'DODGE!', COL.player, 13, 0.7);
  ring(p.x, p.y, 8, 34, 0.3, COL.player, 2);
  sfx('dodge');
  G.run.dodges++;
  if (s.adren > 0) {
    p.dashCharges = s.dashCharges;
    p.frenzy = 3 + s.adrenDur;
  }
}

function updatePlayer(dt) {
  const p = G.player, s = G.stats;
  if (!p.alive) return;
  p.iframes = Math.max(0, p.iframes - dt);
  p.frenzy = Math.max(0, p.frenzy - dt);
  p.dashIfr = Math.max(0, p.dashIfr - dt);

  if (s.aegis > 0 && p.shield === 0) {
    p.shieldT -= dt;
    if (p.shieldT <= 0) { p.shield = 1; ring(p.x, p.y, 4, 18, 0.3, '#9fd8ff', 2); sfx('shieldUp'); }
  }
  if (p.dashCharges < s.dashCharges) {
    p.dashRecharge += dt;
    if (p.dashRecharge >= s.dashCd) { p.dashRecharge = 0; p.dashCharges++; G.hudDirty = true; }
  } else p.dashRecharge = 0;

  if (Input.consumeDash()) tryDash();
  else if (p.dashBuffer > 0) { p.dashBuffer -= dt; if (p.dashCharges > 0 && p.dashT <= 0) tryDash(); }

  const v = Input.vector();
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.dashDx * DASH_SPEED * dt;
    p.y += p.dashDy * DASH_SPEED * dt;
    if (Math.random() < 0.7) part(p.x, p.y, 0, 0, 0.22, 7, 'rgba(77,243,255,0.5)', 0, 0);
    if (p.dashT <= 0) endDash();
  } else {
    const k = 1 - Math.exp(-dt * 18);
    p.vx += (v.x * s.move - p.vx) * k;
    p.vy += (v.y * s.move - p.vy) * k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (v.mag > 0.1) p.face = Math.atan2(v.y, v.x);
  }
  collideWorld(p, p.r);

  // trail (for render)
  p.trailT -= dt;
  if (p.trailT <= 0) {
    p.trailT = 0.03;
    p.trail.push(p.x, p.y);
    if (p.trail.length > 16) p.trail.splice(0, 2);
  }

  // auto-fire
  p.fireT -= dt;
  if (p.fireT <= 0) {
    if (G.room.phase === 'fight' && playerFire()) p.fireT = Math.max(0, p.fireT) + 1 / (s.rof * (p.frenzy > 0 ? 1.6 : 1));
    else p.fireT = 0;
  }

  updateBlades(dt);
}

function findTarget() {
  const p = G.player, s = G.stats;
  const maxR = s.range * 1.15;
  let best = null, bd = maxR * maxR;
  for (const e of G.enemies) {
    if (e.dead || e.untarget) continue;
    let d = dist2(p.x, p.y, e.x, e.y);
    if (d > bd) continue;
    if (!hasLOS(p.x, p.y, e.x, e.y)) { if (G.rooms.length > 1) continue; d *= 2.6; }
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// PC: bullets go where the mouse points (auto-fire keeps running while enemies are around).
function mouseAim() { return Input.pc && Input.mouse.seen && Save.data.settings.mouseAim !== false; }
function mouseWorld() { return Render.toWorld(Input.mouse.x, Input.mouse.y); }
function enemiesAround() {
  const p = G.player, R = G.stats.range * 1.4;
  for (const e of G.enemies) if (!e.dead && !e.untarget && !e.sleep && dist2(p.x, p.y, e.x, e.y) < R * R) return true;
  return false;
}

function playerFire() {
  const p = G.player, s = G.stats;
  let a;
  if (mouseAim()) {
    if (!enemiesAround()) return false;
    const m = mouseWorld();
    a = Math.atan2(m.y - p.y, m.x - p.x);
  } else {
    const t = findTarget();
    if (!t) return false;
    a = Math.atan2(t.y - p.y, t.x - p.x);
  }
  p.aim = a;
  p.lastShot = G.time;
  const n = s.proj;
  const per = s.dmg / (1 + 0.35 * (n - 1));
  const gap = n > 1 ? Math.min(0.14, 0.75 / n) : 0;
  for (let i = 0; i < n; i++) {
    const ang = a + (i - (n - 1) / 2) * gap;
    // spawn at the centre: an enemy hugging the player is still hit (segment test below)
    spawnPB(p.x, p.y, ang, per, Math.random() < s.crit);
  }
  if (s.back > 0) {
    const angs = s.back >= 2 ? [0.75, -0.75, 0.5, -0.5] : [0.75, -0.75];
    for (const k of angs) spawnPB(p.x, p.y, a + Math.PI * k, per * 0.7, Math.random() < s.crit);
  }
  part(p.x + Math.cos(a) * 11, p.y + Math.sin(a) * 11, Math.cos(a) * 40, Math.sin(a) * 40, 0.07, 6, '#bffcff', 0, 0);
  sfx('shoot');
  return true;
}

function spawnPB(x, y, ang, dmg, crit, speed, lifeMul = 1) {
  const s = G.stats;
  if (G.pb.length > 220) return;
  const b = pbPool.pop() || { hits: [] };
  const sp = speed || s.bSpeed;
  b.x = x; b.y = y; b.px = x; b.py = y;
  b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
  b.r = s.bSize * (crit ? 1.3 : 1);
  b.dmg = dmg; b.crit = crit;
  b.life = (s.range / sp) * lifeMul; b.pierce = s.pierce; b.bounce = s.bounce;
  b.hits.length = 0; b.homeT = 0; b.age = 0;
  G.pb.push(b);
}

function killPB(i) { pbPool.push(G.pb[i]); swapRemove(G.pb, i); }

function updatePlayerBullets(dt) {
  const s = G.stats, arr = G.pb;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    b.life -= dt; b.age += dt;
    if (b.life <= 0) { killPB(i); continue; }
    if (s.homing && b.age > 0.06) {
      b.homeT -= dt;
      if (b.homeT <= 0) {
        b.homeT = 0.08;
        const hr = 150 * s.homRange;
        let best = null, bd = hr * hr;
        for (const e of G.enemies) { if (e.dead || e.untarget) continue; const d = dist2(b.x, b.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
        b.tgt = best;
      }
      if (b.tgt && !b.tgt.dead) {
        const cur = Math.atan2(b.vy, b.vx), want = Math.atan2(b.tgt.y - b.y, b.tgt.x - b.x);
        const na = cur + clamp(angleDiff(cur, want), -5 * s.homTurn * dt, 5 * s.homTurn * dt), sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }
    }
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;

    // walls, pillars, locked gates (grid) or the boss hall's circular wall
    let gone = false;
    if (solidAt(b.x, b.y)) {
      if (b.bounce > 0) {
        b.bounce--; b.hits.length = 0;
        if (G.circle) {
          const c = G.circle, nx0 = b.x - c.x, ny0 = b.y - c.y, nl = Math.hypot(nx0, ny0) || 1, nx = nx0 / nl, ny = ny0 / nl;
          const dot = b.vx * nx + b.vy * ny;
          b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
        } else {
          const sx = solidAt(b.x, b.py), sy = solidAt(b.px, b.y);
          if (sx) b.vx = -b.vx;
          if (sy) b.vy = -b.vy;
          if (!sx && !sy) { b.vx = -b.vx; b.vy = -b.vy; }
        }
        b.x = b.px; b.y = b.py;
      } else gone = true;
    }
    if (gone) { sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 1.4, b.crit ? COL.pCrit : COL.pBullet, 2, 90, 0.15); killPB(i); continue; }

    // destructible enemy projectiles (Loom orbs)
    let consumed = false;
    for (let j = G.eb.length - 1; j >= 0; j--) {
      const o = G.eb[j];
      if (!o.hp) continue;
      if (dist2(b.x, b.y, o.x, o.y) < (o.r + b.r) * (o.r + b.r)) {
        o.hp--;
        sparks(o.x, o.y, 0, TAU, o.color, 3, 80);
        if (o.hp <= 0) { burst(o.x, o.y, o.color, 6, 90, 0.3, 2); killEB(j); }
        consumed = true; break;
      }
    }
    if (consumed) { killPB(i); continue; }

    // enemies
    for (const e of G.enemies) {
      if (e.dead || e.untarget) continue;
      const rr = e.r + b.r;
      if (segPointDist2(e.x, e.y, b.px, b.py, b.x, b.y) > rr * rr) continue; // swept: no tunnelling
      if (b.hits.length && b.hits.indexOf(e.id) !== -1) continue;
      if (shieldBlocks(e, b)) { gone = true; break; }
      bulletHit(e, b);
      if (b.pierce > 0) { b.pierce--; b.hits.push(e.id); }
      else { gone = true; }
      break;
    }
    if (gone) killPB(i);
  }
}

function bulletHit(e, b) {
  const s = G.stats;
  const dmg = b.crit ? b.dmg * s.critMult : b.dmg;
  const sp = Math.hypot(b.vx, b.vy) || 1;
  damageEnemy(e, dmg, b.crit, b.vx / sp, b.vy / sp);
  if (e.dead) return;
  if (s.frost) { e.slowT = 1.3 + s.frostDur; e.slowAmt = 0.3 + 0.15 * (s.frost - 1); }
  if (s.burn) { e.burnT = 2.5 + s.burnDur; e.burnDps = Math.max(e.burnDps, s.dmg * 0.3 * s.burn * s.burnD); }
  if (s.chain) chainFrom(e, dmg * 0.4 * s.chainD, s.chain);
}

function chainFrom(e, dmg, n) {
  let cur = e;
  const hit = [e.id];
  for (let k = 0; k < n; k++) {
    let best = null, bd = 115 * 115;
    for (const o of G.enemies) {
      if (o.dead || o.untarget || hit.indexOf(o.id) !== -1) continue;
      const d = dist2(cur.x, cur.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) break;
    bolt(cur.x, cur.y, best.x, best.y);
    hit.push(best.id);
    damageEnemy(best, dmg, false, 0, 0, true);
    cur = best;
  }
  if (hit.length > 1) sfx('chain');
}

function updateBlades(dt) {
  const p = G.player, s = G.stats;
  p.blades.length = 0;
  if (s.orbit <= 0) return;
  p.orbitA += dt * 3.6 * s.orbitSpd;
  const R = 40;
  for (let k = 0; k < s.orbit; k++) {
    const a = p.orbitA + (k * TAU) / s.orbit;
    const bx = p.x + Math.cos(a) * R, by = p.y + Math.sin(a) * R;
    p.blades.push(bx, by, a);
    for (const e of G.enemies) {
      if (e.dead || e.untarget || e.orbitCd > 0) continue;
      const rr = e.r + 8;
      if (dist2(bx, by, e.x, e.y) < rr * rr) {
        e.orbitCd = 0.28 / s.orbitSpd;
        damageEnemy(e, s.dmg * 0.75, false, Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2), true);
        sparks(bx, by, a + Math.PI / 2, 1, '#ffffff', 3, 120);
      }
    }
    for (let j = G.eb.length - 1; j >= 0; j--) {
      const o = G.eb[j];
      if (o.delay > 0) continue;
      const rr = o.r + 7;
      if (dist2(bx, by, o.x, o.y) < rr * rr) { sparks(o.x, o.y, 0, TAU, o.color, 3, 70); killEB(j); }
    }
  }
}

// ================= Enemy projectiles =================
function fireEB(x, y, ang, speed, o) {
  if (G.eb.length > 260) return null;
  const b = ebPool.pop() || {};
  if (ascMod(2)) speed *= 1.12;
  b.x = x; b.y = y; b.vx = Math.cos(ang) * speed; b.vy = Math.sin(ang) * speed;
  b.r = (o && o.r) || 5; b.color = (o && o.color) || COL.eBullet;
  b.life = (o && o.life) || 7; b.hp = (o && o.hp) || 0;
  b.homing = (o && o.homing) || 0; b.turn = (o && o.turn) || 0;
  b.delay = (o && o.delay) || 0; b.dvx = (o && o.dvx) || 0; b.dvy = (o && o.dvy) || 0;
  b.accel = (o && o.accel) || 0; b.maxSp = (o && o.maxSp) || 400;
  G.eb.push(b);
  return b;
}
function killEB(i) { ebPool.push(G.eb[i]); swapRemove(G.eb, i); }

function clearEnemyBullets(sparkle) {
  if (sparkle) for (const b of G.eb) if (Math.random() < 0.5) part(b.x, b.y, 0, -20, 0.4, 3, b.color, 1, 0);
  while (G.eb.length) { ebPool.push(G.eb.pop()); }
}

function updateEnemyBullets(dt) {
  const p = G.player, arr = G.eb;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    b.life -= dt;
    if (b.life <= 0) { killEB(i); continue; }
    if (b.delay > 0) {
      b.delay -= dt;
      if (b.delay <= 0) { b.vx = b.dvx; b.vy = b.dvy; }
      continue;
    }
    if (b.homing && p.alive) {
      const cur = Math.atan2(b.vy, b.vx), want = Math.atan2(p.y - b.y, p.x - b.x);
      const na = cur + clamp(angleDiff(cur, want), -b.turn * dt, b.turn * dt), sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
    }
    if (b.accel) {
      const sp = Math.hypot(b.vx, b.vy), ns = Math.min(b.maxSp, sp + b.accel * dt);
      if (sp > 0) { b.vx *= ns / sp; b.vy *= ns / sp; }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (solidAt(b.x, b.y)) { sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 1.2, b.color, 2, 60); killEB(i); continue; }
    if (p.alive) {
      const rr = b.r + PLAYER_HITBOX;
      if (dist2(b.x, b.y, p.x, p.y) < rr * rr) {
        // hurtPlayer may clear nearby bullets (mutating this array), so re-locate b afterwards
        if (hurtPlayer(b.x, b.y)) {
          const k = arr.indexOf(b);
          if (k !== -1) killEB(k);
          i = Math.min(i, arr.length);
          continue;
        }
      }
    }
  }
}

// ================= Enemies =================
function spawnEnemy(type, x, y, elite, into) {
  const d = ENEMY[type], sc = G.scale;
  const e = {
    id: G.nextId++, type, x, y,
    r: d.r * (elite ? 1.3 : 1),
    hp: d.hp * sc.hp * (elite ? 3.2 : 1),
    speed: d.speed * sc.spd * (elite ? 1.08 : 1) * rand(0.92, 1.08),
    color: d.color, elite: !!elite,
    vx: 0, vy: 0, kx: 0, ky: 0,
    t: rand(0, 1), state: 'move', st: 0, atk: rand(0.9, 2.2), charge: 0,
    flash: 0, slowT: 0, slowAmt: 0, burnT: 0, burnDps: 0, burnAcc: 0, orbitCd: 0,
    dead: false, untarget: false, strafe: chance(0.5) ? 1 : -1, wob: rand(0, TAU),
    ax: 0, ay: 0, spawnIn: 0.25, roomId: -1, home: null, sleep: false,
  };
  e.maxHp = e.hp;
  (into || G.newEnemies).push(e);
  return e;
}

function addMarker(type, elite, room) {
  const spot = freeSpot(room ? 110 : 150, ENEMY[type].r * (elite ? 1.3 : 1), room);
  G.markers.push({ type, elite, x: spot.x, y: spot.y, t: 0, dur: 0.8, roomId: room ? room.id : -1, home: room || null });
}

function updateMarkers(dt) {
  for (let i = G.markers.length - 1; i >= 0; i--) {
    const m = G.markers[i];
    m.t += dt;
    if (m.t >= m.dur) {
      const e = spawnEnemy(m.type, m.x, m.y, m.elite);
      e.roomId = m.roomId; e.home = m.home;
      burst(m.x, m.y, ENEMY[m.type].color, 8, 80, 0.35, 2.5);
      G.markers.splice(i, 1);
    }
  }
}

function steer(e, tx, ty, speed, dt, accel = 7) {
  const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1;
  const k = 1 - Math.exp(-dt * accel);
  e.vx += ((dx / l) * speed - e.vx) * k;
  e.vy += ((dy / l) * speed - e.vy) * k;
}
// Where an enemy should walk to reach the player (refreshed 4x/s).
function chaseTarget(e, dt) {
  const p = G.player;
  e.pathT = (e.pathT || 0) - dt;
  if (e.pathT <= 0 || (!e.wpOk && dist2(e.x, e.y, e.wpx, e.wpy) < 12 * 12)) {
    e.pathT = 0.2;
    const w = routeTo(e.x, e.y, e.r, p.x, p.y);
    e.wpOk = !w;
    if (w) { e.wpx = w.x; e.wpy = w.y; }
  }
  return e.wpOk ? { x: p.x, y: p.y } : { x: e.wpx, y: e.wpy };
}

function brake(e, dt, rate = 8) { const k = Math.exp(-dt * rate); e.vx *= k; e.vy *= k; }

const AI = {
  grunt(e, dt, sm) {
    const p = G.player;
    e.wob += dt * 5;
    const tg = chaseTarget(e, dt);
    const dx = tg.x - e.x, dy = tg.y - e.y, l = Math.hypot(dx, dy) || 1;
    const w = e.wpOk === false ? 0 : Math.sin(e.wob) * 0.45;
    const tx = e.x + (dx / l) * 50 - (dy / l) * 50 * w, ty = e.y + (dy / l) * 50 + (dx / l) * 50 * w;
    steer(e, tx, ty, e.speed * sm * (e.elite ? 1.15 : 1), dt, 6);
  },
  mini(e, dt, sm) { AI.grunt(e, dt, sm); },
  spitter(e, dt, sm) {
    const p = G.player;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    const dx = (p.x - e.x) / (d || 1), dy = (p.y - e.y) / (d || 1);
    const tg = chaseTarget(e, dt);
    if (e.charge > 0) brake(e, dt, 6);
    else if (d > 230 || !e.wpOk) steer(e, tg.x, tg.y, e.speed * sm, dt, 4);
    else if (d < 140) steer(e, e.x - dx * 50, e.y - dy * 50, e.speed * sm, dt, 4);
    else { e.st += dt; if (e.st > 2.4) { e.st = 0; e.strafe *= -1; } steer(e, e.x - dy * 50 * e.strafe, e.y + dx * 50 * e.strafe, e.speed * sm * 0.7, dt, 3); }
    e.atk -= dt * G.scale.fire;
    if (e.atk <= 0.55 && e.charge === 0) e.charge = 0.001;
    if (e.charge > 0) e.charge = Math.min(1, 1 - e.atk / 0.55);
    if (e.atk <= 0) {
      e.atk = rand(2.1, 2.7); e.charge = 0;
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      if (e.elite) for (let k = -1; k <= 1; k++) fireEB(e.x, e.y, a + k * 0.28, 150);
      else fireEB(e.x, e.y, a, 150);
      sfx('eshoot');
    }
  },
  charger(e, dt, sm) {
    const p = G.player;
    e.st += dt;
    if (e.state === 'move') {
      const tg = chaseTarget(e, dt);
      steer(e, tg.x, tg.y, e.speed * sm, dt, 4);
      if ((dist2(e.x, e.y, p.x, p.y) < 210 * 210 && e.st > 0.8 && hasLOS(e.x, e.y, p.x, p.y)) || e.st > 3.5) { e.state = 'aim'; e.st = 0; }
    } else if (e.state === 'aim') {
      brake(e, dt, 10);
      const aimT = e.elite ? 0.6 : 0.75;
      if (e.st < aimT - 0.3) e.ang = Math.atan2(p.y - e.y, p.x - e.x);
      e.charge = e.st / aimT;
      if (e.st >= aimT) { e.state = 'dash'; e.st = 0; e.charge = 0; sfx('dash'); }
    } else if (e.state === 'dash') {
      const sp = (e.elite ? 400 : 350) * G.scale.spd * sm;
      e.vx = Math.cos(e.ang) * sp; e.vy = Math.sin(e.ang) * sp;
      if (Math.random() < 0.5) part(e.x, e.y, 0, 0, 0.2, 6, 'rgba(255,90,90,0.5)', 0);
      if (e.st > 0.6 || e.wallHit) { e.state = 'stun'; e.st = 0; if (e.wallHit) { addShake(0.12); sparks(e.x, e.y, e.ang + Math.PI, 1.5, e.color, 6, 120); } }
    } else if (e.state === 'stun') {
      brake(e, dt, 10);
      if (e.st > 0.7) { e.state = 'move'; e.st = 0; }
    }
  },
  blob(e, dt, sm) {
    const p = G.player;
    e.wob += dt * 3;
    const tg = chaseTarget(e, dt);
    steer(e, tg.x, tg.y, e.speed * sm * (0.7 + 0.5 * Math.abs(Math.sin(e.wob))), dt, 3);
  },
  bomber(e, dt, sm) {
    const p = G.player;
    if (e.state === 'move') {
      const tg = chaseTarget(e, dt);
      steer(e, tg.x, tg.y, e.speed * sm, dt, 5);
      if (dist2(e.x, e.y, p.x, p.y) < 52 * 52) { e.state = 'fuse'; e.st = 0; }
    } else {
      brake(e, dt, 12);
      e.st += dt;
      e.charge = e.st / 0.75;
      if (((e.st * 12) | 0) !== (((e.st - dt) * 12) | 0)) sfx('fuse');
      if (e.st >= 0.75) {
        const R = e.elite ? 80 : 64;
        if (dist2(e.x, e.y, p.x, p.y) < (R + PLAYER_HITBOX) * (R + PLAYER_HITBOX)) hurtPlayer(e.x, e.y);
        G.explosions.push({ x: e.x, y: e.y, r: R, dmg: 30 * G.scale.hp, fx: true });
        e.noDrop = true;
        killEnemy(e);
      }
    }
  },
  sentinel(e, dt, sm) {
    const p = G.player;
    e.wob += dt;
    // a turret hiding behind cover for too long walks out until it can see the player
    e.losT = (e.losT || 0) - dt;
    if (e.losT <= 0) { e.losT = 0.3; e.blind = hasLOS(e.x, e.y, p.x, p.y) ? 0 : (e.blind || 0) + 0.3; }
    if (e.blind > 2.5) { const tg = chaseTarget(e, dt); steer(e, tg.x, tg.y, Math.max(40, e.speed * 2) * sm, dt, 2); }
    const hm = e.home || (G.circle ? { x: G.circle.x - G.circle.R * 0.7, y: G.circle.y - G.circle.R * 0.7, w: G.circle.R * 1.4, h: G.circle.R * 1.4 } : { x: 0, y: 0, w: G.W, h: G.H });
    const tx = hm.x + hm.w / 2 + Math.cos(e.wob * 0.4 + e.id) * hm.w * 0.3, ty = hm.y + hm.h / 2 + Math.sin(e.wob * 0.3 + e.id) * hm.h * 0.3;
    if (!(e.blind > 2.5)) steer(e, tx, ty, e.speed * sm, dt, 1.5);
    e.atk -= dt * G.scale.fire;
    if (e.atk <= 0.7 && e.charge === 0) e.charge = 0.001;
    if (e.charge > 0) e.charge = Math.min(1, 1 - e.atk / 0.7);
    if (e.atk <= 0) {
      e.atk = rand(2.9, 3.5); e.charge = 0;
      const n = e.elite ? 12 : 8, off = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / n;
      for (let k = 0; k < n; k++) fireEB(e.x, e.y, off + (k * TAU) / n, 115, { color: '#c98bff' });
      if (e.elite) for (let k = 0; k < n; k++) fireEB(e.x, e.y, off + ((k + 0.5) * TAU) / n, 80, { color: '#c98bff' });
      ring(e.x, e.y, e.r, e.r + 18, 0.25, e.color, 2);
      sfx('eshoot');
    }
  },
  fake(e, dt, sm) { mirrorCopyAI(e, dt, sm); },

  // Leaper: crouches, jumps onto where you stood (red circle), small shockwave on landing.
  leaper(e, dt, sm) {
    const p = G.player;
    e.st += dt;
    if (e.state === 'move') {
      const tg = chaseTarget(e, dt);
      steer(e, tg.x, tg.y, e.speed * sm, dt, 4);
      e.atk -= dt * G.scale.fire;
      if (e.atk <= 0 && dist2(e.x, e.y, p.x, p.y) < 270 * 270 && hasLOS(e.x, e.y, p.x, p.y)) {
        e.state = 'crouch'; e.st = 0; e.sx = e.x; e.sy = e.y;
        const spot = spotFree(p.x, p.y, e.r) ? p : e;
        e.tx = spot.x; e.ty = spot.y;
      }
    } else if (e.state === 'crouch') {
      brake(e, dt, 12);
      e.charge = e.st / 0.45;
      if (e.st >= 0.45) { e.state = 'air'; e.st = 0; e.air = true; e.untarget = true; e.sx = e.x; e.sy = e.y; e.charge = 0; sfx('jump'); }
    } else if (e.state === 'air') {
      const T0 = e.elite ? 0.5 : 0.6, k = Math.min(1, e.st / T0);
      e.vx = e.vy = 0;
      e.x = lerp(e.sx, e.tx, k); e.y = lerp(e.sy, e.ty, k);
      e.airK = k;
      if (k >= 1) {
        e.air = false; e.untarget = false; e.airK = 0; e.state = 'recover'; e.st = 0;
        const R = 40 + PLAYER_HITBOX;
        if (dist2(e.x, e.y, p.x, p.y) < R * R) hurtPlayer(e.x, e.y);
        ring(e.x, e.y, 6, 44, 0.25, e.color, 3); addShake(0.1); sfx('slam');
        if (G.run.floor >= 12 || e.elite) { const n = e.elite ? 8 : 6, off = Math.random() * TAU; for (let i = 0; i < n; i++) fireEB(e.x, e.y, off + (i * TAU) / n, 105); }
      }
    } else if (e.state === 'recover') {
      brake(e, dt, 8);
      if (e.st > 0.6) { e.state = 'move'; e.st = 0; e.atk = rand(2.2, 3.0); }
    }
  },

  // Sniper: keeps its distance, paints a laser line, then fires one very fast shot along it.
  sniper(e, dt, sm) {
    const p = G.player;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    e.losT = (e.losT || 0) - dt;
    if (e.losT <= 0) { e.losT = 0.25; e.seen = hasLOS(e.x, e.y, p.x, p.y); }
    if (e.state === 'aim') {
      brake(e, dt, 10);
      e.st += dt;
      if (e.st < 0.75) e.ang = Math.atan2(p.y - e.y, p.x - e.x);
      e.charge = Math.min(1, e.st / 1.0);
      if (e.st >= 1.0) {
        e.state = 'move'; e.st = 0; e.charge = 0; e.atk = rand(2.8, 3.4);
        fireEB(e.x, e.y, e.ang, 430, { r: 4, color: '#dfe3ff' });
        if (e.elite) { fireEB(e.x, e.y, e.ang + 0.12, 430, { r: 4, color: '#dfe3ff' }); fireEB(e.x, e.y, e.ang - 0.12, 430, { r: 4, color: '#dfe3ff' }); }
        sfx('laser');
      }
      return;
    }
    const tg = chaseTarget(e, dt);
    if (!e.seen || d > 330) steer(e, tg.x, tg.y, e.speed * sm, dt, 4);
    else if (d < 210) steer(e, e.x - (p.x - e.x), e.y - (p.y - e.y), e.speed * sm, dt, 4);
    else brake(e, dt, 4);
    e.atk -= dt * G.scale.fire;
    if (e.atk <= 0 && e.seen) { e.state = 'aim'; e.st = 0; }
  },

  // Shielder: a frontal shield (turning slowly) blocks bullets. Rhythm: it closes in, winds up and
  // bashes forward, then staggers with the shield DOWN for a moment — that is your window (or flank it).
  shielder(e, dt, sm) {
    const p = G.player;
    const want = Math.atan2(p.y - e.y, p.x - e.x);
    if (e.face === undefined) e.face = want;
    e.shieldFlash = Math.max(0, (e.shieldFlash || 0) - dt);
    e.st += dt;
    if (e.state === 'move') {
      e.face += clamp(angleDiff(e.face, want), -1.1 * dt, 1.1 * dt);
      const tg = chaseTarget(e, dt);
      steer(e, tg.x, tg.y, e.speed * sm * (e.elite ? 1.2 : 1), dt, 3);
      if ((dist2(e.x, e.y, p.x, p.y) < 95 * 95 && e.st > 1.2) || e.st > 5) { e.state = 'windup'; e.st = 0; }
    } else if (e.state === 'windup') {
      brake(e, dt, 10);
      e.face += clamp(angleDiff(e.face, want), -2 * dt, 2 * dt);
      e.charge = e.st / 0.45;
      if (e.st >= 0.45) { e.state = 'bash'; e.st = 0; e.charge = 0; sfx('dash'); }
    } else if (e.state === 'bash') {
      const sp = 330 * G.scale.spd;
      e.vx = Math.cos(e.face) * sp; e.vy = Math.sin(e.face) * sp;
      if (e.st > 0.32 || e.wallHit) { e.state = 'stagger'; e.st = 0; addShake(0.06); }
    } else if (e.state === 'stagger') {
      brake(e, dt, 8);
      if (e.st > (e.elite ? 0.9 : 1.2)) { e.state = 'move'; e.st = 0; }
    }
  },

  // Brood: hangs back and hatches mites.
  brood(e, dt, sm) {
    const p = G.player;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    const tg = chaseTarget(e, dt);
    if (d < 180) steer(e, e.x - (p.x - e.x), e.y - (p.y - e.y), e.speed * sm, dt, 3);
    else if (d > 300 || e.wpOk === false) steer(e, tg.x, tg.y, e.speed * sm, dt, 3);
    else brake(e, dt, 3);
    e.atk -= dt * G.scale.fire;
    e.charge = e.atk < 0.6 ? 1 - e.atk / 0.6 : 0;
    if (e.atk <= 0) {
      e.atk = rand(3.2, 3.8);
      let mine = 0;
      for (const o of G.enemies) if (!o.dead && o.parentId === e.id) mine++;
      const n = Math.min(e.elite ? 3 : 2, 5 - mine);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU;
        const m = spawnEnemy('mite', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, false);
        m.parentId = e.id; m.roomId = e.roomId; m.home = e.home; m.spawnIn = 0.2;
        m.kx = Math.cos(a) * 120; m.ky = Math.sin(a) * 120;
      }
      if (n > 0) { burst(e.x, e.y, e.color, 8, 90, 0.35, 2); sfx('spawn'); }
    }
  },
  mite(e, dt, sm) {
    const tg = chaseTarget(e, dt);
    e.wob += dt * 9;
    steer(e, tg.x + Math.cos(e.wob) * 14, tg.y + Math.sin(e.wob) * 14, e.speed * sm, dt, 7);
  },

  // Mortar: lobs shells that land on your position after a visible countdown circle.
  mortar(e, dt, sm) {
    const p = G.player;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    const tg = chaseTarget(e, dt);
    if (d < 150) steer(e, e.x - (p.x - e.x), e.y - (p.y - e.y), e.speed * sm, dt, 3);
    else if (d > 340) steer(e, tg.x, tg.y, e.speed * sm, dt, 3);
    else brake(e, dt, 4);
    e.ang = Math.atan2(p.y - e.y, p.x - e.x);
    e.atk -= dt * G.scale.fire;
    e.charge = e.atk < 0.5 ? 1 - e.atk / 0.5 : 0;
    if (e.atk <= 0) {
      e.atk = rand(2.8, 3.4);
      const n = e.elite ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const ox = k ? rand(-50, 50) : 0, oy = k ? rand(-50, 50) : 0;
        G.shells.push({ x0: e.x, y0: e.y, tx: p.x + ox, ty: p.y + oy, t: 0, dur: 1.15, r: 40 });
      }
      sfx('eshoot');
    }
  },
};

// Mortar shells: parabolic lob with a landing circle; explode on the ground.
function updateShells(dt) {
  const p = G.player;
  for (let i = G.shells.length - 1; i >= 0; i--) {
    const sh = G.shells[i];
    sh.t += dt;
    if (sh.t < sh.dur) continue;
    G.shells.splice(i, 1);
    ring(sh.tx, sh.ty, 6, sh.r, 0.3, '#ffb070', 3);
    burst(sh.tx, sh.ty, '#ffb070', 12, 160, 0.4, 3);
    addShake(0.12); sfx('explode');
    const R = sh.r + PLAYER_HITBOX;
    if (p.alive && dist2(sh.tx, sh.ty, p.x, p.y) < R * R) hurtPlayer(sh.tx, sh.ty);
    if (sh.pool && G.pools.length < 10) G.pools.push({ x: sh.tx, y: sh.ty, r: sh.r, t: 0, life: G.boss && (G.boss.hard || G.boss.phase2) ? 6 : 5 });
  }
}

// Shielder: bullets arriving within ±60° of its facing are blocked.
function shieldBlocks(e, b) {
  if (e.type !== 'shielder' || e.state === 'stagger' || e.state === 'bash') return false;
  const p = G.player;
  if (dist2(p.x, p.y, e.x, e.y) < (e.r + 16) * (e.r + 16)) return false; // shooting from point blank goes round the shield
  const from = Math.atan2(b.py - e.y, b.px - e.x);
  if (Math.abs(angleDiff(e.face || 0, from)) > (e.elite ? 1.2 : 1.05)) return false;
  e.shieldFlash = 0.12;
  sparks(b.x, b.y, from, 1.2, '#e8ecff', 3, 120);
  sfx('shield');
  return true;
}


function updateEnemies(dt) {
  const p = G.player;
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.orbitCd = Math.max(0, e.orbitCd - dt);
    e.spawnIn = Math.max(0, e.spawnIn - dt);
    let sm = 1;
    if (e.slowT > 0) { e.slowT -= dt; sm *= 1 - e.slowAmt * (e.type === 'boss' ? 0.5 : 1); }
    if (e.burnT > 0) {
      e.burnT -= dt; e.burnAcc += dt;
      if (e.burnAcc >= 0.25) {
        e.burnAcc -= 0.25;
        damageEnemy(e, e.burnDps * 0.25, false, 0, 0, true);
        if (Math.random() < 0.6) part(e.x + rand(-e.r, e.r) * 0.6, e.y, rand(-10, 10), -40, 0.4, 3, COL.burn, 1);
      }
      if (e.burnT <= 0) e.burnDps = 0;
      if (e.dead) continue;
    }
    if (e.sleep) {
      if (e.hp < e.maxHp || (dist2(e.x, e.y, p.x, p.y) < 210 * 210 && hasLOS(e.x, e.y, p.x, p.y))) {
        e.sleep = false;
        floatText(e.x, e.y - e.r - 6, '!', '#ffffff', 14, 0.6);
      } else { e.vx = e.vy = 0; continue; }
    }
    e.wallHit = false;
    if (e.type === 'boss') updateBoss(e, dt, sm);
    else AI[e.type](e, dt, sm);
    if (e.dead) continue;
    e.x += (e.vx + e.kx) * dt; e.y += (e.vy + e.ky) * dt;
    const kd = Math.exp(-dt * 9); e.kx *= kd; e.ky *= kd;
    if (collideWorld(e, e.r)) e.wallHit = true;
    // enemies of the room being fought can never leave it (locked gates are only one tile thick)
    const act = G.room && G.room.active;
    if (act && e.roomId === act.id) {
      const nx = clamp(e.x, act.x + e.r, act.x + act.w - e.r), ny = clamp(e.y, act.y + e.r, act.y + act.h - e.r);
      if (nx !== e.x || ny !== e.y) { e.x = nx; e.y = ny; e.wallHit = true; }
    }
    if (p.alive && !e.air && e.spawnIn <= 0) {
      const rr = e.r + PLAYER_HITBOX;
      if (dist2(e.x, e.y, p.x, p.y) < rr * rr) hurtPlayer(e.x, e.y);
    }
  }
  // soft separation
  const es = G.enemies, n = es.length;
  for (let i = 0; i < n; i++) {
    const a = es[i];
    if (a.dead || a.air) continue;
    for (let j = i + 1; j < n; j++) {
      const b = es[j];
      if (b.dead || b.air) continue;
      const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 0.01) continue;
      const d = Math.sqrt(d2), push = (min - d) * 0.5, ux = dx / d, uy = dy / d;
      const wa = a.type === 'boss' ? 0 : b.type === 'boss' ? 2 : 1;
      const wb = b.type === 'boss' ? 0 : a.type === 'boss' ? 2 : 1;
      a.x -= ux * push * wa; a.y -= uy * push * wa;
      b.x += ux * push * wb; b.y += uy * push * wb;
    }
  }
}

function damageEnemy(e, dmg, crit, kx, ky, quiet) {
  if (e.dead || e.untarget) return;
  if (e.invuln) { if (!quiet) sparks(e.x, e.y, 0, TAU, '#ffffff', 2, 60); return; }
  e.hp -= dmg;
  e.flash = 0.08;
  G.run.dmg += dmg;
  if (e.type !== 'boss' && (kx || ky)) {
    const kb = (e.elite ? 40 : 90) * G.stats.knock * (crit ? 1.5 : 1);
    e.kx += kx * kb; e.ky += ky * kb;
  }
  if (crit) {
    floatText(e.x + rand(-6, 6), e.y - e.r - 4, String(Math.round(dmg)), COL.pCrit, 12, 0.6);
    sparks(e.x, e.y, Math.atan2(ky, kx), 1.2, COL.pCrit, 5, 180);
    sfx('crit');
  } else if (!quiet) {
    sparks(e.x, e.y, Math.atan2(ky, kx), 1.2, e.color, 2, 130);
    sfx('hit');
  }
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e, silent) {
  if (e.dead) return;
  e.dead = true;
  if (silent) { burst(e.x, e.y, e.color, 6, 60, 0.35, 2); return; }
  const s = G.stats, run = G.run;
  if (e.type === 'boss') { onBossDeath(e); return; }
  if (e.type === 'fake') { onFakeDeath(e); return; }
  run.kills++;
  burst(e.x, e.y, e.color, e.elite ? 22 : 12, e.elite ? 200 : 150, 0.5, 3);
  burst(e.x, e.y, '#ffffff', 4, 90, 0.2, 2);
  ring(e.x, e.y, e.r * 0.5, e.r * 2.2, 0.22, e.color, 2);
  sfx(e.elite ? 'bigkill' : 'kill');
  if (e.elite) { hitstop(0.05); addShake(0.2); run.elites++; }
  else addShake(0.04);
  if (!e.noDrop) {
    if (e.elite) dropPickup(e.x, e.y, 'shard', 5);
    else if (Math.random() < 0.55) dropPickup(e.x, e.y, 'shard', 1);
    if (Math.random() < (0.025 + s.vamp + (e.elite ? 0.2 : 0)) * (ascMod(4) ? 0.5 : 1)) dropPickup(e.x, e.y, 'heart', 1);
  }
  if (e.type === 'blob') {
    const n = e.elite ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k * TAU) / n + Math.random();
      const m = spawnEnemy('mini', e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, false);
      m.kx = Math.cos(a) * 160; m.ky = Math.sin(a) * 160; m.spawnIn = 0.35; m.roomId = e.roomId; m.home = e.home;
    }
  }
  if (e.type === 'bomber' && !e.noDrop) G.explosions.push({ x: e.x, y: e.y, r: 48, dmg: 20 * G.scale.hp, fx: true, small: true });
  if (s.volatile > 0) G.explosions.push({ x: e.x, y: e.y, r: (40 + 14 * s.volatile) * s.volR, dmg: s.dmg * (0.6 + 0.3 * s.volatile) * s.volD, fx: true, small: true, vol: true });
}

function processExplosions() {
  let guard = 0;
  while (G.explosions.length && guard++ < 40) {
    const x = G.explosions.shift();
    if (x.fx) {
      ring(x.x, x.y, 4, x.r, 0.28, x.vol ? '#ffcf6b' : '#ffe14d', x.small ? 2 : 4);
      burst(x.x, x.y, x.vol ? '#ffb13d' : '#ffe14d', x.small ? 8 : 18, x.r * 3, 0.4, 3);
      addShake(x.small ? 0.08 : 0.3);
      sfx(x.small ? 'kill' : 'explode');
    }
    for (const e of G.enemies) {
      if (e.dead || e.untarget) continue;
      const rr = x.r + e.r;
      if (dist2(x.x, x.y, e.x, e.y) < rr * rr) {
        const d = Math.sqrt(dist2(x.x, x.y, e.x, e.y)) || 1;
        damageEnemy(e, x.dmg, false, (e.x - x.x) / d, (e.y - x.y) / d, true);
      }
    }
  }
  G.explosions.length = 0;
}

// ================= Player damage =================
// noDodge: attacks that dashing cannot pass through (The Counterweight)
function hurtPlayer(sx, sy, noDodge) {
  const p = G.player;
  if (!p.alive || G.state !== 'play') return false;
  if (p.dashIfr > 0 && !noDodge) {
    if (!p.dodged) { p.dodged = true; perfectDodge(); }
    return false;
  }
  if (p.iframes > 0) return false;
  const run = G.run, s = G.stats;
  if (p.shield > 0) {
    p.shield = 0; p.shieldT = s.aegisCd; p.iframes = 0.7;
    ring(p.x, p.y, 10, 40, 0.3, '#9fd8ff', 3);
    burst(p.x, p.y, '#9fd8ff', 12, 160, 0.4, 3);
    sfx('shield'); hitstop(0.04);
    clearBulletsNear(p.x, p.y, 50);
    return true;
  }
  p.hp -= 1; run.hurt++;
  p.iframes = 1.1;
  G.flash = 1;
  addShake(0.45); hitstop(0.07);
  sfx('hurt');
  burst(p.x, p.y, '#ff4f6b', 14, 170, 0.45, 3);
  const d = Math.hypot(p.x - sx, p.y - sy) || 1;
  p.vx = ((p.x - sx) / d) * 260; p.vy = ((p.y - sy) / d) * 260;
  clearBulletsNear(p.x, p.y, 46);
  G.hudDirty = true;
  if (p.hp <= 0) {
    if ((Save.metaLvl('wind') > 0) && !run.windUsed) {
      run.windUsed = true;
      p.hp = Math.ceil(s.maxHp / 2); p.iframes = 2.2;
      clearEnemyBullets(true);
      ring(p.x, p.y, 10, 160, 0.6, COL.player, 5);
      slowmo(0.8, 0.3);
      showBanner('SECOND WIND', 'Not over yet.');
      sfx('upgrade');
    } else playerDie();
  }
  return true;
}

function clearBulletsNear(x, y, r) {
  for (let i = G.eb.length - 1; i >= 0; i--) {
    const b = G.eb[i];
    if (dist2(b.x, b.y, x, y) < r * r) { part(b.x, b.y, 0, 0, 0.25, 3, b.color, 0); killEB(i); }
  }
}

// ================= Pickups =================
function dropPickup(x, y, type, value) {
  if (G.pickups.length > 120) { G.run.shards += type === 'shard' ? value : 0; return; }
  const a = Math.random() * TAU, sp = rand(40, 120);
  G.pickups.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, type, value, t: 0, magnet: false });
}

function updatePickups(dt) {
  const p = G.player;
  const roomDone = G.room.phase !== 'fight';
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const k = G.pickups[i];
    k.t += dt;
    const d2 = dist2(k.x, k.y, p.x, p.y);
    if (p.alive && (roomDone || d2 < 3600 * G.stats.magnet * G.stats.magnet || k.magnet) && k.t > 0.35) k.magnet = true;
    if (k.magnet && p.alive) {
      const d = Math.sqrt(d2) || 1, sp = 260 + k.t * 120;
      k.vx = ((p.x - k.x) / d) * sp; k.vy = ((p.y - k.y) / d) * sp;
    } else { const f = Math.exp(-dt * 4); k.vx *= f; k.vy *= f; }
    k.x += k.vx * dt; k.y += k.vy * dt;
    collideWorld(k, 4);
    if (p.alive && d2 < 16 * 16 && k.t > 0.2) {
      if (k.type === 'shard') { G.run.shards += k.value; sfx('pickup'); part(k.x, k.y, 0, -30, 0.3, 3, COL.shard, 2); }
      else if (p.hp < G.stats.maxHp) healPlayer(k.value);
      else { G.run.shards += 3; floatText(p.x, p.y - 16, '+3', COL.shard, 11); sfx('pickup'); }
      G.pickups.splice(i, 1);
      G.hudDirty = true;
    }
  }
}
