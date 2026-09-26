// Support upgrade lines + Workshop upgrades: availability rules and actual stat effects.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8080/One-More-Floor/?debug');
  const r = await page.evaluate(() => {
    const out = [];
    const check = (name, cond, info) => out.push([cond ? 'PASS' : 'FAIL', name, info === undefined ? '' : JSON.stringify(info)]);
    const S = OMF.Save.data, G = OMF.G;
    const offered = (id, kind = 'elite') => { for (let i = 0; i < 400; i++) if (OMF.rollChoices(kind).some((u) => u.id === id)) return true; return false; };
    const fresh = (meta) => { S.meta = meta || {}; OMF.startGame(false); };

    // --- boosters need their effect, rares need the blueprint
    const lines = [
      ['blast', 'volatile', 'primer', 'u_volatile'], ['novashard', 'nova', 'capacitor', 'u_nova'],
      ['servo', 'seeker', 'lockon', 'u_seeker'], ['rush', 'adren', 'reflex', 'u_adren'], ['spin', 'halo', 'overdrive', 'u_halo'],
    ];
    for (const [boost, epic, rare, bp] of lines) {
      fresh({});
      check(rare + ' locked without blueprint', !offered(rare));
      check(boost + ' hidden without ' + epic, !offered(boost, 'normal'));
      fresh({ [bp]: 1 });
      check(rare + ' offered with blueprint', offered(rare));
      OMF.addUpgrade(rare, true);
      const statOf = { volatile: 'volatile', nova: 'nova', seeker: 'homing', adren: 'adren', halo: 'orbit' }[epic];
      check(rare + ' grants ' + epic, G.stats[statOf] === 1, G.stats[statOf]);
      check(boost + ' offered after ' + rare, offered(boost, 'normal'));
    }
    for (const [boost, base] of [['conduct', 'arc'], ['kindling', 'ember'], ['deepfreeze', 'cryo'], ['recharge', 'aegis']]) {
      fresh({});
      check(boost + ' hidden without ' + base, !offered(boost, 'normal'));
      OMF.addUpgrade(base, true);
      check(boost + ' offered with ' + base, offered(boost, 'normal'));
    }

    // --- effects
    fresh({ u_nova: 1 }); OMF.addUpgrade('nova', true); OMF.addUpgrade('novashard', true); OMF.addUpgrade('capacitor', true);
    G.room.phase = 'intro'; G.pb.length = 0; OMF.Input.dashQueued = true;
    for (let i = 0; i < 12; i++) OMF.step(1 / 60);
    // nova stacks: epic 1 + capacitor grant 1 = 2 -> 16 bullets, +2 shards
    check('nova ring bullet count', G.pb.length === 18, G.pb.length);
    check('nova damage bonus', Math.abs(G.pb[0].dmg - G.stats.dmg * 0.7 * 1.15) < 1e-6, G.pb[0].dmg);

    fresh({}); OMF.addUpgrade('aegis', true); const cd0 = G.stats.aegisCd; OMF.addUpgrade('recharge', true);
    check('Quick Recharge shortens aegis', Math.abs(cd0 - G.stats.aegisCd - 1.5) < 1e-6, [cd0, G.stats.aegisCd]);
    fresh({}); OMF.addUpgrade('ember', true); OMF.addUpgrade('kindling', true);
    check('Kindling stats', Math.abs(G.stats.burnD - 1.1) < 1e-9 && G.stats.burnDur === 0.5);
    fresh({ u_adren: 1 }); OMF.addUpgrade('reflex', true);
    check('Reflex Amp dodge window', Math.abs(G.stats.dodgeWin - 0.02) < 1e-9 && G.stats.adren === 1);

    // --- Workshop
    fresh({ choice: 1 }); G.state = 'reward'; OMF.UI.showUpgrade(OMF.rollChoices('normal'), 'normal');
    check('Wide Selection shows 4 cards', document.querySelectorAll('#up-cards .card').length === 4);
    OMF.UI.show(null);
    const epicShare = (meta) => { fresh(meta); G.run.floor = 1; let e = 0, n = 0; for (let i = 0; i < 1500; i++) for (const u of OMF.rollChoices('normal')) { n++; if (u.rarity > 0) e++; } return e / n; };
    const base = epicShare({}), lucky = epicShare({ luck: 3 });
    check('Lucky Draw raises rare+epic share', lucky > base + 0.1, [base.toFixed(2), lucky.toFixed(2)]);
    fresh({}); const d0 = G.stats.dashCd; fresh({ reflexes: 3 });
    check('Quick Reflexes', Math.abs(G.stats.dashCd - d0 * 0.82) < 1e-6, [d0, G.stats.dashCd]);
    fresh({ magnet: 2 }); check('Magnet Coil', Math.abs(G.stats.magnet - 1.8) < 1e-9);
    fresh({ medic: 2 }); check('Field Medic rest heal', restHealAmount() === Math.max(2, Math.ceil(G.stats.maxHp / 2)) + 2, restHealAmount());
    S.meta = {};
    return out;
  });
  let fail = 0;
  for (const [s, n, i] of r) { if (s === 'FAIL') fail++; console.log(s, n, i); }
  if (errs.length) { fail++; console.log('JS errors', errs); }
  console.log(`\n${r.length - fail}/${r.length} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
