// Save & Quit mid-floor: continuing must restore the same floor layout, room progress and position.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const src = require('fs').readFileSync(__dirname + '/audit.js', 'utf8'); const bot = src.match(/const BOT = `([\s\S]*?)`;/)[1];
  await page.addScriptTag({ content: bot });
  // play until the first fight room is cleared and the player walked a bit further
  const before = await page.evaluate(() => {
    OMF.Save.data.settings.tutorialDone = true; OMF.startGame(false); OMF.enterFloor(4, 'combat');
    const G = OMF.G;
    for (let i = 0; i < 60 * 120; i++) {
      if (G.player.hp < 3) G.player.hp = 3;
      window.__bot(G); OMF.step(1 / 60);
      const cleared = G.rooms.filter((r) => r.state === 'clear').length;
      if (cleared >= 2 && !G.room.active) break;
    }
    return { grid: Array.from(G.grid.solid).join(''), rooms: G.rooms.map((r) => r.state), pos: [G.player.x, G.player.y], hp: G.player.hp, floor: G.run.floor, kills: G.run.kills };
  });
  await page.tap('#btn-pause'); await page.waitForTimeout(200);
  before.pos = await page.evaluate(() => [OMF.G.player.x, OMF.G.player.y]); // position at the moment of pausing
  await page.tap('#s-pause [data-action=save-quit]'); await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(400); await page.addScriptTag({ content: bot });
  await page.tap('#btn-continue'); await page.waitForTimeout(300);
  const after = await page.evaluate(() => { const G = OMF.G; return { grid: Array.from(G.grid.solid).join(''), rooms: G.rooms.map((r) => r.state), pos: [G.player.x, G.player.y], hp: G.player.hp, floor: G.run.floor, kills: G.run.kills }; });
  const res = [];
  const ok = (n, c, i) => res.push((c ? 'PASS ' : 'FAIL ') + n + (i ? ' — ' + i : ''));
  ok('same floor', after.floor === before.floor);
  ok('same layout', after.grid === before.grid);
  ok('room progress kept', JSON.stringify(after.rooms) === JSON.stringify(before.rooms), JSON.stringify([before.rooms, after.rooms]));
  ok('same position', Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1]) < 2, JSON.stringify([before.pos, after.pos]));
  ok('hp and kills kept', after.hp === before.hp && after.kills === before.kills);
  // quitting in the middle of a fight: the room restarts, player waits just outside it
  const mid = await page.evaluate(() => {
    const G = OMF.G;
    for (let i = 0; i < 60 * 60 && !G.room.active; i++) { if (G.player.hp < 3) G.player.hp = 3; window.__bot(G); OMF.step(1 / 60); }
    const rm = G.room.active; if (!rm) return null;
    for (let i = 0; i < 90; i++) OMF.step(1 / 60);
    return { id: rm.id };
  });
  if (mid) {
    await page.tap('#btn-pause'); await page.waitForTimeout(200);
    await page.tap('#s-pause [data-action=save-quit]'); await page.waitForTimeout(200);
    await page.tap('#btn-continue'); await page.waitForTimeout(300);
    const m2 = await page.evaluate((id) => { const G = OMF.G, rm = G.rooms[id]; const inside = G.player.x > rm.x + 14 && G.player.x < rm.x + rm.w - 14 && G.player.y > rm.y + 14 && G.player.y < rm.y + rm.h - 14; return { state: rm.state, inside, gatesOpen: rm.gates.every((g) => !g.locked) }; }, mid.id);
    ok('interrupted fight room restarts', m2.state === 'idle' && !m2.inside && m2.gatesOpen, JSON.stringify(m2));
  } else ok('reached another fight room', false);
  ok('no JS errors', errs.length === 0, errs.join(' | '));
  console.log(res.join('\n'));
  const fails = res.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${res.length - fails}/${res.length} passed`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
