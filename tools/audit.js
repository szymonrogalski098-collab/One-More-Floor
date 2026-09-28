// Automated audit: runs the game in mobile Chromium under a GitHub-Pages-like sub-path,
// drives it with a simple bot at accelerated speed and checks invariants.
// Usage: node tools/serve.js 8080 &  then  node tools/audit.js
const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp/shots';
const URL = 'http://localhost:8080/One-More-Floor/';

const BOT = `
window.__bot = function (G) {
  const p = G.player;
  let mx = 0, my = 0;
  if (G.side) { // elevator boss: pick the safest x on the floor
    const S = G.side;
    if (G.room.phase === 'doors' && G.stairs.length) mx = G.stairs[0].dir;
    else {
      let best = p.x, bc = 1e9;
      for (let x = S.L + 10; x <= S.R - 10; x += 6) {
        let c = Math.abs(x - p.x) * 0.02;
        for (const d of S.drops) { const dx = Math.abs(d.x + d.vx * 0.3 - x); if (dx < d.r + 14) c += 10; }
        if (S.slam) for (const z of S.slam.zones) if (x > z.x0 - 12 && x < z.x1 + 12) c += 50;
        if (S.gapWarn) c += Math.abs(x - S.gapWarn.x) * 0.1;
        if (c < bc) { bc = c; best = x; }
      }
      mx = Math.abs(best - p.x) < 3 ? 0 : Math.sign(best - p.x);
    }
    const st = OMF.Input.stick; st.x = mx; st.y = 0; st.mag = Math.abs(mx);
    return;
  }
  if (G.room.phase === 'doors' && G.stairs.length) {
    const d = G.stairs[0]; let tx = d.x + d.w / 2, ty = d.y + d.h + 16;
    if (d.wall) { ty = d.y + d.h / 2; tx = d.wall < 0 ? d.x + d.w + 16 : d.x - 16; if (Math.abs(p.y - ty) < 12) tx = d.wall < 0 ? d.x : d.x + d.w; }
    else if (Math.abs(p.x - tx) < 12 && p.y < ty + 30) ty = d.y;
    const w = routeTo(p.x, p.y, p.r, tx, ty); if (w) { tx = w.x; ty = w.y; }
    mx = tx - p.x; my = ty - p.y;
  } else if (G.room.phase === 'rest' && G.shrine && !G.shrine.used) {
    mx = G.shrine.x - p.x; my = G.shrine.y - p.y;
  } else {
    const home = G.room.active ? { x: G.room.active.x + G.room.active.w / 2, y: G.room.active.y + G.room.active.h * 0.6 } : G.circle ? { x: G.circle.x, y: G.circle.y + 40 } : { x: p.x, y: p.y };
    mx = (home.x - p.x) * 0.004; my = (home.y - p.y) * 0.004;
    const gt = OMF.guideTarget();
    if (gt && !G.room.active) { const w = routeTo(p.x, p.y, p.r, gt.x, gt.y) || gt; const l = Math.hypot(w.x - p.x, w.y - p.y) || 1; mx += (w.x - p.x) / l; my += (w.y - p.y) / l; }
    for (const e of G.enemies) { if (e.sleep || !hasLOS(p.x, p.y, e.x, e.y)) continue; const dx = p.x - e.x, dy = p.y - e.y, d2 = dx*dx + dy*dy + 1; if (d2 < 150*150) { mx += dx / d2 * 60; my += dy / d2 * 60; } }
    let near = null, nd = 1e9;
    for (const e of G.enemies) { if (e.dead || e.sleep) continue; const d = (e.x-p.x)**2 + (e.y-p.y)**2; if (d < nd) { nd = d; near = e; } }
    if (near && (nd > 190*190 || !hasLOS(p.x, p.y, near.x, near.y))) { const w = routeTo(p.x, p.y, p.r, near.x, near.y) || near; const l = Math.hypot(w.x - p.x, w.y - p.y) || 1; mx += (w.x - p.x) / l * 0.8; my += (w.y - p.y) / l * 0.8; }
    let danger = false;
    for (const b of G.eb) { const dx = p.x - b.x, dy = p.y - b.y, d2 = dx*dx + dy*dy + 1; if (d2 < 70*70) { mx += dx / d2 * 40; my += dy / d2 * 40; } if (d2 < 22*22) danger = true; }
    for (const bm of G.beams) { if (bm.t > bm.warn - 0.2) { const ax = bm.bx - bm.ax, ay = bm.by - bm.ay; const n = Math.hypot(ax, ay) || 1; const cross = ((p.x - bm.ax) * ay - (p.y - bm.ay) * ax) / n; if (Math.abs(cross) < 30) { mx += -ay / n * Math.sign(cross || 1); my += ax / n * Math.sign(cross || 1); } } }
    const bs = G.boss;
    if (bs && bs.air) { const dx = p.x - bs.tx, dy = p.y - bs.ty, d = Math.hypot(dx, dy) || 1; if (d < 90) { mx += dx / d * 3; my += dy / d * 3; } }
    if (danger && p.dashCharges > 0) OMF.Input.dashQueued = true;
  }
  const l = Math.hypot(mx, my);
  const st = OMF.Input.stick;
  if (l > 0.0001) { st.x = mx / l; st.y = my / l; st.mag = 1; } else { st.x = st.y = st.mag = 0; }
};`;

