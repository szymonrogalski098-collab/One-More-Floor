// Checkpoints: unlock on boss kill, start from them with a starting kit, no shards for skipped floors.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G, S = OMF.Save.data, run = (s) => { for (let i = 0; i < s * 60; i++) OMF.step(1 / 60); };
    S.checkpoints = {}; S.startSel = 1; S.asc = { unlocked: 0, selected: 0, best: {} }; S.meta.start = 0;
    check('no checkpoint to choose before any boss', OMF.UI.nrOptions().cps.length === 0);
    // beat the floor-5 boss
    OMF.startGame(false); OMF.enterFloor(5, 'boss'); run(2.5); OMF.killEnemy(G.boss); run(0.5);
    check('beating the floor-5 boss unlocks checkpoint 6', (S.checkpoints[0] | 0) === 6, S.checkpoints);
    // elevator boss unlocks too
    OMF.startGame(false); OMF.enterFloor(20, 'boss'); run(1.3); G.side.t = G.side.dur; run(0.2);
    check('surviving the elevator unlocks checkpoint 21', (S.checkpoints[0] | 0) === 21);
    G.state = 'menu'; OMF.UI.stack = []; OMF.UI.show('s-menu'); S.shards = 0; S.ships = ['striker'];
    OMF.UI.action('play');
    check('PLAY opens the New Run screen with a CHECKPOINT card', OMF.UI.current === 's-newrun' && !!document.querySelector('[data-k="mode"][data-v="cp"]'));
    OMF.UI.action('nr-pick', document.querySelector('[data-k="mode"][data-v="cp"]'));
    const floors = [...document.querySelectorAll('[data-k="cp"]')].map((e) => +e.dataset.v);
    check('checkpoint cards go from the highest floor down, no floor 1', floors.join(',') === '21,16,11,6', floors);
    // start from checkpoint 11: 5 kit picks, +2 rerolls (nothing to buy: no loadout step)
    const rr0 = S.meta.reroll | 0;
    OMF.UI.action('nr-pick', document.querySelector('[data-k="cp"][data-v="11"]'));
    check('run starts on floor 11 with the kit screen', G.run.floor === 11 && G.state === 'reward' && G.rewardKind === 'kit' && document.getElementById('up-title').textContent === 'STARTING KIT');
    check('kit size 5 picks, +2 rerolls', G.run.kitTotal === 5 && G.run.rerolls === rr0 + 2, [G.run.kitTotal, G.run.rerolls]);
    check('no remembered build: Power Core and Ember come on top of the picks', !!G.run.upgrades.power && !!G.run.upgrades.ember, G.run.order);
    // quit mid-kit and continue: remaining picks are offered again
    OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id);
    OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id);
    OMF.startGame(true);
    check('continue mid-kit keeps the picks made and offers the rest', G.run.order.length >= 1 && G.run.kitLeft === 3 && G.state === 'reward', [G.run.order.length, G.run.kitLeft]);
    while (G.run.kitLeft > 0) OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id);
    check('after the kit: playing, full HP, stairs still locked', G.state === 'play' && G.player.hp === G.stats.maxHp && G.stairs.every((s) => s.locked) && G.run.order.length >= 4, G.run.order.length);
    // shards: only climbed floors
    G.run.floor = 14; G.run.shards = 0; const res = finalizeRun(false);
    check('floor bonus counts only floors 11-14 (4 floors)', res.floorBonus === 8, res.floorBonus);
    OMF.startGame(false); while (G.run.kitLeft > 0) OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id);
    G.run.floor = 13; G.run.shards = 20; const ab = finalizeRun(true);
    check('ending within the first 3 floors of a checkpoint run pays nothing', ab.noPay && ab.earned === 0);
    // a build carried past a checkpoint is remembered and restored minus one upgrade
    S.startSel = 1; OMF.startGame(false);
    for (const id of ['power', 'power', 'rapid', 'split', 'lens', 'aegis']) OMF.addUpgrade(id, true);
    OMF.enterFloor(10, 'boss'); run(2.5); OMF.killEnemy(G.boss); run(0.3);
    G.run.floor = 17; finalizeRun(false);
    const saved = S.cpBuilds[0] && S.cpBuilds[0][11];
    check('build and reached floor are remembered for checkpoint 11', saved && saved.reached === 17 && saved.order.length === 6, saved);
    G.state = 'menu'; OMF.UI.openNewRun(); OMF.UI.nrPick('mode', 'cp');
    check('the checkpoint card describes the remembered build', document.querySelector('[data-k="cp"][data-v="11"]').textContent.includes('5 upgrades from your run'));
    OMF.UI.back(); S.startSel = 11;
    OMF.startGame(false);
    const n = G.run.order.reduce((a, id) => a + G.run.upgrades[id], 0);
    check('checkpoint restores the build minus one upgrade, no pick screen', n === 5 && G.state === 'play' && G.run.kitLeft === 0 && !G.run.upgrades.ember, [n, G.state, G.run.order]);
    // a worse run does not overwrite the better build
    G.run.upgrades = {}; G.run.order = []; OMF.addUpgrade('swift', true);
    OMF.enterFloor(10, 'boss'); run(2.5); OMF.killEnemy(G.boss); run(0.3); G.run.floor = 12; finalizeRun(false);
    check('a shorter run keeps the better remembered build', S.cpBuilds[0][11].reached === 17);
    // challenges: Flawless Ascent / Iron Will
    S.challenges = {}; S.startSel = 1;
    OMF.startGame(false); G.run.hurt = 1; OMF.enterFloor(25, 'boss');
    check('Flawless Ascent needs zero hits', !S.challenges.flawless);
    S.startSel = 21; OMF.startGame(false); while (G.run.kitLeft > 0) OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id);
    G.run.hurt = 0; OMF.enterFloor(25, 'boss');
    check('Flawless Ascent does not count from a checkpoint', !S.challenges.flawless);
    S.startSel = 1; OMF.startGame(false); G.run.hurt = 0; OMF.enterFloor(25, 'boss');
    check('Flawless Ascent: floor-25 boss reached without a hit', !!S.challenges.flawless);
    OMF.startGame(false); G.run.hurt = 29; OMF.enterFloor(40, 'combat');
    check('Iron Will needs 30 HP lost', !S.challenges.ironwill);
    G.run.hurt = 30; OMF.enterFloor(41, 'combat');
    check('Iron Will: 30 HP lost and floor 40 reached', !!S.challenges.ironwill);
    // floor 1 still works normally
    S.startSel = 1; OMF.startGame(false);
    check('START floor 1 = normal run, no kit', G.run.floor === 1 && G.run.start === 1 && G.state === 'play');
    // per ascension
    S.asc = { unlocked: 1, selected: 1, best: {} }; S.startSel = 11; OMF.startGame(false);
    check('checkpoints are per ascension level', checkpointsFor(1).length === 1 && G.run.floor === 1 && G.run.asc === 1);
    return out;
  });
  // older saves: checkpoints come from the best floor reached
  const key = await page.evaluate(() => { OMF.Save.save = () => {}; const k = Object.keys(localStorage).find((x) => x.startsWith('omf')); const d = JSON.parse(localStorage.getItem(k)); delete d.checkpoints; d.best.floor = 24; d.asc = { unlocked: 2, selected: 0, best: { 1: 13, 2: 4 } }; localStorage.setItem(k, JSON.stringify(d)); return k; });
  await page.reload();
  const mig = await page.evaluate(() => OMF.Save.data.checkpoints);
  r.push([mig[0] === 21 && mig[1] === 11 && !mig[2] ? 'PASS' : 'FAIL', 'older saves get checkpoints from their best floors', JSON.stringify(mig) + ' ' + key]);
  await b.close();
  let fail = 0;
  for (const x of r) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  if (errs.length) { fail++; console.log('FAIL JS errors', errs); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + r.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
