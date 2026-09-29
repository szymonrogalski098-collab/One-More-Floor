// New Run screen (mode → checkpoint / ascension → loadout), supplies, the wager and the shop trade.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = [];
  for (const dev of ['Pixel 7', 'Desktop Chrome']) {
    const page = await (await b.newContext({ ...devices[dev] })).newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
    await page.goto('http://localhost:8080/One-More-Floor/?debug');
    const r = await page.evaluate(() => {
      const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
      const G = OMF.G, S = OMF.Save.data, UI = OMF.UI, run = (s) => { for (let i = 0; i < s * 60; i++) OMF.step(1 / 60); };
      const menu = () => { G.state = 'menu'; UI.stack = []; UI.show('s-menu'); UI.renderMenu(); };
      const pick = (k, v) => UI.action('nr-pick', document.querySelector(`[data-k="${k}"][data-v="${v}"]`));
      // a new player: nothing to choose, PLAY starts right away
      S.shards = 0; S.ships = ['striker']; S.ship = 'striker'; S.checkpoints = {}; S.asc = { unlocked: 0, selected: 0, best: {} }; S.meta.start = 0; S.best.floor = 0;
      menu(); UI.action('play');
      check('first runs: PLAY starts the run with no choices', G.state === 'play' && G.run.floor === 1 && UI.current !== 's-newrun');
      // enough shards for a supply: only the loadout step
      S.shards = 60; menu(); UI.action('play');
      check('with shards to spend: straight to the loadout', UI.current === 's-newrun' && UI.nr.step === 'loadout' && !!document.querySelector('[data-k="supply"]'));
      check('unaffordable supplies are disabled', document.querySelector('[data-k="supply"][data-v="revive"]').disabled && !document.querySelector('[data-k="supply"][data-v="coins"]').disabled);
      UI.action('nr-back');
      check('back from the first step returns to the menu', UI.current === 's-menu');
      // everything unlocked
      S.shards = 2000; S.ships = ['striker', 'lancer', 'scatter']; S.checkpoints = { 0: 21, 2: 11 }; S.asc = { unlocked: 2, selected: 0, best: {} }; S.best.floor = 30;
      menu(); UI.action('play');
      check('mode step offers floor 1, checkpoint and ascension', ['normal', 'cp', 'asc'].every((v) => document.querySelector(`[data-k="mode"][data-v="${v}"]`)));
      pick('mode', 'asc');
      check('ascension levels as cards, highest first', [...document.querySelectorAll('[data-k="asc"]')].map((e) => e.dataset.v).join(',') === '2,1');
      pick('asc', 2);
      const cps = [...document.querySelectorAll('[data-k="cp"]')].map((e) => +e.dataset.v);
      check('ascension 2 has its own checkpoints (+ floor 1)', cps.join(',') === '11,6,1', cps);
      UI.action('nr-back'); UI.action('nr-back');
      check('back steps return to the mode choice', UI.nr.step === 'mode');
      pick('mode', 'cp'); pick('cp', 16);
      check('picking a checkpoint leads to the loadout', UI.nr.step === 'loadout' && UI.nr.cp === 16);
      pick('ship', 'lancer'); pick('supply', 'card'); pick('supply', 'heart'); pick('supply', 'reroll');
      check('at most two supplies', UI.nr.supplies.join(',') === 'card,heart', UI.nr.supplies);
      pick('supply', 'card'); pick('supply', 'revive');
      check('a supply can be swapped', UI.nr.supplies.join(',') === 'heart,revive');
      pick('wager', 250);
      const cost = 100 + 150 + 250;
      check('the cost is shown', document.getElementById('nr-hint').textContent.includes(String(2000 - cost)));
      const rr = S.meta.reroll | 0;
      UI.action('nr-go');
      check('START pays for the loadout', S.shards === 2000 - cost, S.shards);
      check('run starts at the checkpoint with the chosen ship', G.run.floor === 16 && G.run.start === 16 && G.run.ship === 'lancer' && G.run.asc === 0);
      while (G.run.kitLeft > 0) OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id);
      const withHeart = G.stats.maxHp; G.run.bonusHp = 0; computeStats(); const without = G.stats.maxHp; G.run.bonusHp = 1; computeStats();
      check('Spare Heart: +1 max HP', withHeart === without + 1 && G.run.bonusHp === 1, [withHeart, without]);
      check('wager stored with its target', G.run.wager && G.run.wager.stake === 250 && G.run.wager.target === wagerTarget(16, 30), G.run.wager);
      // Last Breath
      const p = G.player; S.meta.wind = 0; G.run.windUsed = true; p.hp = 1; p.iframes = 0; p.dashIfr = 0; p.shield = 0;
      OMF.hurtPlayer(p.x + 10, p.y);
      check('Last Breath revives with full HP once', p.alive && p.hp === G.stats.maxHp && G.run.reviveLeft === 0 && G.state === 'play');
      // snapshot keeps it all
      OMF.enterFloor(17, 'combat'); OMF.startGame(true);
      check('continue keeps the wager and the Spare Heart', G.run.wager && G.run.wager.stake === 250 && G.run.bonusHp === 1);
      // wager pays once when the target is reached
      const s0 = S.shards; OMF.enterFloor(G.run.wager.target, 'combat'); OMF.enterFloor(G.run.wager.target + 1, 'combat');
      check('reaching the target pays double, once', S.shards === s0 + 500 && G.run.wager.won, S.shards - s0);
      // Pocket Shards are for shops only
      S.shards = 500; menu(); UI.action('play'); pick('mode', 'normal'); pick('supply', 'coins'); UI.action('nr-go');
      check('Pocket Shards: +20 to spend', G.run.shards === 20 && G.run.gift === 20);
      G.run.floor = 10; const res = finalizeRun(false);
      check('Pocket Shards are not paid out at the end', res.earned === Math.round((0 + res.floorBonus) * (1 + 0.15 * (S.meta.salvage | 0))), res);
      // shop trade: banked shards → shop shards, once per shop
      menu(); S.shards = 250; S.ships = ['striker']; S.checkpoints = {}; S.asc = { unlocked: 0, selected: 0, best: {} };
      S.shards = 0; UI.action('play'); S.shards = 250;
      OMF.enterFloor(4, 'shop'); openShop();
      const w0 = G.run.shards;
      UI.action('shop-trade');
      check('trade: 100 banked → 10 in the shop', S.shards === 150 && G.run.shards === w0 + 10);
      UI.action('shop-trade');
      check('only one trade per shop', S.shards === 150 && document.getElementById('btn-shop-trade').disabled);
      G.run.shards = 30; G.run.gift = 10; shopPay(14);
      check('gifted shards are spent first', G.run.gift === 0 && G.run.shards === 16);
      return out;
    });
    for (const x of r) out.push([x[0], dev + ' · ' + x[1], x[2]]);
    if (errs.length) out.push(['FAIL', dev + ' · JS errors', JSON.stringify(errs.slice(0, 5))]);
  }
  await b.close();
  let fail = 0;
  for (const x of out) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + out.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
