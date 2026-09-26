// Dungeon floors: generation is always connected, rooms lock/unlock, abandon rule pays 0 on floors 1-3.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G;
    OMF.startGame(false);
    let bad = 0, fallback = 0;
    for (let i = 0; i < 300; i++) {
      const f = 1 + (i % 29); if (f % 5 === 0) continue;
      OMF.enterFloor(f, i % 3 ? 'combat' : 'elite');
      if (!dungeonConnected()) bad++;
      if (G.rooms.length === 1) fallback++;
      const ex = G.exitRoom; if (ex.w < 13 * 20) bad++; // room for 2 doors
    }
    check('300 generated floors are connected', bad === 0, { bad, fallback });
    OMF.enterFloor(4, 'combat');
    const rm = G.rooms.find((x) => x.kind !== 'start');
    G.room.phase = 'fight';
    G.player.x = rm.x + rm.w / 2; G.player.y = rm.y + rm.h / 2;
    OMF.step(1 / 60);
    check('entering a fight room activates it', G.room.active === rm);
    check('its exits are locked', rm.gates.every((g) => g.locked) && rm.gates.every((g) => g.tiles.every((t) => G.grid.solid[t] === 1)));
    for (let i = 0; i < 60 * 3; i++) { G.player.hp = 9; OMF.step(1 / 60); }
    check('waves spawn inside the room', G.enemies.filter((e) => e.roomId === rm.id && !e.dead).every((e) => e.x > rm.x && e.x < rm.x + rm.w && e.y > rm.y && e.y < rm.y + rm.h));
    for (let k = 0; k < 20 && rm.state === 'active'; k++) { for (const e of G.enemies) if (!e.dead && e.roomId === rm.id) OMF.killEnemy(e); G.markers.length = 0; G.room.queue.length = 0; for (let i = 0; i < 30; i++) OMF.step(1 / 60); }
    check('clearing the room unlocks it', rm.state === 'clear' && rm.gates.every((g) => !g.locked && g.tiles.every((t) => G.grid.solid[t] === 0)));
    // abandon rule
    const S = OMF.Save.data;
    for (const [fl, expectZero] of [[1, true], [3, true], [4, false]]) {
      OMF.startGame(false); OMF.enterFloor(fl, fl % 5 ? 'combat' : 'boss'); G.run.shards = 20;
      const before = S.shards; const res = finalizeRun(true);
      check('abandon on floor ' + fl + (expectZero ? ' pays 0' : ' pays out'), expectZero ? res.earned === 0 && S.shards === before : res.earned > 0, res.earned);
    }
    OMF.startGame(false); OMF.enterFloor(2, 'combat'); G.run.shards = 20;
    check('dying on floor 2 still pays', finalizeRun(false).earned > 0);
    // stairs are nooks in the top wall of the exit room; the floor you climb into is the one previewed
    let nookOk = true, sameAsPreview = true, previewsOk = true;
    for (let t = 0; t < 12; t++) {
      OMF.startGame(false); OMF.enterFloor([3, 4, 6, 7, 8, 9][t % 6], t % 2 ? 'combat' : 'elite');
      const ex = G.exitRoom;
      for (const st of G.stairs) if (st.y + st.h !== ex.y || !st.locked || !solidAt(st.x + st.w / 2, st.y + st.h / 2)) nookOk = false;
      if (!G.previews || G.previews.length !== G.stairs.length || G.previews.some((p, i) => p.type !== G.stairs[i].type)) previewsOk = false;
      for (let k = 0; k < 6 && G.state === 'play'; k++) { OMF.clearFloor(); for (let i = 0; i < 40; i++) OMF.step(1 / 60); } // blob splits spawn late
      if (G.state === 'reward') { OMF.UI.show(null); OMF.chooseUpgrade(document.querySelector('#up-cards .card').dataset.id); }
      const idx = G.stairs.length - 1, st = G.stairs[idx], pv = G.previews[idx];
      G.player.x = st.x + st.w / 2; G.player.y = st.y + st.h + 14;
      for (let i = 0; i < 200 && G.state !== 'climb'; i++) { OMF.Input.stick.x = 0; OMF.Input.stick.y = -1; OMF.Input.stick.mag = 1; OMF.step(1 / 60); }
      OMF.Input.stick.mag = 0; OMF.Input.stick.y = 0;
      for (let i = 0; i < 80 && G.state === 'climb'; i++) OMF.step(1 / 60);
      if (pv.circle) { if (!G.circle) sameAsPreview = false; }
      else {
        const grid = Array.from(G.grid.solid).join('');
        // the new floor's own stairs are still locked (wall) exactly as in the preview
        if (grid !== pv.solid) sameAsPreview = false;
      }
    }
    check('stairs are locked nooks in the exit room top wall', nookOk);
    check('each staircase has a preview of its floor', previewsOk);
    check('climbing leads to the previewed floor', sameAsPreview);
    // boss hall
    OMF.startGame(false); OMF.enterFloor(5, 'boss');
    check('boss floor is a circular hall', !!G.circle && G.circle.R >= 200);
    return out;
  });
  let fail = 0;
  for (const [s, n, i] of r) { if (s === 'FAIL') fail++; console.log(s, n, i); }
  if (errs.length) { fail++; console.log('JS errors', errs); }
  console.log(`\n${r.length - fail}/${r.length} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
