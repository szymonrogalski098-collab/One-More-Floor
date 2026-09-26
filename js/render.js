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
    if (R && R.active && R.active.w <= this.VW && R.active.h <= this.VH) { tx = R.active.x + R.active.w / 2; ty = R.active.y + R.active.h / 2; }
    else if (G.boss && !G.boss.dead) { tx += (G.boss.x - tx) * 0.3; ty += (G.boss.y - ty) * 0.3; }
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
    const grid = G.grid, cols = grid.cols, rows = grid.rows;
    const open = (tx, ty) => !solidTile(tx, ty);
    if (G.circle) {
      const cc = G.circle;
      g.save(); g.beginPath(); g.arc(cc.x, cc.y, cc.R, 0, TAU); g.clip();
      g.fillStyle = z.a; g.fillRect(0, 0, G.W, G.H);
      for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) if (((tx + ty) & 1) === 0) { g.fillStyle = z.b; g.fillRect(tx * T, ty * T, T, T); }
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
      g.fillStyle = '#1f1b40'; g.fillRect(p.x, p.y, p.w, p.h);
      g.fillStyle = '#2c2758'; g.fillRect(p.x, p.y, p.w, Math.min(6, p.h / 3));
    }
    // neon wall edges
    g.strokeStyle = z.edge;
    if (G.circle) {
      const cc = G.circle;
      g.globalAlpha = 0.75; g.lineWidth = 3; g.beginPath(); g.arc(cc.x, cc.y, cc.R, 0, TAU); g.stroke();
      g.globalAlpha = 0.18; g.lineWidth = 10; g.beginPath(); g.arc(cc.x, cc.y, cc.R - 6, 0, TAU); g.stroke();
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

    this.drawGates(ctx);
    this.drawDoors(ctx);
    this.drawShrine(ctx);
    this.drawMarkers(ctx);
    this.drawTelegraphs(ctx);
    this.drawPickups(ctx);
    this.drawEnemies(ctx);
    this.drawPlayer(ctx);
    this.drawGuide(ctx);
    this.drawPlayerBullets(ctx);
    this.drawEnemyBullets(ctx);
    this.drawBeams(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);

    // screen space
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0, this.sw, this.sh);
    this.drawOffscreen(ctx);
    const p = G.player;
    let dmgA = G.flash * 0.7;
    if (p && p.alive && p.hp === 1) dmgA = Math.max(dmgA, 0.18 + Math.sin(G.time * 6) * 0.1);
    if (dmgA > 0.01) { ctx.globalAlpha = Math.min(1, dmgA); ctx.drawImage(this.dmgVignette, 0, 0, this.sw, this.sh); ctx.globalAlpha = 1; }
    this.drawJoystick(ctx);
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
    if (!tg) return;
    const w = routeTo(p.x, p.y, p.r, tg.x, tg.y) || tg;
    const a = Math.atan2(w.y - p.y, w.x - p.x);
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

  drawDoors(ctx) {
    if (!G.doors.length) return;
    const t = G.time;
    for (const dr of G.doors) {
      const col = ROOM[dr.type].color;
      const cx = dr.x + dr.w / 2, pulse = 0.6 + Math.sin(t * 4 + cx) * 0.25;
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(ctx, cx, dr.y + dr.h / 2, 60, col, pulse);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#04030a';
      ctx.fillRect(dr.x, dr.y, dr.w, dr.h);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.strokeRect(dr.x, dr.y, dr.w, dr.h);
      this.drawRoomIcon(ctx, dr.type, cx, dr.y + dr.h / 2, col);
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = col;
      ctx.fillText(ROOM[dr.type].name, cx, dr.y + dr.h + 6);
      // bouncing chevron
      const by = dr.y + dr.h + 24 + Math.sin(t * 6) * 3;
      ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 6, by + 5); ctx.lineTo(cx, by); ctx.lineTo(cx + 6, by + 5); ctx.stroke();
      ctx.globalAlpha = 1;
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
    } else if (type === 'boss') {
      ctx.moveTo(x - 10, y + 6); ctx.lineTo(x - 10, y - 5); ctx.lineTo(x - 5, y); ctx.lineTo(x, y - 8); ctx.lineTo(x + 5, y); ctx.lineTo(x + 10, y - 5); ctx.lineTo(x + 10, y + 6); ctx.closePath(); ctx.fill();
    }
    ctx.lineCap = 'butt';
  },

  drawShrine(ctx) {
    const s = G.shrine;
    if (!s) return;
    const pulse = 0.5 + Math.sin(G.time * 3) * 0.2;
    const col = s.used ? '#3c5a44' : '#8dff6a';
    ctx.globalCompositeOperation = 'lighter';
    if (!s.used) this.drawGlow(ctx, s.x, s.y, 70, '#8dff6a', pulse);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, 20, 0, TAU); ctx.stroke();
    ctx.lineWidth = 5; ctx.beginPath();
    ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10); ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y); ctx.stroke();
    if (!s.used) {
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#8dff6a'; ctx.fillText('STEP IN', s.x, s.y + 28);
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
    const a = t - (p.lastShot || -9) < 0.35 ? p.aim : p.face;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(a);
    ctx.fillStyle = p.dashT > 0 ? '#ffffff' : COL.player;
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -8); ctx.lineTo(-3, 0); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COL.playerCore;
    ctx.beginPath(); ctx.arc(1, 0, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
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
    if (G.circle) { ctx.beginPath(); ctx.arc(G.circle.x, G.circle.y, G.circle.R, 0, TAU); ctx.clip(); }
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
    const lines = [
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
