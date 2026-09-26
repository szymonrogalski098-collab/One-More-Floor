// Regression: stragglers / sleeping corridor enemies elsewhere on the floor must not stall a room.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const G = OMF.G, out = [];
    for (let trial = 0; trial < 5; trial++) {
      OMF.startGame(false); OMF.enterFloor(24, 'combat');
      const rm = G.rooms.find((x) => x.kind !== 'start');
      const st = G.rooms[0];
      // 16 awake stragglers parked in the start room (outside the fight room)
      for (let i = 0; i < 16; i++) { const e = spawnEnemy('sentinel', st.x + 40 + (i % 4) * 30, st.y + 40 + ((i / 4) | 0) * 30, false, G.enemies); e.speed = 0; e.atk = 1e9; }
      G.room.phase = 'fight'; G.player.x = rm.x + rm.w / 2; G.player.y = rm.y + rm.h / 2;
      let cleared = false;
      for (let s = 0; s < 60 * 90 && !cleared; s++) {
        G.player.hp = 9; G.player.x = rm.x + rm.w / 2; G.player.y = rm.y + rm.h / 2;
        for (const e of G.enemies) if (!e.dead && e.roomId === rm.id && e.spawnIn <= 0) OMF.killEnemy(e);
        OMF.step(1 / 60);
        cleared = rm.state === 'clear';
      }
      out.push(cleared);
    }
    return out;
  });
  const ok = r.every(Boolean);
  console.log(ok ? 'PASS' : 'FAIL', 'room clears despite 16 stragglers elsewhere', JSON.stringify(r));
  // an enemy shoved into the middle of a thick block (locked stairs = 3x3 solid) must get out
  const stuck = await page.evaluate(() => {
    const G = OMF.G, out = [];
    for (let t = 0; t < 10; t++) {
      OMF.startGame(false); OMF.enterFloor(6, 'combat'); G.room.phase = 'fight';
      const st = G.stairs[0];
      const e = spawnEnemy(pick(['blob', 'grunt', 'spitter']), st.x + st.w / 2, st.y + st.h / 2, false, G.enemies);
      e.spawnIn = 0;
      for (let i = 0; i < 30; i++) OMF.step(1 / 60);
      out.push(!solidAt(e.x, e.y));
    }
    return out;
  });
  const ok2 = stuck.every(Boolean);
  console.log(ok2 ? 'PASS' : 'FAIL', 'enemies pushed inside a thick block escape it', JSON.stringify(stuck));
  await b.close(); process.exit(ok && ok2 ? 0 : 1);
})();
