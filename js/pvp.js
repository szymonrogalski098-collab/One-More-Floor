'use strict';
// PvP arena: 1v1 / 2v2 / 3v3 over Net (net.js).
//  - Quick play: a queue channel per size; the player waiting longest builds the match when enough are in.
//  - Friendly: a room code; the host moves players between the two teams (any split, 1v1 included).
//  - Match: first team to 3 rounds. A round ends when a whole team is down; after 35 s a storm closes in.
//  - Every player flies the ship chosen in the menu with 3 random upgrades (rolled by the host per match).
//  - Netcode: each client owns its ship and sends its state ~10x/s with the shots it fired; hits are decided
//    by the shooter (what you see is what you hit) and applied by the victim (who checks its own dash and
//    shield). The host (first to join) runs the rounds. Opponents live in G.enemies as 'pvp' proxies, so
//    auto-aim, homing and bullet collisions of the single-player game work on them unchanged.

const PVP = { target: 3, roundTime: 75, stormAt: 35, stormTime: 30, hpBase: 120, hpPerHeart: 25, countdown: 3 };
const PVP_POOL = ['power', 'rapid', 'split', 'rail', 'rubber', 'lens', 'swift', 'thruster', 'twin', 'aegis', 'vital', 'heavy', 'drill', 'rear', 'seeker', 'ember', 'cryo', 'glass', 'nova'];
const TEAM_COL = ['#4df3ff', '#ff4f6b'], TEAM_NAME = ['BLUE', 'RED'];
const MP = { ch: null, q: null, mode: null, size: 1, code: null, list: [], teams: {}, t0: 0, match: null, status: '' };

function mpName() { return (Save.data.mpName || '').trim().slice(0, 14) || 'Pilot'; }
function mpShip() { const S = Save.data; return S.ships.includes(S.ship) ? S.ship : 'striker'; }
function mpRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mpCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0]; return s; }
function mpHost() { const l = MP.list.slice().sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1)); return l[0] ? l[0].id : Net.id; }
function mpIsHost() { return mpHost() === Net.id; }

// ---------- quick play ----------
async function mpQuick(size) {
  mpLeaveAll();
  MP.mode = 'quick'; MP.size = size; MP.status = 'Signing in…'; UI.renderMp();
  try { await Net.signIn(); } catch (e) { MP.status = 'Could not connect: ' + e.message; UI.renderMp(); return; }
  const me = await Net.myStats().catch(() => null), rating = MP.rating = me ? me.rating : 1000;
  MP.status = 'Searching for ' + size + 'v' + size + '…';
  const t = Date.now();
  MP.q = Net.channel('omf-q-' + size, {
    on: { go: (m) => mpGo(m) },
    presence: (list) => {
      MP.qlist = list; UI.renderMp();
      const need = size * 2, l = list.slice().sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1));
      if (l.length >= need && l[0].id === Net.id && !MP.going) {
        // the longest waiting builds the match: snake draft by rating so the teams are even
        const g = l.slice(0, need).sort((a, b) => b.rating - a.rating), teams = {};
        g.forEach((p, i) => { teams[p.id] = [0, 1, 1, 0][i % 4]; });
        const m = { code: mpCode(), ids: g.map((p) => p.id), teams, host: Net.id };
        MP.q.send('go', m); mpGo(m);
      }
    },
  });
  await MP.q.ready;
  MP.q.track({ name: mpName(), rating, ship: mpShip(), t });
  UI.renderMp();
}
function mpGo(m) {
  if (!m.ids.includes(Net.id) || MP.going) return;
  MP.going = true;
  if (MP.q) { MP.q.leave(); MP.q = null; }
  mpJoinRoom(m.code, { teams: m.teams, expect: m.ids, t: m.host === Net.id ? 1 : 2 });
}

