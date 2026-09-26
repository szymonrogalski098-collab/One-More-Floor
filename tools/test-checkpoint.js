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
    OMF.UI.renderMenu();
    check('no checkpoint picker before any boss', document.getElementById('pick-start').classList.contains('hidden'));
    // beat the floor-5 boss
    OMF.startGame(false); OMF.enterFloor(5, 'boss'); run(2.5); OMF.killEnemy(G.boss); run(0.5);
    check('beating the floor-5 boss unlocks checkpoint 6', (S.checkpoints[0] | 0) === 6, S.checkpoints);
    // elevator boss unlocks too
    OMF.startGame(false); OMF.enterFloor(20, 'boss'); run(1.3); G.side.t = G.side.dur; run(0.2);
    check('surviving the elevator unlocks checkpoint 21', (S.checkpoints[0] | 0) === 21);
    G.state = 'menu'; OMF.UI.renderMenu();
    check('menu shows the START picker', !document.getElementById('pick-start').classList.contains('hidden'));
    OMF.UI.cycleStart(1); OMF.UI.cycleStart(1);
    check('picker steps through checkpoints 1 → 6 → 11', S.startSel === 11, S.startSel);
    check('picker text names the checkpoint', document.getElementById('pk-start-name').textContent.includes('11'));
    // start from checkpoint 11: 5 kit picks, +2 rerolls
    const rr0 = S.meta.reroll | 0;
    OMF.startGame(false);
    check('run starts on floor 11 with the kit screen', G.run.floor === 11 && G.state === 'reward' && G.rewardKind === 'kit' && document.getElementById('up-title').textContent === 'STARTING KIT');
    check('kit size 5 picks, +2 rerolls', G.run.kitTotal === 5 && G.run.rerolls === rr0 + 2, [G.run.kitTotal, G.run.rerolls]);
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
    // floor 1 still works normally
    S.startSel = 1; OMF.startGame(false);
    check('START floor 1 = normal run, no kit', G.run.floor === 1 && G.run.start === 1 && G.state === 'play');
    // per ascension
    S.asc = { unlocked: 1, selected: 1, best: {} }; S.startSel = 11; OMF.UI.renderMenu();
    check('checkpoints are per ascension level', S.startSel === 1 && document.getElementById('pick-start').classList.contains('hidden'));
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
