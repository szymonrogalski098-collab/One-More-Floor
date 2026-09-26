// New enemies, ascension, challenges and ships.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G, S = OMF.Save.data;
    S.challenges = {}; S.ships = ['striker']; S.asc = { unlocked: 0, selected: 0, best: {} };
    // arena with one enemy type, player immortal and standing still
    const arena = (type, elite, secs, hook) => {
      OMF.startGame(false); OMF.enterFloor(14, 'rest'); G.room.phase = 'fight'; G.shrine.used = true;
      const ex = G.exitRoom; G.player.x = ex.x + ex.w / 2; G.player.y = ex.y + ex.h - 40;
      const e = spawnEnemy(type, ex.x + ex.w / 2, ex.y + 70, elite, G.enemies); e.spawnIn = 0; e.roomId = -1;
      const seen = {};
      for (let i = 0; i < secs * 60; i++) { G.player.hp = 9; G.player.iframes = 0.5; OMF.step(1 / 60); if (hook) hook(e, seen); if (e.dead) break; }
      return { e, seen };
    };
    let a = arena('leaper', false, 8, (e, s) => { if (e.state === 'air') s.air = true; if (s.air && e.state === 'recover') s.landed = true; });
    check('leaper jumps and lands', a.seen.air && a.seen.landed);
    a = arena('sniper', false, 8, (e, s) => { if (e.state === 'aim') s.aim = true; for (const b of G.eb) if (Math.hypot(b.vx, b.vy) > 400) s.fast = true; });
    check('sniper aims then fires a fast shot', a.seen.aim && a.seen.fast);
    a = arena('shielder', false, 3, (e, s) => { if (e.shieldFlash > 0) s.blocked = (s.blocked || 0) + 1; s.hp = e.hp / e.maxHp; });
    check('shielder blocks frontal bullets', a.seen.blocked > 3, a.seen);
    a = arena('shielder', false, 10, (e, s) => { if (e.state === 'stagger') s.stag = true; s.hp = e.hp / e.maxHp; });
    check('shielder bashes and staggers with its shield down (takes damage)', a.seen.stag && (a.e.dead || a.seen.hp < 0.8), a.seen);
    // flanking: bullets from behind hurt it
    OMF.startGame(false); OMF.enterFloor(14, 'rest'); G.room.phase = 'fight'; G.shrine.used = true;
    { const ex = G.exitRoom, e = spawnEnemy('shielder', ex.x + ex.w / 2, ex.y + ex.h / 2, false, G.enemies); e.spawnIn = 0; e.face = -Math.PI / 2; e.speed = 0;
      G.player.x = e.x; G.player.y = e.y + 90; const hp0 = e.hp;
      for (let i = 0; i < 70; i++) { e.face = -Math.PI / 2; G.player.hp = 9; OMF.step(1 / 60); }
      check('shielder takes damage from behind', e.hp < hp0); }
    a = arena('brood', false, 9, (e, s) => { s.mites = Math.max(s.mites || 0, G.enemies.filter((m) => m.type === 'mite' && !m.dead).length); });
    check('brood hatches mites (max 5)', a.seen.mites >= 2 && a.seen.mites <= 5, a.seen.mites);
    a = arena('mortar', false, 8, (e, s) => { if (G.shells.length) s.shell = true; if (s.shell && !G.shells.length) s.landed = true; });
    check('mortar lobs shells that land', a.seen.shell && a.seen.landed);
    // spawn pools use them on later floors
    OMF.startGame(false);
    let seenTypes = new Set();
    for (let t = 0; t < 30; t++) { OMF.enterFloor(14 + (t % 3), 'combat'); for (const rm of G.rooms) for (const w of rm.waves || []) for (const s of w) seenTypes.add(s.t); }
    check('new enemies appear in floor plans', ['leaper', 'sniper', 'shielder', 'brood', 'mortar'].every((k) => seenTypes.has(k)), [...seenTypes]);

    // ascension
    S.asc = { unlocked: 3, selected: 3, best: {} };
    OMF.startGame(false); OMF.enterFloor(4, 'combat');
    const hpAsc = G.scale.hp; S.asc.selected = 0; OMF.startGame(false); OMF.enterFloor(4, 'combat');
    check('ascension 1+ raises enemy HP', Math.abs(hpAsc / G.scale.hp - 1.15) < 1e-6, hpAsc / G.scale.hp);
    S.asc.selected = 0; S.asc.unlocked = 0;
    OMF.startGame(false); OMF.enterFloor(15, 'boss'); for (let i = 0; i < 120; i++) OMF.step(1 / 60);
    OMF.killEnemy(G.boss); for (let i = 0; i < 30; i++) OMF.step(1 / 60);
    check('beating The Mirror unlocks Ascension 1', S.asc.unlocked === 1);
    check('challenge "Shattered" granted', !!S.challenges.mirror);
    // ships
    const sh0 = S.shards;
    OMF.startGame(false); OMF.enterFloor(10, 'boss'); for (let i = 0; i < 120; i++) OMF.step(1 / 60);
    const hurt = G.run.hurt; OMF.killEnemy(G.boss); for (let i = 0; i < 30; i++) OMF.step(1 / 60);
    check('Loom Breaker unlocks the Lancer', S.ships.includes('lancer'));
    check('boss without damage unlocks the Phantom', G.run.hurt === hurt ? S.ships.includes('phantom') : true);
    S.ship = 'lancer'; OMF.startGame(false);
    check('Lancer stats apply', G.run.ship === 'lancer' && G.stats.pierce === 1 && G.stats.dmg > 16);
    S.ship = 'bulwark'; OMF.startGame(false);
    check('locked ship falls back to Striker', G.run.ship === 'striker');
    S.shards = 5000; OMF.UI.buyShip('bulwark');
    check('ships can be bought', S.ships.includes('bulwark') && S.shards === 5000 - 550);
    S.ship = 'striker';
    return out;
  });
  let fail = 0;
  for (const [s, n, i] of r) { if (s === 'FAIL') fail++; console.log(s, n, i); }
  if (errs.length) { fail++; console.log('JS errors', errs); }
  console.log(`\n${r.length - fail}/${r.length} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