// ---------- friendly rooms ----------
async function mpCreate() { mpLeaveAll(); MP.mode = 'friendly'; try { await Net.signIn(); } catch (e) { MP.status = 'Could not connect: ' + e.message; UI.renderMp(); return; } mpJoinRoom(mpCode(), { t: Date.now() }); }
async function mpJoin(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) { MP.status = 'A room code has 4 characters.'; UI.renderMp(); return; }
  mpLeaveAll(); MP.mode = 'friendly';
  try { await Net.signIn(); } catch (e) { MP.status = 'Could not connect: ' + e.message; UI.renderMp(); return; }
  mpJoinRoom(code, { t: Date.now() });
}
async function mpJoinRoom(code, o) {
  MP.code = code; MP.list = []; MP.teams = o.teams || {}; MP.expect = o.expect || null; MP.match = null; MP.myT = o.t;
  MP.ch = Net.channel('omf-room-' + code, {
    on: {
      teams: (m) => { if (m.t > MP.myT) return; MP.teams = m.teams; UI.renderLobby(); }, // only from someone who joined before me (the host)
      start: (m) => mpStart(m),
      st: (m) => pvpOnState(m),
      die: (m) => pvpOnDie(m),
      round: (m) => pvpOnRound(m),
      end: (m) => pvpOnEnd(m),
      lobby: () => { if (MP.match) mpBackToLobby(); },
    },
    presence: (list) => mpOnPresence(list),
    error: (e) => { MP.status = 'Connection problem (' + e + ')'; UI.renderMp(); },
  });
  await MP.ch.ready;
  MP.ch.track({ name: mpName(), ship: mpShip(), t: o.t, rating: MP.rating || 1000 });
  UI.openLobby();
}
function mpOnPresence(list) {
  MP.list = list;
  if (mpIsHost() && !MP.match) {
    // the host keeps the teams: newcomers go to the smaller team
    for (const p of list) if (MP.teams[p.id] == null) { const a = list.filter((q) => MP.teams[q.id] === 0).length, b = list.filter((q) => MP.teams[q.id] === 1).length; MP.teams[p.id] = a <= b ? 0 : 1; }
    for (const id in MP.teams) if (!list.some((p) => p.id === id)) delete MP.teams[id];
    MP.ch.send('teams', { teams: MP.teams, t: MP.myT }); // every presence change: late joiners always catch up
    // quick play: start as soon as everybody arrived
    if (MP.expect && MP.expect.every((id) => list.some((p) => p.id === id)) && !MP.startT) MP.startT = setTimeout(() => mpHostStart(), 1200);
  }
  if (MP.match) pvpOnPresence(list);
  UI.renderLobby();
}
function mpMove(id) { // host: move a player to the other team
  if (!mpIsHost() || MP.match) return;
  MP.teams[id] = MP.teams[id] ? 0 : 1;
  MP.ch.send('teams', { teams: MP.teams, t: MP.myT }); UI.renderLobby();
}
function mpCanStart() { const ids = MP.list.map((p) => p.id); return [0, 1].every((t) => ids.some((id) => MP.teams[id] === t)); }
function mpHostStart() {
  if (!mpIsHost() || MP.match || !mpCanStart()) return;
  const seed = (Math.random() * 1e9) | 0, R = mpRand(seed ^ 0x5bd1);
  const players = MP.list.map((p) => {
    const pool = PVP_POOL.slice(), ups = [];
    for (let k = 0; k < 3; k++) ups.push(pool.splice((R() * pool.length) | 0, 1)[0]);
    return { id: p.id, name: p.name, ship: p.ship, team: MP.teams[p.id] | 0, rating: p.rating || 1000, ups };
  });
  const m = { seed, players, target: PVP.target, ranked: MP.mode === 'quick' };
  MP.ch.send('start', m); mpStart(m);
}
function mpLeaveAll() {
  if (MP.q) { MP.q.leave(); MP.q = null; }
  if (MP.ch) { MP.ch.leave(); MP.ch = null; }
  clearTimeout(MP.startT); MP.startT = 0; MP.going = false; MP.match = null; MP.expect = null; MP.list = []; MP.teams = {}; MP.qlist = null; MP.status = '';
  if (G.pvp) pvpTeardown();
}

