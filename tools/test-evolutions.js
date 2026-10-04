// Evolutions: offered only when the recipe is met, take the first card, apply their effects.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
    const G = OMF.G, S = OMF.Save.data;
    for (const m of META) if (m.unlock) S.meta[m.id] = 1; // blueprints (halo, volatile, nova …)
    const fresh = () => { OMF.startGame(false); G.run.upgrades = {}; G.run.order = []; computeStats(); };
    const give = (id, n) => { for (let i = 0; i < n; i++) OMF.addUpgrade(id, true); };
    const evos = UPGRADES.filter((u) => u.evo);
    check('10 evolutions, each recipe uses real upgrades', evos.length === 10 && evos.every((u) => UPG[u.evo[0]] && UPG[u.evo[1]]));
    // never offered without the recipe
    fresh(); let leak = false;
    for (let i = 0; i < 300; i++) if (rollChoices(['normal', 'elite', 'boss'][i % 3]).some((u) => u.rarity === 3)) leak = true;
    check('no evolution without its recipe', !leak);
    // recipe: first maxed + second owned
    for (const e of evos) {
      fresh(); const [a, bb] = e.evo;
      if (a !== 'halo' && (UPG[a].req === 'orbit' || UPG[bb].req === 'orbit')) give('halo', 1);
      if (a !== 'nova' && UPG[bb].req === 'nova') give('nova', 1);
      give(a, UPG[a].max - 1); give(bb, 1);
      const early = readyEvolutions().some((u) => u.id === e.id);
      give(a, 1);
      const ch = rollChoices('normal');
      check(e.name + ': offered first once ' + UPG[a].name + ' is maxed', !early && ch[0].id === e.id && ch.length === 3 + (S.meta.choice | 0), ch.map((u) => u.id));
      OMF.addUpgrade(e.id);
      check(e.name + ': not offered again', !rollChoices('normal').some((u) => u.id === e.id));
    }
    // not sold in the shop, not in the kit
    fresh(); give('ember', 3); give('volatile', 1);
    check('evolutions are not sold in the shop', !rollChoices('shop').some((u) => u.rarity === 3) && !rollChoices('kit').some((u) => u.rarity === 3));
    // effects
    fresh(); const p0 = G.stats.pierce; give('rail', 3); give('drill', 1); const p1 = G.stats.pierce; OMF.addUpgrade('e_railgun');
    check('Railgun: +3 pierce', G.stats.pierce === p1 + 3);
    fresh(); give('cryo', 2); give('lens', 1); OMF.addUpgrade('e_zero');
    OMF.enterFloor(3, 'rest');
    const e1 = spawnEnemy('sentinel', 100, 100, false, G.enemies), e2 = spawnEnemy('sentinel', 140, 100, false, G.enemies);
    e1.slowT = 1; const h1 = e1.hp, h2 = e2.hp; damageEnemy(e1, 10, false, 0, 0, true); damageEnemy(e2, 10, false, 0, 0, true);
    check('Absolute Zero: slowed enemies take +40%', Math.abs((h1 - e1.hp) - 14) < 1e-6 && Math.abs((h2 - e2.hp) - 10) < 1e-6);
    fresh(); give('ember', 3); give('volatile', 1); OMF.addUpgrade('e_napalm');
    OMF.enterFloor(3, 'rest');
    const n1 = spawnEnemy('sentinel', 200, 200, false, G.enemies); n1.hp = n1.maxHp = 1e6;
    G.explosions.push({ x: 200, y: 200, r: 50, dmg: 1, fx: false, vol: true }); processExplosions();
    check('Napalm: volatile explosions ignite', n1.burnT > 0 && n1.burnDps > 0);
    fresh(); const hp0 = G.stats.maxHp; give('aegis', 2); give('vital', 1); G.player.hp = 1; OMF.addUpgrade('e_fortress');
    check('Fortress: +2 max HP and full heal', G.stats.maxHp === hp0 + 3 && G.player.hp === G.stats.maxHp);
    // Dash Nova balance: a ring, not a homing volley; past 16 bullets each one is weaker
    fresh(); give('nova', 2); give('novashard', 4); give('seeker', 1); give('e_super', 1); give('capacitor', 3);
    G.pb.length = 0; G.player.dashT = 0.01; G.player.dashCharges = 0;
    const s0 = G.stats, n = 10 + 6 * (s0.nova - 1) + s0.novaExtra;
    OMF.step(1 / 60); // the dash ends this frame: the nova fires
    const ring = G.pb.filter((b2) => b2.noHome);
    const per = s0.dmg * 0.7 * s0.novaD;
    check('nova bullets never home (Seeker Chip does not steer them)', ring.length === n && s0.homing > 0, [ring.length, n]);
    check('nova total damage grows only with the square root past 16 bullets', Math.abs(ring[0].dmg - per * Math.sqrt(16 / n)) < 1e-6 && ring.reduce((a, b2) => a + b2.dmg, 0) < per * n * 0.75, [ring[0].dmg, per]);
    return out;
  });
  await b.close();
  let fail = 0;
  for (const x of r) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  if (errs.length) { fail++; console.log('FAIL JS errors', errs); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + r.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
