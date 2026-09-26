// Checks the Blade Halo speed upgrades: Spin Coil (+5%, needs Halo), Overdrive Motor (+10%,
// first pick adds a blade, unlocked by the Blade Halo blueprint).
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = {};
    OMF.Save.data.meta = {}; // nothing unlocked
    OMF.startGame(false);
    const offered = (id) => { for (let i = 0; i < 300; i++) if (OMF.rollChoices('elite').some((u) => u.id === id)) return true; return false; };
    out.lockedOverdriveOffered = offered('overdrive');
    out.spinWithoutHaloOffered = offered('spin');
    OMF.Save.data.meta.u_halo = 1;
    out.overdriveWithoutHalo = offered('overdrive');
    OMF.addUpgrade('halo', true);
    out.overdriveWithHalo = offered('overdrive');
    OMF.addUpgrade('overdrive', true);
    out.bladesWithHalo = OMF.G.stats.orbit;
    out.spdAfterOverdrive = OMF.G.stats.orbitSpd;
    out.spinOfferedWithHalo = offered('spin');
    for (let k = 0; k < 2; k++) OMF.addUpgrade('spin', true);
    out.spdFinal = +OMF.G.stats.orbitSpd.toFixed(2);
    // spin rate actually used by the simulation
    const p = OMF.G.player, a0 = p.orbitA; OMF.G.room.phase = 'intro';
    for (let i = 0; i < 60; i++) OMF.step(1 / 60);
    out.radPerSec = +(p.orbitA - a0).toFixed(2);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const ok = !r.lockedOverdriveOffered && !r.spinWithoutHaloOffered && !r.overdriveWithoutHalo && r.overdriveWithHalo
    && r.bladesWithHalo === 1 && r.spinOfferedWithHalo && r.spdFinal === 1.2 && Math.abs(r.radPerSec - 3.6 * 1.2) < 0.05;
  console.log(ok ? 'PASS' : 'FAIL');
  await b.close(); process.exit(ok ? 0 : 1);
})();