// ---------- the match ----------
function mpStart(m) {
  if (MP.match || !m.players.some((p) => p.id === Net.id)) return;
  clearTimeout(MP.startT); MP.startT = 0;
  const me = m.players.find((p) => p.id === Net.id);
  const M = MP.match = {
    seed: m.seed, target: m.target, ranked: !!m.ranked, round: 0, score: [0, 0], phase: 'between', t: 0, roundT: 0,
    players: {}, team: me.team, outB: [], outH: [], sendT: 0, kills: 0, deaths: 0, over: false,
  };
  for (const p of m.players) M.players[p.id] = { ...p, alive: true, hp: 1, left: false, kills: 0, deaths: 0, x: 0, y: 0, tx: 0, ty: 0, a: 0, dash: false };
  // a fresh run-like state for the local ship (never touches the saved run)
  Sound.init();
  UI.stack = []; UI.show(null); UI.showHud(true);
  document.documentElement.classList.add('pvp');
  G.training = null;
  G.run = { floor: 21, pvp: true, upgrades: {}, order: [], kills: 0, shards: 0, dmg: 0, time: 0, bosses: 0, elites: 0, hurt: 0, dodges: 0, rerolls: 0, windUsed: true, ship: me.ship, asc: 0, hurtAtBoss: 0, start: 1, kitLeft: 0, kitTotal: 0, cpPending: {}, curses: [], sealed: {} };
  G.player = makePlayer();
  for (const id of me.ups) if (UPG[id]) addUpgrade(id, true);
  computeStats();
  M.maxHp = PVP.hpBase + PVP.hpPerHeart * (G.stats.maxHp - 5);
  G.scale = floorScale(1);
  resetArrays();
  pvpArena(m.seed);
  G.pvp = M;
  G.room = { type: 'pvp', phase: 'intro', t: 0, active: null, queue: [], queueT: 0 };
  // opponents become targetable proxies; teammates are only drawn
  for (const id in M.players) {
    const pl = M.players[id];
    if (id === Net.id || pl.team === M.team) continue;
    G.enemies.push(pl.proxy = { id: G.nextId++, type: 'pvp', pid: id, team: pl.team, x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, r: 8, hp: 1e9, maxHp: 1e9, color: TEAM_COL[pl.team], flash: 0, t: 0, spawnIn: 0, orbitCd: 0, slowT: 0, slowAmt: 0, burnT: 0, burnAcc: 0, burnDps: 0, dead: false, untarget: false, hits: [] });
  }
  Render.buildFloor();
  G.state = 'play'; G.fade = 1; G.fadeDir = -1;
  Sound.music(true, 'boss');
  pvpStartRound(1);
}
function pvpSpawn(team, idx) {
  const A = G.pvpArena, col = team ? A.w - 4 : 3, rows = [0.5, 0.3, 0.7];
  return { x: (col + 0.5) * T, y: A.y0 + A.h * rows[idx % 3] };
}
function pvpStartRound(n) {
  const M = G.pvp, p = G.player;
  M.round = n; M.phase = 'countdown'; M.t = 0; M.roundT = 0; M.storm = null;
  G.pb.length = 0; clearEnemyBullets();
  const byTeam = [[], []];
  for (const id of Object.keys(M.players).sort()) byTeam[M.players[id].team].push(id);
  for (const id in M.players) {
    const pl = M.players[id], sp = pvpSpawn(pl.team, byTeam[pl.team].indexOf(id));
    pl.alive = !pl.left; pl.hp = 1; pl.x = pl.tx = sp.x; pl.y = pl.ty = sp.y;
    if (pl.proxy) { pl.proxy.x = sp.x; pl.proxy.y = sp.y; pl.proxy.untarget = !pl.alive; }
    if (id === Net.id) { p.x = sp.x; p.y = sp.y; p.vx = p.vy = 0; p.face = pl.team ? Math.PI : 0; }
  }
  p.alive = true; p.dashT = 0; p.dashIfr = 0; p.dashCharges = G.stats.dashCharges; p.iframes = 0; p.fireT = 0.3;
  if (G.stats.aegis > 0) { p.shield = 1; p.shieldT = 0; }
  M.hp = M.maxHp; M.prot = 0;
  Render.snapCamera();
  showBanner('ROUND ' + n, TEAM_NAME[0] + ' ' + M.score[0] + ' : ' + M.score[1] + ' ' + TEAM_NAME[1], 'boss');
}
function pvpArena(seed) {
  const R = mpRand(seed), w = 44, h = 26;
  makeGrid(w, h + 2);
  carve(1, 1, w - 2, h);
  const room = { id: 0, kind: 'exit', state: 'clear', gates: [], ...tileRect(1, 1, w - 2, h) };
  G.rooms = [room]; G.halls = []; G.traps = []; G.stairs = []; G.arrival = null; G.exitRoom = room; G.pillars = [];
  // cover, mirrored left/right so both teams get the same arena
  const n = 6 + ((R() * 3) | 0);
  for (let k = 0; k < n; k++) {
    const bw = 1 + ((R() * 3) | 0), bh = 1 + ((R() * 3) | 0), x = 6 + ((R() * (w / 2 - 9)) | 0), y = 3 + ((R() * (h - 6 - bh)) | 0);
    for (const xx of [x, w - x - bw]) { fillSolid(xx, y, bw, bh); G.pillars.push({ ...tileRect(xx, y, bw, bh), crate: bw * bh === 1 }); }
  }
  G.pvpArena = { w, h, y0: T, cx: (w * T) / 2, cy: T + (h * T) / 2, R: Math.hypot(w, h) * T * 0.5 };
  G.spawn = { x: 4 * T, y: G.pvpArena.cy };
  G.gridVer++;
}

