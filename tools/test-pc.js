// Mouse & keyboard mode: no joystick on click, click = dash, bullets follow the mouse, touch switches back.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
  const errs = [];
  const page = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  await page.mouse.move(800, 300);
  check('PC mode on a mouse device', await page.evaluate(() => OMF.Input.pc && document.documentElement.classList.contains('pc')));
  check('menu shows PC controls', (await page.textContent('#m-controls')).includes('WASD'));
  const bb = await (await page.$('#s-menu .btn-primary')).boundingBox();
  await page.mouse.move(bb.x + 30, bb.y + 20); await page.waitForTimeout(250);
  const sc = await page.evaluate(() => getComputedStyle(document.querySelector('#s-menu .btn-primary')).transform);
  check('buttons grow on hover', sc !== 'none' && parseFloat(sc.split('(')[1]) > 1.01, sc);
  await page.mouse.click(bb.x + 30, bb.y + 20); await page.waitForTimeout(1200);
  await page.evaluate(() => { OMF.G.tutorial = 0; OMF.G.player.dashCharges = 1; });
  await page.mouse.move(1200, 250);
  await page.mouse.down(); await page.waitForTimeout(40);
  const r = await page.evaluate(() => ({ stick: OMF.Input.stick.active, dash: OMF.G.player.dashT > 0 || OMF.G.player.dashCharges === 0 }));
  await page.mouse.up();
  check('a click dashes and never shows the joystick', !r.stick && r.dash, r);
  await page.waitForTimeout(400);
  const x0 = await page.evaluate(() => OMF.G.player.x);
  await page.keyboard.down('a'); await page.waitForTimeout(350); await page.keyboard.up('a');
  check('WASD moves', (await page.evaluate(() => OMF.G.player.x)) < x0 - 10);
  check('auto-aim is the default on PC', await page.evaluate(() => OMF.Save.data.settings.mouseAim === false));
  await page.evaluate(() => { OMF.Save.data.settings.mouseAim = true; });
  await page.evaluate(() => { const G = OMF.G, p = G.player; G.pb.length = 0; let ox = -80, oy = 60; for (const [a, b] of [[-80, 60], [80, 60], [0, -80], [0, 80], [-80, 0], [80, 0]]) if (spotFree(p.x + a, p.y + b, 12) && hasLOS(p.x, p.y, p.x + a, p.y + b)) { ox = a; oy = b; break; } const e = spawnEnemy('grunt', p.x + ox, p.y + oy, false, G.enemies); e.spawnIn = 0; e.speed = 0; e.hp = e.maxHp = 1e9; G.room.phase = 'fight'; });
  await page.waitForTimeout(500);
  const aim = await page.evaluate(() => { const p = OMF.G.player, m = mouseWorld(), bl = OMF.G.pb[OMF.G.pb.length - 1]; return bl ? Math.abs(angleDiff(Math.atan2(bl.vy, bl.vx), Math.atan2(m.y - p.y, m.x - p.x))) : 9; });
  check('bullets go toward the mouse, not the enemy', aim < 0.3, aim);
  await page.evaluate(() => { OMF.Save.data.settings.mouseAim = false; OMF.G.pb.length = 0; });
  await page.waitForTimeout(500);
  const aim2 = await page.evaluate(() => { const p = OMF.G.player, e = OMF.G.enemies[0], bl = OMF.G.pb[OMF.G.pb.length - 1]; return bl ? Math.abs(angleDiff(Math.atan2(bl.vy, bl.vx), Math.atan2(e.y - p.y, e.x - p.x))) : 9; });
  check('mouse aim off = auto-aim', aim2 < 0.3, aim2);
  await page.evaluate(() => { OMF.Save.data.settings.mouseAim = true; });
  await page.dispatchEvent('#cv', 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 300, clientY: 500, isPrimary: true });
  check('a touch switches to touch controls (joystick)', await page.evaluate(() => !OMF.Input.pc && OMF.Input.stick.active));
  // guide arrow: stable while walking the path to the next room, and it gets you there
  const guide = await page.evaluate(() => {
    const res = [];
    for (let k = 0; k < 12; k++) {
      OMF.startGame(false); OMF.enterFloor(6 + (k % 4), 'combat');
      const G = OMF.G, p = G.player; G.arriveT = 0; G.tutorial = 0; G.room.phase = 'fight'; G.room.t = 1;
      let prev = null, maxJump = 0, reached = false, frames = 0;
      const tg0 = OMF.guideTarget();
      for (let i = 0; i < 60 * 25; i++) {
        p.iframes = 9; p.hp = 9;
        const tg = OMF.guideTarget();
        if (!tg || roomAt(p.x, p.y, 14) && roomAt(p.x, p.y, 14).state === 'idle') { reached = true; break; }
        const w = guidePoint(p.x, p.y, tg.x, tg.y), a = Math.atan2(w.y - p.y, w.x - p.x);
        if (prev !== null) maxJump = Math.max(maxJump, Math.abs(angleDiff(prev, a)));
        prev = a;
        p.x += Math.cos(a) * 150 / 60; p.y += Math.sin(a) * 150 / 60; collideWorld(p, p.r);
        frames++;
      }
      res.push({ reached, maxJump: +maxJump.toFixed(2), frames });
    }
    return res;
  });
  check('guide arrow leads to the next room', guide.every((g) => g.reached), guide);
  check('guide arrow never flips (max turn per frame < 1.2 rad)', guide.every((g) => g.maxJump < 1.2), guide.map((g) => g.maxJump));
  // shop: clicking BUY with the mouse buys, it must not dash
  await page.evaluate(() => { const G = OMF.G; OMF.startGame(false); OMF.enterFloor(8, 'shop'); G.run.shards = 99; for (let i = 0; i < 60; i++) OMF.step(1 / 60); const it = shopUps()[0]; G.player.x = it.x; G.player.y = it.y; G.player.dashCharges = 1; OMF.step(1 / 60); });
  await page.waitForTimeout(200);
  await page.click('#stall-btn');
  const sh = await page.evaluate(() => { OMF.step(1 / 60); const it = shopUps()[0]; return { sold: it.sold, dashT: OMF.G.player.dashT, charges: OMF.G.player.dashCharges }; });
  check('shop: a mouse click on BUY buys and does not dash', sh.sold && sh.dashT <= 0 && sh.charges === 1, sh);
  await page.evaluate(() => { const it = shopUps()[1]; OMF.G.player.x = it.x; OMF.G.player.y = it.y; OMF.G.run.shards = 99; OMF.step(1 / 60); });
  await page.keyboard.press('e');
  check('shop: E buys the item you stand on', await page.evaluate(() => shopUps()[1].sold));
  await page.evaluate(() => { const G = OMF.G; OMF.enterFloor(9, 'risk'); for (let i = 0; i < 60; i++) OMF.step(1 / 60); const o = G.altar[0]; G.player.x = o.x; G.player.y = o.y; G.player.dashCharges = 1; OMF.step(1 / 60); });
  await page.waitForTimeout(200);
  await page.click('#stall-btn');
  const al = await page.evaluate(() => { OMF.step(1 / 60); return { done: OMF.G.stall.done, dashT: OMF.G.player.dashT }; });
  check('altar: a mouse click on ACCEPT takes the pact and does not dash', al.done && al.dashT <= 0, al);
  check('no JS errors', !errs.length, errs);
  await b.close();
  let fail = 0;
  for (const x of out) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + out.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
