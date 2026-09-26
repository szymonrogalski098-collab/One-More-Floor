// Regression test for the Warden slam: must be escapable by walking alone, and the
// target must not follow the player after take-off (e.g. when dashing).
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const res = await page.evaluate(() => {
    const out = [];
    const G = OMF.G;
    function setup(hard, dirX, dirY, useDash) {
      OMF.startGame(false);
      OMF.enterFloor(5, 'boss');
      for (let i = 0; i < 120; i++) OMF.step(1 / 60); // boss spawns and lands
      const bs = G.boss; bs.enter = 0; bs.invuln = false; bs.untarget = false; bs.hard = hard;
      clearEnemyBullets(false);
      const p = G.player; p.x = G.W / 2; p.y = G.H / 2; p.iframes = 0; p.dashCharges = 1; p.vx = p.vy = 0;
      startPattern(bs, ['slam']); bs.pat = 'slam'; bs.sub = ''; bs.step = 0;
      OMF.step(1 / 60); // take-off, target locked on the player
      const tx = bs.tx, ty = bs.ty, hp0 = p.hp;
      let moved = false;
      const st = OMF.Input.stick;
      for (let i = 0; i < 70 && bs.sub === 'aim'; i++) {
        // reaction delay 0.2 s, then walk (and optionally dash)
        if (i >= 12) { st.x = dirX; st.y = dirY; st.mag = 1; }
        if (useDash && i === 20) OMF.Input.dashQueued = true;
        clearEnemyBullets(false);
        OMF.step(1 / 60);
        if (bs.tx !== tx || bs.ty !== ty) moved = true;
      }
      st.x = st.y = st.mag = 0;
      return { hard, dir: [dirX, dirY], dash: useDash, hit: p.hp < hp0, targetMoved: moved, dist: Math.hypot(p.x - tx, p.y - ty).toFixed(0) };
    }
    for (const hard of [false, true]) {
      out.push(setup(hard, 0, 1, false));
      out.push(setup(hard, 1, 0, false));
      out.push(setup(hard, -0.7071, 0.7071, false));
      out.push(setup(hard, 0, 1, true));
    }
    return out;
  });
  let fail = 0;
  for (const r of res) { const ok = !r.hit && !r.targetMoved; if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + JSON.stringify(r)); }
  await b.close();
  process.exit(fail ? 1 : 0);
})();
