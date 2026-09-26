// UI / touch / PWA / offline audit across device profiles. Screenshots go to $SHOTS.
const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp/shots';
const URL = 'http://localhost:8080/One-More-Floor/';
const results = [];
const ok = (name, cond, extra = '') => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };

async function touchDrag(page, cdp, x0, y0, x1, y1, holdMs) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  const n = 6;
  for (let i = 1; i <= n; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(holdMs);
}
async function touchEnd(cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }

(async () => {
  const browser = await chromium.launch();
  const profiles = [
    ['iphone-se', devices['iPhone SE']],
    ['pixel7', devices['Pixel 7']],
    ['iphone14promax', devices['iPhone 14 Pro Max']],
    ['pixel7-landscape', devices['Pixel 7 landscape']],
    ['galaxy-fold-narrow', { viewport: { width: 280, height: 653 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ];
  for (const [name, dev] of profiles) {
    const ctx = await browser.newContext({ ...dev });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(URL + '?debug');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-menu.png` });
    // menu fits: primary button visible within viewport
    const vis = await page.evaluate(() => { const r = document.querySelector('[data-action=play]').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
    ok(name + ': play button on screen', vis);
    await page.tap('#s-menu [data-action=play]');
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    const before = await page.evaluate(() => ({ x: OMF.G.player.x, y: OMF.G.player.y }));
    const vp = page.viewportSize();
    await touchDrag(page, cdp, vp.width * 0.4, vp.height * 0.7, vp.width * 0.4 + 60, vp.height * 0.7, 500);
    await page.screenshot({ path: `${SHOTS}/${name}-joystick.png` });
    await touchEnd(cdp);
    const after = await page.evaluate(() => ({ x: OMF.G.player.x, y: OMF.G.player.y }));
    ok(name + ': touch joystick moves player right', after.x - before.x > 25, (after.x - before.x).toFixed(1) + 'px');
    // dash button
    const c0 = await page.evaluate(() => OMF.G.player.dashCharges);
    const box = await page.locator('#btn-dash').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 2 }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(30);
    const c1 = await page.evaluate(() => ({ c: OMF.G.player.dashCharges, t: OMF.G.player.dashT, ifr: OMF.G.player.dashIfr }));
    ok(name + ': dash button triggers dash', c1.c < c0 || c1.ifr > 0, JSON.stringify(c1));
    // second-finger tap = dash
    await page.waitForTimeout(1700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y: vp.height * 0.6, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y: vp.height * 0.6, id: 3 }, { x: vp.width * 0.5, y: vp.height * 0.5, id: 4 }] });
    await page.waitForTimeout(40);
    const c2 = await page.evaluate(() => OMF.G.player.dashIfr > 0 || OMF.G.player.dashCharges < OMF.G.stats.dashCharges);
    await touchEnd(cdp);
    ok(name + ': second-finger tap dashes', c2);
    // arena inside viewport & below HUD
    const lay = await page.evaluate(() => { const R = OMF.Render; const hud = document.querySelector('.hud-top').getBoundingClientRect(); return { top: R.offY, left: R.offX, bottom: R.offY + R.VH * R.scale, right: R.offX + R.VW * R.scale, hudBottom: hud.bottom, VW: R.VW, VH: R.VH, vw: innerWidth, vh: innerHeight }; });
    ok(name + ': arena fits viewport', lay.left >= 0 && lay.right <= lay.vw + 0.5 && lay.bottom <= lay.vh + 0.5, JSON.stringify(lay));
    ok(name + ': arena below HUD bar', lay.top >= lay.hudBottom - 2);
    // pause
    await page.tap('#btn-pause');
    await page.waitForTimeout(250);
    ok(name + ': pause', await page.evaluate(() => OMF.G.state === 'paused'));
    await page.screenshot({ path: `${SHOTS}/${name}-pause.png` });
    await page.tap('#s-pause [data-action=resume]');
    await page.waitForTimeout(100);
    ok(name + ': resume', await page.evaluate(() => OMF.G.state === 'play'));
    // force clear -> reward cards
    await page.evaluate(() => OMF.clearFloor());
    await page.waitForTimeout(2200);
    ok(name + ': reward screen shows', await page.evaluate(() => OMF.G.state === 'reward' && document.querySelectorAll('#up-cards .card').length === 3));
    await page.screenshot({ path: `${SHOTS}/${name}-reward.png` });
    await page.waitForTimeout(500);
    await page.tap('#up-cards .card');
    await page.waitForTimeout(300);
    ok(name + ': upgrade applied + doors', await page.evaluate(() => OMF.G.run.order.length >= 1 && OMF.G.doors.length >= 1 && OMF.G.state === 'play'));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/${name}-doors.png` });
    // bosses
    for (const f of [5, 10, 15]) {
      await page.evaluate((f) => { OMF.G.player.hp = 99; OMF.enterFloor(f, 'boss'); }, f);
      await page.waitForTimeout(4800);
      await page.screenshot({ path: `${SHOTS}/${name}-boss${f}.png` });
      ok(name + ': boss ' + f + ' spawned', await page.evaluate(() => !!OMF.G.boss && !document.querySelector('#bossbar').classList.contains('hidden')));
    }
    // death
    await page.evaluate(() => { const p = OMF.G.player; p.hp = 1; p.iframes = 0; p.dashIfr = 0; p.shield = 0; OMF.hurtPlayer(p.x + 5, p.y); });
    await page.waitForTimeout(2500);
    ok(name + ': death screen', await page.evaluate(() => OMF.UI.current === 's-dead'));
    await page.screenshot({ path: `${SHOTS}/${name}-death.png` });
    if (name === 'pixel7') {
      await page.waitForTimeout(500);
      await page.tap('#s-dead [data-action=meta]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${name}-meta.png` });
      await page.tap('#s-meta [data-action=back]');
      await page.waitForTimeout(200);
      ok(name + ': back from meta returns to death', await page.evaluate(() => OMF.UI.current === 's-dead'));
      await page.tap('#s-dead [data-action=play]');
      await page.waitForTimeout(600);
      ok(name + ': quick restart', await page.evaluate(() => OMF.G.state === 'play' && OMF.G.run.floor === 1));
    }
    ok(name + ': no JS errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // ---- persistence, continue, meta purchase, settings ----
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    await page.goto(URL + '?debug');
    await page.evaluate(() => { OMF.Save.data.shards = 500; OMF.Save.save(); OMF.UI.renderMenu(); });
    await page.tap('#s-menu [data-action=meta]');
    await page.waitForTimeout(200);
    await page.tap('.buy[data-id=hull]');
    await page.tap('.buy[data-id=u_halo]');
    await page.screenshot({ path: `${SHOTS}/meta-bought.png` });
    await page.tap('#s-meta [data-action=back]');
    await page.tap('#s-menu [data-action=settings]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/settings.png` });
    await page.tap('[data-set=shake]');
    await page.tap('[data-set=lefty]');
    await page.tap('[data-q=low]');
    await page.reload();
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ hull: OMF.Save.metaLvl('hull'), halo: OMF.Save.isUnlocked('halo'), shards: OMF.Save.data.shards, shake: OMF.Save.data.settings.shake, lefty: OMF.Save.data.settings.lefty, q: OMF.Save.data.settings.quality, qlevel: OMF.Q.level }));
    ok('meta purchase persisted', s.hull === 1 && s.halo && s.shards === 500 - 40 - 80, JSON.stringify(s));
    ok('settings persisted', s.shake === false && s.lefty === true && s.q === 'low' && s.qlevel === 0);
    // continue
    await page.evaluate(() => { OMF.startGame(false); OMF.addUpgrade('power'); OMF.addUpgrade('power'); OMF.enterFloor(7, 'elite'); });
    const maxHp = await page.evaluate(() => OMF.G.stats.maxHp);
    ok('meta hull applies (+1 HP)', maxHp === 6, 'maxHp=' + maxHp);
    await page.reload();
    await page.waitForTimeout(300);
    const cont = await page.evaluate(() => !document.getElementById('btn-continue').classList.contains('hidden') && document.getElementById('btn-continue').textContent);
    ok('continue button after reload', !!cont, cont);
    await page.tap('#btn-continue');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ f: OMF.G.run.floor, t: OMF.G.room.type, p: OMF.G.run.upgrades.power }));
    ok('continue restores floor/type/upgrades', r.f === 7 && r.t === 'elite' && r.p === 2, JSON.stringify(r));
    await page.evaluate(() => { OMF.G.state = 'play'; });
    await page.screenshot({ path: `${SHOTS}/lefty-lowq.png` });
    await ctx.close();
  }

  // ---- PWA + offline ----
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL);
    const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); const j = await r.json(); const icons = await Promise.all(j.icons.map(async (i) => (await fetch(new URL(i.src, l.href))).status)); return { j, icons, href: l.href }; });
    ok('manifest loads', !!man.j.name && man.j.display === 'standalone', man.href);
    ok('manifest icons resolve under sub-path', man.icons.every((s) => s === 200), man.icons.join(','));
    ok('manifest has 192+512+maskable', ['192x192', '512x512'].every((s) => man.j.icons.some((i) => i.sizes === s)) && man.j.icons.some((i) => i.purpose === 'maskable'));
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
    let ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!ctl) { await page.reload(); await page.waitForTimeout(800); ctl = await page.evaluate(() => !!navigator.serviceWorker.controller); }
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
    ok('service worker controls page', ctl, 'scope=' + scope);
    ok('SW scope is the sub-path', scope.endsWith('/One-More-Floor/'));
    const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return (await c.keys()).length; });
    ok('precache populated', cached >= 20, cached + ' entries');
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForTimeout(600);
    const offlineOk = await page.evaluate(() => typeof G !== 'undefined' && document.querySelector('#s-menu').classList.contains('active'));
    ok('loads offline after cache', offlineOk);
    await page.tap('#s-menu [data-action=play]');
    await page.waitForTimeout(1200);
    ok('playable offline', await page.evaluate(() => G.state === 'play' && G.rooms.length > 0 && !!G.grid));
    await page.screenshot({ path: `${SHOTS}/offline-play.png` });
    // also a deep URL with query offline
    await page.goto(URL + 'index.html?utm=x').catch(() => {});
    ok('offline index.html?query', await page.evaluate(() => typeof G !== 'undefined').catch(() => false));
    ok('PWA: no JS errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
