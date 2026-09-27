// Training mode: barrier, counted hits (no death), respawns, immortal bosses, save untouched.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G, S = OMF.Save.data, run = (s, hook) => { for (let i = 0; i < s * 60; i++) { OMF.step(1 / 60); if (hook) hook(); } };
    S.best.floor = 31;
    const snap = { v: 2, floor: 9, type: 'combat', hp: 3, order: [], run: {}, floorState: null }; S.snapshot = snap;
    const best = S.best.floor, runs = S.runs, shards = S.shards;
    OMF.startTraining({ enemies: { spitter: 2, sniper: 1, sentinel: 1, mortar: 1 }, boss: null, elite: false, hard: false, shoot: false });
    let above = true, below = true, hp = G.player.hp;
    const I = OMF.Input, v0 = I.vector; I.vector = () => ({ x: 0, y: -1, mag: 1 });
    run(20, () => { for (const e of G.enemies) if (!e.dead && e.y > G.training.barrierY) above = false; if (G.player.y < G.training.barrierY) below = false; });
    I.vector = v0;
    check('enemies stay above the barrier, player below it', above && below);
    check('enemies attack through it: hits counted, HP untouched, still alive', G.training.hits > 0 && G.player.hp === hp && G.state === 'play', G.training.hits);
    check('the chosen enemies are all there', ['spitter', 'sniper', 'sentinel', 'mortar'].every((k) => G.enemies.some((e) => !e.dead && e.type === k)) && G.enemies.filter((e) => !e.dead && e.type === 'spitter').length === 2);
    check('no shooting unless enabled', G.pb.length === 0);
    const e0 = G.enemies.find((e) => e.type === 'spitter'); OMF.killEnemy(e0); run(3);
    check('a killed enemy comes back', G.enemies.filter((e) => !e.dead && e.type === 'spitter').length === 2);
    check('no shard drops', G.pickups.length === 0 && G.run.shards === 0);
    // bosses
    for (const k of ['warden', 'mirror', 'forge']) {
      OMF.startTraining({ enemies: {}, boss: k, elite: false, hard: true, shoot: true });
      run(4, () => { G.player.iframes = 0; });
      const bs = G.boss;
      bs.hp = 1; OMF.G.player.hp = 5; run(2);
      check(k + ': training boss cannot die, is enraged', G.boss === bs && !bs.dead && bs.hard, [bs.hp, bs.maxHp]);
    }
    OMF.startTraining({ enemies: {}, boss: 'elevator', elite: false, hard: false, shoot: false });
    run(70);
    check('elevator ride never ends in training', G.side && G.room.phase === 'fight' && G.boss && G.player.hp > 0);
    check('saved run, records, runs and shards untouched', S.snapshot === snap && S.best.floor === best && S.runs === runs && S.shards === shards);
    OMF.exitTraining();
    check('exit returns to the training screen', OMF.UI.current === 's-training' && !G.training);
    return out;
  });
  await b.close();
  let fail = 0;
  for (const x of r) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  if (errs.length) { fail++; console.log('FAIL JS errors', errs); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + r.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
