// Multiplayer over the local transport (?net=local: BroadcastChannel between two tabs).
// Room code, teams, start, shots and hits, rounds, the end of the match, ranking, quick play.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const errs = [];
  const open = async () => { const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1])); await pg.goto('http://localhost:8080/One-More-Floor/?debug&net=local'); return pg; };
  const A = await open(), B = await open();
  const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (pg, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pg.evaluate(fn)) return true; await wait(100); } return false; };

  await A.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('omf-lb:')).forEach((k) => localStorage.removeItem(k)); OMF.Save.data.mpName = 'Alpha'; OMF.UI.action('mp'); mpCreate(); });
  await B.evaluate(() => { OMF.Save.data.mpName = 'Bravo'; OMF.UI.action('mp'); });
  check('create: a 4-character room code and the lobby', await until(A, () => OMF.UI.current === 's-lobby' && /^[A-Z0-9]{4}$/.test(MP.code)));
  const code = await A.evaluate(() => MP.code);
  await B.evaluate((c) => { document.getElementById('mp-code').value = c.toLowerCase(); OMF.UI.action('mp-join'); }, code);
  check('join by code: both see both players', await until(A, () => MP.list.length === 2) && await until(B, () => MP.list.length === 2));
  check('the newcomer goes to the other team', await until(B, () => Object.keys(MP.teams).length === 2 && new Set(Object.values(MP.teams)).size === 2));
  check('only the host can start; START is enabled', await A.evaluate(() => mpIsHost() && !document.getElementById('lb-start').disabled && !document.getElementById('lb-start').classList.contains('hidden')) && await B.evaluate(() => !mpIsHost() && document.getElementById('lb-start').classList.contains('hidden')));
  // host moves Bravo to blue → START disabled (red is empty) → move back
  const bid = await B.evaluate(() => Net.id);
  await A.evaluate((id) => mpMove(id), bid);
  check('host moves a player between teams (seen by the other)', await until(B, () => new Set(Object.values(MP.teams)).size === 1) && await A.evaluate(() => document.getElementById('lb-start').disabled));
  await A.evaluate((id) => mpMove(id), bid);
  await until(B, () => new Set(Object.values(MP.teams)).size === 2);
  await A.evaluate(() => { PVP.countdown = 0.5; mpHostStart(); });
  await B.evaluate(() => { PVP.countdown = 0.5; });
  check('start: both are in the arena with 3 upgrades each', await until(A, () => !!G.pvp && G.run.order.length === 3) && await until(B, () => !!G.pvp && G.run.order.length === 3));
  check('the opponent is a proxy you can target', await A.evaluate(() => G.enemies.filter((e) => e.type === 'pvp').length === 1));
  check('fight starts after the countdown', await until(A, () => G.pvp.phase === 'fight') && await until(B, () => G.pvp.phase === 'fight'));
  // Bravo keeps still with low HP; Alpha flies next to him and shoots
  await B.evaluate(() => { window.__hold = setInterval(() => { const M = G.pvp; if (!M) return; M.maxHp = 25; if (M.hp > 25) M.hp = 25; G.stats.rof = 0.01; }, 50); });
  await A.evaluate(() => { window.__chase = setInterval(() => { const M = G.pvp; if (!M || M.phase !== 'fight') return; const o = Object.values(M.players).find((p) => p.id !== Net.id); G.player.x = o.x - 90; G.player.y = o.y; G.stats.rof = 8; }, 50); });
  check('shots arrive as bullets on the other screen', await until(B, () => G.eb.some((x) => x.fake), 8000));
  check('hits apply on the victim: a round is won', await until(A, () => G.pvp && G.pvp.score[G.pvp.team] >= 1, 15000), await A.evaluate(() => G.pvp && G.pvp.score));
  check('both agree on the score', await until(B, () => G.pvp && G.pvp.score.join() === '' + 0 + ',' + 0 ? false : true) && (await A.evaluate(() => G.pvp.score.join())) === (await B.evaluate(() => G.pvp.score.join())));
  check('the match ends at 3 rounds with a result screen', await until(A, () => OMF.UI.current === 's-mpresult', 40000) && await until(B, () => OMF.UI.current === 's-mpresult', 5000));
  check('winner sees VICTORY, loser DEFEAT', (await A.evaluate(() => document.getElementById('mr-title').textContent)) === 'VICTORY' && (await B.evaluate(() => document.getElementById('mr-title').textContent)) === 'DEFEAT');
  check('kills counted', await A.evaluate(() => G.pvp.kills >= 3));
  check('ranking: the result is saved', await A.evaluate(async () => { const l = await Net.leaderboard(); return l.some((r) => r.name === 'Alpha' && r.wins === 1) && l.some((r) => r.name === 'Bravo' && r.losses === 1); }));
  // back to the room (friendly)
  await A.evaluate(() => { clearInterval(window.__chase); OMF.UI.action('mp-again'); });
  check('friendly: back to the room together', await until(A, () => OMF.UI.current === 's-lobby' && !G.pvp) && await until(B, () => OMF.UI.current === 's-lobby' && !G.pvp));
  // leaving
  await B.evaluate(() => { clearInterval(window.__hold); OMF.UI.action('mp-leave'); });
  check('leaving: back to the menu, the room sees one player', await until(B, () => OMF.UI.current === 's-menu' && !MP.ch) && await until(A, () => MP.list.length === 1, 6000));
  await A.evaluate(() => OMF.UI.action('mp-leave'));
  // quick play 1v1: both search, a match is formed
  await A.evaluate(() => { OMF.UI.action('mp'); mpQuick(1); });
  await B.evaluate(() => { OMF.UI.action('mp'); mpQuick(1); });
  check('quick play: two searchers are matched and the match starts', await until(A, () => !!G.pvp, 12000) && await until(B, () => !!G.pvp, 6000), await A.evaluate(() => [MP.status, MP.qlist && MP.qlist.length]));
  check('quick play is ranked, on opposite teams', await A.evaluate(() => G.pvp.ranked) && (await A.evaluate(() => G.pvp.team)) !== (await B.evaluate(() => G.pvp.team)));
  // a player leaving mid-match loses the round
  await B.evaluate(() => OMF.UI.action('mp-leave'));
  check('opponent leaves: you take the round', await until(A, () => G.pvp && G.pvp.score[G.pvp.team] >= 1, 8000));
  check('no JS errors', !errs.length, errs.slice(0, 5));
  await b.close();
  let fail = 0;
  for (const x of out) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + out.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
