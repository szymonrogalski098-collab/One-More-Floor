// Rare room variants (rooms.js): layout, mechanics, saving, previews.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G, I = OMF.Input, v0 = I.vector, cd0 = I.consumeDash;
    const run = (s, hook) => { for (let i = 0; i < s * 60; i++) { OMF.step(1 / 60); if (hook && hook() === false) break; } };
    const god = () => { G.player.hp = 9; G.player.iframes = 1; };
    let p = null;
    const build = (v, floor = 14) => { OMF.startGame(false); G.forceVariant = v; OMF.enterFloor(floor, 'combat'); G.forceVariant = null; p = G.player; return G.rooms.find((x) => x.variant === v); };
    const enter = (rm) => { p.x = rm.x + rm.w / 2; p.y = rm.y + rm.h - 24; run(1.2, () => { god(); p.x = rm.x + rm.w / 2; p.y = rm.y + rm.h - 24; }); };
    // frequency: never before floor 4 or on calm floors, sometimes later
    let early = 0, late = 0;
    for (let i = 0; i < 200; i++) { if (rollVariant(3, 'combat')) early++; if (rollVariant(20, 'elite')) late++; if (rollVariant(20, 'rest')) early++; }
    check('variants: none before floor 4 or on calm floors, often later', early === 0 && late > 60 && late < 160, [early, late]);
    const kinds = Object.keys(ROOM_VARIANTS), seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(rollVariant(12, 'combat'));
    check('all variants appear by floor 12', kinds.every((k) => seen.has(k)), [...seen]);
    for (const v of kinds) {
      const rm = build(v);
      check(v + ': one room of this kind, floor reachable', !!rm && G.rooms.filter((x) => x.variant).length === 1 && G.stairs.length >= 1, rm && [rm.tw, rm.th]);
    }
    // Great Hall
    let rm = build('grand');
    check('grand: nearly twice the size', rm.tw >= 22 && rm.th >= 16);
    check('grand: one more wave', rm.waves.length >= 3, rm.waves.length);
    const hearts0 = G.pickups.filter((k) => k.type === 'heart').length;
    clearRoomSection(rm);
    check('grand: clearing it drops a heart and shards', G.pickups.filter((k) => k.type === 'heart').length === hearts0 + 1);
    // Trap Hall
    rm = build('gauntlet');
    const traps = G.traps.filter((t) => t.roomId === rm.id).sort((a, b2) => a.x - b2.x);
    check('gauntlet: a grid of spike plates, no cover', traps.length >= 4 && !G.pillars.some((p) => pointInRect(p.x + 1, p.y + 1, rm, 0)), traps.length);
    check('gauntlet: timing sweeps across the room', traps[traps.length - 1].off > traps[0].off);
    // Long Hall
    rm = build('corridor');
    check('corridor: long and low', rm.tw >= 24 && rm.th === 7);
    enter(rm);
    const farSide = p.x < rm.x + rm.w / 2 ? 1 : -1;
    const ms = G.markers.concat(G.enemies.filter((e) => !e.dead && e.roomId === rm.id));
    check('corridor: enemies come in from the far end', ms.length > 0 && ms.every((m) => (farSide > 0 ? m.x > rm.x + rm.w * 0.55 : m.x < rm.x + rm.w * 0.45)), ms.map((m) => Math.round(m.x - rm.x)));
    // Conveyor
    rm = build('conveyor');
    enter(rm);
    const bt = G.belts.find((x) => x.roomId === rm.id);
    p.x = bt.x + bt.w / 2; p.y = bt.y + bt.h / 2; const x0 = p.x;
    I.vector = () => ({ x: 0, y: 0, mag: 0 }); run(0.5, () => { god(); }); I.vector = v0;
    check('conveyor: a belt carries you', Math.sign(p.x - x0) === bt.dx && Math.abs(p.x - x0) > 25, p.x - x0);
    // Colonnade
    rm = build('colonnade');
    check('colonnade: many pillars', G.pillars.filter((q) => pointInRect(q.x + 1, q.y + 1, rm, 0)).length >= 4);
    enter(rm); G.enemies.forEach((e) => { e.dead = true; }); G.markers.length = 0; G.room.queue.length = 0; clearEnemyBullets();
    { const y = rm.y + T * 1.5, xw = rm.x + rm.w - 10; fireEB(xw - 30, y, 0, 200, { color: '#fff' }); }
    run(0.4, god);
    check('colonnade: enemy bullets bounce off the wall', G.eb.length === 1 && G.eb[0].bounced && G.eb[0].vx < 0);
    // Dark Room
    rm = build('dark');
    enter(rm);
    check('dark: dark while the fight is on', rm.state === 'active' && Array.isArray(darknessLights()));
    for (const e of G.enemies) OMF.killEnemy(e); G.markers.length = 0; G.room.queue.length = 0; rm.waveIdx = 99; run(1.5, god);
    check('dark: light comes back once cleared', rm.state === 'clear' && darknessLights() === null, rm.state);
    // Chasm
    rm = build('chasm');
    const pits = []; for (let y = rm.ty; y < rm.ty + rm.th; y++) for (let x = rm.tx; x < rm.tx + rm.tw; x++) if (pitTile(x, y)) pits.push([x, y]);
    check('chasm: a pit across the middle', pits.length >= 12, pits.length);
    const pc = pits[Math.floor(pits.length / 2)], px = (pc[0] + 0.5) * T, py = (pc[1] + 0.5) * T;
    check('chasm: bullets and sight pass over the pit', !solidAt(px, py) && hasLOS(px, py - 80, px, py + 80));
    check('chasm: nothing spawns on the pit', !spotFree(px, py, 8));
    const band = rm.tw >= rm.th, top = band ? Math.min(...pits.map((q) => q[1])) : Math.min(...pits.map((q) => q[0]));
    enter(rm); G.enemies.forEach((e) => { e.dead = true; }); G.markers.length = 0; G.room.queue.length = 0;
    // walk into it: stopped at the edge
    if (band) { p.x = px; p.y = top * T - 30; I.vector = () => ({ x: 0, y: 1, mag: 1 }); } else { p.y = py; p.x = top * T - 30; I.vector = () => ({ x: 1, y: 0, mag: 1 }); }
    run(1, god); I.vector = v0;
    check('chasm: you cannot walk into the pit', !pitAt(p.x, p.y) && (band ? p.y < top * T : p.x < top * T), [Math.round(p.x), Math.round(p.y), top * T]);
    // dash over it
    const s0 = band ? p.y : p.x;
    I.vector = band ? () => ({ x: 0, y: 1, mag: 1 }) : () => ({ x: 1, y: 0, mag: 1 });
    { let once = true; I.consumeDash = () => { const v = once; once = false; return v; }; for (let k = 0; k < 30 && once; k++) OMF.step(1 / 60); I.consumeDash = cd0; }
    run(0.3, god); I.vector = v0;
    check('chasm: a dash carries you over it', (band ? p.y : p.x) > (top + 3) * T && !pitAt(p.x, p.y), [s0, band ? p.y : p.x, (top + 3) * T]);
    // walkers route around it instead of pushing against it
    const e = spawnEnemy('grunt', px - 120, (top - 2) * T, false, G.enemies); e.spawnIn = 0;
    const tgt = band ? { x: px + 100, y: (top + 5) * T } : { x: (top + 5) * T, y: py };
    const w = routeTo(e.x, e.y, e.r, tgt.x, tgt.y);
    check('chasm: walkers route around the pit', !!w);
    // save & resume keeps pits, belts and the variant
    const nPits = pits.length; OMF.startGame(true);
    let n2 = 0; for (const q of pits) if (pitTile(q[0], q[1])) n2++;
    check('resume keeps the pit', n2 === nPits && G.rooms.some((x) => x.variant === 'chasm'));
    rm = build('conveyor'); const nb = G.belts.length; OMF.startGame(true);
    check('resume keeps the belts', G.belts.length === nb && nb === 2);
    // stair preview names the rare room
    let lay = null;
    for (let k = 0; k < 10 && !lay; k++) { OMF.startGame(false); G.forceVariant = 'grand'; OMF.enterFloor(13, 'rest'); G.forceVariant = null; lay = G.previews.find((l) => l.rooms && l.rooms.some((x) => x.variant === 'grand')); }
    check('stair previews carry the variant', !!lay);
    // variants never leak: the next floor has no belts
    rm = build('conveyor'); OMF.clearFloor(); run(2); if (G.state === 'reward') OMF.chooseUpgrade('__skip');
    G.forceVariant = null; OMF.goThroughDoor(G.stairs[0]); run(1.5);
    check('belts do not follow you to the next floor', G.run.floor === 15 && !(G.belts || []).some((x) => !G.rooms[x.roomId] || G.rooms[x.roomId].variant !== 'conveyor'));
    return out;
  });
  await b.close();
  let fail = 0;
  for (const x of r) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  if (errs.length) { fail++; console.log('FAIL JS errors', errs); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + r.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
