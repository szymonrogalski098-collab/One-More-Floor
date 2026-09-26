// Render+sim cost under 4x CPU throttling (approximates a mid-range phone) in a heavy scene.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const q of [2, 0]) {
    const r = await page.evaluate((q) => {
      OMF.startGame(false);
      for (const u of UPGRADES) for (let k = 0; k < u.max; k++) OMF.addUpgrade(u.id, true);
      OMF.enterFloor(15, 'boss');
      applyQuality(q); OMF.Render.resize();
      const G = OMF.G; let sim = 0, ren = 0, n = 0, maxF = 0;
      for (let i = 0; i < 900; i++) {
        G.player.hp = 99; G.player.iframes = 1;
        if (G.state === 'reward') { OMF.UI.show(null); OMF.chooseUpgrade('__skip'); OMF.enterFloor(15, 'boss'); }
        // keep scene heavy: extra enemies & bullets
        if (i % 30 === 0 && G.enemies.length < 16) for (let k = 0; k < 4; k++) spawnEnemy('grunt', 60 + k * 60, 100, false, G.enemies);
        if (i % 20 === 0) for (let k = 0; k < 16; k++) fireEB(G.W / 2, 150, k * Math.PI / 8, 90);
        const t0 = performance.now(); OMF.step(1 / 60); const t1 = performance.now(); OMF.Render.draw(); const t2 = performance.now();
        if (i > 60) { sim += t1 - t0; ren += t2 - t1; n++; maxF = Math.max(maxF, t2 - t0); }
      }
      return { q, simMs: (sim / n).toFixed(2), renderMs: (ren / n).toFixed(2), maxFrameMs: maxF.toFixed(1), eb: G.eb.length, parts: G.parts.length, en: G.enemies.length, pb: G.pb.length };
    }, q);
    console.log(JSON.stringify(r));
  }
  await b.close();
})();
