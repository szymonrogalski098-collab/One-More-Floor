// New bosses: The Counterweight (side-view elevator, floor 20), The Orrery (25), The Forgemaster (30).
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = [];
  for (const dev of ['Pixel 7', 'Desktop Chrome']) {
    const ctx = await b.newContext({ ...devices[dev] }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
    await page.goto('http://localhost:8080/One-More-Floor/?debug');
    const r = await page.evaluate(() => {
      const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
      const G = OMF.G, S = OMF.Save.data, I = OMF.Input, vec0 = I.vector;
      const run = (secs, hook) => { for (let i = 0; i < secs * 60; i++) { OMF.step(1 / 60); if (hook && hook() === false) break; } };
      S.challenges = {};
      check('boss order: 5 warden … 20 elevator, 25 orrery, 30 forge, 35 warden II',
        bossKindFor(5) === 'warden' && bossKindFor(20) === 'elevator' && bossKindFor(25) === 'orrery' && bossKindFor(30) === 'forge' && bossKindFor(35) === 'warden' && bossCycle(35) === 1 && bossCycle(30) === 0);

      // ---------- Counterweight ----------
      OMF.startGame(false); OMF.enterFloor(20, 'boss');
      check('floor 20 is the side-view elevator', !!G.side && !G.circle && G.stairs.every((s) => s.side));
      run(1.3);
      check('ride starts, boss is on the bar', G.room.phase === 'fight' && G.boss && G.boss.kind === 'elevator');
      // movement: only left/right, the player stays on the floor
      const y0 = G.player.y;
      I.vector = () => ({ x: -1, y: -1, mag: 1 }); run(1.4, () => { G.player.iframes = 1; }); I.vector = vec0;
      check('joystick moves only horizontally, player stays on the floor', G.player.x <= G.side.L + G.player.r + 1 && Math.abs(G.player.y - y0) < 0.01, { x: G.player.x, y: G.player.y });
      // the boss cannot be damaged or targeted
      check('boss is not an enemy (cannot be shot)', !G.enemies.includes(G.boss) && G.pb.length === 0);
      // dash does not dodge a drop
      G.player.iframes = 0; G.player.hp = 5; G.player.shield = 0; G.side.drops.length = 0; G.side.slam = null; G.side.cool = 99; G.side.slamT = 99;
      G.player.x = (G.side.L + G.side.R) / 2; G.player.dashCharges = 1;
      const cd0 = I.consumeDash;
      I.consumeDash = (() => { let once = true; return () => { const v = once; once = false; return v; }; })();
      OMF.step(1 / 60);
      G.side.drops.push({ x: G.player.x, y: G.player.y - 10, vx: 0, vy: 0, r: 10, warn: 0, t: 0, split: false });
      const hp = G.player.hp, dashing = G.player.dashT > 0;
      OMF.step(1 / 60);
      I.consumeDash = cd0;
      check('dashing through a falling ball still hurts', dashing && G.player.hp === hp - 1, { dashing, hp: G.player.hp });
      // every attack kind shows up and the crush happens
      const seen = {};
      G.side.cool = 0; G.side.slamT = 3;
      run(45, () => { G.player.hp = 9; G.player.iframes = 1; if (G.side.slam) seen.slam = true; if (G.side.gapWarn) seen.curtain = true; for (const d of G.side.drops) { if (d.split) seen.split = true; if (d.r === 9) seen.sweep = true; if (d.r === 10) seen.aimed = true; } });
      check('drops (aimed, curtain, sweep, split) and CRUSH all occur', seen.slam && seen.curtain && seen.sweep && seen.aimed && seen.split, seen);
      // the crush plate is solid: you cannot stand inside it
      G.side.slam = { zones: [{ x0: G.side.L, x1: G.side.L + 100 }], state: 'down', t: 0.2, warn: 1 };
      G.player.x = G.side.L + 30; OMF.step(1 / 60);
      check('crush plate pushes you out', G.player.x >= G.side.L + 100 + G.player.r - 0.01, G.player.x);
      G.side.slam = null;
      // fair: every curtain has a gap wide enough
      let fair = true;
      for (let k = 0; k < 200; k++) {
        G.side.drops.length = 0; G.side.cool = 0; G.side.slamT = 99; G.side.slam = null;
        const gw0 = G.side.gapWarn; G.side.gapWarn = null;
        sideAttacks(0, 0.9);
        if (G.side.gapWarn) {
          const gw = G.side.gapWarn, xs = G.side.drops.map((d) => d.x).sort((a, b) => a - b);
          const lo = Math.max(G.side.L, ...xs.filter((x) => x < gw.x).map((x) => x + 11)), hi = Math.min(G.side.R, ...xs.filter((x) => x > gw.x).map((x) => x - 11));
          if (hi - lo < 2 * 5.5 + 8) fair = false;
        }
        G.side.gapWarn = gw0;
      }
      check('curtain gap always passable', fair);
      G.side.drops.length = 0;
      // survive to the end: reward, shards, challenge
      const bosses = G.run.bosses, sh = G.run.shards;
      G.side.t = G.side.dur - 0.05; run(0.2, () => { G.player.hp = 9; });
      check('surviving the ride wins', G.room.phase === 'clear' && !G.boss && G.run.bosses === bosses + 1 && G.run.shards > sh);
      run(1.5);
      check('boss reward screen opens', G.state === 'reward');
      OMF.chooseUpgrade('__skip');
      check('doors unlock after the reward', G.room.phase === 'doors' && G.stairs.every((s) => !s.locked));
      check('challenge "Going Up" granted', !!S.challenges.counter);
      // save & quit in the doors phase keeps the boss beaten
      OMF.startGame(true); run(1.2);
      check('resume after beating it: no refight, doors open', !!G.side && G.room.phase === 'doors' && !G.boss && G.run.floor === 20, G.room.phase);
      // walk out through a door
      const st = G.stairs[G.stairs.length - 1];
      I.vector = () => ({ x: st.dir, y: 0, mag: 1 }); run(4, () => G.run.floor === 20); I.vector = vec0;
      run(1);
      check('walking through the side door climbs to floor 21', G.run.floor === 21 && !G.side && G.room.type === st.type, { floor: G.run.floor, type: G.room.type, want: st.type, dir: st.dir, n: G.stairs.length });
      // preview of the elevator from floor 19 stairs
      OMF.startGame(false); OMF.enterFloor(19, 'rest');
      check('floor 19 stairs preview the elevator', G.previews.length === 1 && G.previews[0].side === true);
      // death in the elevator ends the run normally
      OMF.startGame(false); OMF.enterFloor(20, 'boss'); run(1.3);
      G.player.hp = 1; G.player.iframes = 0; G.player.shield = 0; S.meta.wind = 0;
      G.side.drops.push({ x: G.player.x, y: G.side.ceilY + 10, vx: 0, vy: 0, r: 10, warn: 0, t: 0, split: false });
      run(1.5);
      check('dying in the elevator shows the death screen', G.state === 'dead');

      // ---------- Orrery & Forgemaster ----------
      for (const [floor, kind, pats] of [[25, 'orrery', ['expand', 'fling', 'eclipse', 'nova']], [30, 'forge', ['magma', 'quake', 'bellows']]]) {
        OMF.startGame(false); OMF.enterFloor(floor, 'boss');
        run(2.5);
        const bs = G.boss;
        check(kind + ': spawns in the circular hall', bs && bs.kind === kind && !!G.circle);
        const got = {}, haz = {};
        run(70, () => { G.player.hp = 9; G.player.iframes = 1; if (bs.pat) got[bs.pat] = true; if (G.pools.length) haz.pool = true; if (G.waves.length) haz.wave = true; if (bs.planets && bs.planets.some((p) => p.mode === 'out')) haz.fling = true; });
        check(kind + ': uses every pattern', pats.every((p) => got[p]), got);
        if (kind === 'forge') check('forge: lava pools and shockwaves appear', haz.pool && haz.wave, haz);
        if (kind === 'orrery') check('orrery: planets are flung and come back', haz.fling && bs.planets.every((p) => ['orbit', 'back', 'out', 'aim'].includes(p.mode)));
        // hazards hurt
        if (kind === 'forge') {
          bs.pat = null; bs.cool = 99; bs.atk = 99; clearEnemyBullets(); G.shells.length = 0; G.beams.length = 0;
          G.player.iframes = 0; G.player.hp = 5; G.player.shield = 0; G.player.dashIfr = 0; G.waves.length = 0;
          G.pools.push({ x: G.player.x, y: G.player.y, r: 30, t: 1, life: 5 });
          const h0 = G.player.hp; OMF.step(1 / 60);
          check('forge: standing in lava hurts', G.player.hp === h0 - 1);
          G.pools.length = 0; G.player.iframes = 0; G.player.vx = G.player.vy = 0;
          { const c = arenaCenter(); bs.x = c.x; bs.y = c.y - 100; bs.vx = bs.vy = 0; G.player.x = c.x; G.player.y = c.y + 60; }
          const a = Math.atan2(G.player.y - bs.y, G.player.x - bs.x), d = Math.hypot(G.player.x - bs.x, G.player.y - bs.y);
          G.waves.push({ x: bs.x, y: bs.y, r: d, spd: 0, w: 14, gapA: a, gapW: 0.9, color: '#fff' });
          const h1 = G.player.hp, src = []; const hp0 = window.hurtPlayer; window.hurtPlayer = (x, y, n) => { src.push([Math.round(x), Math.round(y), Math.round(bs.x), Math.round(bs.y), Math.round(G.player.x), Math.round(G.player.y), G.enemies.length, G.pools.length]); return hp0(x, y, n); };
          OMF.step(1 / 60); window.hurtPlayer = hp0;
          check('forge: standing in the shockwave gap is safe', G.player.hp === h1, src);
          G.waves.length = 0;
        }
        const kills = G.run.bosses;
        OMF.killEnemy(bs); run(0.5);
        check(kind + ': defeat clears hazards, counts, grants challenge', G.run.bosses === kills + 1 && !G.pools.length && !G.waves.length && !!S.challenges[kind]);
      }
      I.vector = vec0;
      return out;
    });
    for (const x of r) out.push([x[0], dev + ' · ' + x[1], x[2]]);
    if (errs.length) out.push(['FAIL', dev + ' · JS errors', JSON.stringify(errs.slice(0, 5))]);
    await ctx.close();
  }
  await b.close();
  let fail = 0;
  for (const x of out) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + out.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