async function simulate(page, opts) {
  return page.evaluate(async (o) => {
    const G = OMF.G, res = { floors: [], errors: [], maxEnemies: 0, maxEB: 0, maxParts: 0, bossesSeen: [], stepsMs: 0, steps: 0 };
    const t0 = performance.now();
    let steps = 0;
    try {
      while (steps < o.maxSteps) {
        if (G.state === 'reward' && G.rewardKind === 'shop') { const k = G.shop.items.findIndex((x) => x.price <= shopWallet()); if (k >= 0) shopBuy(k); shopLeave(); }
        else if (G.state === 'reward' && G.rewardKind === 'altar') altarChoose(Math.random() < 0.5 ? 0 : -1);
        else if (G.state === 'reward') {
          const cards = [...document.querySelectorAll('#up-cards .card')];
          const id = cards.length ? cards[(Math.random() * cards.length) | 0].dataset.id : null;
          OMF.UI.show(null); OMF.chooseUpgrade(id);
        }
        if (G.state === 'trans') { const cb = G.transCb; G.transCb = null; G.fadeDir = 0; G.fade = 0; cb(); res.floors.push(G.run.floor + ':' + G.room.type); }
        if (G.state === 'dead') break;
        if (G.state === 'climb') { const f0 = G.run.floor; OMF.step(1 / 60); if (G.run.floor !== f0) res.floors.push(G.run.floor + ':' + G.room.type); steps++; continue; }
        if (G.state !== 'play' && G.state !== 'dying') break;
        if (o.god && G.player.hp < 3) G.player.hp = 3;
        if (G.boss && res.bossesSeen.indexOf(G.boss.kind + '@' + G.run.floor) === -1) res.bossesSeen.push(G.boss.kind + '@' + G.run.floor);
        if (o.fastBoss && G.side && G.boss) G.side.t += 1 / 60;
        if (o.fastBoss && G.boss && G.boss.enter <= 0 && (G.boss.pt > 3 || G.boss.t > 4)) { G.boss.hp -= G.boss.maxHp * 0.004; if (G.boss.hp <= 0) OMF.killEnemy(G.boss); } // also the bosses your guns cannot hurt
        window.__bot(G);
        OMF.step(1 / 60);
        steps++;
        res.maxEnemies = Math.max(res.maxEnemies, G.enemies.length);
        res.maxEB = Math.max(res.maxEB, G.eb.length);
        res.maxParts = Math.max(res.maxParts, G.parts.length);
        if (o.untilFloor && G.run && G.run.floor >= o.untilFloor) break;
        // invariants
        const p = G.player;
        if (!isFinite(p.x) || !isFinite(p.y)) throw new Error('player NaN');
        if (p.x < 0 || p.x > G.W || p.y < 0 || p.y > G.H) throw new Error('player out of arena ' + p.x + ',' + p.y);
        for (const e of G.enemies) if (!isFinite(e.x) || !isFinite(e.hp)) throw new Error('enemy NaN ' + e.type);
        if (steps % 600 === 0) OMF.Render.draw();
      }
    } catch (e) { res.errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')); }
    res.steps = steps; res.stepsMs = performance.now() - t0;
    res.bossLeft = G.boss ? +(G.boss.hp / G.boss.maxHp).toFixed(2) : null; res.hurtBy = G.run && G.run.hurt;
    res.final = { state: G.state, floor: G.run ? G.run.floor : null, room: G.room && (G.room.type + ':' + G.room.phase + ':' + (G.room.active ? G.room.active.id : '-')), stairs: G.stairs.length, alive: G.enemies.filter((e) => !e.dead).length, pos: G.player && [Math.round(G.player.x), Math.round(G.player.y)], hp: G.player && G.player.hp, kills: G.run && G.run.kills, time: G.run && G.run.time, ups: G.run && JSON.stringify(G.run.upgrades) };
    return res;
  }, opts);
}

(async () => {
  const browser = await chromium.launch();
  const report = [];
  const log = (...a) => { console.log(...a); };
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL + '?debug');
  await page.addScriptTag({ content: BOT });
  await page.waitForTimeout(500);

  // 1) Honest bot runs (no god mode) — difficulty sanity
  for (let i = 0; i < (+process.env.RUNS || 3); i++) {
    await page.evaluate(() => { OMF.Save.data.snapshot = null; OMF.startGame(false); });
    const r = await simulate(page, { maxSteps: 60 * 60 * 12, god: false });
    log('BOT RUN', i, 'bossLeft', r.bossLeft, JSON.stringify(r.final), 'floors', r.floors.join(' '), 'max', r.maxEnemies, r.maxEB, r.maxParts, 'ms/step', (r.stepsMs / r.steps).toFixed(3), r.errors);
    await page.waitForTimeout(300);
    const dead = await page.evaluate(() => ({ state: OMF.G.state, screen: OMF.UI.current, shards: OMF.Save.data.shards, runs: OMF.Save.data.runs, best: OMF.Save.data.best.floor, snap: OMF.Save.data.snapshot }));
    log('  after:', JSON.stringify(dead));
  }
  await page.screenshot({ path: SHOTS + '/death.png' });

  // 2) God-mode run through 3 boss cycles (+ II variants)
  await page.evaluate(() => { OMF.startGame(false); });
  const g = await simulate(page, { maxSteps: 60 * 60 * 40, god: true, fastBoss: true, untilFloor: 31 });
  log('GOD RUN', JSON.stringify(g.final), 'bosses', g.bossesSeen.join(','), 'max', g.maxEnemies, g.maxEB, g.maxParts, g.errors);
  log('  floors', g.floors.join(' '));

  // 2b) God-mode bot through each late boss room (labyrinth, bridge, stage, summit) and out the stairs
  for (const f of [25, 35, 40, 45, 50]) {
    await page.evaluate((f) => { OMF.startGame(false); OMF.enterFloor(f, 'boss'); }, f);
    const l = await simulate(page, { maxSteps: 60 * 60 * 8, god: true, fastBoss: true, untilFloor: f + 1 });
    log('LATE BOSS', f, l.bossesSeen.join(','), JSON.stringify({ floor: l.final.floor, room: l.final.room, pos: l.final.pos, time: Math.round(l.final.time) }), l.final.floor === f + 1 ? 'OK' : 'STUCK', l.errors);
  }

  // 3) All upgrades maxed stress test on a boss floor
  const s = await page.evaluate(() => {
    const G = OMF.G;
    OMF.startGame(false);
    for (const u of UPGRADES) for (let k = 0; k < u.max; k++) OMF.addUpgrade(u.id, true);
    OMF.enterFloor(10, 'boss');
    return OMF.G.stats;
  });
  log('MAXED stats dmg', s.dmg.toFixed(1), 'rof', s.rof.toFixed(2), 'proj', s.proj, 'maxHp', s.maxHp);
  const m = await simulate(page, { maxSteps: 60 * 40, god: true });
  log('MAXED RUN', JSON.stringify(m.final), 'max', m.maxEnemies, m.maxEB, m.maxParts, 'ms/step', (m.stepsMs / m.steps).toFixed(3), m.errors);
  await page.evaluate(() => OMF.Render.draw());
  await page.screenshot({ path: SHOTS + '/maxed.png' });

  log('PAGE ERRORS', errors);
  await browser.close();
})();
