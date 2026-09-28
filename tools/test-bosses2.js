// Floors 35-50: Eclipse, Serpent, Chronos, Architect.
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
      check('10 bosses to floor 50, II from 55', BOSS_ORDER.length === 10 && bossKindFor(35) === 'eclipse' && bossKindFor(40) === 'serpent' && bossKindFor(45) === 'chronos' && bossKindFor(50) === 'architect' && bossKindFor(55) === 'warden' && bossCycle(55) === 1 && bossCycle(50) === 0);
      const pats = { eclipse: ['vanish', 'flare', 'blackout', 'crescent'], serpent: ['lunge', 'spit', 'burrow', 'coil'], chronos: ['hands', 'rewind', 'stop'], architect: ['build', 'crush', 'blueprint', 'recall'] };
      for (const [floor, kind] of [[35, 'eclipse'], [40, 'serpent'], [45, 'chronos'], [50, 'architect']]) {
        OMF.startGame(false); OMF.enterFloor(floor, 'boss'); run(2.5);
        const bs = G.boss;
        check(kind + ': spawns', bs && bs.kind === kind && !!G.circle);
        const got = {}, seen = {};
        run(90, () => {
          G.player.hp = 9; G.player.iframes = 1;
          if (bs.pat) got[bs.pat] = true;
          if (bs.untarget && bs.enter <= 0) seen.hidden = true;
          if (G.darkK < 0.6) seen.blackout = true;
          if (G.blocks.some((o) => o.solid && o.kind === 'block')) seen.block = true;
          if (G.blocks.some((o) => o.kind === 'wall' && o.solid)) seen.wall = true;
          if (bs.marks && bs.marks.length) seen.mark = true;
          if (G.eb.some((o) => o.delay > 0.3)) seen.frozen = true;
          if (bs.segs && bs.segs.length >= 14) seen.body = true;
          if (pats[kind].every((p) => got[p]) && (seen.done = (seen.done || 0) + 1) > 180) return false;
        });
        check(kind + ': uses every pattern', pats[kind].every((p) => got[p]), got);
        if (kind === 'eclipse') check('eclipse: hides and blacks out', seen.hidden && seen.blackout, seen);
        if (kind === 'serpent') check('serpent: has a long body', seen.body);
        if (kind === 'chronos') check('chronos: rewind marks and time stop', seen.mark && seen.frozen, seen);
        if (kind === 'architect') check('architect: raises blocks and walls', seen.block && seen.wall, seen);
        // mechanics
        if (kind === 'serpent') {
          run(6, () => { G.player.hp = 9; G.player.iframes = 1; if (!bs.air && bs.segs.length >= 10) return false; });
          const s = bs.segs[5];
          const bl = { x: s.x + 1, y: s.y, px: s.x - 20, py: s.y, vx: 300, vy: 0, r: 3 };
          check('serpent: the body blocks bullets', serpentBlocks(bl));
          G.player.iframes = 0; G.player.dashIfr = 0; G.player.shield = 0; const h = G.run.hurt;
          G.player.x = bs.segs[8].x; G.player.y = bs.segs[8].y; bs.pat = null; bs.cool = 99;
          OMF.step(1 / 60);
          check('serpent: the body hurts on contact', G.run.hurt > h);
        }
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
