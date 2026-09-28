// Boss halls (every boss has its own room), the Puppeteer (45) and the Architect (50).
// The special rooms of 25/35/40 are covered by test-specials.js.
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
      const G = OMF.G, S = OMF.Save.data;
      const run = (s, hook) => { for (let i = 0; i < s * 60; i++) { OMF.step(1 / 60); if (hook && hook() === false) break; } };
      S.challenges = {};
      check('10 bosses to floor 50, II from 55', BOSS_ORDER.length === 10 && bossKindFor(25) === 'polarity' && bossKindFor(35) === 'keys' && bossKindFor(40) === 'collapse' && bossKindFor(45) === 'puppeteer' && bossKindFor(50) === 'architect' && bossKindFor(55) === 'warden' && bossCycle(55) === 1 && bossCycle(50) === 0);
      // every boss has its own hall; you cannot leave it and can always reach the stairs
      const shapes = new Set();
      for (let f = 5; f <= 50; f += 5) {
        if (f === 20 || f === 35 || f === 40) continue; // elevator, labyrinth, bridge: not halls
        OMF.startGame(false); OMF.enterFloor(f, 'boss');
        const c = G.circle, kind = bossKindFor(f);
        shapes.add(c.pts ? c.pts.length + ':' + Math.round(c.pts[0][0] - c.x) : 'circle:' + kind);
        let inside = true;
        for (let i = 0; i < 400; i++) { const o = { x: c.x + (Math.random() - 0.5) * c.R * 3, y: c.y + (Math.random() - 0.5) * c.R * 3 }; hallClamp(o, 8); if (hallDepth(o.x, o.y) < 7.9) inside = false; }
        const sp = G.spawn;
        const reach = G.stairs.every((st) => Math.abs(c.y - hallRayT(st.x + st.w / 2, c.y, 0, -1, 0) - (st.y + st.h - 4)) < 1);
        check(kind + ': own hall (' + (c.pts ? c.pts.length + '-gon' : 'circle') + '), walls hold, spawn inside, stairs on the wall', c.kind === kind && inside && hallDepth(sp.x, sp.y) > 8 && reach);
      }
      check('halls differ from each other', shapes.size >= 7, [...shapes]);
      const pats = { puppeteer: ['string', 'puppets', 'curtain'], architect: ['build', 'crush', 'blueprint', 'recall'] };
      for (const [floor, kind] of [[45, 'puppeteer'], [50, 'architect']]) {
        OMF.startGame(false); OMF.enterFloor(floor, 'boss'); run(2.5);
        const bs = G.boss;
        check(kind + ': spawns', bs && bs.kind === kind && !!G.circle);
        const got = {}, seen = {};
        run(90, () => {
          G.player.hp = 9; G.player.iframes = 1;
          if (bs.pat) got[bs.pat] = true;
          if (G.blocks.some((o) => o.solid && o.kind === 'block')) seen.block = true;
          if (G.blocks.some((o) => o.kind === 'wall' && o.solid)) seen.wall = true;
          if (bs.puppets && bs.puppets.some((q) => q.x != null)) seen.puppet = true;
          if (bs.curtain) seen.curtain = true;
          if (G.wells.length) seen.well = true;
          if (pats[kind].every((p) => got[p]) && (seen.done = (seen.done || 0) + 1) > 180) return false;
        });
        check(kind + ': uses every pattern', pats[kind].every((p) => got[p]), got);
        if (kind === 'puppeteer') check('puppeteer: puppets and the curtain appear', seen.puppet && seen.curtain, seen);
        if (kind === 'architect') check('architect: raises blocks, walls and slowing wells', seen.block && seen.wall && seen.well, seen);
        // mechanics
        if (kind === 'architect') {
          G.blocks.length = 0; const c = arenaCenter();
          G.blocks.push({ x: c.x - 20, y: c.y - 20, w: 40, h: 40, t: 1, warn: 0, life: 9, kind: 'block', solid: true });
          check('architect: blocks are solid for bullets', solidAt(c.x, c.y));
          const o = { x: c.x, y: c.y + 5 }; collideWorld(o, 8);
          check('architect: blocks push you out', !pointInRect(o.x, o.y, G.blocks[0], 7), o);
        }
        const k0 = G.run.bosses;
        OMF.killEnemy(bs); run(0.5);
        check(kind + ': defeat counts, clears the arena', G.run.bosses === k0 + 1 && !G.blocks.length && G.darkK === 1 && !!S.challenges[kind === 'architect' ? 'summit' : kind]);
      }
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
