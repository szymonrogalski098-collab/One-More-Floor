'use strict';
// Canvas renderer. Static floor is pre-rendered to an offscreen canvas per room;
// glows are cached radial sprites; bullets are batched into single paths.

const ZONES = [
  { a: '#14122c', b: '#171534', edge: '#6c5cff', name: 'Foundations' },
  { a: '#0e1922', b: '#11202a', edge: '#2fd6c3', name: 'Flooded Halls' },
  { a: '#1c0f1f', b: '#221226', edge: '#ff4f8b', name: 'Crimson Floors' },
  { a: '#1b150c', b: '#211a0f', edge: '#ffb13d', name: 'The Forge' },
  { a: '#140f23', b: '#1a122f', edge: '#b36bff', name: 'The Summit' },
];
function zoneFor(floor) { return ZONES[Math.floor((floor - 1) / 5) % ZONES.length]; }

const Render = {
  cv: null, ctx: null, sw: 0, sh: 0, scale: 1, offX: 0, offY: 0, VW: 360, VH: 600,
  cam: { x: 180, y: 300 },
  floorCv: null, floorK: 1, glow: new Map(), vignette: null, dmgVignette: null,

  init(cv) {
    this.cv = cv;
    this.ctx = cv.getContext('2d', { alpha: false });
    this.floorCv = document.createElement('canvas');
    this.resize();
  },

  resize() {
    this.sw = window.innerWidth; this.sh = window.innerHeight;
    const d = Q.dpr;
    this.cv.width = Math.round(this.sw * d); this.cv.height = Math.round(this.sh * d);
    this.cv.style.width = this.sw + 'px'; this.cv.style.height = this.sh + 'px';
    this.layout();
    this.vignette = this.makeVignette('rgba(0,0,0,0.55)');
    this.dmgVignette = this.makeVignette('rgba(255,30,70,0.85)');
    if (G.run) this.buildFloor();
  },

  // The "view box" is a VW x VH window of the world, scaled to fit the screen under the HUD.
  layout() {
    const landscape = this.sw > this.sh * 1.15;
    const { VW, VH } = viewDims();
    this.VW = VW; this.VH = VH;
    const safeTop = UI.safeTop();
    const botRes = landscape ? 22 : 10;
    const availW = this.sw - 8;
    let topRes = (landscape ? 52 : 62) + safeTop;
    // portrait: leave room for the upgrade-chip row if it costs little arena size
    if (!landscape && (this.sh - 90 - safeTop - botRes) / VH >= (availW / VW) * 0.95) topRes = 90 + safeTop;
    this.topRes = topRes;
    const availH = this.sh - topRes - botRes;
    this.scale = Math.max(0.3, Math.min(availW / VW, availH / VH));
    this.offX = (this.sw - VW * this.scale) / 2;
    this.offY = topRes + Math.max(0, (availH - VH * this.scale) * 0.35);
    const ups = document.getElementById('hud-ups');
    if (ups) ups.classList.toggle('overlap', !landscape && this.offY < 88 + safeTop);
  },

  // ---------- camera ----------
  camTarget() {
    const p = G.player, R = G.room;
    let tx = p ? p.x : G.W / 2, ty = p ? p.y : G.H / 2;
    if (G.bridge && (G.bridge.phase === 'run' || G.bridge.phase === 'arrive')) { tx = G.W / 2; ty = G.bridge.camY; } // the bridge scrolls on its own
    else if (R && R.active && R.active.w <= this.VW && R.active.h <= this.VH) { tx = R.active.x + R.active.w / 2; ty = R.active.y + R.active.h / 2; }
    else if (G.boss && !G.boss.dead && G.circle) { tx += (G.boss.x - tx) * 0.3; ty += (G.boss.y - ty) * 0.3; }
    const cx = G.W <= this.VW ? G.W / 2 : clamp(tx, this.VW / 2, G.W - this.VW / 2);
    const cy = G.H <= this.VH ? G.H / 2 : clamp(ty, this.VH / 2, G.H - this.VH / 2);
    return { x: cx, y: cy };
  },
  snapCamera() { const t = this.camTarget(); this.cam.x = t.x; this.cam.y = t.y; },
  updateCamera(dt) {
    if (!G.run || !G.player) return;
    const t = this.camTarget(), k = 1 - Math.exp(-dt * 6);
    this.cam.x += (t.x - this.cam.x) * k; this.cam.y += (t.y - this.cam.y) * k;
  },
  toWorld(sx, sy) {
    const s = this.scale;
    return { x: this.cam.x + (sx - this.offX - this.VW * s / 2) / s, y: this.cam.y + (sy - this.offY - this.VH * s / 2) / s };
  },
  toScreen(x, y) {
    const s = this.scale;
    return { x: this.offX + this.VW * s / 2 + (x - this.cam.x) * s, y: this.offY + this.VH * s / 2 + (y - this.cam.y) * s };
  },

  makeVignette(color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 60, 128, 128, 182);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, color);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return c;
  },

  glowSprite(color) {
    let c = this.glow.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color);
    gr.addColorStop(0.35, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.5;
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.glow.set(color, c);
    return c;
  },

  // Pre-render the static floor of the whole world once per floor (resolution capped for big maps).
  buildFloor() {
    this.layout();
    const z = zoneFor(G.run ? G.run.floor : 1);
    this.zone = z;
    const k = Math.min(this.scale * Q.dpr, Math.sqrt(7e6 / (G.W * G.H)));
    this.floorK = k;
    const c = this.floorCv;
    c.width = Math.max(1, Math.round(G.W * k));
    c.height = Math.max(1, Math.round(G.H * k));
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#07060f'; g.fillRect(0, 0, G.W, G.H);
    if (G.side) { this.buildSideBg(g, z); return; }
    if (G.bridge) { this.buildBridgeBg(g, z); return; }
    const grid = G.grid, cols = grid.cols, rows = grid.rows;
    const open = (tx, ty) => !solidTile(tx, ty);
    if (G.circle) {
      g.save(); hallPath(g); g.clip();
      this.drawHallFloor(g, G.circle, z);
      g.restore();
    } else {
      for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
        if (open(tx, ty)) {
          g.fillStyle = ((tx + ty) & 1) ? z.a : z.b; g.fillRect(tx * T, ty * T, T, T);
          if (Math.random() < 0.06) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(tx * T + 3, ty * T + 3, T - 6, T - 6); }
        } else if (open(tx - 1, ty) || open(tx + 1, ty) || open(tx, ty - 1) || open(tx, ty + 1) || open(tx - 1, ty - 1) || open(tx + 1, ty + 1) || open(tx - 1, ty + 1) || open(tx + 1, ty - 1)) {
          g.fillStyle = '#0d0b1f'; g.fillRect(tx * T, ty * T, T, T);
        }
      }
    }
    if (!G.circle) for (const rm of G.rooms || []) if (rm.variant) this.drawVariantFloor(g, rm);
    // cracks on open floor
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < Math.min(40, (G.W * G.H) / 30000); i++) {
      let x = rand(20, G.W - 20), y = rand(20, G.H - 20);
      if (solidAt(x, y)) continue;
      g.beginPath(); g.moveTo(x, y);
      for (let n = 0; n < 4; n++) { x += rand(-12, 12); y += rand(-12, 12); g.lineTo(x, y); }
      g.stroke();
    }
    // pillars (drawn before edges so the neon outline sits on top)
    for (const p of G.pillars) {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(p.x + 3, p.y + 5, p.w, p.h);
      if (p.crate) {
        g.fillStyle = '#3a2717'; g.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
        g.strokeStyle = '#b8742e'; g.lineWidth = 1.5; g.strokeRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
        g.beginPath(); g.moveTo(p.x + 3, p.y + 3); g.lineTo(p.x + p.w - 3, p.y + p.h - 3); g.moveTo(p.x + p.w - 3, p.y + 3); g.lineTo(p.x + 3, p.y + p.h - 3); g.stroke();
      } else {
        g.fillStyle = '#1f1b40'; g.fillRect(p.x, p.y, p.w, p.h);
        g.fillStyle = '#2c2758'; g.fillRect(p.x, p.y, p.w, Math.min(6, p.h / 3));
      }
    }
    // neon wall edges
    g.strokeStyle = z.edge;
    if (G.circle) {
      const cc = G.circle;
      g.strokeStyle = cc.kind && BOSSES[cc.kind] ? BOSSES[cc.kind].color : z.edge; // each hall glows in its boss's colour
      g.lineJoin = 'round';
      g.globalAlpha = 0.8; g.lineWidth = 3; hallPath(g); g.stroke();
      g.globalAlpha = 0.18; g.lineWidth = 10; hallPath(g, cc, 6); g.stroke();
    } else {
      g.lineWidth = 2; g.globalAlpha = 0.7;
      g.beginPath();
      for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
        if (!open(tx, ty)) continue;
        const x = tx * T, y = ty * T;
        if (!open(tx - 1, ty)) { g.moveTo(x, y); g.lineTo(x, y + T); }
        if (!open(tx + 1, ty)) { g.moveTo(x + T, y); g.lineTo(x + T, y + T); }
        if (!open(tx, ty - 1)) { g.moveTo(x, y); g.lineTo(x + T, y); }
        if (!open(tx, ty + 1)) { g.moveTo(x, y + T); g.lineTo(x + T, y + T); }
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  },

  // Floor art of the rare room variants (rooms.js): each looks like what it does.
  drawVariantFloor(g, rm) {
    const V = ROOM_VARIANTS[rm.variant], x0 = rm.x, y0 = rm.y, w = rm.w, h = rm.h;
    const open = (tx, ty) => { const v = G.grid.solid[ty * G.grid.cols + tx]; return v === 0; };
    const each = (fn) => { for (let ty = rm.ty; ty < rm.ty + rm.th; ty++) for (let tx = rm.tx; tx < rm.tx + rm.tw; tx++) if (open(tx, ty)) fn(tx * T, ty * T, tx, ty); };
    g.save();
    if (rm.variant === 'grand') { // big pale flagstones with a gold inlay
      each((x, y, tx, ty) => { g.fillStyle = (((tx >> 1) + (ty >> 1)) & 1) ? '#2e2a45' : '#35304f'; g.fillRect(x, y, T, T); });
      g.strokeStyle = 'rgba(255,212,77,0.35)'; g.lineWidth = 2; g.strokeRect(x0 + 2 * T, y0 + 2 * T, w - 4 * T, h - 4 * T);
      g.strokeStyle = 'rgba(255,212,77,0.18)'; g.strokeRect(x0 + 3 * T, y0 + 3 * T, w - 6 * T, h - 6 * T);
      g.fillStyle = 'rgba(255,212,77,0.22)'; g.beginPath(); g.arc(x0 + w / 2, y0 + h / 2, 2.2 * T, 0, TAU); g.fill();
    } else if (rm.variant === 'gauntlet') { // steel grating
      each((x, y) => { g.fillStyle = '#1d1a26'; g.fillRect(x, y, T, T); g.strokeStyle = 'rgba(255,138,61,0.12)'; g.lineWidth = 1; g.beginPath(); for (let k = 4; k < T; k += 5) { g.moveTo(x + k, y); g.lineTo(x, y + k); } g.stroke(); });
    } else if (rm.variant === 'corridor') { // a long carpet runner
      each((x, y, tx, ty) => { g.fillStyle = (tx & 1) ? '#231d36' : '#261f3b'; g.fillRect(x, y, T, T); });
      const cy = y0 + h / 2;
      g.fillStyle = '#3d1f4f'; g.fillRect(x0 + T, cy - T * 1.2, w - 2 * T, T * 2.4);
      g.fillStyle = 'rgba(195,139,255,0.55)'; g.fillRect(x0 + T, cy - T * 1.2, w - 2 * T, 2); g.fillRect(x0 + T, cy + T * 1.2 - 2, w - 2 * T, 2);
    } else if (rm.variant === 'conveyor') { // riveted plates (the belts are drawn live)
      each((x, y) => { g.fillStyle = '#1b2230'; g.fillRect(x, y, T, T); g.fillStyle = 'rgba(77,243,255,0.12)'; g.fillRect(x + 2, y + 2, 2, 2); g.fillRect(x + T - 4, y + T - 4, 2, 2); });
    } else if (rm.variant === 'colonnade') { // green-veined checker
      each((x, y, tx, ty) => { g.fillStyle = ((tx + ty) & 1) ? '#1e2a22' : '#233128'; g.fillRect(x, y, T, T); });
    } else if (rm.variant === 'dark') { // near-black floor, barely visible seams
      each((x, y) => { g.fillStyle = '#0c0a18'; g.fillRect(x, y, T, T); g.strokeStyle = 'rgba(140,125,255,0.06)'; g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1); });
    } else if (rm.variant === 'chasm') { // cracked stone around a bottomless pit
      each((x, y, tx, ty) => { g.fillStyle = ((tx + ty) & 1) ? '#2a2130' : '#2e2434'; g.fillRect(x, y, T, T); });
      for (let ty = rm.ty; ty < rm.ty + rm.th; ty++) for (let tx = rm.tx; tx < rm.tx + rm.tw; tx++) {
        if (!pitTile(tx, ty)) continue;
        const x = tx * T, y = ty * T;
        g.fillStyle = '#020104'; g.fillRect(x, y, T, T);
        g.strokeStyle = 'rgba(255,79,107,0.7)'; g.lineWidth = 2; g.beginPath();
        if (!pitTile(tx - 1, ty)) { g.moveTo(x, y); g.lineTo(x, y + T); }
        if (!pitTile(tx + 1, ty)) { g.moveTo(x + T, y); g.lineTo(x + T, y + T); }
        if (!pitTile(tx, ty - 1)) { g.moveTo(x, y); g.lineTo(x + T, y); }
        if (!pitTile(tx, ty + 1)) { g.moveTo(x, y + T); g.lineTo(x + T, y + T); }
        g.stroke();
      }
    }
    g.restore();
  },
  // live parts of room variants: the belts run
  drawRoomFx(ctx) {
    if (!G.belts || !G.belts.length) return;
    const t = G.time;
    for (const bt of G.belts) {
      const on = G.rooms[bt.roomId] && G.rooms[bt.roomId].state === 'active';
      ctx.fillStyle = 'rgba(10,30,40,0.85)'; ctx.fillRect(bt.x, bt.y, bt.w, bt.h);
      ctx.strokeStyle = 'rgba(77,243,255,0.45)'; ctx.lineWidth = 1.5; ctx.strokeRect(bt.x + 0.75, bt.y + 0.75, bt.w - 1.5, bt.h - 1.5);
      ctx.save(); ctx.beginPath(); ctx.rect(bt.x, bt.y, bt.w, bt.h); ctx.clip();
      const off = ((on ? t * 80 : 0) * bt.dx) % 24, cy = bt.y + bt.h / 2;
      ctx.strokeStyle = on ? 'rgba(77,243,255,0.6)' : 'rgba(77,243,255,0.25)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let x = bt.x - 24 + off; x < bt.x + bt.w + 24; x += 24) { ctx.moveTo(x - bt.dx * 5, cy - 8); ctx.lineTo(x + bt.dx * 3, cy); ctx.lineTo(x - bt.dx * 5, cy + 8); }
      ctx.stroke(); ctx.restore(); ctx.lineCap = 'butt';
    }
  },

  // Ship hulls (nose along +x, about 24 px across). Each one shows what it does: the Lancer carries a
  // long cannon, the Scatter a wide fan of muzzles, the Phantom swept blades, the Bulwark a shield plate.
  drawShip(ctx, ship, fill) {
    const acc = SHIP[ship] ? SHIP[ship].color : COL.player;
    const poly = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); };
    ctx.fillStyle = fill; ctx.lineJoin = 'round';
    if (ship === 'lancer') {
      ctx.fillStyle = acc; ctx.fillRect(4, -1.4, 13, 2.8); // the cannon
      ctx.fillStyle = fill; poly([9, 0, 3, -3.5, -2, -10, -7, -10, -4, -3.5, -9, -3, -9, 3, -4, 3.5, -7, 10, -2, 10, 3, 3.5]); ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 1.4; ctx.stroke();
    } else if (ship === 'scatter') {
      poly([8, 0, 3, -4, 6, -11, -3, -9, -8, -3, -5, 0, -8, 3, -3, 9, 6, 11, 3, 4]); ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = acc; for (const y of [-9, 0, 9]) { ctx.beginPath(); ctx.arc(y ? 5 : 8, y, 1.8, 0, TAU); ctx.fill(); } // three muzzles
    } else if (ship === 'phantom') {
      poly([13, 0, 1, -4, -3, -12, -6, -4, -11, -6, -8, 0, -11, 6, -6, 4, -3, 12, 1, 4]); ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.globalAlpha *= 0.45; ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(-14, -9); ctx.moveTo(-5, 8); ctx.lineTo(-14, 9); ctx.stroke(); ctx.globalAlpha /= 0.45; // blade trails
    } else if (ship === 'bulwark') {
      poly([9, 0, 4, -9, -6, -9, -10, 0, -6, 9, 4, 9]); ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-1, 0, 13, -0.85, 0.85); ctx.stroke(); ctx.lineCap = 'butt'; // shield plate
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(-3, 0); ctx.lineTo(-6, 9); ctx.stroke();
    } else {
      poly([12, 0, -7, -8, -3, 0, -7, 8]); ctx.fill();
    }
    ctx.fillStyle = COL.playerCore;
    ctx.beginPath(); ctx.arc(ship === 'lancer' ? 0 : 1, 0, 2.6, 0, TAU); ctx.fill();
  },

  worldTransform(shx, shy) {
    const d = Q.dpr, s = this.scale;
    const ox = this.offX + this.VW * s / 2 - this.cam.x * s, oy = this.offY + this.VH * s / 2 - this.cam.y * s;
    this.ctx.setTransform(s * d, 0, 0, s * d, (ox + shx) * d, (oy + shy) * d);
  },

  draw() {
    const ctx = this.ctx, d = Q.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#07060f';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!G.run || G.state === 'menu' || G.state === 'boot') { this.drawMenuBg(); return; }

    const tr = G.trauma * G.trauma;
    const shx = tr ? (Math.random() * 2 - 1) * 9 * tr : 0, shy = tr ? (Math.random() * 2 - 1) * 9 * tr : 0;
    this.worldTransform(shx, shy);
    ctx.drawImage(this.floorCv, 0, 0, G.W, G.H);

    if (G.side) {
      this.drawSide(ctx);
      this.drawPlayer(ctx);
      this.drawSideFront(ctx);
      this.drawParticles(ctx);
      this.drawTexts(ctx);
    } else {
    this.drawGates(ctx);
    this.drawRoomFx(ctx);
    this.drawTraps(ctx);
    this.drawBarrier(ctx);
    this.drawStairs(ctx);
    this.drawShrine(ctx);
    this.drawMarkers(ctx);
    this.drawTelegraphs(ctx);
    this.drawHazards(ctx);
    this.drawBossExtras(ctx);
    this.drawShells(ctx);
    this.drawPickups(ctx);
    this.drawEnemies(ctx);
    this.drawPlayer(ctx);
    this.drawGuide(ctx);
    this.drawPlayerBullets(ctx);
    this.drawEnemyBullets(ctx);
    this.drawBeams(ctx);
    this.drawCurtain(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);
    }

    // screen space
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalAlpha = 1;
    this.drawDarkness(ctx);
    ctx.drawImage(this.vignette, 0, 0, this.sw, this.sh);
    this.drawOffscreen(ctx);
    const p = G.player;
    let dmgA = G.flash * 0.7;
    if (p && p.alive && p.hp === 1) dmgA = Math.max(dmgA, 0.18 + Math.sin(G.time * 6) * 0.1);
    if (dmgA > 0.01) { ctx.globalAlpha = Math.min(1, dmgA); ctx.drawImage(this.dmgVignette, 0, 0, this.sw, this.sh); ctx.globalAlpha = 1; }
    this.drawJoystick(ctx);
    this.drawCrosshair(ctx);
    if (G.tutorial) this.drawTutorial(ctx);
    if (G.fade > 0) { ctx.globalAlpha = G.fade; ctx.fillStyle = '#07060f'; ctx.fillRect(0, 0, this.sw, this.sh); ctx.globalAlpha = 1; }
  },

  // Locked room exits: pulsing energy bars across the corridor mouth.
  drawGates(ctx) {
    if (!G.rooms) return;
    const cols = G.grid.cols, a = 0.55 + Math.sin(G.time * 8) * 0.2;
    for (const rm of G.rooms) for (const gt of rm.gates) {
      if (!gt.locked) continue;
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#ff4f6b';
      for (const i of gt.tiles) ctx.fillRect((i % cols) * T, ((i / cols) | 0) * T, T, T);
      ctx.globalAlpha = a; ctx.strokeStyle = '#ff4f6b'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const i of gt.tiles) {
        const x = (i % cols) * T, y = ((i / cols) | 0) * T;
        if (gt.horiz) { ctx.moveTo(x + T / 2, y); ctx.lineTo(x + T / 2, y + T); }
        else { ctx.moveTo(x, y + T / 2); ctx.lineTo(x + T, y + T / 2); }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // Chevron next to the player pointing along the path to the next room / doors.
  drawGuide(ctx) {
    const p = G.player;
    if (!p || !p.alive || G.state !== 'play') return;
    const tg = guideTarget();
    if (!tg) { this.guideA = null; return; }
    const w = guidePoint(p.x, p.y, tg.x, tg.y);
    const want = Math.atan2(w.y - p.y, w.x - p.x);
    // smoothed so the arrow turns instead of snapping
    const now = G.time, dt = Math.min(0.1, Math.max(0, now - (this.guideT || now)));
    this.guideT = now;
    this.guideA = this.guideA == null ? want : this.guideA + angleDiff(this.guideA, want) * Math.min(1, dt * 12);
    const a = this.guideA;
    const r = 30 + Math.sin(G.time * 6) * 3, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#8dff6a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(3, 0); ctx.lineTo(-5, 7); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  },

  // Edge markers for awake enemies outside the visible area.
  drawOffscreen(ctx) {
    if (G.state !== 'play' && G.state !== 'reward') return;
    const m = 14, top = this.topRes + 6;
    for (const e of G.enemies) {
      if (e.dead || e.sleep) continue;
      const s = this.toScreen(e.x, e.y);
      if (s.x > 0 && s.x < this.sw && s.y > top && s.y < this.sh) continue;
      const cx = this.sw / 2, cy = (top + this.sh) / 2, a = Math.atan2(s.y - cy, s.x - cx);
      const x = clamp(s.x, m, this.sw - m), y = clamp(s.y, top + m, this.sh - m);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.globalAlpha = 0.85; ctx.fillStyle = e.type === 'boss' ? '#ff4f6b' : e.elite ? COL.gold : e.color;
      const k = e.type === 'boss' ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(7 * k, 0); ctx.lineTo(-5 * k, -6 * k); ctx.lineTo(-5 * k, 6 * k); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  drawMenuBg() {
    const ctx = this.ctx, d = Q.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const t = performance.now() / 1000;
    ctx.strokeStyle = 'rgba(108,92,255,0.12)'; ctx.lineWidth = 1;
    const T = 36, oy = (t * 18) % T;
    ctx.beginPath();
    for (let x = 0; x <= this.sw; x += T) { ctx.moveTo(x, 0); ctx.lineTo(x, this.sh); }
    for (let y = -T + oy; y <= this.sh; y += T) { ctx.moveTo(0, y); ctx.lineTo(this.sw, y); }
    ctx.stroke();
    ctx.drawImage(this.vignette, 0, 0, this.sw, this.sh);
  },

  drawGlow(ctx, x, y, r, color, alpha = 1) {
    if (!Q.glow) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.glowSprite(color), x - r, y - r, r * 2, r * 2);
  },

  // Exit staircases (steps rising toward the top wall) and the arrival staircase.
  drawStairs(ctx) {
    const t = G.time;
    if (G.arrival) this.drawStairShape(ctx, G.arrival, '#6c5cff', 0.45, false);
    for (const st of G.stairs || []) {
      const col = ROOM[st.type].color, on = G.stairOn === st;
      // side stairs are the same drawing turned so the steps rise toward the outside
      const rot = st.wall ? st.wall * Math.PI / 2 : 0;
      const L = st.wall ? { x: -st.h / 2, y: -st.w / 2, w: st.h, h: st.w } : st;
      if (st.wall) { ctx.save(); ctx.translate(st.x + st.w / 2, st.y + st.h / 2); ctx.rotate(rot); }
      if (!st.locked) {
        ctx.globalCompositeOperation = 'lighter';
        this.drawGlow(ctx, L.x + L.w / 2, L.y + L.h / 2, 55, col, 0.5 + Math.sin(t * 4 + L.x) * 0.2);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      this.drawStairShape(ctx, L, st.locked ? '#5a5680' : col, st.locked ? 0.5 : 1, true);
      // type hint: small icon on the first step, full preview when standing on the stairs
      ctx.globalAlpha = st.locked ? 0.35 : on ? 1 : 0.6;
      ctx.save(); ctx.translate(L.x + L.w / 2, L.y + L.h - 14); ctx.rotate(-rot); this.drawRoomIcon(ctx, st.type, 0, 0, st.locked ? '#9c96c9' : col); ctx.restore();
      ctx.globalAlpha = 1;
      if (st.locked) {
        // energy bar across the bottom step
        ctx.strokeStyle = '#ff4f6b'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.55 + Math.sin(t * 8) * 0.2;
        ctx.beginPath(); ctx.moveTo(L.x + 2, L.y + L.h - 2); ctx.lineTo(L.x + L.w - 2, L.y + L.h - 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // chevrons drifting up the steps
        const k = (t * 1.2) % 1;
        ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        for (let i = 0; i < 2; i++) {
          const y = L.y + L.h - 30 - ((k + i * 0.5) % 1) * (L.h - 40);
          ctx.globalAlpha = 0.8 * Math.sin(((k + i * 0.5) % 1) * Math.PI);
          ctx.beginPath(); ctx.moveTo(L.x + L.w / 2 - 7, y + 4); ctx.lineTo(L.x + L.w / 2, y - 2); ctx.lineTo(L.x + L.w / 2 + 7, y + 4); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      }
      if (st.wall) ctx.restore();
    }
  },

  // Whole-map preview of the floor behind a staircase (drawn once when you step on it).
  drawMapPreview(cv, lay, type) {
    const d = Math.min(2, window.devicePixelRatio || 1);
    const cw = cv.clientWidth || 300, ch = cv.clientHeight || 190;
    cv.width = Math.round(cw * d); cv.height = Math.round(ch * d);
    const g = cv.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = '#07060f'; g.fillRect(0, 0, cw, ch);
    const z = zoneFor(lay.floor), col = ROOM[type].color;
    const icon = (x, y, tp, c, sz) => { g.save(); g.translate(x, y); g.scale(sz, sz); this.drawRoomIcon(g, tp, 0, 0, c); g.restore(); };
    if (lay.side) { this.drawSidePreview(g, cw, ch, lay, z); return; }
    if (lay.circle) {
      const R = Math.min(cw, ch) * 0.38, cx = cw / 2, cy = ch / 2 + 6, kind = lay.kind || bossKindFor(lay.floor);
      const mini = buildHallGeometry({ x: cx, y: cy, R }, kind);
      g.save(); hallPath(g, mini); g.clip(); this.drawHallFloor(g, mini, z); g.restore();
      g.strokeStyle = BOSSES[kind] ? BOSSES[kind].color : z.edge; g.lineWidth = 2; g.lineJoin = 'round'; hallPath(g, mini); g.stroke();
      const b = BOSSES[kind];
      g.fillStyle = b.color; g.beginPath(); g.arc(cx, cy - R * 0.3, 9, 0, TAU); g.fill();
      icon(cx, cy - R * 0.3 - 18, 'boss', '#ff4f6b', 0.9);
      g.fillStyle = '#4df3ff'; g.beginPath(); g.arc(cx, cy + R - 10, 4, 0, TAU); g.fill();
      return;
    }
    // crop to the open area
    const cols = lay.cols, rows = lay.rows, sol = lay.solid;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (sol.charCodeAt(y * cols + x) === 48) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (const st of lay.stairs) { y0 = Math.min(y0, st.ty); }
    x0 -= 1; y0 -= 1; x1 += 2; y1 += 2;
    const k = Math.min((cw - 12) / (x1 - x0), (ch - 12) / (y1 - y0));
    const ox = (cw - (x1 - x0) * k) / 2 - x0 * k, oy = (ch - (y1 - y0) * k) / 2 - y0 * k;
    const open = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && sol.charCodeAt(y * cols + x) !== 49;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (open(x, y)) { g.fillStyle = sol.charCodeAt(y * cols + x) === 50 ? '#020104' : z.b; g.fillRect(ox + x * k, oy + y * k, k + 0.5, k + 0.5); }
    g.strokeStyle = z.edge; g.lineWidth = 1.2; g.beginPath();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!open(x, y)) continue;
      const X = ox + x * k, Y = oy + y * k;
      if (!open(x - 1, y)) { g.moveTo(X, Y); g.lineTo(X, Y + k); }
      if (!open(x + 1, y)) { g.moveTo(X + k, Y); g.lineTo(X + k, Y + k); }
      if (!open(x, y - 1)) { g.moveTo(X, Y); g.lineTo(X + k, Y); }
      if (!open(x, y + 1)) { g.moveTo(X, Y + k); g.lineTo(X + k, Y + k); }
    }
    g.stroke();
    const tr = (r) => [ox + (r.x / T) * k, oy + (r.y / T) * k, (r.w / T) * k, (r.h / T) * k];
    for (const p of lay.pillars) { const [x, y, w, h] = tr(p); g.fillStyle = p.crate ? '#8a5a26' : '#3d3670'; g.fillRect(x, y, w, h); }
    for (const t of lay.traps) { const [x, y, w, h] = tr(t); g.fillStyle = 'rgba(255,138,61,0.7)'; g.fillRect(x + 1, y + 1, w - 2, h - 2); }
    // fight rooms get a crossed-swords mark, the exit room a gold outline
    lay.rooms.forEach((rm) => {
      const [x, y, w, h] = tr(rm);
      if (rm.kind === 'exit') { g.strokeStyle = type === 'elite' ? COL.gold : '#ffffff'; g.globalAlpha = 0.7; g.lineWidth = 1.5; g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.globalAlpha = 1; }
      if (rm.variant) { // a rare room: its name instead of the swords
        const V = ROOM_VARIANTS[rm.variant];
        g.strokeStyle = V.color; g.globalAlpha = 0.9; g.lineWidth = 1.5; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
        g.fillStyle = V.color; g.font = '800 ' + Math.max(8, Math.min(11, k * 0.9)) + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(V.name.toUpperCase(), x + w / 2, y + h / 2); g.globalAlpha = 1;
      } else if (rm.kind !== 'start' && !isCalm(type)) icon(x + w / 2, y + h / 2, type === 'elite' && rm.kind === 'exit' ? 'elite' : 'combat', 'rgba(255,79,107,0.8)', Math.max(0.45, Math.min(0.8, k / 10)));
    });
    if (isCalm(type) && lay.rooms[0]) { const [x, y, w, h] = tr(lay.rooms[0]); icon(x + w / 2, y + h / 2, type, ROOM[type].color, 0.8); }
    for (const st of lay.stairs) { const [x, y, w, h] = tr(st); g.fillStyle = ROOM[st.type].color; g.globalAlpha = 0.85; g.fillRect(x, y, w, h); g.globalAlpha = 1; }
    if (lay.arrival) { const [x, y, w, h] = tr(lay.arrival); g.fillStyle = '#4df3ff'; g.fillRect(x, y, w, h); g.beginPath(); g.arc(x + w / 2, y - 3, 3, 0, TAU); g.fill(); }
  },

  // Training: the energy fence enemies cannot cross (their bullets pass through)
  drawBarrier(ctx) {
    const tr = G.training;
    if (!tr || tr.barrierY == null) return;
    const y = tr.barrierY, x0 = T, x1 = G.W - T, t = G.time;
    ctx.globalAlpha = 0.12; ctx.fillStyle = '#ff4fd8'; ctx.fillRect(x0, y - 6, x1 - x0, 12);
    ctx.globalAlpha = 0.75 + Math.sin(t * 6) * 0.15; ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = x0 + ((t * 40) % 24); x < x1; x += 24) { ctx.moveTo(x, y - 5); ctx.lineTo(x + 6, y + 5); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  // Floor art of a boss hall (clipped to the hall by the caller). c = hall geometry, z = zone colours.
  drawHallFloor(g, c, z) {
    const kind = c.kind, R = c.R, x0 = c.x - R * 1.3, y0 = c.y - R * 1.3, S = R * 2.6, s = R / 250;
    const rnd = (() => { let v = 1234567; return () => ((v = (v * 16807) % 2147483647) / 2147483647); })(); // same art every time
    const base = { polarity: ['#0c0c1c', '#10101f'], puppeteer: ['#1e0f0c', '#24130f'], architect: ['#0b1730', '#0d1b36'], forge: ['#1c0e08', '#22110a'], serpent: ['#0d1a10', '#102013'], chronos: ['#1a1608', '#1f1a0b'], mirror: ['#0c1a1c', '#0f2023'], loom: ['#170d24', '#1c102c'], orrery: ['#0b1024', '#0e142c'], warden: ['#1a140c', '#20180e'] }[kind] || [z.a, z.b];
    g.fillStyle = base[0]; g.fillRect(x0, y0, S, S);
    const col = BOSSES[kind] ? BOSSES[kind].color : z.edge;
    g.lineWidth = 1.2 * s;
    if (kind === 'warden') { // stone bricks
      g.strokeStyle = 'rgba(0,0,0,0.45)'; const bh = 22 * s, bw = 44 * s;
      for (let y = y0, row = 0; y < y0 + S; y += bh, row++) {
        g.fillStyle = row % 2 ? base[1] : base[0]; g.fillRect(x0, y, S, bh);
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + S, y);
        for (let x = x0 + (row % 2) * bw / 2; x < x0 + S; x += bw) { g.moveTo(x, y); g.lineTo(x, y + bh); }
        g.stroke();
      }
      g.globalAlpha = 0.25; g.strokeStyle = col; g.lineWidth = 2 * s; hallPath(g, c, 34 * s); g.stroke(); g.globalAlpha = 1;
    } else if (kind === 'loom') { // woven threads
      g.globalAlpha = 0.16;
      for (let k = -S; k < S; k += 18 * s) {
        g.strokeStyle = (k / (18 * s)) % 2 ? col : '#4df3ff';
        g.beginPath(); g.moveTo(x0 + k, y0); g.lineTo(x0 + k + S, y0 + S); g.stroke();
        g.beginPath(); g.moveTo(x0 + k + S, y0); g.lineTo(x0 + k, y0 + S); g.stroke();
      }
      g.globalAlpha = 1;
    } else if (kind === 'mirror') { // crystal facets
      g.globalAlpha = 0.14; g.strokeStyle = col; const st = 46 * s;
      for (let a = 0; a < 3; a++) {
        const ang = (a * Math.PI) / 3, dx = Math.cos(ang), dy = Math.sin(ang);
        for (let k = -S; k < S; k += st) { g.beginPath(); g.moveTo(c.x - dy * k - dx * S, c.y + dx * k - dy * S); g.lineTo(c.x - dy * k + dx * S, c.y + dx * k + dy * S); g.stroke(); }
      }
      g.globalAlpha = 0.08; g.fillStyle = '#ffffff';
      for (let i = 0; i < 14; i++) { const x = c.x + (rnd() - 0.5) * R * 1.8, y = c.y + (rnd() - 0.5) * R * 1.8, r = (10 + rnd() * 18) * s; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.6, y + r * 0.5); g.lineTo(x - r * 0.6, y + r * 0.5); g.closePath(); g.fill(); }
      g.globalAlpha = 1;
    } else if (kind === 'polarity') { // split floor: blue half, red half, pulsing seam
      g.globalAlpha = 0.22; g.fillStyle = '#4d8cff'; g.fillRect(x0, y0, S / 2, S);
      g.fillStyle = '#ff4f6b'; g.fillRect(x0 + S / 2, y0, S / 2, S);
      g.globalAlpha = 0.18; g.strokeStyle = '#ffffff';
      for (let r = 40 * s; r < R; r += 40 * s) { g.beginPath(); g.arc(c.x, c.y, r, 0, TAU); g.stroke(); }
      g.globalAlpha = 0.5; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(c.x, y0); g.lineTo(c.x, y0 + S); g.stroke();
      g.globalAlpha = 1;
    } else if (kind === 'forge') { // cracked floor glowing with heat
      g.fillStyle = base[1];
      for (let i = 0; i < 26; i++) { g.globalAlpha = 0.6; g.fillRect(c.x + (rnd() - 0.5) * R * 2, c.y + (rnd() - 0.5) * R * 2, (20 + rnd() * 40) * s, (14 + rnd() * 26) * s); }
      g.strokeStyle = '#ff7a3d'; g.lineWidth = 2 * s; g.shadowColor = '#ff7a3d'; g.shadowBlur = 8 * s;
      for (let i = 0; i < 12; i++) {
        let x = c.x + (rnd() - 0.5) * R * 1.6, y = c.y + (rnd() - 0.5) * R * 1.6;
        g.globalAlpha = 0.35 + rnd() * 0.3; g.beginPath(); g.moveTo(x, y);
        for (let n = 0; n < 5; n++) { x += (rnd() - 0.5) * 50 * s; y += (rnd() - 0.5) * 50 * s; g.lineTo(x, y); }
        g.stroke();
      }
      g.shadowBlur = 0; g.globalAlpha = 1;
    } else if (kind === 'puppeteer') { // theatre stage: planks, footlights, curtain fringe
      g.strokeStyle = 'rgba(0,0,0,0.5)'; const pw = 28 * s;
      for (let x = x0, i = 0; x < x0 + S; x += pw, i++) { g.fillStyle = i % 2 ? '#2a1712' : '#301a14'; g.fillRect(x, y0, pw, S); g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + S); g.stroke(); }
      g.fillStyle = '#7a1030'; const top = c.y - hallRayT(c.x, c.y, 0, -1, 0);
      for (let x = x0; x < x0 + S; x += 22 * s) { g.beginPath(); g.moveTo(x, top); g.lineTo(x + 11 * s, top + 26 * s); g.lineTo(x + 22 * s, top); g.fill(); }
      g.fillStyle = '#ffd48a';
      const bot = c.y + hallRayT(c.x, c.y, 0, 1, 0);
      for (let x = c.x - R; x < c.x + R; x += 40 * s) { g.globalAlpha = 0.35; g.beginPath(); g.arc(x, bot - 8 * s, 4 * s, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    } else if (kind === 'architect') { // blueprint grid
      g.strokeStyle = '#6fa8ff';
      for (let x = x0, i = 0; x < x0 + S; x += 20 * s, i++) { g.globalAlpha = i % 5 ? 0.1 : 0.28; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + S); g.stroke(); }
      for (let y = y0, i = 0; y < y0 + S; y += 20 * s, i++) { g.globalAlpha = i % 5 ? 0.1 : 0.28; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + S, y); g.stroke(); }
      g.globalAlpha = 0.3; g.strokeStyle = col; g.setLineDash([8 * s, 6 * s]); g.beginPath(); g.arc(c.x, c.y, R * 0.45, 0, TAU); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 1;
    } else { // plain checker (fallback)
      for (let y = y0, j = 0; y < y0 + S; y += T * s, j++) for (let x = x0, i = 0; x < x0 + S; x += T * s, i++) if (((i + j) & 1) === 0) { g.fillStyle = base[1]; g.fillRect(x, y, T * s, T * s); }
    }
  },

  // ---------- floors 35-50: boss-owned things in the world ----------
  drawBossExtras(ctx) {
    const b = G.boss, t = G.time;
    // Architect blocks and walls (kept inside the round hall)
    ctx.save();
    if (G.circle && G.blocks.length) { hallPath(ctx); ctx.clip(); }
    for (const o of G.blocks) {
      if (!o.solid) {
        const k = o.t / o.warn;
        ctx.globalAlpha = 0.25 + 0.35 * k; ctx.fillStyle = o.kind === 'wall' ? '#ff4f6b' : COL.architect;
        if (o.kind === 'wall') { // the path of the wall and the safe gap
          const c = arenaCenter(), R = G.circle ? G.circle.R : 200;
          ctx.fillRect(o.dir > 0 ? c.x - R : o.gx + o.gap / 2, o.y, o.dir > 0 ? o.gx - o.gap / 2 - (c.x - R) : c.x + R - (o.gx + o.gap / 2), o.h);
          ctx.globalAlpha = 0.55 + Math.sin(t * 14) * 0.2; ctx.fillStyle = '#8dff6a'; ctx.fillRect(o.gx - o.gap / 2, o.y, o.gap, o.h);
        } else { ctx.setLineDash([4, 4]); ctx.strokeStyle = COL.architect; ctx.lineWidth = 2; ctx.strokeRect(o.x, o.y, o.w, o.h); ctx.setLineDash([]); }
        continue;
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(o.x + 3, o.y + 5, o.w, o.h);
      ctx.fillStyle = o.kind === 'wall' ? '#2b1030' : '#3a1a40'; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = COL.architect; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      if (o.kind === 'block' && o.t > o.warn + o.life - 1.2 && ((t * 10) | 0) % 2) { ctx.globalAlpha = 0.4; ctx.fillStyle = '#ffffff'; ctx.fillRect(o.x, o.y, o.w, o.h); }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (!b || b.dead) return;
    this.drawSpecials(ctx, b);
    // Architect recalled slams
    for (const s of b.slams || []) {
      const k = s.t / s.fuse;
      ctx.globalAlpha = 0.18 + 0.3 * k; ctx.fillStyle = '#ff4f3d'; ctx.beginPath(); ctx.arc(s.x, s.y, SLAM_R * k, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ff4f3d'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y, SLAM_R, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // ---------- special-room bosses ----------
  drawSpecials(ctx, b) {
    const t = G.time, p = G.player;
    // Polarity: coloured floor zones and the charged beam
    for (const z of b.zones || []) {
      const k = Math.min(1, z.t / z.warn);
      if (z.t < 0) continue;
      ctx.globalAlpha = z.done ? 0.55 : 0.15 + 0.25 * k + Math.sin(t * 16) * 0.05; ctx.fillStyle = POL_COL[z.pol];
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (z.done ? 1 : k), 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.95; ctx.strokeStyle = POL_COL[z.pol]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    }
    if (G.polBeam) {
      const B = G.polBeam, k = 1 - B.t / 0.35;
      ctx.globalAlpha = k; ctx.strokeStyle = B.col; ctx.lineWidth = 14 * k + 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(B.x1, B.y1); ctx.lineTo(B.x2, B.y2); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4 * k + 1; ctx.stroke(); ctx.lineCap = 'butt';
    }
    // Keys: seals with a filling ring, walls about to move
    if (G.maze) {
      for (const s of G.maze.seals) {
        ctx.globalAlpha = 1; ctx.fillStyle = s.lit ? COL.keys : '#2a2418'; ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, TAU); ctx.fill();
        ctx.strokeStyle = COL.keys; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = s.lit ? '#1a1206' : COL.keys; ctx.font = '900 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✦', s.x, s.y + 1);
        if (!s.lit && s.t > 0) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 20, -Math.PI / 2, -Math.PI / 2 + TAU * (s.t / 2)); ctx.stroke(); }
      }
      const sh = G.maze.shifting;
      if (sh && ((t * 8) | 0) % 2) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#ff4f6b'; for (const d of sh.close) for (const [x, y] of d.tiles) ctx.fillRect(x * T + 3, y * T + 3, T - 6, T - 6);
        ctx.fillStyle = '#8dff6a'; for (const d of sh.open) for (const [x, y] of d.tiles) ctx.fillRect(x * T + 3, y * T + 3, T - 6, T - 6);
      }
      if (b.kind === 'keys' && b.alertT > 0) { ctx.globalAlpha = 0.5; ctx.strokeStyle = COL.keys; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.alertX, b.alertY, 12 + (3 - b.alertT) * 20, 0, TAU); ctx.stroke(); }
    }
    // Collapse: the bridge plates, lane warnings and boulders
    if (G.bridge) this.drawBridge(ctx);
    // Puppeteer: needles, threads, puppets
    for (const n of b.needles || []) {
      if (n.t < 0) continue;
      if (!n.flying) {
        const e = rayToEdge(n.ax, n.ay, Math.cos(n.a), Math.sin(n.a), 0);
        ctx.globalAlpha = 0.3 + 0.5 * (n.t / n.warn); ctx.strokeStyle = '#ff5c8a'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(n.ax, n.ay); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = 1; ctx.strokeStyle = '#ffd6e4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(n.x - Math.cos(n.a) * 12, n.y - Math.sin(n.a) * 12); ctx.lineTo(n.x, n.y); ctx.stroke();
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(n.ax, n.ay); ctx.lineTo(n.x, n.y); ctx.stroke();
      }
    }
    for (const q of b.puppets || []) {
      if (q.x == null) continue;
      ctx.globalAlpha = 0.55; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#ffb3c9'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -8); ctx.lineTo(-3, 0); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,179,201,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x, q.y - 12); ctx.lineTo(q.x, q.y - 60); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const th of G.threads || []) {
      const d = Math.sqrt(dist2(th.px, th.py, p.x, p.y)), k = Math.min(1, d / 190);
      ctx.strokeStyle = th.tension > 0 ? '#ffffff' : k > 0.8 ? '#ffd6e4' : '#ff5c8a'; ctx.lineWidth = 1.5 + th.tension * 3;
      ctx.beginPath(); ctx.moveTo(th.px, th.py); ctx.quadraticCurveTo((th.px + p.x) / 2, (th.py + p.y) / 2 + 30 * (1 - k), p.x, p.y); ctx.stroke();
      ctx.fillStyle = '#ff5c8a'; ctx.beginPath(); ctx.arc(th.px, th.py, 4, 0, TAU); ctx.fill();
    }
    // slowing wells (Architect)
    for (const w of G.wells || []) {
      const k = Math.min(1, w.t / w.warn);
      ctx.globalAlpha = 0.18 * k + 0.05; ctx.fillStyle = '#6fa8ff'; ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.6 * k; ctx.strokeStyle = '#6fa8ff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(w.x, w.y, w.r - ((t * 20) % 12), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  },
  // Puppeteer's curtain: half of the stage hidden for a moment
  drawCurtain(ctx) {
    const b = G.boss;
    if (!b || b.dead || !b.curtain || !G.circle) return;
    const c = b.curtain, R = G.circle.R, cx = G.circle.x, k = Math.min(1, c.t / 0.5, (c.dur - c.t) / 0.4);
    const x = c.side < 0 ? cx - R * 1.2 : cx, w = R * 1.2, top = G.circle.y - R, h = R * 2 * k;
    ctx.save(); hallPath(ctx); ctx.clip();
    ctx.fillStyle = '#5a0c24'; ctx.fillRect(x, top, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let fx = x; fx < x + w; fx += 16) ctx.fillRect(fx, top, 6, h);
    ctx.fillStyle = '#ffcf6b'; ctx.fillRect(x, top + h - 6, w, 4);
    ctx.restore();
  },
  buildBridgeBg(g, z) {
    const B = G.bridge;
    g.fillStyle = '#030208'; g.fillRect(0, 0, G.W, G.H);
    for (let i = 0; i < 260; i++) { g.globalAlpha = 0.05 + Math.random() * 0.1; g.fillStyle = '#9d8cff'; g.fillRect(Math.random() * G.W, Math.random() * G.H, 2, 2); }
    g.globalAlpha = 0.5; g.fillStyle = '#1a1410'; g.fillRect(B.bx - 10, B.y0, 6, G.H - B.y0); g.fillRect(B.bx + B.pw * 3 + 4, B.y0, 6, G.H - B.y0); // ropes
    g.globalAlpha = 1;
    // the plaza at the end: big flagstones on a cliff
    const P = B.plaza;
    g.fillStyle = '#1c1612'; g.fillRect(P.x - 8, P.y - 8, P.w + 16, P.h + 16);
    for (let y = P.y; y < P.y + P.h; y += 40) for (let x = P.x; x < P.x + P.w; x += 40) {
      g.fillStyle = ((x + y) / 40) % 2 ? '#3a3040' : '#352b3a'; g.fillRect(x + 1, y + 1, Math.min(40, P.x + P.w - x) - 2, Math.min(40, P.y + P.h - y) - 2);
    }
    for (let i = 0; i < 26; i++) { const x = P.x + Math.random() * P.w, y = P.y + Math.random() * P.h; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-14, 14), y + rand(-14, 14)); g.stroke(); }
    g.strokeStyle = COL.collapse; g.globalAlpha = 0.6; g.lineWidth = 2; g.strokeRect(P.x - 1, P.y - 1, P.w + 2, P.h + 2); g.globalAlpha = 1;
  },
  drawBridge(ctx) {
    const B = G.bridge, { VH } = viewDims(), t = G.time;
    const top = this.cam.y - VH / 2 - 40, bot = this.cam.y + VH / 2 + 40;
    const r0 = Math.max(0, Math.floor((top - B.y0) / B.ph)), r1 = Math.min(B.total - 1, Math.ceil((bot - B.y0) / B.ph));
    for (let r = r0; r <= r1; r++) for (let l = 0; l < 3; l++) {
      const q = B.plates[r][l], rc = bridgeRect(r, l);
      if (q.s === 'gone') { ctx.fillStyle = '#020105'; ctx.fillRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2); continue; }
      const sh = q.s === 'crack' ? Math.sin(t * 60 + r + l) * q.t * 2 : 0;
      ctx.fillStyle = q.s === 's' ? '#3a3040' : r % 2 ? '#4a3b2c' : '#54432f';
      ctx.fillRect(rc.x + 2 + sh, rc.y + 2, rc.w - 4, rc.h - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(rc.x + 2.5 + sh, rc.y + 2.5, rc.w - 5, rc.h - 5);
      if (q.s === 'crack') {
        ctx.strokeStyle = `rgba(255,120,60,${0.4 + q.t * 0.6})`; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(rc.x + rc.w * 0.2, rc.y + 6); ctx.lineTo(rc.x + rc.w * 0.5, rc.y + rc.h * 0.5); ctx.lineTo(rc.x + rc.w * 0.35, rc.y + rc.h - 6);
        ctx.moveTo(rc.x + rc.w * 0.5, rc.y + rc.h * 0.5); ctx.lineTo(rc.x + rc.w * 0.85, rc.y + rc.h * 0.3); ctx.stroke();
      }
    }
    for (const w of B.rowsWarn) { // plaza: a boulder will roll along this row
      if (w.t < 0) continue;
      ctx.globalAlpha = 0.12 + 0.3 * (w.t / w.warn) + Math.sin(t * 20) * 0.05; ctx.fillStyle = '#ff4f3d';
      ctx.fillRect(B.plaza.x, w.y - 20, B.plaza.w, 40);
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffb13d';
      const ax = w.dir > 0 ? B.plaza.x + 10 : B.plaza.x + B.plaza.w - 10;
      ctx.beginPath(); ctx.moveTo(ax + w.dir * 10, w.y); ctx.lineTo(ax - w.dir * 4, w.y - 8); ctx.lineTo(ax - w.dir * 4, w.y + 8); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const w of B.lanesWarn) {
      ctx.globalAlpha = 0.12 + 0.3 * (w.t / w.warn) + Math.sin(t * 20) * 0.05; ctx.fillStyle = '#ff4f3d';
      ctx.fillRect(B.bx + w.lane * B.pw + 4, top, B.pw - 8, bot - top);
    }
    ctx.globalAlpha = 1;
    for (const o of B.boulders) {
      ctx.fillStyle = '#6a5a48'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a2016'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(o.x + Math.cos(o.a) * o.r, o.y + Math.sin(o.a) * o.r); ctx.lineTo(o.x - Math.cos(o.a) * o.r, o.y - Math.sin(o.a) * o.r); ctx.stroke();
    }
  },

  // Darkness (the labyrinth): everything outside a few lights is black.
  drawDarkness(ctx) {
    const lights = G.run && typeof darknessLights === 'function' ? darknessLights() : null;
    if (!lights) return;
    if (!this.darkCv) { this.darkCv = document.createElement('canvas'); this.lightSpr = this.makeLight(); }
    const c = this.darkCv, d = Q.dpr;
    if (c.width !== Math.round(this.sw * d) || c.height !== Math.round(this.sh * d)) { c.width = Math.round(this.sw * d); c.height = Math.round(this.sh * d); }
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.sw, this.sh);
    g.fillStyle = 'rgba(3,2,10,0.94)'; g.fillRect(0, 0, this.sw, this.sh);
    g.globalCompositeOperation = 'destination-out';
    const s = this.scale;
    for (const [x, y, r] of lights) { const p = this.toScreen(x, y), R = r * s; g.drawImage(this.lightSpr, p.x - R, p.y - R, R * 2, R * 2); }
    ctx.drawImage(c, 0, 0, this.sw, this.sh);
  },
  makeLight() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;
  },

  // ---------- Forgemaster lava pools & shockwaves ----------
  drawHazards(ctx) {
    const t = G.time;
    for (const pl of G.pools) {
      const k = Math.min(1, pl.t / 0.35), fade = Math.min(1, (pl.life - pl.t) / 0.6);
      ctx.globalAlpha = (pl.t < 0.35 ? 0.35 : 0.75) * fade; ctx.fillStyle = '#ff5a1f';
      ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r * (0.6 + 0.4 * k), 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.8 * fade; ctx.fillStyle = '#ffcf6b';
      for (let i = 0; i < 3; i++) { const a = t * 1.3 + i * 2.1 + pl.x; ctx.beginPath(); ctx.arc(pl.x + Math.cos(a) * pl.r * 0.45, pl.y + Math.sin(a) * pl.r * 0.45, 2.5 + Math.sin(t * 5 + i) * 1.2, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = '#ffb13d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r, 0, TAU); ctx.stroke();
    }
    for (const w of G.waves) {
      ctx.globalAlpha = 0.85; ctx.strokeStyle = w.color; ctx.lineWidth = w.w;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, w.gapA + w.gapW / 2, w.gapA - w.gapW / 2 + TAU); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#fff0d8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, w.gapA + w.gapW / 2, w.gapA - w.gapW / 2 + TAU); ctx.stroke();
      // the gap edges glow green so the way out is easy to read
      ctx.strokeStyle = '#8dff6a'; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { const a = w.gapA + (s * w.gapW) / 2; ctx.beginPath(); ctx.moveTo(w.x + Math.cos(a) * (w.r - 10), w.y + Math.sin(a) * (w.r - 10)); ctx.lineTo(w.x + Math.cos(a) * (w.r + 10), w.y + Math.sin(a) * (w.r + 10)); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  },

  // ---------- THE COUNTERWEIGHT: side-view elevator ----------
  buildSideBg(g, z) {
    const S = G.side;
    g.fillStyle = '#05040c'; g.fillRect(0, 0, G.W, G.H);
    // shaft walls behind the cabin
    g.fillStyle = '#0c0a1c'; g.fillRect(S.L - 26, 0, S.R - S.L + 52, G.H);
    // cabin back wall with panels
    g.fillStyle = z.a; g.fillRect(S.L, S.ceilY, S.R - S.L, S.floorY - S.ceilY);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
    for (let x = S.L + 26; x < S.R; x += 52) { g.beginPath(); g.moveTo(x, S.ceilY + 8); g.lineTo(x, S.floorY - 8); g.stroke(); }
    g.fillStyle = z.b; g.fillRect(S.L, S.floorY - 60, S.R - S.L, 4);
    // floor slab with hazard stripes
    g.fillStyle = '#1a1730'; g.fillRect(S.L - 14, S.floorY, S.R - S.L + 28, 18);
    g.fillStyle = '#ffd44d';
    for (let x = S.L - 14; x < S.R + 14; x += 16) { g.beginPath(); g.moveTo(x, S.floorY + 18); g.lineTo(x + 8, S.floorY + 18); g.lineTo(x + 16, S.floorY + 10); g.lineTo(x + 8, S.floorY + 10); g.closePath(); g.globalAlpha = 0.35; g.fill(); }
    g.globalAlpha = 1;
    // side walls and the broken ceiling grate
    g.fillStyle = '#16132b'; g.fillRect(S.L - 14, S.ceilY - 8, 14, S.floorY - S.ceilY + 8); g.fillRect(S.R, S.ceilY - 8, 14, S.floorY - S.ceilY + 8);
    g.strokeStyle = z.edge; g.globalAlpha = 0.8; g.lineWidth = 2;
    g.strokeRect(S.L, S.ceilY, S.R - S.L, S.floorY - S.ceilY);
    g.globalAlpha = 0.5; g.lineWidth = 3;
    for (let x = S.L; x <= S.R; x += 20) { if (((x - S.L) / 20) % 3 === 1) continue; g.beginPath(); g.moveTo(x, S.ceilY - 8); g.lineTo(x + 10, S.ceilY); g.stroke(); }
    g.globalAlpha = 1;
  },

  drawSide(ctx) {
    const S = G.side, t = G.time, R = G.room;
    // shaft beams rushing down past the cabin (we are going up)
    ctx.strokeStyle = 'rgba(108,92,255,0.35)'; ctx.lineWidth = 3;
    const gap = 90, off = S.scroll % gap;
    ctx.beginPath();
    for (let y = -gap + off; y < G.H + gap; y += gap) {
      ctx.moveTo(S.L - 26, y); ctx.lineTo(S.L - 14, y + 6);
      ctx.moveTo(S.R + 14, y + 6); ctx.lineTo(S.R + 26, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = -gap + ((S.scroll * 1.7) % gap); y < G.H; y += gap) { ctx.fillRect(4, y, S.L - 34, 2); ctx.fillRect(S.R + 30, y + 40, G.W - S.R - 34, 2); }
    // cables and the counterweight above the cabin
    const bx = S.bx, by = S.by, bw = 64, bh = 44;
    ctx.strokeStyle = '#6a6590'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx - 14, 0); ctx.lineTo(bx - 14, by - bh / 2); ctx.moveTo(bx + 14, 0); ctx.lineTo(bx + 14, by - bh / 2); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter'; this.drawGlow(ctx, bx, by, 70, COL.counter, R.phase === 'fight' ? 0.55 : 0.25); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#2b2440'; ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    ctx.fillStyle = COL.counter; ctx.fillRect(bx - bw / 2, by - bh / 2, bw, 6); ctx.fillRect(bx - bw / 2, by + bh / 2 - 6, bw, 6);
    ctx.strokeStyle = '#ffb3d1'; ctx.lineWidth = 2; ctx.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
    const p = G.player, ea = Math.atan2(p.y - by, p.x - bx), rage = S.slam && S.slam.state === 'warn';
    ctx.fillStyle = '#12091a'; ctx.beginPath(); ctx.arc(bx, by, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = rage ? '#ffffff' : '#ff4f6b'; ctx.beginPath(); ctx.arc(bx + Math.cos(ea) * 4, by + Math.sin(ea) * 4, 5 + (rage ? Math.sin(t * 30) * 1.5 : 0), 0, TAU); ctx.fill();
    // floor indicator: progress of the ride
    if (R.phase === 'fight' || R.phase === 'intro') {
      const k = R.phase === 'fight' ? Math.min(1, S.t / S.dur) : 0;
      const w = S.R - S.L - 40, x = S.L + 20, y = S.ceilY + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = '#8dff6a'; ctx.fillRect(x, y, w * k, 5);
      ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(234,252,255,0.75)'; ctx.fillText('FLOOR ' + G.run.floor + ' ▲ ' + Math.ceil(Math.max(0, S.dur - S.t)) + 's', S.L + (S.R - S.L) / 2, y + 8);
    }
    // curtain gap: the only safe spot is marked on the floor
    if (S.gapWarn) {
      const gw = S.gapWarn;
      ctx.globalAlpha = 0.35 + Math.sin(t * 14) * 0.15; ctx.fillStyle = '#8dff6a';
      ctx.fillRect(gw.x - gw.w / 2 + 6, S.ceilY, gw.w - 12, S.floorY - S.ceilY);
      ctx.globalAlpha = 1; ctx.fillRect(gw.x - gw.w / 2 + 6, S.floorY - 3, gw.w - 12, 3);
    }
    // drop warnings: marker at the ceiling and a landing line on the floor
    for (const d of S.drops) {
      if (d.t >= d.warn) continue;
      const k = d.t / d.warn;
      ctx.globalAlpha = 0.15 + 0.25 * k; ctx.strokeStyle = '#ff4f6b'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(d.x, S.ceilY + 6); ctx.lineTo(d.x, S.floorY); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.6 + 0.4 * k; ctx.fillStyle = '#ff4f6b';
      ctx.beginPath(); ctx.moveTo(d.x - 6, S.ceilY + 2); ctx.lineTo(d.x + 6, S.ceilY + 2); ctx.lineTo(d.x, S.ceilY + 11); ctx.closePath(); ctx.fill();
      ctx.fillRect(d.x - d.r, S.floorY - 2, d.r * 2 * k, 2);
    }
    ctx.globalAlpha = 1;
    // exit doors in the side walls
    for (const st of G.stairs) {
      const col = st.locked ? '#5a5680' : ROOM[st.type].color, x = st.dir < 0 ? S.L - 14 : S.R;
      if (!st.locked) { ctx.globalCompositeOperation = 'lighter'; this.drawGlow(ctx, x + 7, st.y + st.h / 2, 40, col, 0.5 + Math.sin(t * 4) * 0.2); ctx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = 1; ctx.fillStyle = st.locked ? '#1f1b33' : '#07060f'; ctx.fillRect(x, st.y, 14, st.h);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x + 1, st.y + 1, 12, st.h - 2);
      ctx.globalAlpha = st.locked ? 0.4 : 1;
      this.drawRoomIcon(ctx, st.type, st.dir < 0 ? S.L + 16 : S.R - 16, st.y - 12, st.locked ? '#9c96c9' : col);
      if (!st.locked) {
        ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        const k = (t * 1.5) % 1, cx = (st.dir < 0 ? S.L + 22 : S.R - 22) + st.dir * k * 10, cy = st.y + st.h / 2;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.moveTo(cx - st.dir * 4, cy - 6); ctx.lineTo(cx + st.dir * 3, cy); ctx.lineTo(cx - st.dir * 4, cy + 6); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.globalAlpha = 1;
    }
  },

  // in front of the player: falling balls and the crushing plates
  drawSideFront(ctx) {
    const S = G.side, t = G.time;
    if (S.slam) {
      const sl = S.slam, k = slamDepth(sl);
      for (const z of sl.zones) {
        const w = z.x1 - z.x0, h = (S.floorY - S.ceilY) * k;
        if (sl.state === 'warn') {
          ctx.globalAlpha = 0.18 + 0.2 * (sl.t / sl.warn) + Math.sin(t * 18) * 0.06; ctx.fillStyle = '#ff4f6b';
          ctx.fillRect(z.x0, S.ceilY, w, S.floorY - S.ceilY);
          ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ff4f6b'; ctx.lineWidth = 2; ctx.strokeRect(z.x0 + 1, S.ceilY + 1, w - 2, S.floorY - S.ceilY - 2);
        }
        ctx.globalAlpha = 1;
        const y = S.ceilY - 8, hh = Math.max(10, h + 8);
        ctx.fillStyle = '#2b2440'; ctx.fillRect(z.x0, y, w, hh);
        ctx.fillStyle = COL.counter; ctx.fillRect(z.x0, y + hh - 8, w, 8);
        ctx.fillStyle = '#ffd44d'; ctx.globalAlpha = 0.5;
        for (let x = z.x0; x < z.x1 - 8; x += 16) ctx.fillRect(x + 4, y + hh - 16, 8, 6);
        ctx.globalAlpha = 1; ctx.strokeStyle = '#ffb3d1'; ctx.lineWidth = 2; ctx.strokeRect(z.x0 + 1, y, w - 2, hh);
      }
    }
    for (const d of S.drops) {
      if (d.t < d.warn) continue;
      ctx.globalCompositeOperation = 'lighter'; this.drawGlow(ctx, d.x, d.y, d.r * 2.6, COL.counter, 0.6); ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.fillStyle = d.split ? '#ffe0ef' : COL.counter;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2b0a1a'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 0.45, 0, TAU); ctx.fill();
      if (d.split) { ctx.strokeStyle = '#ff4f6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(d.x - d.r * 0.7, d.y); ctx.lineTo(d.x + d.r * 0.7, d.y); ctx.moveTo(d.x, d.y - d.r * 0.7); ctx.lineTo(d.x, d.y + d.r * 0.7); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  },

  drawSidePreview(g, cw, ch, lay, z) {
    const w = Math.min(cw * 0.5, 150), h = ch - 30, x = (cw - w) / 2, y = 16;
    g.fillStyle = '#0c0a1c'; g.fillRect(x - 14, 0, w + 28, ch);
    g.fillStyle = z.b; g.fillRect(x, y, w, h);
    g.strokeStyle = z.edge; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    g.strokeStyle = '#6a6590'; g.beginPath(); g.moveTo(cw / 2 - 6, 0); g.lineTo(cw / 2 - 6, y); g.moveTo(cw / 2 + 6, 0); g.lineTo(cw / 2 + 6, y); g.stroke();
    g.fillStyle = COL.counter; g.fillRect(cw / 2 - 16, 2, 32, 12);
    g.fillStyle = COL.counter; g.globalAlpha = 0.8;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + 15 + ((i * 37) % (w - 30)), y + 14 + i * 13, 4, 0, TAU); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#4df3ff'; g.beginPath(); g.arc(cw / 2, y + h - 7, 5, 0, TAU); g.fill();
    for (const st of lay.stairs) { g.fillStyle = ROOM[st.type].color; g.fillRect(st.dir < 0 ? x - 6 : x + w, y + h - 26, 6, 26); }
    g.fillStyle = '#ffffff'; g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('SIDE VIEW · ←  →  + DASH', cw / 2, y + h / 2);
  },

  drawStairShape(ctx, r, col, alpha, up) {
    const steps = Math.max(3, Math.round(r.h / 10));
    ctx.globalAlpha = alpha;
    for (let i = 0; i < steps; i++) {
      // lightest at the hall edge, darker as the steps lead away (exit: bottom edge, arrival: top edge)
      const k = up ? (i + 1) / steps : 1 - i / steps;
      const y = r.y + (i * r.h) / steps, h = r.h / steps;
      ctx.fillStyle = `rgba(${30 + 40 * k | 0},${26 + 34 * k | 0},${62 + 60 * k | 0},1)`;
      ctx.fillRect(r.x, y, r.w, h);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + 0.12 * k) + ')';
      ctx.fillRect(r.x, y, r.w, 1.5);
    }
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.globalAlpha = 1;
  },

  drawTraps(ctx) {
    if (!G.traps || !G.traps.length) return;
    for (const tr of G.traps) {
      const armed = trapArmed(tr), st = armed ? trapState(tr) : { s: 0 };
      ctx.fillStyle = st.s === 1 ? 'rgba(255,138,61,' + (0.25 + 0.25 * Math.abs(Math.sin(G.time * 14))) + ')' : 'rgba(0,0,0,0.35)';
      ctx.fillRect(tr.x + 1, tr.y + 1, tr.w - 2, tr.h - 2);
      ctx.strokeStyle = armed ? '#ff8a3d' : 'rgba(255,138,61,0.35)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(tr.x + 1.5, tr.y + 1.5, tr.w - 3, tr.h - 3);
      // spikes: holes when retracted, bright cones when active
      for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
        const cx = tr.x + tr.w * (0.2 + 0.3 * xx), cy = tr.y + tr.h * (0.2 + 0.3 * yy);
        if (st.s === 2) {
          ctx.fillStyle = '#ffe0d0';
          ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4, cy + 3); ctx.lineTo(cx - 4, cy + 3); ctx.closePath(); ctx.fill();
        } else { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3); }
      }
    }
  },

  drawRoomIcon(ctx, type, x, y, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    if (type === 'combat') {
      ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    } else if (type === 'elite') {
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * TAU) / 5, a2 = a + TAU / 10; ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); ctx.lineTo(x + Math.cos(a2) * 4, y + Math.sin(a2) * 4); }
      ctx.closePath(); ctx.fill();
    } else if (type === 'rest') {
      ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.lineWidth = 3.5; ctx.stroke();
    } else if (type === 'shop') { // shard / coin
      ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill();
    } else if (type === 'risk') { // horned skull-ish: a triangle with an eye
      ctx.moveTo(x, y + 9); ctx.lineTo(x - 9, y - 7); ctx.lineTo(x + 9, y - 7); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 2, 2.5, 0, TAU); ctx.fill();
    } else if (type === 'boss') {
      ctx.moveTo(x - 10, y + 6); ctx.lineTo(x - 10, y - 5); ctx.lineTo(x - 5, y); ctx.lineTo(x, y - 8); ctx.lineTo(x + 5, y); ctx.lineTo(x + 10, y - 5); ctx.lineTo(x + 10, y + 6); ctx.closePath(); ctx.fill();
    }
    ctx.lineCap = 'butt';
  },

  drawShrine(ctx) {
    const s = G.shrine;
    if (!s) return;
    const pulse = 0.5 + Math.sin(G.time * 3) * 0.2, base = ROOM[s.kind || 'rest'].color;
    const col = s.used ? 'rgba(160,160,190,0.35)' : base;
    ctx.globalCompositeOperation = 'lighter';
    if (!s.used) this.drawGlow(ctx, s.x, s.y, 70, base, pulse);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, 20, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1.3, 1.3); this.drawRoomIcon(ctx, s.kind || 'rest', 0, 0, col); ctx.restore();
    if (!s.used) {
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = base; ctx.fillText('STEP IN', s.x, s.y + 28);
    }
  },

  drawMarkers(ctx) {
    for (const m of G.markers) {
      const k = m.t / m.dur, r = ENEMY[m.type].r * (m.elite ? 1.3 : 1);
      ctx.globalAlpha = 0.35 + 0.5 * k;
      ctx.strokeStyle = m.elite ? COL.gold : ENEMY[m.type].color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, r * (2.4 - 1.4 * k), 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.x - 4, m.y - 4); ctx.lineTo(m.x + 4, m.y + 4); ctx.moveTo(m.x + 4, m.y - 4); ctx.lineTo(m.x - 4, m.y + 4); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  drawTelegraphs(ctx) {
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (e.type === 'charger' && e.state === 'aim') {
        const len = 280;
        ctx.globalAlpha = 0.15 + 0.5 * e.charge;
        ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = e.r * 1.4;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.ang) * len, e.y + Math.sin(e.ang) * len); ctx.stroke();
        ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.ang) * len, e.y + Math.sin(e.ang) * len); ctx.stroke();
      } else if (e.type === 'bomber' && e.state === 'fuse') {
        const R = e.elite ? 80 : 64;
        ctx.globalAlpha = 0.12 + 0.25 * e.charge;
        ctx.fillStyle = '#ff4f3d';
        ctx.beginPath(); ctx.arc(e.x, e.y, R * Math.min(1, e.charge * 1.1), 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ff4f3d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, TAU); ctx.stroke();
      } else if (e.type === 'leaper' && (e.state === 'crouch' || e.state === 'air')) {
        const k = e.state === 'air' ? e.airK || 0 : 0;
        ctx.globalAlpha = 0.15 + 0.3 * k; ctx.fillStyle = '#ff4f3d';
        ctx.beginPath(); ctx.arc(e.tx, e.ty, 40 * Math.max(0.15, k), 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.85; ctx.strokeStyle = '#ff4f3d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.tx, e.ty, 40, 0, TAU); ctx.stroke();
      } else if (e.type === 'sniper' && e.state === 'aim') {
        let len = 0; const ca = Math.cos(e.ang), sa = Math.sin(e.ang);
        while (len < 650 && !solidAt(e.x + ca * len, e.y + sa * len)) len += 10;
        ctx.globalAlpha = 0.25 + 0.6 * e.charge; ctx.strokeStyle = e.st > 0.75 ? '#ffffff' : '#ff4f6b'; ctx.lineWidth = 1 + e.charge * 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + ca * len, e.y + sa * len); ctx.stroke();
      } else if (e.type === 'boss' && e.kind === 'warden' && e.air) {
        const R = SLAM_R, k = e.airK || 0;
        ctx.globalAlpha = 0.18 + 0.3 * k;
        ctx.fillStyle = '#ff4f3d';
        ctx.beginPath(); ctx.arc(e.tx, e.ty, R * k, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ff4f3d'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(e.tx, e.ty, R, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.5; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(e.tx, e.ty, e.r * (0.5 + k * 0.5), e.r * (0.3 + k * 0.3), 0, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },

  drawShells(ctx) {
    for (const sh of G.shells) {
      const k = sh.t / sh.dur;
      ctx.globalAlpha = 0.15 + 0.3 * k; ctx.fillStyle = '#ff8a3d';
      ctx.beginPath(); ctx.arc(sh.tx, sh.ty, sh.r * k, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sh.tx, sh.ty, sh.r, 0, TAU); ctx.stroke();
      const x = lerp(sh.x0, sh.tx, k), y = lerp(sh.y0, sh.ty, k) - Math.sin(k * Math.PI) * 90;
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(lerp(sh.x0, sh.tx, k), lerp(sh.y0, sh.ty, k), 5, 3, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffd0a0'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#6a3a10'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  drawPickups(ctx) {
    const t = G.time;
    ctx.globalCompositeOperation = 'lighter';
    for (const k of G.pickups) this.drawGlow(ctx, k.x, k.y, k.type === 'heart' ? 16 : 10, k.type === 'heart' ? COL.heart : COL.shard, 0.8);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    for (const k of G.pickups) {
      if (k.type === 'shard') {
        const a = t * 4 + k.x, s = 4;
        ctx.fillStyle = COL.shard;
        ctx.beginPath();
        ctx.moveTo(k.x + Math.cos(a) * s, k.y + Math.sin(a) * s * 1.4);
        ctx.lineTo(k.x + Math.cos(a + Math.PI / 2) * s * 0.6, k.y);
        ctx.lineTo(k.x - Math.cos(a) * s, k.y - Math.sin(a) * s * 1.4);
        ctx.lineTo(k.x - Math.cos(a + Math.PI / 2) * s * 0.6, k.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(k.x - 1, k.y - 1, 2, 2);
      } else {
        const s = 5 + Math.sin(t * 6) * 0.6;
        this.heartPath(ctx, k.x, k.y, s);
        ctx.fillStyle = COL.heart; ctx.fill();
      }
    }
  },

  heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s);
    ctx.bezierCurveTo(x - s * 2, y - s * 0.3, x - s * 0.8, y - s * 1.8, x, y - s * 0.6);
    ctx.bezierCurveTo(x + s * 0.8, y - s * 1.8, x + s * 2, y - s * 0.3, x, y + s);
    ctx.closePath();
  },

  drawEnemies(ctx) {
    const es = G.enemies;
    if (Q.glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const e of es) {
        if (e.dead) continue;
        const a = e.type === 'boss' ? (e.alpha == null ? 1 : e.alpha) : 1;
        this.drawGlow(ctx, e.x, e.y, e.r * (e.type === 'boss' ? 3 : 2.4), e.elite ? COL.gold : e.color, (e.charge > 0 ? 0.55 + e.charge * 0.45 : 0.4) * a);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    for (const e of es) {
      if (e.dead) continue;
      const white = e.flash > 0;
      const fill = white ? '#ffffff' : e.color;
      let sc = 1;
      if (e.spawnIn > 0) sc = 1 - e.spawnIn * 2;
      if (sc < 0.2) sc = 0.2;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (sc !== 1) ctx.scale(sc, sc);
      switch (e.type) {
        case 'grunt': case 'mini': {
          if (e.type === 'mini') { this.blobShape(ctx, e, fill); break; }
          const a = Math.atan2(e.vy, e.vx), r = e.r;
          ctx.rotate(a);
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.moveTo(r * 1.25, 0); ctx.lineTo(-r * 0.85, -r * 0.95); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.85, r * 0.95); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#2a0b26'; ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.28, 0, TAU); ctx.fill();
          break;
        }
        case 'spitter': {
          const r = e.r, p = G.player, a = Math.atan2(p.y - e.y, p.x - e.x);
          ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
          ctx.fillStyle = '#3a1d05'; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.fill();
          ctx.fillStyle = e.charge > 0 ? '#fff4c2' : '#ffa53d';
          ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, r * (0.25 + e.charge * 0.25), 0, TAU); ctx.fill();
          break;
        }
        case 'charger': {
          const r = e.r, a = e.state === 'aim' || e.state === 'dash' ? e.ang : Math.atan2(e.vy, e.vx);
          ctx.rotate(a);
          ctx.fillStyle = fill;
          ctx.fillRect(-r, -r * 0.85, r * 1.9, r * 1.7);
          ctx.beginPath(); ctx.moveTo(r * 0.9, -r * 0.85); ctx.lineTo(r * 1.5, -r * 1.2); ctx.lineTo(r * 0.9, -r * 0.3); ctx.fill();
          ctx.beginPath(); ctx.moveTo(r * 0.9, r * 0.85); ctx.lineTo(r * 1.5, r * 1.2); ctx.lineTo(r * 0.9, r * 0.3); ctx.fill();
          ctx.fillStyle = e.state === 'stun' ? '#666' : '#3a0707';
          ctx.fillRect(r * 0.2, -r * 0.35, r * 0.5, r * 0.7);
          break;
        }
        case 'blob': this.blobShape(ctx, e, fill); break;
        case 'bomber': {
          const r = e.r, blink = e.state === 'fuse' && ((e.st * 14) | 0) % 2 === 0;
          ctx.fillStyle = blink ? '#ffffff' : fill;
          ctx.rotate(e.t * 3);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8, rr = i % 2 ? r * 0.8 : r * 1.25; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#3a3005'; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.fill();
          break;
        }
        case 'sentinel': {
          const r = e.r;
          ctx.rotate(e.t * 0.8);
          ctx.fillStyle = fill;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#20093a';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill();
          if (e.charge > 0) {
            ctx.strokeStyle = '#e8d0ff'; ctx.lineWidth = 2; ctx.globalAlpha = e.charge;
            ctx.beginPath(); ctx.arc(0, 0, r + 4 + (1 - e.charge) * 14, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
          }
          break;
        }
        case 'fake': this.mirrorShape(ctx, e, fill, false); break;
        case 'leaper': {
          const r = e.r, sq = e.state === 'crouch' ? 1 - Math.min(1, e.charge) * 0.25 : 1;
          if (e.air) { const h = Math.sin((e.airK || 0) * Math.PI); ctx.scale(1 + h * 0.4, 1 + h * 0.4); }
          ctx.scale(1 / sq, sq);
          ctx.strokeStyle = fill; ctx.lineWidth = 2.5;
          ctx.beginPath();
          for (const a of [0.7, 2.44, 3.84, 5.58]) { ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6); ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); }
          ctx.stroke();
          ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
          ctx.fillStyle = '#0a2440'; ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 0.35, 0, TAU); ctx.fill();
          break;
        }
        case 'sniper': {
          const r = e.r, a = e.state === 'aim' ? e.ang : Math.atan2(G.player.y - e.y, G.player.x - e.x);
          ctx.rotate(a);
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.moveTo(r * 1.7, 0); ctx.lineTo(0, -r * 0.8); ctx.lineTo(-r, 0); ctx.lineTo(0, r * 0.8); ctx.closePath(); ctx.fill();
          ctx.fillStyle = e.charge > 0 ? '#ffffff' : '#1a1c40'; ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.3, 0, TAU); ctx.fill();
          break;
        }
        case 'shielder': {
          const r = e.r;
          ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
          ctx.fillStyle = '#2a2f45'; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
          const w = e.elite ? 1.2 : 1.05;
          ctx.rotate(e.face || 0);
          const down = e.state === 'stagger' || e.state === 'bash';
          ctx.strokeStyle = down ? 'rgba(159,216,255,0.25)' : e.shieldFlash > 0 || e.state === 'windup' ? '#ffffff' : '#9fd8ff';
          ctx.lineWidth = down ? 2 : 5; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(0, 0, r + (down ? 2 : 5), -w, w); ctx.stroke(); ctx.lineCap = 'butt';
          if (e.state === 'stagger') { ctx.rotate(-(e.face || 0)); ctx.fillStyle = '#ffd44d'; for (let i = 0; i < 3; i++) { const a = e.t * 5 + (i * TAU) / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 7, -r - 6 + Math.sin(a) * 2, 2, 0, TAU); ctx.fill(); } }
          break;
        }
        case 'brood': {
          const r = e.r, pul = 1 + Math.sin(e.t * 4) * 0.06 + (e.charge || 0) * 0.12;
          ctx.scale(pul, pul);
          ctx.fillStyle = fill; ctx.beginPath();
          for (let i = 0; i < 10; i++) { const a = (i * TAU) / 10, rr = r * (i % 2 ? 0.85 : 1.05); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#26400a';
          for (let i = 0; i < 4; i++) { const a = e.t + (i * TAU) / 4; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.18, 0, TAU); ctx.fill(); }
          break;
        }
        case 'mite': {
          const r = e.r; ctx.rotate(Math.atan2(e.vy, e.vx));
          ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r, -r); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill();
          break;
        }
        case 'mortar': {
          const r = e.r;
          ctx.fillStyle = fill; ctx.fillRect(-r, -r * 0.8, r * 2, r * 1.6);
          ctx.rotate(e.ang || 0);
          ctx.fillStyle = e.charge > 0 ? '#ffe0b0' : '#5a3a18'; ctx.fillRect(0, -r * 0.3, r * 1.4, r * 0.6);
          break;
        }
        case 'boss': this.drawBoss(ctx, e, fill); break;
      }
      ctx.restore();
      if (e.elite) {
        ctx.strokeStyle = COL.gold; ctx.lineWidth = 2; ctx.globalAlpha = 0.6 + Math.sin(G.time * 6) * 0.3;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (e.slowT > 0) {
        ctx.strokeStyle = COL.frost; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 2, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (e.type !== 'boss' && e.type !== 'fake' && e.hp < e.maxHp) {
        const w = Math.max(14, e.r * 2), k = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w, 3);
        ctx.fillStyle = e.elite ? COL.gold : '#ffffff'; ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w * k, 3);
      }
    }
  },

  blobShape(ctx, e, fill) {
    const r = e.r, w = Math.sin(e.t * 6) * 0.1;
    ctx.scale(1 + w, 1 - w);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.35, r * 0.28, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0b2a14';
    ctx.beginPath(); ctx.arc(r * 0.15, r * 0.1, r * 0.18, 0, TAU); ctx.arc(-r * 0.3, r * 0.15, r * 0.14, 0, TAU); ctx.fill();
  },

  mirrorShape(ctx, e, fill, real) {
    const r = e.r;
    ctx.rotate(e.t * 0.6);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.2); ctx.lineTo(r, 0); ctx.lineTo(0, r * 1.2); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#062a22';
    ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(r * 0.66, 0); ctx.lineTo(0, r * 0.8); ctx.lineTo(-r * 0.66, 0); ctx.closePath(); ctx.fill();
    ctx.rotate(-e.t * 1.4);
    ctx.beginPath(); ctx.moveTo(0, -r * 0.42); ctx.lineTo(r * 0.36, 0); ctx.lineTo(0, r * 0.42); ctx.lineTo(-r * 0.36, 0); ctx.closePath();
    if (real) { ctx.fillStyle = '#ffffff'; ctx.fill(); }
    else { ctx.strokeStyle = '#bfffee'; ctx.lineWidth = 2; ctx.stroke(); }
  },

  drawBoss(ctx, b, fill) {
    const r = b.r;
    ctx.globalAlpha = b.alpha == null ? 1 : Math.max(0.05, b.alpha);
    if (b.air) { const s = 1 + Math.sin((b.airK || 0) * Math.PI) * 0.45; ctx.scale(s, s); }
    if (b.charge > 0) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha *= b.charge;
      ctx.beginPath(); ctx.arc(0, 0, r + 6 + (1 - b.charge) * 20, 0, TAU); ctx.stroke();
      ctx.globalAlpha = b.alpha == null ? 1 : Math.max(0.05, b.alpha);
    }
    if (b.kind === 'warden') {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8 + Math.PI / 8; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2b1a05';
      ctx.fillRect(-r * 0.62, -r * 0.62, r * 1.24, r * 1.24);
      const p = G.player, a = Math.atan2(p.y - b.y, p.x - b.x);
      ctx.fillStyle = b.phase2 ? '#ff4f3d' : '#ffe0a0';
      ctx.fillRect(Math.cos(a) * r * 0.2 - r * 0.45, Math.sin(a) * r * 0.2 - r * 0.1, r * 0.9, r * 0.2);
      ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 2;
      ctx.strokeRect(-r * 0.62, -r * 0.62, r * 1.24, r * 1.24);
    } else if (b.kind === 'loom') {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#f0d4ff'; ctx.lineWidth = 2.5;
      for (let k = 0; k < 3; k++) { const a = b.t * (k % 2 ? -1.2 : 1.6) + k; ctx.beginPath(); ctx.arc(0, 0, r + 6 + k * 5, a, a + 1.4); ctx.stroke(); }
      ctx.fillStyle = '#f7ecff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.fill();
      ctx.fillStyle = b.phase2 ? '#ff2d6b' : '#3b0f5c';
      ctx.beginPath(); ctx.arc(Math.cos(b.eyeA) * r * 0.25, Math.sin(b.eyeA) * r * 0.25, r * 0.3, 0, TAU); ctx.fill();
    } else if (b.kind === 'mirror') {
      this.mirrorShape(ctx, b, fill, true);
    } else if (b.kind === 'polarity') {
      // two half-discs spinning around each other
      ctx.save(); ctx.rotate(b.t * 1.2);
      ctx.fillStyle = POL_COL[0]; ctx.beginPath(); ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.fill();
      ctx.fillStyle = POL_COL[1]; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.fill();
      ctx.fillStyle = POL_COL[1]; ctx.beginPath(); ctx.arc(0, -r / 2, r / 2, 0, TAU); ctx.fill();
      ctx.fillStyle = POL_COL[0]; ctx.beginPath(); ctx.arc(0, r / 2, r / 2, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, TAU); ctx.stroke();
    } else if (b.kind === 'keys') {
      // a hunched hunter with a ring of keys; its eyes glow
      const a = b.face || 0;
      ctx.rotate(a);
      ctx.fillStyle = '#3a2f1a'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.3, r, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = fill; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = b.alertT > 0 ? '#ff4f3d' : '#ffe39a';
      ctx.beginPath(); ctx.arc(r * 0.7, -r * 0.35, 2.6, 0, TAU); ctx.arc(r * 0.7, r * 0.35, 2.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-r * 0.6, 0, r * 0.45, 0, TAU); ctx.stroke();
    } else if (b.kind === 'collapse') {
      // a stone giant: shoulders and a glowing maw
      ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.6, r, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = fill; ctx.fillRect(-r * 0.7, -r * 0.8, r * 1.4, r * 1.3);
      ctx.fillStyle = '#1a120a'; ctx.fillRect(-r * 0.45, -r * 0.1, r * 0.9, r * 0.35);
      ctx.fillStyle = b.phase2 ? '#ff4f3d' : '#ffb13d'; ctx.fillRect(-r * 0.4, -r * 0.5, r * 0.2, r * 0.14); ctx.fillRect(r * 0.2, -r * 0.5, r * 0.2, r * 0.14);
    } else if (b.kind === 'puppeteer') {
      // a masked head with a crossbar and dangling strings
      ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-r * 1.4, -r * 1.2); ctx.lineTo(r * 1.4, -r * 1.2); ctx.stroke();
      for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(k * r * 1.1, -r * 1.2); ctx.lineTo(k * r * 0.6, -r * 0.2 + Math.sin(b.t * 3 + k) * 3); ctx.stroke(); }
      ctx.fillStyle = '#f2e8dc'; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.85, r, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a0a10'; ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.15, r * 0.16, r * 0.24, 0, 0, TAU); ctx.ellipse(r * 0.32, -r * 0.15, r * 0.16, r * 0.24, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = fill; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, r * 0.3, r * 0.35, 0.2, Math.PI - 0.2); ctx.stroke();
    } else if (b.kind === 'architect') {
      // rotating nested squares
      ctx.save(); ctx.rotate(b.t * 0.5);
      ctx.fillStyle = fill; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.rotate(-b.t * 1.2 + Math.PI / 4); ctx.fillStyle = '#1a0a1c'; ctx.fillRect(-r * 0.68, -r * 0.68, r * 1.36, r * 1.36);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(-r * 0.68, -r * 0.68, r * 1.36, r * 1.36);
      ctx.restore();
      ctx.fillStyle = b.phase2 ? '#ff4f6b' : '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.22 + Math.sin(b.t * 5) * 1.5, 0, TAU); ctx.fill();
    } else if (b.kind === 'forge') {
      // anvil body with a glowing furnace mouth
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(-r * 1.1, -r * 0.55); ctx.lineTo(r * 1.1, -r * 0.55); ctx.lineTo(r * 0.7, r * 0.1); ctx.lineTo(r * 0.45, r * 0.9);
      ctx.lineTo(-r * 0.45, r * 0.9); ctx.lineTo(-r * 0.7, r * 0.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1206'; ctx.fillRect(-r * 0.55, -r * 0.3, r * 1.1, r * 0.75);
      const heat = 0.6 + Math.sin(b.t * 7) * 0.2 + (b.charge || 0) * 0.4;
      ctx.fillStyle = b.phase2 ? '#ff3d2d' : '#ffcf6b'; ctx.globalAlpha *= Math.min(1, heat);
      ctx.fillRect(-r * 0.4, -r * 0.15, r * 0.8, r * 0.45);
      ctx.globalAlpha = b.alpha == null ? 1 : Math.max(0.05, b.alpha);
      ctx.strokeStyle = '#ffd9b0'; ctx.lineWidth = 2; ctx.strokeRect(-r * 0.55, -r * 0.3, r * 1.1, r * 0.75);
    }
    ctx.globalAlpha = 1;
  },

  drawPlayer(ctx) {
    const p = G.player;
    if (!p || !p.alive) return;
    const s = G.stats, t = G.time;
    // trail
    const tr = p.trail, spd = Math.hypot(p.vx, p.vy);
    if (p.dashT > 0 || spd > 60) {
      ctx.fillStyle = COL.player;
      for (let i = 0; i < tr.length; i += 2) {
        const k = i / tr.length;
        ctx.globalAlpha = k * (p.dashT > 0 ? 0.35 : 0.12);
        ctx.beginPath(); ctx.arc(tr[i], tr[i + 1], p.r * (0.4 + k * 0.5), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(ctx, p.x, p.y, 26, p.frenzy > 0 ? '#ff8a3d' : COL.player, 0.7);
    ctx.globalCompositeOperation = 'source-over';
    let alpha = 1;
    if (p.iframes > 0 && ((t * 18) | 0) % 2 === 0) alpha = 0.35;
    ctx.globalAlpha = alpha;
    const a = G.side ? p.face : mouseAim() ? Math.atan2(mouseWorld().y - p.y, mouseWorld().x - p.x) : t - (p.lastShot || -9) < 0.35 ? p.aim : p.face;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(a);
    const ship = G.run ? G.run.ship : 'striker';
    ctx.fillStyle = p.pol != null ? POL_COL[p.pol] : p.dashT > 0 ? '#ffffff' : COL.player; // The Polarity: your colour
    this.drawShip(ctx, ship, ctx.fillStyle);
    ctx.restore();
    if (p.pol != null && G.boss && G.boss.kind === 'polarity') { // beam charge around you
      const k = (G.boss.charge2 || 0) / polarityNeed(G.boss);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = POL_COL[p.pol]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 17, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (p.shield > 0) {
      ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.55 + Math.sin(t * 5) * 0.2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const aa = (i * TAU) / 6 + t; ctx.lineTo(p.x + Math.cos(aa) * 15, p.y + Math.sin(aa) * 15); }
      ctx.closePath(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // blades
    const bl = p.blades;
    if (bl.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < bl.length; i += 3) this.drawGlow(ctx, bl[i], bl[i + 1], 14, COL.player, 0.7);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#eafcff';
      for (let i = 0; i < bl.length; i += 3) {
        ctx.save(); ctx.translate(bl[i], bl[i + 1]); ctx.rotate(bl[i + 2] + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, -3); ctx.lineTo(-8, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // dash-ready pips under player
    if (s.dashCharges > 1 || p.dashCharges < s.dashCharges) {
      for (let i = 0; i < s.dashCharges; i++) {
        ctx.fillStyle = i < p.dashCharges ? COL.player : 'rgba(77,243,255,0.2)';
        ctx.fillRect(p.x - (s.dashCharges * 6) / 2 + i * 6 + 1, p.y + 13, 4, 2);
      }
    }
  },

  drawPlayerBullets(ctx) {
    const arr = G.pb;
    if (!arr.length) return;
    if (Q.glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const b of arr) this.drawGlow(ctx, b.x, b.y, b.r * 3.2, b.crit ? COL.pCrit : COL.pBullet, 0.6);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? COL.pBullet : COL.pCrit;
      ctx.beginPath();
      let lw = 0;
      for (const b of arr) {
        if (b.crit !== (pass === 1)) continue;
        const sp = Math.hypot(b.vx, b.vy) || 1, l = 7 + b.r;
        ctx.moveTo(b.x - (b.vx / sp) * l, b.y - (b.vy / sp) * l);
        ctx.lineTo(b.x, b.y);
        lw = Math.max(lw, b.r * 1.5);
      }
      ctx.lineWidth = lw || 5;
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (const b of arr) { ctx.moveTo(b.x + b.r * 0.6, b.y); ctx.arc(b.x, b.y, b.r * 0.6, 0, TAU); }
    ctx.fill();
    ctx.lineCap = 'butt';
  },

  // Pre-baked enemy bullet: soft glow + colored disc + white core, one drawImage per bullet.
  // Sprite covers 6r x 6r; the disc radius is 1/6 of the sprite.
  bulletSprite(color, glow) {
    const key = color + (glow ? 'g' : 'n');
    let c = this.glow.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 72;
    const g = c.getContext('2d');
    if (glow) {
      const gr = g.createRadialGradient(36, 36, 8, 36, 36, 36);
      gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.45; g.fillStyle = gr; g.fillRect(0, 0, 72, 72); g.globalAlpha = 1;
    }
    g.fillStyle = color; g.beginPath(); g.arc(36, 36, 12, 0, TAU); g.fill();
    g.fillStyle = '#fff4f8'; g.beginPath(); g.arc(36, 36, 6, 0, TAU); g.fill();
    this.glow.set(key, c);
    return c;
  },

  drawEnemyBullets(ctx) {
    const arr = G.eb;
    if (!arr.length) return;
    ctx.globalAlpha = 1;
    const glow = Q.glow;
    if (!glow) {
      // low quality: batched paths are cheapest on CPU-rasterized canvases
      const byColor = this._byColor || (this._byColor = new Map());
      byColor.clear();
      for (const b of arr) { let l = byColor.get(b.color); if (!l) { l = []; byColor.set(b.color, l); } l.push(b); }
      for (const [color, list] of byColor) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const b of list) { const r = b.delay > 0 ? b.r * 0.8 : b.r; ctx.moveTo(b.x + r, b.y); ctx.arc(b.x, b.y, r, 0, TAU); }
        ctx.fill();
      }
      ctx.fillStyle = '#fff4f8';
      ctx.beginPath();
      for (const b of arr) { const r = b.r * 0.5; ctx.moveTo(b.x + r, b.y); ctx.arc(b.x, b.y, r, 0, TAU); }
      ctx.fill();
      return;
    }
    let lastColor = null, spr = null;
    for (const b of arr) {
      if (b.color !== lastColor) { lastColor = b.color; spr = this.bulletSprite(b.color, glow); }
      const r = (b.delay > 0 ? b.r * 0.8 : b.r) * 3;
      ctx.drawImage(spr, b.x - r, b.y - r, r * 2, r * 2);
    }
  },

  drawBeams(ctx) {
    if (!G.beams.length) return;
    ctx.save();
    if (G.circle) { hallPath(ctx); ctx.clip(); }
    ctx.lineCap = 'round';
    for (const bm of G.beams) {
      const firing = bm.t > bm.warn && bm.fire > 0;
      if (!firing) {
        const k = bm.t / bm.warn;
        if (bm.dashLine) {
          ctx.globalAlpha = 0.12 + 0.2 * k; ctx.strokeStyle = bm.color; ctx.lineWidth = bm.w;
          ctx.beginPath(); ctx.moveTo(bm.ax, bm.ay); ctx.lineTo(bm.bx, bm.by); ctx.stroke();
        }
        ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(bm.t * 14)) * k;
        ctx.strokeStyle = bm.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bm.ax, bm.ay); ctx.lineTo(bm.bx, bm.by); ctx.stroke();
        if (bm.rot) {
          // chevrons showing rotation direction
          const dir = Math.sign(bm.spd), nx = -Math.sin(bm.a) * dir, ny = Math.cos(bm.a) * dir;
          const ux = Math.cos(bm.a), uy = Math.sin(bm.a);
          ctx.lineWidth = 2.5; ctx.globalAlpha = 0.8;
          ctx.beginPath();
          for (let d = 50; d < 420; d += 55) {
            const x = bm.ax + ux * d, y = bm.ay + uy * d;
            ctx.moveTo(x - ux * 6, y - uy * 6); ctx.lineTo(x + nx * 9, y + ny * 9); ctx.lineTo(x + ux * 6, y + uy * 6);
          }
          ctx.stroke();
        }
      } else {
        ctx.globalAlpha = 0.45; ctx.strokeStyle = bm.color; ctx.lineWidth = bm.w * 1.5;
        ctx.beginPath(); ctx.moveTo(bm.ax, bm.ay); ctx.lineTo(bm.bx, bm.by); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = bm.w * 0.7;
        ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = bm.w * 0.3;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    ctx.restore();
  },

  drawParticles(ctx) {
    for (const r of G.rings) {
      const k = r.t / r.dur;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.width * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r0, r.r1, easeOut(k)), 0, TAU); ctx.stroke();
    }
    for (const b of G.bolts) {
      ctx.globalAlpha = 1 - b.t / b.life; ctx.strokeStyle = b.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.pts[0], b.pts[1]);
      for (let i = 2; i < b.pts.length; i += 2) ctx.lineTo(b.pts[i], b.pts[i + 1]);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of G.parts) {
      const k = p.life / p.max;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.shape === 1) {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * 0.7;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
      } else {
        const s = p.size * (0.4 + k * 0.6);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  drawTexts(ctx) {
    if (!G.texts.length) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (const t of G.texts) {
      const k = t.t / t.life;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = '900 ' + t.size + 'px system-ui, sans-serif';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  },

  // PC: neon crosshair at the mouse (the system cursor is hidden over the game)
  drawCrosshair(ctx) {
    if (!mouseAim() || (G.state !== 'play' && G.state !== 'climb')) return;
    const x = Input.mouse.x, y = Input.mouse.y, t = G.time, r = 9 + Math.sin(t * 5) * 0.8;
    ctx.globalAlpha = 0.9; ctx.strokeStyle = COL.player; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r - 6, y); ctx.lineTo(x - r + 3, y); ctx.moveTo(x + r - 3, y); ctx.lineTo(x + r + 6, y);
    ctx.moveTo(x, y - r - 6); ctx.lineTo(x, y - r + 3); ctx.moveTo(x, y + r - 3); ctx.lineTo(x, y + r + 6);
    ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  },

  drawJoystick(ctx) {
    const st = Input.stick;
    if (!st.active) return;
    const R = Input.R;
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(st.ox, st.oy, R, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(st.ox, st.oy, R, 0, TAU); ctx.stroke();
    const kx = st.ox + st.x * R, ky = st.oy + st.y * R;
    ctx.globalAlpha = 0.5; ctx.fillStyle = COL.player;
    ctx.beginPath(); ctx.arc(kx, ky, 22, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  },

  drawTutorial(ctx) {
    const t = G.tutorial;
    const lines = Input.pc ? [
      [0.8, 'WASD or arrow keys to move'],
      [4.5, mouseAim() ? 'Aim with the mouse, firing is automatic' : 'You fire automatically at the nearest enemy'],
      [8.5, 'SPACE, SHIFT or a mouse click = invulnerable dash'],
      [13, 'Dash through an attack = PERFECT DODGE'],
    ] : [
      [0.8, 'Drag anywhere on the screen to move'],
      [4.5, 'You fire automatically at the nearest enemy'],
      [8.5, 'DASH (or tap with a second finger) = invulnerable dodge'],
      [13, 'Dash through an attack = PERFECT DODGE'],
    ];
    let msg = null, a = 0;
    for (let i = 0; i < lines.length; i++) {
      const start = lines[i][0], end = lines[i + 1] ? lines[i + 1][0] : start + 4.5;
      if (t >= start && t < end) { msg = lines[i][1]; a = Math.min(1, (t - start) * 3, (end - t) * 3); }
    }
    if (!msg) return;
    ctx.globalAlpha = a;
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const y = this.offY + this.VH * this.scale * 0.72;
    const w = Math.min(this.sw - 24, ctx.measureText(msg).width + 28);
    ctx.fillStyle = 'rgba(10,9,26,0.85)';
    ctx.fillRect(this.sw / 2 - w / 2, y - 18, w, 36);
    ctx.strokeStyle = 'rgba(77,243,255,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(this.sw / 2 - w / 2 + 0.5, y - 17.5, w - 1, 35);
    ctx.fillStyle = '#eafcff';
    ctx.fillText(msg, this.sw / 2, y, this.sw - 36);
    ctx.globalAlpha = 1;
  },
};