// ---------- per frame ----------
function pvpStep(dt) {
  const M = G.pvp, p = G.player;
  M.t += dt;
  if (M.phase === 'countdown' && M.t >= PVP.countdown) { M.phase = 'fight'; M.t = 0; M.prot = 1.0; sfx('door'); }
  G.room.phase = M.phase === 'fight' ? 'fight' : 'intro';
  if (M.phase === 'fight') {
    M.roundT += dt; M.prot = Math.max(0, M.prot - dt);
    if (p.alive) updatePlayer(dt);
    pvpStorm(dt);
  } else if (M.phase === 'countdown' && p.alive) { Input.consumeDash(); }
  // teammates and opponents glide to their last reported position
  const k = Math.min(1, dt * 14);
  for (const id in M.players) { const pl = M.players[id]; if (id === Net.id) continue; pl.x += (pl.tx - pl.x) * k; pl.y += (pl.ty - pl.y) * k; }
  updateEnemies(dt);
  updatePlayerBullets(dt);
  updateEnemyBullets(dt);
  for (let i = G.enemies.length - 1; i >= 0; i--) if (G.enemies[i].dead) swapRemove(G.enemies, i);
  // network: my state ~10x/s (fewer with more players: the free tier counts messages)
  M.sendT -= dt;
  if (M.sendT <= 0 && MP.ch) {
    const n = Object.keys(M.players).length;
    M.sendT = n <= 2 ? 0.08 : n <= 4 ? 0.11 : 0.14;
    const me = M.players[Net.id];
    MP.ch.send('st', { id: Net.id, x: Math.round(p.x), y: Math.round(p.y), a: +(p.aim || 0).toFixed(2), hp: +(M.hp / M.maxHp).toFixed(3), alive: p.alive, dash: p.dashT > 0, b: M.outB.splice(0, 40), h: M.outH.splice(0) });
    if (me) { me.x = p.x; me.y = p.y; me.hp = M.hp / M.maxHp; }
  }
  if (mpIsHost()) pvpHost(dt);
  UI.pvpHud();
}
// after 35 s the storm closes in: outside the circle you lose HP
function pvpStorm(dt) {
  const M = G.pvp, A = G.pvpArena, p = G.player;
  if (M.roundT < PVP.stormAt) return;
  const k = Math.min(1, (M.roundT - PVP.stormAt) / PVP.stormTime);
  M.storm = { x: A.cx, y: A.cy, r: A.R * (1 - k) + 70 * k };
  if (p.alive && dist2(p.x, p.y, M.storm.x, M.storm.y) > M.storm.r * M.storm.r) {
    M.stormAcc = (M.stormAcc || 0) + dt;
    if (M.stormAcc >= 0.25) { M.stormAcc = 0; pvpTakeHit(M.maxHp * 0.03, null, true); }
  }
}
function pvpHost(dt) {
  const M = G.pvp;
  if (M.phase !== 'fight' || M.over || M.ending) return;
  const alive = [0, 0];
  for (const id in M.players) { const pl = M.players[id]; if (pl.alive && !pl.left) alive[pl.team]++; }
  if (!alive[0] || !alive[1]) { pvpEndRound(alive[0] ? 0 : alive[1] ? 1 : -1); return; }
  if (M.roundT > PVP.roundTime) { // time: the team with more HP left
    const hp = [0, 0];
    for (const id in M.players) { const pl = M.players[id]; if (pl.alive && !pl.left) hp[pl.team] += pl.hp; }
    pvpEndRound(hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1);
  }
}
function pvpEndRound(w) {
  const M = G.pvp;
  M.ending = true;
  const score = M.score.slice(); if (w >= 0) score[w]++;
  const m = { winner: w, score, next: M.round + 1 };
  MP.ch.send('round', m); pvpOnRound(m);
  if (w >= 0 && score[w] >= M.target) { const e = { winner: w, score }; setTimeout(() => { if (MP.ch) MP.ch.send('end', e); pvpOnEnd(e); }, 900); }
}

