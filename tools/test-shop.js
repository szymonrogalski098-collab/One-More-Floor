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
    OMF.startGame(false); G.tutorial = 0;
    const seen = new Set();
    for (let i = 0; i < 300; i++) for (const t of nextDoorTypes(3 + (i % 20))) seen.add(t + '@' + (3 + (i % 20) >= 6 ? 'late' : (3 + (i % 20) >= 4 ? 'mid' : 'early')));
    check('shops appear from floor 4, altars from floor 6', seen.has('shop@mid') && seen.has('risk@late') && !seen.has('shop@early') && !seen.has('risk@mid') && !seen.has('risk@early'), [...seen]);
    // shop: in the room, stairs open at once
    OMF.enterFloor(8, 'shop'); run(1); G.run.shards = 20;
    G.pickups.push({ x: 10, y: 10, vx: 0, vy: 0, type: 'shard', value: 30, t: 0, magnet: false });
    check('shop room: stairs open right away, no screen', G.state === 'play' && G.room.phase === 'doors' && G.stairs.every((s) => !s.locked) && OMF.UI.current !== 's-shop');
    check('shop stall: 3 upgrades + repair + reroll + trade on pedestals', shopUps().length === 3 && ['heal', 'reroll', 'trade'].every((t) => G.stall.items.some((x) => x.type === t)));
    const ups = shopUps(), it = ups.find((x) => x.price <= 50), i = ups.indexOf(it);
    G.player.x = it.x; G.player.y = it.y; run(0.1);
    check('standing on a pedestal shows it with a BUY button', !document.getElementById('stall-info').classList.contains('hidden') && document.getElementById('stall-btn').textContent.startsWith('BUY'));
    check('wallet counts shards still on the floor', shopWallet() === 50, shopWallet());
    OMF.UI.action('stall-use');
    check('BUY takes the price and gives the upgrade', G.run.shards === 50 - it.price && !!G.run.upgrades[it.id] && it.sold);
    const sh = G.run.shards; shopBuy(i);
    check('a sold item cannot be bought twice', G.run.shards === sh);
    G.run.shards = 3; const expensive = ups.findIndex((x) => !x.sold); shopBuy(expensive);
    check('cannot buy without enough shards', !ups[expensive].sold && G.run.shards === 3);
    G.player.hp = G.stats.maxHp; G.run.shards = 50; shopHeal();
    check('repair kit refused at full HP', G.run.shards === 50);
    G.player.hp = 1; shopHeal();
    check('repair kit heals for its price', G.player.hp === 3 && G.run.shards === 50 - SHOP_HEAL.price);
    shopReroll();
    check('reroll costs shards', G.run.shards === 50 - SHOP_HEAL.price - SHOP_REROLL_PRICE);
    const snapIds = shopUps().map((x) => x.id + x.sold).join(); OMF.startGame(true); run(1);
    check('save & quit keeps the shop exactly (no free rerolls)', shopUps().map((x) => x.id + x.sold).join() === snapIds);
    // walking out without buying
    const st = G.stairs[0]; OMF.goThroughDoor(st); run(1.5);
    check('you can leave a shop without touching it', G.run.floor === 9);
    // altar
    OMF.enterFloor(9, 'risk'); run(1);
    check('altar room: stairs open right away, pact stones offered', G.state === 'play' && G.room.phase === 'doors' && G.altar.length >= 1 && G.altar.every((o) => UPG[o.id] && (CURSE[o.curse] || UPG[o.lose])));
    check('walking past: no curse', G.run.curses.length === 0);
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
    OMF.enterFloor(11, 'risk'); run(1);
    const o = G.altar[0]; G.player.x = o.x; G.player.y = o.y; run(0.1);
    check('a pact stone shows SACRIFICE and RECEIVE', document.getElementById('stall-info').textContent.includes('SACRIFICE') && document.getElementById('stall-btn').textContent === 'ACCEPT THE PACT');
    OMF.UI.action('stall-use');
    check('taking a pact adds the upgrade and the curse', !!G.run.upgrades[o.id] && G.run.curses.includes(o.curse));
    const other = G.altar[1]; const c0 = G.run.curses.length; altarChoose(1);
    check('the other stones break: only one pact per altar', G.run.curses.length === c0 && !other.taken && G.stall.done);
    // the altar reads what you like this run
    OMF.startGame(false); for (const id of ['rapid', 'rapid', 'rapid', 'split', 'swift', 'power']) OMF.addUpgrade(id, true);
    check('tastes: spray is the favourite', runTastes()[0] === 'spray', runTastes());
    OMF.enterFloor(11, 'risk'); run(1);
    const A = G.altar;
    check('altar: your most-stacked upgrade, +2 levels, first', A[0].id === 'rapid' && A[0].levels === 2 && A[0].fav === 'spray', A);
    const epicOk = UPGRADES.some((u) => u.rarity === 2 && u.tag === 'spray' && OMF.Save.isUnlocked(u.id) && !u.req);
    check('altar: an epic of your favourite tag (or two levels of a spray rare)', epicOk ? A.some((x) => UPG[x.id].rarity === 2 && UPG[x.id].tag === 'spray') : A[1] && UPG[A[1].id].tag === 'spray' && A[1].levels === 2, A.map((x) => x.id));
    check('altar: no curse hits your favourite tag', A.every((x) => !(CURSE_HITS[x.curse] || []).includes('spray')), A.map((x) => x.curse));
    const lose = A.find((x) => x.lose);
    check('altar: one pact asks for an upgrade you rely on least (not spray)', !!lose && UPG[lose.lose].tag !== 'spray' && !!G.run.upgrades[lose.lose], A.map((x) => x.lose));
    const r0 = G.run.upgrades.rapid; altarChoose(0);
    check('altar: taking it adds both levels', G.run.upgrades.rapid === r0 + 2);
    OMF.enterFloor(13, 'risk'); run(1);
    const L = G.altar.find((x) => x.lose);
    if (L) { const gone = L.lose; altarChoose(G.altar.indexOf(L)); check('a sacrifice pact takes the upgrade away, no curse', !G.run.upgrades[gone] && !G.run.order.includes(gone) && !!G.run.upgrades[L.id]); }
    // music: one theme per zone, the calm rooms and each boss
    const th = (f, t) => { OMF.startGame(false); OMF.enterFloor(f, t); return Sound.theme; };
    check('music: zones 1-5 have their own themes', th(3, 'combat') === 'z1' && th(14, 'combat') === 'z2' && th(27, 'elite') === 'z3' && th(33, 'combat') === 'z4' && th(48, 'combat') === 'z5' && th(53, 'combat') === 'z1');
    check('music: rest, shop and altar sound different', th(7, 'rest') === 'rest' && th(8, 'shop') === 'shop' && th(9, 'risk') === 'altar');
    const bossThemes = [];
    for (const f of [5, 10, 15, 25, 35, 40, 45, 50]) { OMF.startGame(false); OMF.enterFloor(f, 'boss'); run(1.2); bossThemes.push(Sound.theme); }
    check('music: every boss has its own theme', new Set(bossThemes).size === bossThemes.length, bossThemes);
    OMF.killEnemy(G.boss); run(0.3);
    check('music: after the boss the zone theme returns', Sound.theme === 'z5', Sound.theme);
    return out;
  });
  await b.close();
  let fail = 0;
  for (const x of r) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  if (errs.length) { fail++; console.log('FAIL JS errors', errs); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + r.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
