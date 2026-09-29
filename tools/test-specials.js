// Special-room bosses: The Polarity (25), The Warden of Keys (35), The Collapse (40), The Puppeteer (45),
// plus the late-boss pressure tools (shield-piercing hits, sealed upgrades, slows).
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
      const G = OMF.G, S = OMF.Save.data, I = OMF.Input, vec0 = I.vector, cd0 = I.consumeDash;
      const run = (secs, hook) => { for (let i = 0; i < secs * 60; i++) { OMF.step(1 / 60); if (hook && hook() === false) break; } };
      const god = () => { G.player.hp = 9; G.player.iframes = 1; };
      const dashOnce = () => { let once = true; I.consumeDash = () => { const v = once; once = false; return v; }; for (let k = 0; k < 30 && once; k++) OMF.step(1 / 60); I.consumeDash = cd0; }; // steps until the press is read (hitstop can skip a frame)
      const quiet = (bs) => { bs.pat = null; bs.cool = 99; bs.atk = 99; clearEnemyBullets(); };
      S.challenges = {};

      // ---------- Polarity ----------
      OMF.startGame(false); OMF.addUpgrade('aegis', true); OMF.enterFloor(25, 'boss'); run(2.5);
      let bs = G.boss, p = G.player;
      check('polarity: spawns, you start blue', bs && bs.kind === 'polarity' && p.pol === 0);
      quiet(bs); G.time += 1;
      const c0 = p.dashCharges; dashOnce();
      check('polarity: dash swaps colour instead of dashing', p.pol === 1 && p.dashT <= 0, { pol: p.pol, dashT: p.dashT, c0, c: p.dashCharges });
      dashOnce();
      check('polarity: swap has a short cooldown', p.pol === 1);
      // same colour: absorbed, charges
      p.iframes = 0; p.dashIfr = 0; p.shield = 1; p.hp = 5; const ch0 = bs.charge2 || 0;
      fireEB(p.x - 30, p.y, 0, 300, { color: POL_COL[1], pol: 1, r: 6 }); run(0.2);
      check('polarity: your colour is absorbed and charges the beam', p.hp === 5 && p.shield === 1 && (bs.charge2 || 0) === ch0 + 1, { hp: p.hp, sh: p.shield, ch: bs.charge2 });
      // other colour: hurts through the shield
      fireEB(p.x - 30, p.y, 0, 300, { color: POL_COL[0], pol: 0, r: 6 }); run(0.2);
      check('polarity: the other colour hurts through the shield', p.hp === 4 && p.shield === 1, { hp: p.hp, sh: p.shield });
      // guns do nothing
      check('polarity: you cannot shoot', (() => { run(1, () => { god(); quiet(bs); }); return G.pb.length === 0; })());
      const hp0 = bs.hp; damageEnemy(bs, 50, true, 0, 0, false);
      check('polarity: normal damage does not hurt it', bs.hp === hp0);
      bs.charge2 = polarityNeed(bs) - 1; fireEB(p.x - 30, p.y, 0, 300, { color: POL_COL[p.pol], pol: p.pol, r: 6 }); run(0.2, god);
      check('polarity: a full charge fires the beam (1/6 of its HP)', bs.hp < hp0 - bs.maxHp / 7 && (bs.charge2 || 0) === 0, [hp0, bs.hp]);
      // colour zones burn only the same colour
      bs.zones.push({ x: p.x, y: p.y, r: 58, pol: p.pol, t: 1.2, warn: 1.15, life: 0.6 }); p.iframes = 0; const h1 = p.hp; OMF.step(1 / 60);
      check('polarity: a zone of your colour is safe', p.hp === h1);
      bs.zones.push({ x: p.x, y: p.y, r: 58, pol: 1 - p.pol, t: 1.2, warn: 1.15, life: 0.6 }); p.iframes = 0; p.dashIfr = 0; OMF.step(1 / 60);
      check('polarity: a zone of the other colour burns', p.hp === h1 - 1);
      const got = {}; bs.cool = 0;
      run(60, () => { god(); if (bs.pat) got[bs.pat] = true; if (['wave', 'zebra', 'floor', 'spiral'].every((k) => got[k])) return false; });
      check('polarity: uses every pattern', ['wave', 'zebra', 'floor', 'spiral'].every((k) => got[k]), got);
      OMF.killEnemy(bs); run(0.5);
      check('polarity: defeat clears the colour, grants challenge', p.pol === null && !!S.challenges.polarity && !G.boss);

      // ---------- Warden of Keys ----------
      OMF.startGame(false); OMF.enterFloor(35, 'boss'); run(2.5);
      bs = G.boss; p = G.player;
      check('keys: labyrinth with 4 seals, hunter is untargetable', bs && bs.kind === 'keys' && G.maze && G.maze.seals.length === 4 && bs.untarget && bs.invuln);
      check('keys: every seal and the exit are reachable', mazeConnected());
      run(1, god);
      check('keys: you cannot shoot', G.pb.length === 0);
      bs.alertT = 0; bs.x = p.x + 300; dashOnce();
      check('keys: a dash alerts the hunter', bs.alertT > 1.5);
      // shifting keeps it connected
      let conn = true;
      for (let k = 0; k < 6; k++) { G.maze.shiftT = 0; run(1.7, () => { god(); bs.x = G.maze.seals[0].x; bs.y = G.maze.seals[0].y; bs.stunT = 1; }); if (!mazeConnected()) conn = false; }
      check('keys: walls shift and the maze stays connected', conn && G.maze.closed !== undefined);
      // contact pierces the shield and stuns it
      bs.stunT = 0; p.shield = 1; p.hp = 5; p.iframes = 0; p.dashIfr = 0; bs.x = p.x + 4; bs.y = p.y; OMF.step(1 / 60);
      check('keys: contact hurts through the shield and stuns the hunter', p.hp === 4 && p.shield === 1 && bs.stunT > 1);
      // light the seals
      let lit = 0;
      for (const s of G.maze.seals) {
        p.x = s.x; p.y = s.y;
        run(2.2, () => { god(); p.x = s.x; p.y = s.y; bs.stunT = 1; bs.x = 0; bs.y = 0; });
        lit = G.maze.seals.filter((x) => x.lit).length;
        if (lit < 4 && bs.hp !== bs.maxHp * (4 - lit) / 4) break;
      }
      run(0.5);
      check('keys: four lit seals bury the hunter', lit === 4 && !G.boss && !!S.challenges.keys, lit);
      check('keys: the dark lifts', darknessLights() === null);

      // ---------- Collapse ----------
      OMF.startGame(false); OMF.enterFloor(40, 'boss'); run(2.5);
      bs = G.boss; p = G.player; let B = G.bridge;
      check('collapse: bridge starts scrolling, giant untargetable', bs && bs.kind === 'collapse' && B && B.phase === 'run' && bs.untarget);
      // a plate cracks under you and then falls
      const row = Math.floor((p.y - B.y0) / B.ph) - 2, lane = 1;
      B.plates[row][lane].s = 'ok'; const rc = bridgeRect(row, lane);
      p.x = rc.x + rc.w / 2; p.y = rc.y + rc.h / 2; OMF.step(1 / 60);
      check('collapse: a plate cracks when you step on it', B.plates[row][lane].s === 'crack');
      p.x = rc.x + rc.w / 2 + B.pw; run(1.0, () => { god(); B.boulders.length = 0; B.lanesWarn.length = 0; });
      const held = B.plates[row][lane].s === 'crack';
      run(0.7, () => { god(); B.boulders.length = 0; B.lanesWarn.length = 0; });
      check('collapse: a cracked plate holds 1.6 s, then falls', held && B.plates[row][lane].s === 'gone');
      // stepping into a hole hurts (through the shield) and puts you back on a plate
      p.fallAt = -9; p.shield = 1; p.hp = 5; p.iframes = 0; p.dashIfr = 0; p.x = rc.x + rc.w / 2; p.y = rc.y + rc.h / 2; OMF.step(1 / 60);
      const pl = plateAt(p.x, p.y);
      check('collapse: falling hurts through the shield and respawns on a plate', p.hp === 4 && p.shield === 1 && pl && pl.s !== 'gone', { hp: p.hp, s: pl && pl.s });
      check('collapse: the respawn is mid-view on plates that hold for a moment', Math.abs(p.y - B.camY) < 110 && pl.safe > 1 && p.iframes >= 1.4, { dy: p.y - B.camY, safe: pl.safe });
      // standing still gets you left behind
      const h2 = G.run.hurt; run(12, () => { p.hp = 9; B.boulders.length = 0; });
      check('collapse: standing still you fall behind', G.run.hurt > h2);
      // the dash crosses a hole
      p.fallAt = -9; p.iframes = 0; const r2 = Math.floor((p.y - B.y0) / B.ph); B.plates[r2 - 1][1].s = 'gone'; B.plates[r2 - 2][1].s = 'ok'; B.plates[r2][1].s = 'ok';
      p.x = B.bx + B.pw * 1.5; p.y = B.y0 + r2 * B.ph + B.ph / 2; p.dashCharges = G.stats.dashCharges; p.vx = p.vy = 0; const h3 = G.run.hurt;
      const hp_ = window.hurtPlayer, why = []; window.hurtPlayer = (x, y, a, c) => { why.push([Math.round(x), Math.round(y), Math.round(p.x), Math.round(p.y), Math.round(B.camY), p.dashT > 0, (plateAt(p.x, p.y) || {}).s, r2, B.y0, p.dashCharges, G.hitstop, G.state]); return hp_(x, y, a, c); };
      I.vector = () => ({ x: 0, y: -1, mag: 1 }); dashOnce(); I.vector = () => ({ x: 0, y: 0, mag: 0 }); run(0.2, () => { B.boulders.length = 0; B.lanesWarn.length = 0; }); I.vector = vec0; window.hurtPlayer = hp_;
      check('collapse: a dash jumps over a hole', G.run.hurt === h3, why);
      // skip to the end
      B.camY = B.endCam + 1; p.x = B.bx + B.pw * 1.5; p.y = B.y0 + B.ph * 3; run(0.3, god);
      check('collapse: the scrolling stops at the plaza', B.phase === 'arrive' && bs.untarget);
      check('collapse: the plaza is a big arena', B.plaza.w >= 20 * 20 && B.plaza.h >= 16 * 20, [B.plaza.w, B.plaza.h]);
      p.y = B.y0 - 30; run(0.3, god);
      check('collapse: stepping onto the plaza starts the fight, giant targetable', B.phase === 'final' && !bs.untarget && !bs.invuln);
      const cam = Render.camTarget();
      check('collapse: on the plaza the camera follows you', Math.abs(cam.y - Math.min(Math.max(p.y, viewDims().VH / 2), G.H - viewDims().VH / 2)) < 2, [cam.y, p.y]);
      let rolled = false, inside = true;
      run(8, () => { god(); if (B.boulders.some((o) => o.vx)) rolled = true; if (!pointInRect(bs.x, bs.y, B.plaza, 1)) inside = false; });
      check('collapse: boulders roll across the plaza, the giant stays on it', rolled && inside && B.plates.every((rw) => rw.some((q) => q.s !== 'crack' || true)));
      OMF.killEnemy(bs); run(0.5);
      check('collapse: defeat settles the bridge, grants challenge', B.phase === 'done' && !G.boss && !!S.challenges.collapse && B.plates.every((rw) => rw.every((q) => q.s === 's' || q.s === 'gone')));
      run(1.5); if (G.state === 'reward') OMF.chooseUpgrade('__skip');
      check('collapse: exits are in the plaza side walls', G.stairs.length >= 1 && G.stairs.every((st) => st.wall && !st.locked));
      { const st = G.stairs[0]; p.x = st.wall < 0 ? st.x + st.w + 30 : st.x - 30; p.y = st.y + st.h / 2; I.vector = () => ({ x: st.wall, y: 0, mag: 1 }); run(3, () => G.run.floor === 40); I.vector = vec0; run(1); }
      check('collapse: walking into a side exit climbs to 41', G.run.floor === 41);
      check('floor 41 is a normal floor (no bridge, no maze)', !G.bridge && !G.maze, G.room.type);

      // ---------- Puppeteer ----------
      OMF.startGame(false); OMF.addUpgrade('aegis', true); OMF.addUpgrade('power', true); OMF.enterFloor(45, 'boss'); run(2.5);
      bs = G.boss; p = G.player; quiet(bs);
      const mv0 = G.stats.move * playerSlow();
      shootString(bs, bs.x, bs.y, 0); bs.needles[0].ax = p.x; bs.needles[0].ay = p.y - 60; bs.needles[0].x = p.x; bs.needles[0].y = p.y - 60; bs.needles[0].a = Math.PI / 2;
      run(1, () => { god(); quiet(bs); p.vx = p.vy = 0; });
      check('puppeteer: a string seals the shield first', G.threads.length === 1 && isSealed('aegis') && G.stats.aegis === 0 && p.shield === 0, G.threads.map((t) => t.id));
      check('puppeteer: a string slows you', G.stats.move * playerSlow() < mv0 * 0.9);
      const th = G.threads[0]; th.px = p.x; th.py = p.y - 260; run(1, () => { god(); quiet(bs); });
      check('puppeteer: pulling far away snaps it and frees the upgrade', G.threads.length === 0 && !isSealed('aegis'));
      G.threads.push({ px: p.x + 150, py: p.y, id: null, tension: 0 }); const x0 = p.x; bs.yankT = 0.5; run(0.3, () => { god(); quiet(bs); });
      check('puppeteer: a yank drags you toward the pin', p.x > x0 + 20, p.x - x0);
      clearStrings(); bs.yankT = 0;
      bs.cool = 0; const seen = {};
      run(150, () => { god(); if (bs.pat) seen[bs.pat] = true; if (bs.curtain) seen.cur = true; if (bs.puppets.some((q) => q.x != null)) seen.pup = true; if (bs.needles.length >= 3) seen.fan = true; if (seen.cur && seen.pup && seen.string && seen.fan) return false; });
      check('puppeteer: fans of strings, puppets and the curtain', seen.cur && seen.pup && seen.string && seen.fan, seen);
      OMF.killEnemy(bs); run(0.5);
      check('puppeteer: defeat cuts all strings, grants challenge', !G.threads.length && !Object.keys(G.run.sealed).length && !!S.challenges.puppeteer);

      // ---------- pressure tools on the other bosses ----------
      OMF.startGame(false); OMF.addUpgrade('aegis', true); OMF.addUpgrade('power', true); OMF.enterFloor(30, 'boss'); run(2.5);
      bs = G.boss; p = G.player;
      let sealedSeen = false;
      run(14, () => { god(); if (Object.keys(G.run.sealed).length) sealedSeen = true; if (sealedSeen) return false; });
      check('floor 30+: the boss seals an upgrade for a while', sealedSeen);
      run(5.5, () => { god(); bs.sealT = 99; });
      check('floor 30+: the seal wears off', !Object.keys(G.run.sealed).length);
      quiet(bs); G.pools.length = 0; G.waves.length = 0;
      const base = playerSlow(); G.pools.push({ x: p.x, y: p.y, r: 40, t: 1, life: 5 });
      check('forge: lava slows you', playerSlow() < base * 0.7);
      G.pools.length = 0;
      bs.sealT = 99; G.run.sealed = {}; computeStats(); quiet(bs); G.shells.length = 0; G.pools.length = 0; G.waves.length = 0; p.x = bs.x; p.y = bs.y + 90; p.shield = 1; p.hp = 5; p.iframes = 0; p.dashIfr = 0; const d = Math.hypot(p.x - bs.x, p.y - bs.y);
      G.waves.push({ x: bs.x, y: bs.y, r: d, spd: 0, w: 14, gapA: Math.atan2(p.y - bs.y, p.x - bs.x) + Math.PI, gapW: 0.5, color: '#fff' });
      OMF.step(1 / 60); G.waves.length = 0;
      check('forge: quake waves pierce the shield', p.hp === 4 && p.shield === 1, { hp: p.hp, sh: p.shield });
      p.shield = 1; p.iframes = 0; p.dashIfr = 0; const h4 = p.hp; OMF.hurtPlayer(p.x, p.y);
      check('normal hits still break the shield first', p.hp === h4 && p.shield === 0);
      OMF.startGame(false); OMF.enterFloor(50, 'boss'); run(2.5);
      G.wells.push({ x: G.player.x, y: G.player.y, r: 58, t: 1, warn: 0.6, life: 6 });
      check('architect: wells slow you', playerSlow() <= 0.7 + 1e-9);

      // ---------- training & previews ----------
      for (const k of ['polarity', 'keys', 'collapse', 'puppeteer']) {
        OMF.startTraining({ enemies: {}, boss: k, elite: false, hard: false, shoot: true });
        run(25, () => { G.player.iframes = 0; if (G.maze) for (const s of G.maze.seals) { s.lit = true; } });
        check(k + ': training boss survives, no errors', G.boss && !G.boss.dead && G.state === 'play');
        OMF.exitTraining();
      }
      for (const f of [34, 39]) { OMF.startGame(false); OMF.enterFloor(f, 'rest'); check('floor ' + f + ' stairs preview the next room', G.previews.length >= 1); }
      // climbing into the special rooms through the stairs (the floor comes from the preview) keeps them special
      for (const [f, key] of [[34, 'maze'], [39, 'bridge']]) {
        OMF.startGame(false); OMF.enterFloor(f, 'rest'); OMF.goThroughDoor(G.stairs[0]); run(3.5);
        check('climbing to ' + (f + 1) + ' builds the ' + key, G.run.floor === f + 1 && !!G[key] && G.boss && (key === 'maze' ? G.maze.seals.every((s) => !s.lit) : G.bridge.phase === 'run'));
        // save & quit mid-fight, resume: the room is rebuilt and the fight restarts
        OMF.startGame(true); run(2.5);
        check('resume on ' + (f + 1) + ' keeps the ' + key, G.run.floor === f + 1 && !!G[key] && !!G.boss && (key === 'maze' || G.bridge.plates.some((rw) => rw.some((q) => q.h && q.s === 'gone'))));
        // after the boss the next floor is a normal one, also after save & quit there
        OMF.killEnemy(G.boss); run(1.5); if (G.state === 'reward') OMF.chooseUpgrade('__skip');
        OMF.goThroughDoor(G.stairs[0]); run(1.5);
        check('floor ' + (f + 2) + ' after it has no ' + key, G.run.floor === f + 2 && !G.maze && !G.bridge);
        OMF.startGame(true); run(0.5);
        check('resume on ' + (f + 2) + ' has no ' + key, G.run.floor === f + 2 && !G.maze && !G.bridge);
        { const sn = S.snapshot; if (sn.floorState) { sn.floorState[key] = { junk: 1 }; OMF.startGame(true); run(0.2); check('an old save carrying the ' + key + ' onto ' + (f + 2) + ' loads clean', !G.maze && !G.bridge); } }
      }
      I.vector = vec0; I.consumeDash = cd0;
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