// ---------- shots and hits ----------
// spawnPB / damageEnemy call these when G.pvp is on
function pvpShot(b, ang, sp) { const M = G.pvp; if (M.outB.length < 60) M.outB.push([Math.round(b.x), Math.round(b.y), +ang.toFixed(3), Math.round(sp), +b.r.toFixed(1), b.life ? +b.life.toFixed(2) : 1]); }
function pvpHitProxy(e, dmg, crit) {
  const M = G.pvp, pl = M.players[e.pid];
  if (!pl || !pl.alive || M.phase !== 'fight') return;
  M.outH.push([e.pid, Math.round(dmg * 10) / 10, crit ? 1 : 0]);
  e.flash = 0.08;
  if (crit) floatText(e.x + rand(-6, 6), e.y - 14, String(Math.round(dmg)), COL.pCrit, 12, 0.5);
  sparks(e.x, e.y, 0, TAU, crit ? COL.pCrit : TEAM_COL[pl.team], crit ? 4 : 2, 120);
  sfx(crit ? 'crit' : 'hit');
}
function pvpTakeHit(dmg, by, storm) {
  const M = G.pvp, p = G.player;
  if (!p.alive || M.phase !== 'fight') return;
  if (!storm) {
    if (M.prot > 0 || p.dashIfr > 0) return; // spawn protection / a dash dodges
    if (p.shield > 0) { p.shield = 0; p.shieldT = G.stats.aegisCd; ring(p.x, p.y, 6, 26, 0.3, '#9fd8ff', 3); sfx('shield'); return; }
  }
  M.hp -= dmg;
  G.flash = Math.max(G.flash || 0, 0.3); addShake(0.12); if (!storm) sfx('hurt');
  if (M.hp <= 0) {
    M.hp = 0; p.alive = false; M.deaths++;
    burst(p.x, p.y, COL.player, 30, 220, 0.8, 4); sfx('death');
    const m = { id: Net.id, by: by || null };
    MP.ch && MP.ch.send('die', m); pvpOnDie(m);
  }
}
function pvpOnState(m) {
  const M = G.pvp; if (!M) return;
  const pl = M.players[m.id]; if (!pl) return;
  pl.tx = m.x; pl.ty = m.y; pl.a = m.a; pl.hp = m.hp; pl.dash = m.dash;
  for (const b of m.b || []) fireEB(b[0], b[1], b[2], b[3], { color: TEAM_COL[pl.team], r: Math.max(3, b[4]), life: b[5] || 1, fake: true });
  for (const h of m.h || []) if (h[0] === Net.id) pvpTakeHit(h[1], m.id);
}
function pvpOnDie(m) {
  const M = G.pvp; if (!M) return;
  const pl = M.players[m.id]; if (!pl || !pl.alive && m.id !== Net.id) return;
  pl.alive = false; pl.deaths++;
  if (pl.proxy) { pl.proxy.untarget = true; burst(pl.proxy.x, pl.proxy.y, TEAM_COL[pl.team], 30, 220, 0.8, 4); }
  if (m.by && M.players[m.by]) M.players[m.by].kills++;
  if (m.by === Net.id) { M.kills++; floatText(G.player.x, G.player.y - 26, 'KILL · ' + pl.name.toUpperCase(), COL.gold, 13, 1.2); sfx('kill'); }
  UI.pvpFeed((m.by && M.players[m.by] ? M.players[m.by].name : 'The storm') + ' ✕ ' + pl.name);
}
function pvpOnRound(m) {
  const M = G.pvp; if (!M) return;
  M.score = m.score; M.phase = 'between'; M.ending = false;
  const mine = m.winner === M.team;
  showBanner(m.winner < 0 ? 'DRAW' : TEAM_NAME[m.winner] + ' TAKES THE ROUND', TEAM_NAME[0] + ' ' + m.score[0] + ' : ' + m.score[1] + ' ' + TEAM_NAME[1], m.winner < 0 ? 'rest' : mine ? 'combat' : 'boss');
  if (Math.max(m.score[0], m.score[1]) >= M.target) return;
  clearTimeout(M.nextT); M.nextT = setTimeout(() => { if (G.pvp === M && !M.over) pvpStartRound(m.next); }, 2600);
}
async function pvpOnEnd(m) {
  const M = G.pvp; if (!M || M.over) return;
  M.over = true; M.phase = 'over'; clearTimeout(M.nextT);
  const won = m.winner === M.team;
  const opp = Object.values(M.players).filter((p) => p.team !== M.team);
  const result = { won, score: m.score, team: M.team, kills: M.kills, deaths: M.deaths, ranked: M.ranked, players: Object.values(M.players) };
  try {
    const r = await Net.report({ name: mpName(), won, kills: M.kills, deaths: M.deaths, oppRating: opp.length ? Math.round(opp.reduce((a, p) => a + (p.rating || 1000), 0) / opp.length) : 1000, ranked: M.ranked, opp: opp.length });
    result.rating = r && (r.rating != null ? r.rating : r[0] && r[0].rating);
  } catch (e) { result.reportError = e.message; }
  setTimeout(() => { if (G.pvp === M) UI.showPvpResult(result); }, 1200);
}
function pvpOnPresence(list) {
  const M = G.pvp; if (!M) return;
  for (const id in M.players) {
    const there = list.some((p) => p.id === id);
    if (!there && !M.players[id].left) { M.players[id].left = true; M.players[id].alive = false; if (M.players[id].proxy) M.players[id].proxy.untarget = true; UI.pvpFeed(M.players[id].name + ' left'); }
  }
}
// opponent proxies follow their owner's reports smoothly
AI.pvp = function (e, dt) {
  const M = G.pvp, pl = M && M.players[e.pid];
  if (!pl) return;
  const k = Math.min(1, dt * 14);
  e.x += (pl.tx - e.x) * k; e.y += (pl.ty - e.y) * k; e.vx = e.vy = 0; e.kx = e.ky = 0;
  e.untarget = !pl.alive;
};
function pvpTeardown() {
  document.documentElement.classList.remove('pvp');
  G.pvp = null; G.pvpArena = null; G.enemies.length = 0; G.eb.length = 0; G.pb.length = 0;
}
function mpBackToLobby() { // friendly: everybody back to the room
  pvpTeardown(); MP.match = null; G.state = 'menu';
  UI.showHud(false); Sound.music(false);
  UI.openLobby();
}
function mpLeave() { mpLeaveAll(); UI.showHud(false); Sound.music(false); goMenu(); }
