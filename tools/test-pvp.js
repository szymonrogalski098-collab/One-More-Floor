// Multiplayer over the local transport (?net=local: BroadcastChannel between two tabs, database in localStorage).
// Rooms, teams, bots, spawns, rounds, the end of the match, a dropped connection and the catch-up,
// anti-cheat (forged hits, ignoring damage), casual with bots, ranked with both sides confirming,
// friends and invites.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const errs = [];
  const open = async () => { const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1])); await pg.goto('http://localhost:8080/One-More-Floor/?debug&net=local'); return pg; };
  const A = await open(), B = await open();
  const out = [], check = (n, c, i) => out.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (pg, fn, ms = 8000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pg.evaluate(fn, arg)) return true; await wait(100); } return false; };
  const both = (fn, arg) => Promise.all([A.evaluate(fn, arg), B.evaluate(fn, arg)]);

  await A.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('omf-l-')).forEach((k) => localStorage.removeItem(k)); });
  await both(() => { PVP.countdown = 0.5; PVP.target = 3; });
  await A.evaluate(() => { OMF.Save.data.mpName = 'Alpha'; OMF.UI.action('mp'); mpCreate(); });
  await B.evaluate(() => { OMF.Save.data.mpName = 'Bravo'; OMF.UI.action('mp'); });
  check('menu: one mode card and a PLAY button', await B.evaluate(() => !document.getElementById('mp-play').classList.contains('hidden') && /CASUAL/.test(document.getElementById('mp-modecard').textContent)));
  check('create: a room code and the lobby', await until(A, () => OMF.UI.current === 's-lobby' && /^[A-Z0-9]{4}$/.test(MP.code)));
  const code = await A.evaluate(() => MP.code);
  await B.evaluate((c) => { OMF.UI.action('mp-modes'); document.getElementById('mp-code').value = c.toLowerCase(); OMF.UI.action('mp-join'); }, code);
  check('join by code: both see both players', await until(A, () => MP.list.length === 2) && await until(B, () => MP.list.length === 2));
  check('the newcomer goes to the other team', await until(B, () => Object.keys(MP.teams).length === 2 && new Set(Object.values(MP.teams)).size === 2));
  check('only the host can start', await A.evaluate(() => mpIsHost() && !document.getElementById('lb-start').disabled && !document.getElementById('lb-start').classList.contains('hidden')) && await B.evaluate(() => !mpIsHost() && document.getElementById('lb-start').classList.contains('hidden')));
  const bid = await B.evaluate(() => Net.id), aid = await A.evaluate(() => Net.id);
  await A.evaluate((id) => mpMove(id), bid);
  check('host moves a player between teams', await until(B, () => new Set(Object.values(MP.teams)).size === 1) && await A.evaluate(() => document.getElementById('lb-start').disabled));
  await A.evaluate((id) => mpMove(id), bid);
  await until(B, () => new Set(Object.values(MP.teams)).size === 2);
  // bots in a room: add one, the other sees it, remove it
  await A.evaluate(() => mpAddBot(0));
  check('room: the host adds a bot, everybody sees it', await until(B, () => MP.bots.length === 1 && document.querySelectorAll('#s-lobby .lb-p.bot').length === 1));
  await A.evaluate(() => mpMove(MP.bots[0].id));
  check('room: tapping a bot removes it', await until(B, () => MP.bots.length === 0));

  // ---------- a match ----------
  await A.evaluate(() => mpHostStart());
  check('start: both in the arena with 3 upgrades', await until(A, () => !!G.pvp && G.run.order.length === 3) && await until(B, () => !!G.pvp && G.run.order.length === 3));
  const sp = await both(() => ({ team: G.pvp.team, x: G.player.x, y: G.player.y, cx: G.pvpArena.cx, top: G.pvpArena.y0, h: G.pvpArena.h }));
  check('spawns: centred, one team at the bottom, the other at the top', sp.every((s) => Math.abs(s.x - s.cx) < 1 && (s.team === 0 ? s.y > s.top + s.h - 80 : s.y < s.top + 80)), sp);
  check('the opponent is a proxy you can target', await A.evaluate(() => G.enemies.filter((e) => e.type === 'pvp').length === 1));
  check('Workshop upgrades do not count in PvP', await A.evaluate(() => { const s = pvpStats(G.run.ship, G.run.order); return Math.abs(s.dmg - G.stats.dmg) < 1e-9; }));
  check('fight starts after the countdown', await until(A, () => G.pvp.phase === 'fight') && await until(B, () => G.pvp.phase === 'fight'));
  // anti-cheat 1: a forged hit far beyond the ship's damage is ignored
  await B.evaluate((id) => { for (let i = 0; i < 6; i++) MP.ch.send('st', { id: Net.id, r: G.pvp.round, x: Math.round(G.player.x), y: Math.round(G.player.y), a: 0, hp: 1, al: true, d: false, sh: false, b: [], h: [[id, 9999, 1]] }); }, aid);
  await wait(500);
  check('anti-cheat: an impossible hit is ignored and noted', await A.evaluate((id) => G.pvp.hp === G.pvp.maxHp && G.pvp.players[id].viol > 0, bid));
  // anti-cheat 2: a hit through the middle wall (no bouncing bullets) is ignored
  await both(() => { window.__pin = setInterval(() => { const M = G.pvp; if (!M) return; const A = G.pvpArena; G.player.x = A.cx; G.player.y = M.team ? A.cy - 45 : A.cy + 45; G.stats.rof = 0.01; for (const id in M.players) M.players[id].st.bounce = 0; }, 30); });
  await wait(600);
  await B.evaluate((id) => { for (let i = 0; i < 4; i++) setTimeout(() => MP.ch.send('st', { id: Net.id, r: G.pvp.round, x: Math.round(G.player.x), y: Math.round(G.player.y), a: 0, hp: 1, al: true, d: false, sh: false, b: [], h: [[id, 5, 0]] }), i * 120); }, aid);
  await wait(800);
  check('anti-cheat: a hit through a wall is ignored', await A.evaluate(() => { const A = G.pvpArena; return G.pvp.hp === G.pvp.maxHp && !hasLOS(A.cx, A.cy - 45, A.cx, A.cy + 45); }));
  await both(() => clearInterval(window.__pin));
  // anti-cheat 3: Bravo ignores every hit (god mode); the host's ledger kills him anyway
  await B.evaluate(() => { window.__realTake = pvpTakeHit; window.pvpTakeHit = function () {}; });
  await A.evaluate(() => { window.__chase = setInterval(() => { const M = G.pvp; if (!M || M.phase !== 'fight') return; const o = Object.values(M.players).find((p) => p.id !== Net.id); const s = [[-90, 0], [90, 0], [0, 90], [0, -90], [-64, 64], [64, 64], [-64, -64], [64, -64]].map(([dx, dy]) => [o.x + dx, o.y + dy]).find(([x, y]) => spotFree(x, y, 10) && hasLOS(x, y, o.x, o.y)) || [o.x - 90, o.y]; G.player.x = s[0]; G.player.y = s[1]; G.stats.rof = 8; G.player.fireT = Math.min(G.player.fireT, 0.2); }, 50); });
  await B.evaluate(() => { window.__hold = setInterval(() => { const M = G.pvp; if (!M) return; G.stats.rof = 0.01; }, 50); });
  check('shots arrive as bullets on the other screen', await until(B, () => G.eb.some((x) => x.fake), 8000));
  check('anti-cheat: ignoring lethal damage does not save you (host ledger)', await until(A, () => G.pvp && G.pvp.score[G.pvp.team] >= 1, 20000), await A.evaluate(() => G.pvp && [G.pvp.score, Object.values(G.pvp.players).map((p) => Math.round(p.lhp))]));
  await B.evaluate(() => { window.pvpTakeHit = window.__realTake; });
  check('both agree on the score', await until(B, (s) => G.pvp && G.pvp.score.join() === s, 5000, (await A.evaluate(() => G.pvp.score.join()))));
  // honest round: Bravo low on HP
  await B.evaluate(() => { clearInterval(window.__hold); window.__hold = setInterval(() => { const M = G.pvp; if (!M) return; M.maxHp = 25; if (M.hp > 25) M.hp = 25; G.stats.rof = 0.01; }, 50); });
  check('hits apply on the victim: another round won', await until(A, () => G.pvp && G.pvp.score[G.pvp.team] >= 2, 20000), await A.evaluate(() => G.pvp && G.pvp.score));
  await A.evaluate(() => clearInterval(window.__chase));
  // ---------- connection lost (phone locked) and back ----------
  await until(A, () => G.pvp.phase === 'fight', 8000);
  await B.evaluate(() => { Net.down = true; });
  check('connection lost: after 5 s silent the player is out of the round', await until(A, () => G.pvp && G.pvp.score[G.pvp.team] >= 3 || (G.pvp && G.pvp.round >= 4), 12000) || await until(A, (id) => !G.pvp.players[id].alive, 1000, bid), await A.evaluate(() => [G.pvp.score, G.pvp.round]));
  // (the third round ends the match: start a fresh one in the room to test the catch-up)
  await until(A, () => OMF.UI.current === 's-mpresult', 8000);
  await B.evaluate(() => { Net.down = false; pvpWake(9000); });
  check('the match ends with a result screen', await A.evaluate(() => OMF.UI.current === 's-mpresult' && document.getElementById('mr-title').textContent === 'VICTORY'));
  check('back from the background: the host state catches the player up', await until(B, () => OMF.UI.current === 's-mpresult', 8000) && (await B.evaluate(() => document.getElementById('mr-title').textContent)) === 'DEFEAT');
  check('kills counted, no rating in a room', await A.evaluate(() => G.pvp.kills >= 2 && /No rating/.test(document.getElementById('mr-rating').textContent)));
  await A.evaluate(() => OMF.UI.action('mp-again'));
  check('room: back to the room together', await until(A, () => OMF.UI.current === 's-lobby' && !G.pvp) && await until(B, () => OMF.UI.current === 's-lobby' && !G.pvp));
  await B.evaluate(() => clearInterval(window.__hold));
  // mid-round drop and return: the player plays again from the next round
  await A.evaluate(() => mpHostStart());
  await until(A, () => G.pvp && G.pvp.phase === 'fight', 8000); await until(B, () => G.pvp && G.pvp.phase === 'fight', 8000);
  await B.evaluate(() => { Net.down = true; });
  await until(A, () => G.pvp.score[G.pvp.team] >= 1, 12000);
  await wait(500);
  await B.evaluate(() => { Net.down = false; pvpWake(7000); });
  check('after the return both are in the same round with the same score', await until(B, (s) => !G.pvp.wait && G.pvp.score.join() === s, 6000, await A.evaluate(() => G.pvp.score.join())), await both(() => [G.pvp.round, G.pvp.phase, G.pvp.score.join()]));
  check('the returning player is back in the next round (visible and targetable)', await until(A, (id) => G.pvp.round >= 2 && G.pvp.phase !== 'between' && G.pvp.players[id].alive && !G.pvp.players[id].left && !G.pvp.players[id].proxy.untarget, 8000, bid));
  check('no flood of stale bullets after the return', await A.evaluate(() => G.eb.length < 80), await A.evaluate(() => G.eb.length));
  // a player leaving mid-match gives the round
  await B.evaluate(() => OMF.UI.action('mp-leave'));
  check('leaving: back to the menu', await until(B, () => OMF.UI.current === 's-menu' && !MP.ch));
  check('opponent left: you take the rounds', await until(A, () => G.pvp && (G.pvp.score[G.pvp.team] >= 2 || OMF.UI.current === 's-mpresult'), 12000));
  await A.evaluate(() => OMF.UI.action('mp-leave'));

  // ---------- casual with a bot ----------
  await A.evaluate(() => { PVP.botWait = 1; PVP.target = 1; OMF.UI.action('mp'); mpQueue('casual', 1); });
  check('casual: alone in the queue, a bot joins and the match starts', await until(A, () => G.pvp && Object.values(G.pvp.players).some((p) => p.bot), 10000));
  check('casual: no rating', await A.evaluate(() => !G.pvp.ranked));
  const bot0 = await A.evaluate(() => { const b = Object.values(G.pvp.players).find((p) => p.bot); return [b.x, b.y]; });
  await until(A, () => G.pvp.phase === 'fight', 6000);
  await A.evaluate(() => { window.__still = setInterval(() => { if (!G.pvp) return; const A = G.pvpArena; G.player.x = A.cx; G.player.y = A.y0 + A.h - 60; G.stats.rof = 0.01; }, 30); });
  check('casual: the bot moves and shoots', await until(A, (p) => { const b = Object.values(G.pvp.players).find((x) => x.bot); return Math.hypot(b.x - p[0], b.y - p[1]) > 40 && (G.pvp.bb.length > 0 || G.pvp.hp < G.pvp.maxHp); }, 15000, bot0));
  check('casual: the bot can hurt you', await until(A, () => G.pvp.hp < G.pvp.maxHp, 15000));
  await A.evaluate(() => { clearInterval(window.__still); window.__chase = setInterval(() => { const M = G.pvp; if (!M || M.phase !== 'fight') return; const o = Object.values(M.players).find((p) => p.bot); const s = [[-70, 0], [70, 0], [0, 70], [0, -70], [-50, 50], [50, 50], [-50, -50], [50, -50]].map(([dx, dy]) => [o.x + dx, o.y + dy]).find(([x, y]) => spotFree(x, y, 10) && hasLOS(x, y, o.x, o.y)) || [o.x - 70, o.y]; G.player.x = s[0]; G.player.y = s[1]; G.stats.rof = 10; G.player.fireT = Math.min(G.player.fireT, 0.2); M.hp = M.maxHp; }, 30); });
  check('casual: you can beat the bot', await until(A, () => OMF.UI.current === 's-mpresult' && document.getElementById('mr-title').textContent === 'VICTORY', 25000), await A.evaluate(() => G.pvp && [G.pvp.score, G.pvp.phase]));
  await A.evaluate(() => { clearInterval(window.__chase); OMF.UI.action('mp-leave'); });

  // ---------- Google accounts, ranked ----------
  await A.evaluate(async () => { OMF.UI.action('mp'); await Social.login(); return Social.setName('Alpha'); });
  await B.evaluate(async () => { OMF.UI.action('mp'); await Social.login(); });
  check('a taken name is refused', (await B.evaluate(() => Social.setName('alpha'))) === 'name taken');
  check('a free name is saved', (await B.evaluate(() => Social.setName('Bravo'))) === null && await B.evaluate(() => Social.me && Social.me.name === 'Bravo'));
  await both(() => { PVP.target = 1; });
  await A.evaluate(() => mpQueue('ranked', 1));
  await B.evaluate(() => mpQueue('ranked', 1));
  check('ranked: two players matched, ranked, opposite teams', await until(A, () => G.pvp && G.pvp.ranked, 12000) && await until(B, () => G.pvp && G.pvp.ranked, 6000) && (await A.evaluate(() => G.pvp.team)) !== (await B.evaluate(() => G.pvp.team)));
  check('ranked: no bots', await A.evaluate(() => !Object.values(G.pvp.players).some((p) => p.bot)));
  await until(A, () => G.pvp.phase === 'fight', 6000);
  await B.evaluate(() => { window.__hold = setInterval(() => { const M = G.pvp; if (!M) return; M.maxHp = 25; if (M.hp > 25) M.hp = 25; G.stats.rof = 0.01; }, 50); });
  await A.evaluate(() => { window.__chase = setInterval(() => { const M = G.pvp; if (!M || M.phase !== 'fight') return; const o = Object.values(M.players).find((p) => p.id !== Net.id); const s = [[-90, 0], [90, 0], [0, 90], [0, -90], [-64, 64], [64, 64], [-64, -64], [64, -64]].map(([dx, dy]) => [o.x + dx, o.y + dy]).find(([x, y]) => spotFree(x, y, 10) && hasLOS(x, y, o.x, o.y)) || [o.x - 90, o.y]; G.player.x = s[0]; G.player.y = s[1]; G.stats.rof = 8; G.player.fireT = Math.min(G.player.fireT, 0.2); }, 50); });
  check('ranked: the match ends', await until(A, () => OMF.UI.current === 's-mpresult', 25000) && await until(B, () => OMF.UI.current === 's-mpresult', 6000));
  await both(() => { clearInterval(window.__hold); clearInterval(window.__chase); });
  await wait(800);
  const board = await A.evaluate(async () => { await Net.rpc('pvp_me'); return Net.leaderboard(); });
  const board2 = await B.evaluate(async () => { await Net.rpc('pvp_me'); return Net.leaderboard(); });
  check('ranked: both reports agree → winner +16, loser −16', board2.some((r) => r.name === 'Alpha' && r.wins === 1 && r.rating === 1016) && board2.some((r) => r.name === 'Bravo' && r.losses === 1 && r.rating === 984), [board, board2]);
  await both(() => OMF.UI.action('mp-leave'));

  // ---------- friends and invites ----------
  await A.evaluate(() => { OMF.UI.action('mp'); OMF.UI.action('friends'); document.getElementById('fr-name').value = 'Bravo'; OMF.UI.action('fr-add'); });
  await B.evaluate(() => { OMF.UI.action('mp'); OMF.UI.action('friends'); });
  check('friends: the request arrives', await until(B, () => document.querySelector('#fr-list [data-action="fr-yes"]') !== null, 8000));
  await B.evaluate(() => document.querySelector('#fr-list [data-action="fr-yes"]').click());
  check('friends: accepted on both sides, online', await until(A, (id) => Social.accepted().some((f) => f.id === id) && Social.online.has(id), 8000, bid) && await until(B, (id) => Social.accepted().some((f) => f.id === id), 8000, aid));
  check('friends: the QR code is a link with the friend id', await A.evaluate(() => { OMF.UI.action('fr-qr'); return Social.friendLink().endsWith('?friend=' + Net.id) && !document.getElementById('fr-qrbox').classList.contains('hidden'); }));
  await B.evaluate(() => { OMF.UI.action('fr-back'); OMF.UI.action('mp-back'); }); // B is in the main menu
  await A.evaluate((id) => Social.inviteFriend(id), bid);
  check('invite: shows up for the friend', await until(B, () => !document.getElementById('invite').classList.contains('hidden'), 8000));
  await B.evaluate(() => OMF.UI.action('inv-yes'));
  check('invite: accepting joins the room', await until(B, (c) => MP.code === c && OMF.UI.current === 's-lobby', 8000, await A.evaluate(() => MP.code)) && await until(A, () => MP.list.length === 2, 6000));
  await A.evaluate(() => mpHostStart());
  await until(B, () => !!G.pvp, 6000);
  await A.evaluate((id) => Social.ch.send('inv', { to: id, from: Net.id, name: 'Alpha', code: 'ZZZZ' }), bid);
  await wait(600);
  check('invite: never inside a match', await B.evaluate(() => document.getElementById('invite').classList.contains('hidden') && !!G.pvp));
  await both(() => OMF.UI.action('mp-leave'));
  check('no JS errors', !errs.length, errs.slice(0, 5));
  await b.close();
  let fail = 0;
  for (const x of out) { if (x[0] !== 'PASS') fail++; console.log(x[0], x[1], x[2]); }
  console.log(fail ? fail + ' FAILED' : 'ALL ' + out.length + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
