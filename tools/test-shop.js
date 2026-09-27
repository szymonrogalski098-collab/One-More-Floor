// Shop and Altar floors: buying with run shards, curses and their effects, saves.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G, S = OMF.Save.data, run = (s) => { for (let i = 0; i < s * 60; i++) OMF.step(1 / 60); };
    const step = () => { const s = G.shrine; G.player.x = s.x; G.player.y = s.y; run(0.2); };
    OMF.startGame(false); G.tutorial = 0;
    const seen = new Set();
    for (let i = 0; i < 300; i++) for (const t of nextDoorTypes(3 + (i % 20))) seen.add(t + '@' + (3 + (i % 20) >= 6 ? 'late' : (3 + (i % 20) >= 4 ? 'mid' : 'early')));
    check('shops appear from floor 4, altars from floor 6', seen.has('shop@mid') && seen.has('risk@late') && !seen.has('shop@early') && !seen.has('risk@mid') && !seen.has('risk@early'), [...seen]);
    // shop
    OMF.enterFloor(8, 'shop'); run(1); G.run.shards = 20;
    G.pickups.push({ x: 10, y: 10, vx: 0, vy: 0, type: 'shard', value: 30, t: 0, magnet: false });
    step();
    check('stepping on the shop opens it', G.state === 'reward' && OMF.UI.current === 's-shop' && G.shop.items.length === 3);
    check('wallet counts shards still on the floor', shopWallet() === 50, shopWallet());
    const it = G.shop.items.find((x) => x.price <= 50);
    const i = G.shop.items.indexOf(it);
    shopBuy(i);
    check('buying takes the price and gives the upgrade', G.run.shards === 50 - it.price && !!G.run.upgrades[it.id] && it.sold);
    const sh = G.run.shards; shopBuy(i);
    check('a sold item cannot be bought twice', G.run.shards === sh);
    G.run.shards = 3; const expensive = G.shop.items.findIndex((x) => !x.sold); shopBuy(expensive);
    check('cannot buy without enough shards', !G.shop.items[expensive].sold && G.run.shards === 3);
    G.player.hp = G.stats.maxHp; G.run.shards = 50; shopHeal();
    check('repair kit refused at full HP', G.run.shards === 50);
    G.player.hp = 1; shopHeal();
    check('repair kit heals for its price', G.player.hp === 3 && G.run.shards === 50 - SHOP_HEAL.price);
    const before = G.shop.items.map((x) => x.id).join(); shopReroll();
    check('reroll costs shards', G.run.shards === 50 - SHOP_HEAL.price - SHOP_REROLL_PRICE);
    shopLeave();
    check('leaving opens the stairs', G.state === 'play' && G.room.phase === 'doors' && G.stairs.every((s) => !s.locked));
    // altar
    OMF.enterFloor(9, 'risk'); run(1); step();
    check('stepping on the altar offers upgrade + curse pairs', G.state === 'reward' && G.altar.length >= 1 && G.altar.every((o) => UPG[o.id] && CURSE[o.curse]));
    altarChoose(-1);
    check('walking away: no curse, stairs open', G.run.curses.length === 0 && G.room.phase === 'doors');
    // curse effects
    const hp0 = G.stats.maxHp, rng0 = G.stats.range, cd0 = G.stats.dashCd;
    G.run.curses = ['frail', 'myopia', 'sluggish', 'hunted', 'barrage', 'greed']; computeStats();
    check('Frail / Short Sight / Sluggish change stats', G.stats.maxHp === hp0 - 1 && Math.abs(G.stats.range - rng0 * 0.8) < 1e-6 && Math.abs(G.stats.dashCd - cd0 * 1.25) < 1e-6);
    const e = spawnEnemy('grunt', 50, 50, false, []); const base = ENEMY.grunt.speed * G.scale.spd;
    check('Hunted: enemies faster', e.speed > base * 0.92 * 1.15 - 1e-6, [e.speed, base]);
    const bl = fireEB(0, 0, 0, 100); const sp = Math.hypot(bl.vx, bl.vy); killEB(G.eb.indexOf(bl));
    check('Barrage: bullets 15% faster', Math.abs(sp - 115) < 0.01, sp);
    // save & continue keeps curses and spent shards
    G.run.curses = ['frail']; computeStats(); saveSnapshot();
    OMF.startGame(true);
    check('curses survive Save & Quit', G.run.curses.includes('frail') && G.stats.maxHp === hp0 - 1);
    // taking a pact
    OMF.enterFloor(11, 'risk'); run(1); step();
    const o = G.altar[0]; altarChoose(0);
    check('taking a pact adds the upgrade and the curse', !!G.run.upgrades[o.id] && G.run.curses.includes(o.curse));
    return out;
  });
  await b.close();
  let fail = 0;
  for (const x of r) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  if (errs.length) { fail++; console.log('FAIL JS errors', errs); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + r.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
