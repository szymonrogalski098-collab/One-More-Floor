'use strict';
// PvP arena: 1v1 / 2v2 / 3v3 over Net (net.js).
//  - Modes: RANKED (players only, Google accounts, rating), CASUAL (bots fill the empty seats after 10 s),
//    ROOM (a code to share; the host moves players between teams and can add bots).
//  - Match: first team to 3 rounds. A round ends when a whole team is down; after 35 s a storm closes in.
//    One team spawns at the bottom, the other at the top; the arena is point-symmetric.
//  - Every player flies the ship chosen in the menu with 3 random upgrades (rolled by the host per match).
//  - Netcode: each client owns its ship and sends its state ~10x/s with the shots it fired and the hits it
//    scored. The host (the earliest player still answering) runs the rounds, simulates the bots and every
//    second broadcasts the match state, so a player whose phone slept catches up instead of drifting.
//  - Anti-cheat (every client checks the others): hits need a plausible damage, rate, range and line of
//    sight; movement needs a plausible speed. The host also keeps its own HP ledger for everyone from the
//    public hits: whoever ignores lethal damage is declared dead by the host. Repeat offenders are removed.

const PVP = { target: 3, roundTime: 75, stormAt: 35, stormTime: 30, hpBase: 120, hpPerHeart: 25, countdown: 3, botWait: 10, awayDie: 5, kickAt: 8 };
const PVP_POOL = ['power', 'rapid', 'split', 'rail', 'rubber', 'lens', 'swift', 'thruster', 'twin', 'aegis', 'vital', 'heavy', 'drill', 'rear', 'seeker', 'ember', 'cryo', 'glass', 'nova'];
const TEAM_COL = ['#4df3ff', '#ff4f6b'], TEAM_NAME = ['BLUE', 'RED'];
const MP_MODES = {
  ranked: { name: 'RANKED', sub: 'Players only · rating · Google account', col: '#ffd34d' },
  casual: { name: 'CASUAL', sub: 'No rating · bots join after 10 s', col: '#4df3ff' },
  room: { name: 'FRIENDLY ROOM', sub: 'Share a code · pick the teams · add bots', col: '#c792ff' },
};
const BOT_NAMES = ['Vega', 'Orion', 'Nyx', 'Kestrel', 'Rook', 'Pike', 'Juno', 'Echo', 'Flint', 'Sable', 'Wren', 'Atlas'];
const MP = { ch: null, q: null, mode: null, size: 1, code: null, list: [], teams: {}, bots: [], match: null, status: '' };

function mpName() { return Social.me ? Social.me.name : (Save.data.mpName || '').trim().slice(0, 14) || 'Pilot'; }
function mpShip() { const S = Save.data; return S.ships.includes(S.ship) ? S.ship : 'striker'; }
function mpRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mpCode(n = 4) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += A[(Math.random() * A.length) | 0]; return s; }
// host: the earliest player in the room; during a match only players who are still answering count
function mpHost() {
  const M = G.pvp, now = performance.now();
  let l = MP.list.slice();
  if (M) l = l.filter((p) => p.id === Net.id || (M.players[p.id] && !M.players[p.id].left && now - M.players[p.id].seen < 3000));
  l.sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1));
  return l[0] ? l[0].id : Net.id;
}
// offline (my socket is dead, not theirs) I am nobody's host: no deciding rounds from a bubble
function mpIsHost() { return mpHost() === Net.id && (!G.pvp || Net.online()); }
function mpMakeBot(team, taken) {
  const names = BOT_NAMES.filter((n) => !taken.includes('Bot ' + n)), ships = SHIPS.map((s) => s.id);
  return { id: 'B' + mpCode(6), name: 'Bot ' + (names[(Math.random() * names.length) | 0] || 'X'), ship: ships[(Math.random() * ships.length) | 0], team, bot: true };
}
function mpAllNames() { return MP.list.map((p) => p.name).concat(MP.bots.map((b) => b.name)); }

// ---------- matchmaking (ranked / casual) ----------
async function mpQueue(mode, size) {
  mpLeaveAll();
  MP.mode = mode; MP.size = size; MP.status = 'Connecting…'; MP.qT = Date.now(); UI.renderMp();
  try { await Net.signIn(); } catch (e) { MP.status = 'Could not connect: ' + e.message; MP.mode = null; UI.renderMp(); return; }
  if (mode === 'ranked' && !Social.me) { MP.status = 'Ranked needs a Google account and a pilot name.'; MP.mode = null; UI.renderMp(); return; }
  MP.rating = Social.me ? Social.me.rating : 1000;
  MP.qlist = null;
  const q = MP.q = Net.channel('omf-' + (mode === 'ranked' ? 'q' : 'c') + '-' + size, {
    on: { go: (m) => mpGo(m) },
    presence: (list) => { MP.qlist = list; mpQueueCheck(); UI.renderMp(); },
  });
  await q.ready;
  if (MP.q !== q) return;
  q.track({ name: mpName(), rating: MP.rating, ship: mpShip(), t: MP.qT });
  clearInterval(MP.qTick); MP.qTick = setInterval(() => { mpQueueCheck(); UI.renderMp(); }, 500);
  UI.renderMp();
}
function mpQueueCheck() {
  if (!MP.q || MP.going) return;
  const need = MP.size * 2, l = (MP.qlist || []).slice();
  if (!l.some((p) => p.id === Net.id)) l.push({ id: Net.id, t: MP.qT, rating: MP.rating });
  l.sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1));
  if (l[0].id !== Net.id) return; // the one waiting longest builds the match
  const waited = (Date.now() - MP.qT) / 1000;
  if (l.length < need && !(MP.mode === 'casual' && waited >= PVP.botWait)) return;
  // snake draft by rating so the teams are even; bots fill the empty seats (casual)
  const g = l.slice(0, need).sort((a, b) => b.rating - a.rating), teams = {}, count = [0, 0];
  g.forEach((p, i) => { let t = [0, 1, 1, 0][i % 4]; if (count[t] >= MP.size) t = 1 - t; teams[p.id] = t; count[t]++; });
  const bots = [];
  for (const t of [0, 1]) while (count[t] < MP.size) { bots.push(mpMakeBot(t, bots.map((b) => b.name))); count[t]++; }
  const m = { code: mpCode(6), ids: g.map((p) => p.id), teams, bots, host: Net.id, mode: MP.mode };
  MP.q.send('go', m); mpGo(m);
}
function mpGo(m) {
  if (!m.ids.includes(Net.id) || MP.going) return;
  MP.going = true;
  clearInterval(MP.qTick);
  if (MP.q) { MP.q.leave(); MP.q = null; }
  mpJoinRoom(m.code, { teams: m.teams, bots: m.bots, expect: m.ids, t: m.host === Net.id ? 1 : 2, mode: m.mode });
}

// ---------- rooms ----------
async function mpCreate() {
  mpLeaveAll(); MP.mode = 'room';
  try { await Net.signIn(); } catch (e) { MP.status = 'Could not connect: ' + e.message; MP.mode = null; UI.renderMp(); return false; }
  await mpJoinRoom(mpCode(), { t: Date.now(), mode: 'room' });
  return true;
}
async function mpJoin(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4 && code.length !== 6) { MP.status = 'A room code has 4 characters.'; UI.renderMp(); return; }
  mpLeaveAll(); MP.mode = 'room';
  try { await Net.signIn(); } catch (e) { MP.status = 'Could not connect: ' + e.message; MP.mode = null; UI.renderMp(); return; }
  mpJoinRoom(code, { t: Date.now(), mode: 'room' });
}
async function mpJoinRoom(code, o) {
  MP.code = code; MP.list = []; MP.teams = o.teams || {}; MP.bots = o.bots || []; MP.expect = o.expect || null; MP.match = null; MP.myT = o.t; MP.mode = o.mode;
  const fromHost = (m) => m.from === mpHost();
  const ch = MP.ch = Net.channel('omf-room-' + code, {
    on: {
      teams: (m) => { if (m.t > MP.myT || G.pvp) return; MP.teams = m.teams; MP.bots = m.bots || []; UI.renderLobby(); }, // only from someone who joined before me (the host)
      start: (m) => { if (fromHost(m)) mpStart(m); },
      st: (m) => pvpOnState(m),
      die: (m) => pvpOnDie(m),
      round: (m) => { if (fromHost(m)) pvpOnRound(m); },
      end: (m) => { if (fromHost(m)) pvpOnEnd(m); },
      sync: (m) => { if (fromHost(m)) pvpOnSync(m); },
      hi: () => { if (G.pvp && mpIsHost()) pvpSendSync(); },
      kick: (m) => { if (fromHost(m)) pvpOnKick(m); },
      bye: (m) => pvpOnBye(m),
      lobby: (m) => { if (MP.match && fromHost(m)) mpBackToLobby(); },
    },
    presence: (list) => mpOnPresence(list),
    error: (e) => { MP.status = 'Connection problem (' + e + ')'; UI.renderMp(); },
  });
  await ch.ready;
  if (MP.ch !== ch) return;
  ch.track({ name: mpName(), ship: mpShip(), t: o.t, rating: MP.rating || 1000 });
  Social.track();
  UI.openLobby();
}
function mpOnPresence(list) {
  MP.list = list;
  if (!G.pvp && mpIsHost() && !MP.match) {
    // the host keeps the teams: newcomers go to the smaller team
    const size = (t) => list.filter((q) => MP.teams[q.id] === t).length + MP.bots.filter((b) => b.team === t).length;
    for (const p of list) if (MP.teams[p.id] == null) MP.teams[p.id] = size(0) <= size(1) ? 0 : 1;
    for (const id in MP.teams) if (!list.some((p) => p.id === id)) delete MP.teams[id];
    mpSendTeams(); // every presence change: late joiners always catch up
    // matchmaking: start as soon as everybody arrived
    if (MP.expect && MP.expect.every((id) => list.some((p) => p.id === id)) && !MP.startT) MP.startT = setTimeout(() => mpHostStart(), 1200);
  }
  if (G.pvp) pvpOnPresence(list);
  UI.renderLobby();
}
function mpSendTeams() { if (MP.ch) MP.ch.send('teams', { teams: MP.teams, bots: MP.bots, t: MP.myT }); }
function mpMove(id) { // host: move a player to the other team (a bot is removed instead)
  if (!mpIsHost() || MP.match || MP.mode !== 'room') return;
  if (MP.bots.some((b) => b.id === id)) MP.bots = MP.bots.filter((b) => b.id !== id);
  else MP.teams[id] = MP.teams[id] ? 0 : 1;
  mpSendTeams(); UI.renderLobby();
}
function mpAddBot(team) {
  if (!mpIsHost() || MP.match || MP.mode !== 'room') return;
  const n = MP.list.filter((p) => MP.teams[p.id] === team).length + MP.bots.filter((b) => b.team === team).length;
  if (n >= 3) return;
  MP.bots.push(mpMakeBot(team, mpAllNames()));
  mpSendTeams(); UI.renderLobby();
}
function mpCanStart() {
  const ids = MP.list.map((p) => p.id);
  return [0, 1].every((t) => ids.some((id) => MP.teams[id] === t) || MP.bots.some((b) => b.team === t));
}
function mpHostStart() {
  if (!mpIsHost() || MP.match || !mpCanStart()) return;
  const seed = (Math.random() * 1e9) | 0, R = mpRand(seed ^ 0x5bd1);
  const roll = () => { const pool = PVP_POOL.slice(), ups = []; for (let k = 0; k < 3; k++) ups.push(pool.splice((R() * pool.length) | 0, 1)[0]); return ups; };
  const humans = MP.list.filter((p) => MP.teams[p.id] != null).map((p) => ({ id: p.id, name: p.name, ship: p.ship, team: MP.teams[p.id] | 0, rating: p.rating || 1000, ups: roll() }));
  const bots = MP.bots.map((b) => ({ ...b, rating: 1000, ups: roll() }));
  const ranked = MP.mode === 'ranked' && !bots.length;
  const m = { seed, players: humans.concat(bots), target: PVP.target, mode: MP.mode, ranked, mid: ranked ? 'm-' + mpCode(16) : null, from: Net.id };
  MP.ch.send('start', m); mpStart(m);
}
function mpLeaveAll() {
  clearInterval(MP.qTick);
  if (MP.q) { MP.q.leave(); MP.q = null; }
  if (MP.ch) { if (G.pvp) MP.ch.send('bye', { id: Net.id }); MP.ch.leave(); MP.ch = null; }
  clearTimeout(MP.startT); MP.startT = 0; MP.going = false; MP.match = null; MP.expect = null; MP.list = []; MP.teams = {}; MP.bots = []; MP.qlist = null; MP.status = ''; MP.code = null;
  if (G.pvp) pvpTeardown();
  Social.track();
}

// ---------- stats of any ship + upgrades (PvP ignores the Workshop, so every client can compute everybody's) ----------
function pvpStats(ship, ups) {
  const keepRun = G.run, keepStats = G.stats, keepP = G.player, upgrades = {};
  for (const id of ups) if (UPG[id]) upgrades[id] = (upgrades[id] | 0) + 1;
  G.run = { ...(keepRun || {}), pvp: true, ship, upgrades, sealed: {}, curses: [], asc: 0, bonusHp: 0 }; G.player = null;
  const s = computeStats();
  G.run = keepRun; G.stats = keepStats; G.player = keepP;
  return s;
}
function pvpMaxHp(s) { return PVP.hpBase + PVP.hpPerHeart * (s.maxHp - 5); }

// ---------- the match ----------
function mpStart(m) {
  if (MP.match || !m.players.some((p) => p.id === Net.id)) return;
  clearTimeout(MP.startT); MP.startT = 0;
  const me = m.players.find((p) => p.id === Net.id);
  const M = MP.match = {
    seed: m.seed, target: m.target, mode: m.mode, ranked: !!m.ranked, mid: m.mid, round: 0, score: [0, 0], phase: 'between', t: 0, roundT: 0, clock: 0,
    players: {}, team: me.team, outB: [], outH: [], sendT: 0, syncT: 0, kills: 0, deaths: 0, over: false, hist: [], bb: [], wait: false,
  };
  const now = performance.now();
  for (const p of m.players) {
    const st = pvpStats(p.ship, p.ups);
    M.players[p.id] = { ...p, st, maxHp: pvpMaxHp(st), alive: true, hp: 1, left: false, seen: now, kills: 0, deaths: 0, x: 0, y: 0, tx: 0, ty: 0, a: 0, dash: false, sh: false, hist: [], win: [], viol: 0, lhp: 0, outB: [], outH: [] };
  }
  // a fresh run-like state for the local ship (never touches the saved run)
  Sound.init();
  UI.stack = []; UI.show(null); UI.showHud(true); UI.hideInvite();
  document.documentElement.classList.add('pvp');
  G.training = null;
  G.run = { floor: 21, pvp: true, upgrades: {}, order: [], kills: 0, shards: 0, dmg: 0, time: 0, bosses: 0, elites: 0, hurt: 0, dodges: 0, rerolls: 0, windUsed: true, ship: me.ship, asc: 0, hurtAtBoss: 0, start: 1, kitLeft: 0, kitTotal: 0, cpPending: {}, curses: [], sealed: {} };
  G.player = makePlayer();
  for (const id of me.ups) if (UPG[id]) addUpgrade(id, true);
  computeStats();
  M.maxHp = pvpMaxHp(G.stats);
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
  Social.track();
  Net.fast(true);
  pvpStartRound(1);
  if (M.ranked) { // the server only counts a match every player registered
    const ids = m.players.map((p) => p.id).sort();
    Net.rpc('pvp_start', { p_match: M.mid, p_players: ids, p_teams: ids.map((id) => M.players[id].team) })
      .catch((e) => { M.ranked = false; M.rankNote = e.message; UI.pvpFeed('Not ranked: ' + e.message); });
  }
}
function pvpSpawn(team, idx) {
  const A = G.pvpArena, dx = [0, -3, 3][idx % 3] * T;
  return { x: A.cx + dx, y: team ? A.y0 + 2.5 * T : A.y0 + A.h - 2.5 * T };
}
function pvpStartRound(n) {
  const M = G.pvp, p = G.player;
  M.round = n; M.phase = 'countdown'; M.t = 0; M.roundT = 0; M.storm = null; M.ending = false;
  G.pb.length = 0; clearEnemyBullets(); M.bb.length = 0; M.hist.length = 0;
  const byTeam = [[], []];
  for (const id of Object.keys(M.players).sort()) byTeam[M.players[id].team].push(id);
  for (const id in M.players) {
    const pl = M.players[id], sp = pvpSpawn(pl.team, byTeam[pl.team].indexOf(id));
    pl.alive = !pl.left; pl.hp = 1; pl.x = pl.tx = sp.x; pl.y = pl.ty = sp.y; pl.a = pl.team ? Math.PI / 2 : -Math.PI / 2;
    pl.lhp = pl.maxHp; pl.lowT = 0; pl.hist.length = 0; pl.anchor = null; pl.win.length = 0; pl.shBlock = -99; pl.sim = null; pl.outB.length = 0; pl.outH.length = 0;
    if (pl.proxy) { pl.proxy.x = sp.x; pl.proxy.y = sp.y; pl.proxy.untarget = !pl.alive; }
    if (id === Net.id) { p.x = sp.x; p.y = sp.y; p.vx = p.vy = 0; p.face = p.aim = pl.a; }
  }
  p.alive = true; p.dashT = 0; p.dashIfr = 0; p.dashCharges = G.stats.dashCharges; p.iframes = 0; p.fireT = 0.3; p.trail.length = 0;
  if (G.stats.aegis > 0) { p.shield = 1; p.shieldT = 0; }
  M.hp = M.maxHp; M.prot = 0;
  Render.snapCamera();
  showBanner('ROUND ' + n, TEAM_NAME[0] + ' ' + M.score[0] + ' : ' + M.score[1] + ' ' + TEAM_NAME[1], 'boss');
}
// 30x40 tiles, point-symmetric (turned 180°, the top team sees what the bottom team sees)
function pvpArena(seed) {
  const R = mpRand(seed), w = 30, h = 40;
  makeGrid(w + 2, h + 2);
  carve(1, 1, w, h);
  const room = { id: 0, kind: 'exit', state: 'clear', gates: [], ...tileRect(1, 1, w, h) };
  G.rooms = [room]; G.halls = []; G.traps = []; G.stairs = []; G.arrival = null; G.exitRoom = room; G.pillars = [];
  const used = [];
  const put = (x, y, bw, bh) => {
    const pairs = [[x, y], [w + 2 - x - bw, h + 2 - y - bh]];
    if (pairs[0][0] === pairs[1][0] && pairs[0][1] === pairs[1][1]) pairs.pop(); // the centre piece is its own mirror
    for (const [px, py] of pairs) if (used.some((u) => px < u[0] + u[2] + 1 && px + bw + 1 > u[0] && py < u[1] + u[3] + 1 && py + bh + 1 > u[1])) return;
    for (const [px, py] of pairs) { fillSolid(px, py, bw, bh); used.push([px, py, bw, bh]); G.pillars.push({ ...tileRect(px, py, bw, bh), crate: bw * bh === 1 }); }
  };
  put(w / 2, h / 2, 2, 2); // the middle: no straight line between the two spawns
  put(w / 2 - 5, h - 9, 3, 1); // first cover in front of each spawn
  put(w / 2 + 4, h - 9, 3, 1);
  const n = 8 + ((R() * 4) | 0);
  for (let k = 0, tries = 0; k < n && tries < 80; tries++) {
    const bw = 1 + ((R() * 3) | 0), bh = 1 + ((R() * 3) | 0), x = 2 + ((R() * (w - 3 - bw)) | 0), y = 7 + ((R() * (h / 2 - 7 - bh)) | 0);
    const before = used.length; put(x, y, bw, bh); if (used.length > before) k++;
  }
  G.pvpArena = { w: w * T, h: h * T, x0: T, y0: T, cx: T + (w * T) / 2, cy: T + (h * T) / 2, R: Math.hypot(w, h) * T * 0.5 };
  G.spawn = { x: G.pvpArena.cx, y: G.pvpArena.y0 + G.pvpArena.h - 2.5 * T };
  G.gridVer++;
}

// ---------- per frame ----------
function pvpStep(dt) {
  const M = G.pvp, p = G.player, now = performance.now();
  if (M.wait) { // back from the background: wait for the host's state before moving
    M.waitT += dt;
    if (M.waitT > 5) M.wait = false; // nobody answers: the others are gone, carry on
    UI.pvpHud();
    return;
  }
  // lost the connection without going to the background (tunnel, wifi switch): catch up when it is back
  if (!Net.online()) M.offT = (M.offT || 0) + dt;
  else if (M.offT > 1.5) { M.offT = 0; pvpWake(9999); return; }
  else M.offT = 0;
  M.t += dt; M.clock += dt;
  if (M.phase === 'countdown' && M.t >= PVP.countdown) { M.phase = 'fight'; M.t = 0; M.prot = 1.0; sfx('door'); }
  G.room.phase = M.phase === 'fight' ? 'fight' : 'intro';
  const host = mpIsHost();
  if (M.phase === 'fight') {
    M.roundT += dt; M.prot = Math.max(0, M.prot - dt);
    if (p.alive) updatePlayer(dt);
    pvpStorm(dt);
  } else if (M.phase === 'countdown' && p.alive) { Input.consumeDash(); }
  M.hist.push({ x: p.x, y: p.y, t: M.clock }); while (M.hist.length && M.clock - M.hist[0].t > 1.2) M.hist.shift();
  // teammates and opponents glide to their last reported position (bots: the host moves them itself)
  const k = Math.min(1, dt * 14);
  for (const id in M.players) {
    const pl = M.players[id];
    if (id === Net.id) continue;
    if (pl.bot && host) continue;
    pl.x += (pl.tx - pl.x) * k; pl.y += (pl.ty - pl.y) * k;
  }
  if (host) pvpBots(dt);
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
    const msg = { id: Net.id, r: M.round, x: Math.round(p.x), y: Math.round(p.y), a: +(p.aim || 0).toFixed(2), hp: +(M.hp / M.maxHp).toFixed(3), al: p.alive, d: p.dashIfr > 0, sh: p.shield > 0, b: M.outB.splice(0, 40), h: M.outH.splice(0) };
    if (host) {
      const bots = [];
      for (const id in M.players) { const pl = M.players[id]; if (!pl.bot) continue; bots.push({ id, r: M.round, x: Math.round(pl.x), y: Math.round(pl.y), a: +pl.a.toFixed(2), hp: +pl.hp.toFixed(3), al: pl.alive, d: pl.dash, sh: !!(pl.sim && pl.sim.shield), b: pl.outB.splice(0, 30), h: pl.outH.splice(0) }); }
      if (bots.length) msg.bots = bots;
    }
    MP.ch.send('st', msg);
    if (me) { me.x = p.x; me.y = p.y; me.hp = M.hp / M.maxHp; me.seen = now; }
  }
  if (host) pvpHost(dt);
  UI.pvpHud();
}
// after 35 s the storm closes in: outside the circle you lose HP
function pvpStormNow() {
  const M = G.pvp, A = G.pvpArena;
  if (M.roundT < PVP.stormAt) return null;
  const k = Math.min(1, (M.roundT - PVP.stormAt) / PVP.stormTime);
  return { x: A.cx, y: A.cy, r: A.R * (1 - k) + 70 * k };
}
function pvpStorm(dt) {
  const M = G.pvp, p = G.player;
  M.storm = pvpStormNow();
  if (!M.storm) return;
  M.stormAcc = (M.stormAcc || 0) + dt;
  if (M.stormAcc < 0.25) return;
  M.stormAcc = 0;
  const out = (x, y, pad) => dist2(x, y, M.storm.x, M.storm.y) > (M.storm.r + pad) ** 2;
  if (p.alive && out(p.x, p.y, 0)) pvpTakeHit(M.maxHp * 0.03, null, true);
  if (!mpIsHost()) return;
  for (const id in M.players) { // the host's ledger and the bots take the storm too
    const pl = M.players[id];
    if (id === Net.id || !pl.alive || !out(pl.x, pl.y, 24)) continue;
    if (pl.bot) pvpBotHit(pl, pl.maxHp * 0.03, null, true); else pl.lhp -= pl.maxHp * 0.03;
  }
}
function pvpHost(dt) {
  const M = G.pvp, now = performance.now();
  // the match state for everybody (and whoever just came back)
  M.syncT -= dt;
  if (M.syncT <= 0) { M.syncT = 1; pvpSendSync(); }
  if (M.over || M.ending) return;
  if (M.phase === 'fight') {
    for (const id in M.players) {
      const pl = M.players[id];
      if (pl.bot || id === Net.id || !pl.alive) continue;
      // silent too long (phone locked, app in the background): out for this round
      if (now - pl.seen > PVP.awayDie * 1000) { pvpForceDie(pl, null); continue; }
      // ignored lethal damage: the host's ledger says dead
      if (pl.lhp <= -0.2 * pl.maxHp) { pl.lowT += dt; if (pl.lowT > 1.5) { pl.viol += 2; pvpForceDie(pl, pl.lastBy || null); } } else pl.lowT = 0;
    }
    for (const id in M.players) { const pl = M.players[id]; if (!pl.left && pl.viol >= PVP.kickAt && !pl.bot && id !== Net.id) pvpKick(pl); }
    const alive = [0, 0];
    for (const id in M.players) { const pl = M.players[id]; if (pl.alive && !pl.left) alive[pl.team]++; }
    if (!alive[0] || !alive[1]) { pvpEndRound(alive[0] ? 0 : alive[1] ? 1 : -1); return; }
    if (M.roundT > PVP.roundTime) { // time: the team with more HP left
      const hp = [0, 0];
      for (const id in M.players) { const pl = M.players[id]; if (pl.alive && !pl.left) hp[pl.team] += pl.hp; }
      pvpEndRound(hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1);
    }
  }
}
function pvpSendSync() {
  const M = G.pvp; if (!M || !MP.ch) return;
  const dead = [], left = [];
  for (const id in M.players) { const pl = M.players[id]; if (id === Net.id ? !G.player.alive : !pl.alive) dead.push(id); if (pl.left) left.push(id); }
  MP.ch.send('sync', { from: Net.id, r: M.round, ph: M.phase, t: +M.t.toFixed(2), rt: +M.roundT.toFixed(2), sc: M.score, dead, left, end: M.over ? M.endMsg : null });
}
function pvpOnSync(s) {
  const M = G.pvp; if (!M || M.over) return;
  if (s.end) { pvpOnEnd(s.end); return; }
  const was = M.wait; M.wait = false;
  if (s.r > M.round) pvpStartRound(s.r);
  if (s.r === M.round && s.ph !== M.phase && !(s.ph === 'countdown' && M.phase === 'fight')) { M.phase = s.ph; M.t = s.t; if (s.ph === 'fight') M.prot = 0; }
  if (s.r === M.round && Math.abs(M.roundT - s.rt) > 1.5) M.roundT = s.rt;
  M.score = s.sc.slice();
  for (const id in M.players) {
    const pl = M.players[id];
    pl.left = s.left.includes(id);
    if (s.r === M.round && s.dead.includes(id) && (id === Net.id ? G.player.alive : pl.alive)) pvpMarkDead(pl, null, true);
  }
  if (was) { G.pb.length = 0; clearEnemyBullets(); }
}
function pvpEndRound(w) {
  const M = G.pvp;
  M.ending = true;
  const score = M.score.slice(); if (w >= 0) score[w]++;
  const m = { from: Net.id, winner: w, score, next: M.round + 1 };
  MP.ch.send('round', m); pvpOnRound(m);
  if (w >= 0 && score[w] >= M.target) { const e = { from: Net.id, winner: w, score }; setTimeout(() => { if (MP.ch) MP.ch.send('end', e); pvpOnEnd(e); }, 900); }
}

// ---------- shots and hits ----------
// spawnPB / damageEnemy call these when G.pvp is on
function pvpShot(b, ang, sp) { const M = G.pvp; if (M.outB.length < 60) M.outB.push([Math.round(b.x), Math.round(b.y), +ang.toFixed(3), Math.round(sp), +b.r.toFixed(1), b.life ? +b.life.toFixed(2) : 1]); }
function pvpHitProxy(e, dmg, crit) {
  const M = G.pvp, pl = M.players[e.pid];
  if (!pl || !pl.alive || M.phase !== 'fight') return;
  dmg = Math.round(dmg * 10) / 10;
  if (pl.bot && mpIsHost()) pvpBotHit(pl, dmg, Net.id); // I run the bots
  else M.outH.push([e.pid, dmg, crit ? 1 : 0]);
  pvpLedger(pl, dmg, Net.id);
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
    M.hp = 0;
    const m = { from: Net.id, id: Net.id, by: by || null, r: M.round };
    MP.ch && MP.ch.send('die', m); pvpOnDie(m);
  }
}
function pvpForceDie(pl, by) {
  const M = G.pvp, m = { from: Net.id, id: pl.id, by, r: M.round, forced: 1 };
  MP.ch && MP.ch.send('die', m); pvpOnDie(m);
}
function pvpMarkDead(pl, by, quiet) {
  const M = G.pvp, mine = pl.id === Net.id;
  if (mine) { const p = G.player; if (!p.alive) return; p.alive = false; M.hp = 0; M.deaths++; burst(p.x, p.y, COL.player, 30, 220, 0.8, 4); sfx('death'); }
  else { if (!pl.alive) return; if (pl.proxy) burst(pl.proxy.x, pl.proxy.y, TEAM_COL[pl.team], 30, 220, 0.8, 4); else burst(pl.x, pl.y, TEAM_COL[pl.team], 24, 200, 0.7, 4); }
  pl.alive = false; pl.deaths++;
  if (pl.proxy) pl.proxy.untarget = true;
  if (quiet) return;
  if (by && M.players[by]) M.players[by].kills++;
  if (by === Net.id) { M.kills++; floatText(G.player.x, G.player.y - 26, 'KILL · ' + pl.name.toUpperCase(), COL.gold, 13, 1.2); sfx('kill'); }
  UI.pvpFeed((by && M.players[by] ? M.players[by].name : M.storm ? 'The storm' : 'Lost connection') + ' ✕ ' + pl.name);
}
function pvpOnDie(m) {
  const M = G.pvp; if (!M) return;
  const pl = M.players[m.id]; if (!pl || (m.r != null && m.r !== M.round)) return;
  const host = mpHost();
  // a player reports their own death; the host reports bots and forced deaths
  if (m.from !== m.id && m.from !== host) return;
  if ((pl.bot || m.forced) && m.from !== host) return;
  pvpMarkDead(pl, m.by && M.players[m.by] ? m.by : null);
}
function pvpOnRound(m) {
  const M = G.pvp; if (!M) return;
  M.score = m.score; M.phase = 'between'; M.ending = false;
  const mine = m.winner === M.team;
  showBanner(m.winner < 0 ? 'DRAW' : TEAM_NAME[m.winner] + ' TAKES THE ROUND', TEAM_NAME[0] + ' ' + m.score[0] + ' : ' + m.score[1] + ' ' + TEAM_NAME[1], m.winner < 0 ? 'rest' : mine ? 'combat' : 'boss');
  if (Math.max(m.score[0], m.score[1]) >= M.target) return;
  clearTimeout(M.nextT); M.nextT = setTimeout(() => { if (G.pvp === M && !M.over && M.round < m.next) pvpStartRound(m.next); }, 2600);
}
async function pvpOnEnd(m) {
  const M = G.pvp; if (!M || M.over) return;
  M.over = true; M.phase = 'over'; M.endMsg = { from: m.from, winner: m.winner, score: m.score }; clearTimeout(M.nextT);
  const won = m.winner === M.team;
  const result = { won, score: m.score, team: M.team, kills: M.kills, deaths: M.deaths, mode: M.mode, ranked: M.ranked, rankNote: M.rankNote, players: Object.values(M.players) };
  Social.track();
  if (M.ranked) {
    try {
      const flagged = Object.values(M.players).filter((p) => !p.bot && p.id !== Net.id && (p.kicked || p.viol >= PVP.kickAt / 2)).map((p) => p.id);
      const r = await Net.rpc('pvp_report', { p_match: M.mid, p_winner: m.winner, p_kills: M.kills, p_deaths: M.deaths, p_flagged: flagged });
      result.rating = r && r.rating; result.settled = r && r.settled;
      if (Social.me && r && r.rating != null) Social.me.rating = r.rating;
    } catch (e) { result.reportError = e.message; }
  }
  setTimeout(() => { if (G.pvp === M) UI.showPvpResult(result); }, 1200);
}
function pvpOnPresence(list) {
  const M = G.pvp; if (!M) return;
  for (const id in M.players) {
    const pl = M.players[id]; if (pl.bot) continue;
    const there = list.some((p) => p.id === id);
    if (!there && !pl.gone) pl.gone = performance.now();
    if (there) pl.gone = 0;
  }
}
function pvpOnBye(m) {
  const M = G.pvp; if (!M) return;
  const pl = M.players[m.id]; if (!pl || pl.left || pl.bot) return;
  pl.left = true; pl.kicked = true; // gone for good: the next states do not bring them back
  pvpMarkDead(pl, null, true);
  UI.pvpFeed(pl.name + ' left');
}
function pvpKick(pl) {
  const m = { from: Net.id, id: pl.id };
  MP.ch && MP.ch.send('kick', m); pvpOnKick(m);
}
function pvpOnKick(m) {
  const M = G.pvp; if (!M) return;
  const pl = M.players[m.id]; if (!pl || pl.kicked) return;
  pl.kicked = true; pl.flagged = true; pl.left = true; pvpMarkDead(pl, null, true);
  if (m.id === Net.id) { UI.toast('REMOVED FROM THE MATCH', 'Too many impossible moves (bad connection?)'); mpLeave(); return; }
  UI.pvpFeed(pl.name + ' removed · impossible play');
}
// back from the background (main.js): stale state must not count; the host sends where the match is
function pvpWake(away) {
  const M = G.pvp; if (!M || M.over || away < 1500) return;
  M.wait = true; M.waitT = 0;
  G.pb.length = 0; clearEnemyBullets(); M.outB.length = 0; M.outH.length = 0;
  for (const id in M.players) M.players[id].seen = performance.now(); // give everybody a fresh chance
  if (MP.ch) MP.ch.send('hi', { id: Net.id });
}

// ---------- receiving states, with the checks ----------
function pvpOnState(m) {
  const M = G.pvp; if (!M) return;
  pvpApply(m, false);
  if (m.bots && m.id === mpHost() && m.id !== Net.id) for (const s of m.bots) pvpApply(s, true);
}
function pvpApply(s, viaHost) {
  const M = G.pvp, pl = M.players[s.id];
  if (!pl || s.id === Net.id) return;
  if (!!pl.bot !== viaHost) return; // only the host speaks for bots, and nobody for another player
  pl.seen = performance.now();
  if (pl.left && !pl.kicked) pl.left = false; // came back: plays from the next round
  if (s.r !== M.round || M.wait) return; // another round (late packet) or I am catching up
  pvpCheckMove(pl, s.x, s.y);
  pl.a = s.a; pl.hp = s.hp; pl.dash = s.d; pl.sh = s.sh;
  pl.hist.push({ x: pl.tx, y: pl.ty, t: M.clock, d: s.d, sh: s.sh });
  while (pl.hist.length && M.clock - pl.hist[0].t > 3) pl.hist.shift();
  if (!pl.alive) return;
  if (G.eb.length < 220) for (const b of (s.b || []).slice(0, 40)) { const e = fireEB(b[0], b[1], b[2], b[3], { color: TEAM_COL[pl.team], r: Math.max(3, b[4]), life: Math.min(2, b[5] || 1), fake: true }); if (e) e.team = pl.team; }
  for (const h of s.h || []) {
    const t = M.players[h[0]];
    if (!pvpHitOk(pl, h[0], h[1])) { pl.viol += 0.5; continue; }
    if (h[0] === Net.id) pvpTakeHit(h[1], s.id);
    else if (t.bot && mpIsHost()) pvpBotHit(t, h[1], s.id);
    pvpLedger(t, h[1], s.id);
  }
}
// position: over every second, no faster than flying + dashing allows; never inside a wall
function pvpCheckMove(pl, x, y) {
  const M = G.pvp, st = pl.st;
  if (!pl.anchor) pl.anchor = { x, y, t: M.clock };
  const dt = M.clock - pl.anchor.t;
  if (dt >= 1) {
    const allowed = st.move * 1.3 * dt + (st.dashCharges + dt / st.dashCd) * DASH_SPEED * (DASH_TIME + 0.02) + 60;
    if (Math.hypot(x - pl.anchor.x, y - pl.anchor.y) > allowed) { pl.viol += 1; pl.anchor = { x, y, t: M.clock }; pl.tx = pl.x = x; pl.ty = pl.y = y; return; }
    pl.anchor = { x, y, t: M.clock };
  }
  if (solidAt(x, y)) { pl.viol += 0.25; return; } // keep the last good spot
  pl.tx = x; pl.ty = y;
}
// a hit claimed by `pl` on `tid`: a damage its ship can do, at a rate it can fire, from where it could see
function pvpHitOk(pl, tid, dmg) {
  const M = G.pvp, t = M.players[tid], st = pl.st;
  if (!t || t.team === pl.team || M.phase !== 'fight' || !(dmg > 0)) return false;
  if (tid === Net.id ? !G.player.alive : !t.alive) return false;
  const nova = st.nova ? st.dmg * 0.7 * st.novaD : 0;
  if (dmg > Math.max(st.dmg * st.critMult, nova) * 1.25 + 2) return false;
  const now = M.clock;
  while (pl.win.length && now - pl.win[0][0] > 1) pl.win.shift();
  const sum = pl.win.reduce((a, w) => a + w[1], 0);
  const novaN = st.nova ? 10 + 6 * (st.nova - 1) + st.novaExtra : 0;
  const cap = (st.dmg * st.critMult * (st.proj + (st.back >= 2 ? 4 : st.back ? 2 : 0)) * st.rof * 1.6 + novaN * nova + st.dmg * 3) * 1.5 + 20;
  if (sum + dmg > cap) return false;
  pl.win.push([now, dmg]);
  // where both were in the last moments: in range, and in sight (bouncing bullets go round corners)
  const sh = pl.hist.length ? pl.hist.slice(-10) : [{ x: pl.tx, y: pl.ty }];
  const th = tid === Net.id ? M.hist.slice(-8) : t.hist.slice(-6);
  if (!th.length) th.push({ x: tid === Net.id ? G.player.x : t.tx, y: tid === Net.id ? G.player.y : t.ty });
  const R = st.range * (1 + 0.5 * st.bounce) * 1.25 + 60;
  for (let i = sh.length - 1; i >= 0; i -= 2) for (let j = th.length - 1; j >= 0; j -= 2) {
    const a = sh[i], b = th[j];
    if (dist2(a.x, a.y, b.x, b.y) > R * R) continue;
    if (st.bounce > 0 || hasLOS(a.x, a.y, b.x, b.y)) return true;
  }
  return false;
}
// host: HP from the public hits (a dash, a shield or the start protection around the hit forgive it)
function pvpLedger(t, dmg, by) {
  const M = G.pvp;
  if (!mpIsHost() || !t || t.bot || t.id === Net.id || !t.alive || M.roundT < 1.2) return;
  const recent = t.hist.filter((x) => M.clock - x.t < 0.35);
  // dashing far more often than the ship can: the dash flag is a lie
  const dashes = t.hist.filter((x) => x.d).length / Math.max(1, t.hist.length), st = t.st;
  const maxDuty = Math.min(1, ((st.dashCharges + 3 / st.dashCd) * (DASH_TIME + DASH_IFR_TAIL + st.dodgeWin)) / 3) * 1.6 + 0.1;
  const dashOk = t.hist.length < 12 || dashes <= maxDuty;
  if (!dashOk) t.viol += 0.2;
  if (dashOk && recent.some((x) => x.d)) return;
  if (recent.some((x) => x.sh) && M.clock - t.shBlock > st.aegisCd * 0.8) { t.shBlock = M.clock; return; }
  t.lhp -= dmg; t.lastBy = by;
}

// ---------- bots (simulated by the host) ----------
function pvpBotInit(pl) {
  const st = pl.st, maxHp = pl.maxHp;
  return { x: pl.x, y: pl.y, vx: 0, vy: 0, r: 8, hp: maxHp * Math.max(0.05, pl.hp), maxHp, fireT: 0.6 + Math.random() * 0.4, dashT: 0, dashIfr: 0, dx: 0, dy: 0, charges: st.dashCharges, recharge: 0,
    shield: st.aegis > 0 ? 1 : 0, shieldT: 0, think: 0, tgt: null, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1, dodgeT: 0, lastTx: 0, lastTy: 0, aim: pl.a };
}
function pvpBotTargets(pl) {
  const M = G.pvp, out = [];
  for (const id in M.players) {
    const o = M.players[id];
    if (o.team === pl.team || o.left) continue;
    if (id === Net.id) { if (G.player.alive) out.push({ id, x: G.player.x, y: G.player.y }); }
    else if (o.alive) out.push({ id, x: o.x, y: o.y });
  }
  return out;
}
function pvpBots(dt) {
  const M = G.pvp, A = G.pvpArena, fight = M.phase === 'fight';
  for (const id in M.players) {
    const pl = M.players[id];
    if (!pl.bot) continue;
    const b = pl.sim || (pl.sim = pvpBotInit(pl)), st = pl.st;
    if (!pl.alive) continue;
    if (!fight) { pl.x = pl.tx = b.x; pl.y = pl.ty = b.y; continue; }
    b.dashIfr = Math.max(0, b.dashIfr - dt);
    if (b.charges < st.dashCharges) { b.recharge += dt; if (b.recharge >= st.dashCd) { b.recharge = 0; b.charges++; } }
    if (st.aegis > 0 && !b.shield) { b.shieldT -= dt; if (b.shieldT <= 0) b.shield = 1; }
    // pick the nearest opponent (one in sight counts as much closer)
    const targets = pvpBotTargets(pl);
    b.think -= dt;
    if (b.think <= 0) {
      b.think = 0.25;
      let best = null, bd = Infinity;
      for (const o of targets) { let d = dist2(b.x, b.y, o.x, o.y); if (!hasLOS(b.x, b.y, o.x, o.y)) d *= 3; if (d < bd) { bd = d; best = o.id; } }
      b.tgt = best;
    }
    const tg = targets.find((o) => o.id === b.tgt);
    // movement: away from the storm, otherwise keep a fighting distance and strafe
    let mx = 0, my = 0;
    const storm = M.storm;
    if (storm && dist2(b.x, b.y, storm.x, storm.y) > (storm.r - 50) ** 2) { mx = storm.x - b.x; my = storm.y - b.y; }
    else if (tg) {
      const dx = tg.x - b.x, dy = tg.y - b.y, d = Math.hypot(dx, dy) || 1, see = hasLOS(b.x, b.y, tg.x, tg.y);
      b.strafeT -= dt; if (b.strafeT <= 0) { b.strafeT = 0.9 + Math.random() * 1.6; b.strafe = -b.strafe; }
      if (!see || d > st.range * 0.85) {
        const wp = routeTo(b.x, b.y, 8, tg.x, tg.y);
        if (wp) { mx = wp.x - b.x; my = wp.y - b.y; } else { mx = dx; my = dy; }
      } else {
        const want = st.range * 0.6, push = d < want - 40 ? -0.7 : d > want + 40 ? 0.7 : 0;
        mx = (dx / d) * push + (-dy / d) * b.strafe; my = (dy / d) * push + (dx / d) * b.strafe;
      }
    } else { mx = A.cx - b.x; my = A.cy - b.y; }
    const ml = Math.hypot(mx, my);
    if (b.dashT > 0) {
      b.dashT -= dt; b.x += b.dx * DASH_SPEED * dt; b.y += b.dy * DASH_SPEED * dt;
    } else {
      const k = 1 - Math.exp(-dt * 12), sp = st.move * 0.9;
      b.vx += ((ml > 1 ? mx / ml : 0) * sp - b.vx) * k; b.vy += ((ml > 1 ? my / ml : 0) * sp - b.vy) * k;
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    collideWorld(b, 8);
    // dodge: a bullet about to hit, sometimes
    b.dodgeT -= dt;
    if (b.dodgeT <= 0 && b.charges > 0 && b.dashT <= 0) {
      b.dodgeT = 0.15;
      const threat = pvpBotThreat(pl, b);
      if (threat && Math.random() < 0.4) {
        const l = Math.hypot(threat.vx, threat.vy) || 1, side = Math.random() < 0.5 ? 1 : -1;
        b.dx = (-threat.vy / l) * side; b.dy = (threat.vx / l) * side;
        b.dashT = DASH_TIME; b.dashIfr = DASH_TIME + DASH_IFR_TAIL; b.charges--;
      }
    }
    // fire with a little lead and a little error
    b.fireT -= dt;
    if (tg) {
      const tvx = (tg.x - b.lastTx) / Math.max(dt, 1e-3), tvy = (tg.y - b.lastTy) / Math.max(dt, 1e-3);
      b.lastTx = tg.x; b.lastTy = tg.y;
      const d = Math.hypot(tg.x - b.x, tg.y - b.y), lead = Math.min(0.35, d / st.bSpeed) * 0.7;
      b.aim = Math.atan2(tg.y + clamp(tvy, -300, 300) * lead - b.y, tg.x + clamp(tvx, -300, 300) * lead - b.x);
      if (b.fireT <= 0 && d < st.range * 1.05 && hasLOS(b.x, b.y, tg.x, tg.y)) { b.fireT = 1.12 / st.rof; pvpBotFire(pl, b, b.aim + (Math.random() - 0.5) * 0.16); }
    } else if (ml > 1) b.aim = Math.atan2(my, mx);
    if (b.fireT < 0) b.fireT = 0;
    pl.x = pl.tx = b.x; pl.y = pl.ty = b.y; pl.a = b.aim; pl.hp = b.hp / b.maxHp; pl.dash = b.dashIfr > 0;
  }
  pvpBotBullets(dt);
}
function pvpBotThreat(pl, b) {
  const M = G.pvp;
  const look = (x, y, vx, vy) => { const rx = b.x - x, ry = b.y - y, sp2 = vx * vx + vy * vy || 1, tt = (rx * vx + ry * vy) / sp2; if (tt < 0 || tt > 0.35) return false; const cx = x + vx * tt - b.x, cy = y + vy * tt - b.y; return cx * cx + cy * cy < 18 * 18; };
  if (M.team !== pl.team) for (const x of G.pb) if (look(x.x, x.y, x.vx, x.vy)) return x;
  for (const x of G.eb) if (x.fake && x.team !== pl.team && look(x.x, x.y, x.vx, x.vy)) return x;
  for (const x of M.bb) if (x.team !== pl.team && look(x.x, x.y, x.vx, x.vy)) return x;
  return null;
}
function pvpBotFire(pl, b, a) {
  const M = G.pvp, st = pl.st, n = st.proj, per = st.dmg / (1 + 0.35 * (n - 1)), gap = n > 1 ? Math.min(0.14, 0.75 / n) : 0;
  const shoot = (ang, dmg) => {
    if (M.bb.length > 200) return;
    const crit = Math.random() < st.crit, r = st.bSize * (crit ? 1.3 : 1);
    M.bb.push({ x: b.x, y: b.y, px: b.x, py: b.y, vx: Math.cos(ang) * st.bSpeed, vy: Math.sin(ang) * st.bSpeed, r, dmg: crit ? dmg * st.critMult : dmg, crit, life: st.range / st.bSpeed, pierce: st.pierce, bounce: st.bounce, team: pl.team, owner: pl.id, hits: [] });
    if (pl.outB.length < 40) pl.outB.push([Math.round(b.x), Math.round(b.y), +ang.toFixed(3), Math.round(st.bSpeed), +r.toFixed(1), +(st.range / st.bSpeed).toFixed(2)]);
  };
  for (let i = 0; i < n; i++) shoot(a + (i - (n - 1) / 2) * gap, per);
  if (st.back > 0) for (const k of (st.back >= 2 ? [0.75, -0.75, 0.5, -0.5] : [0.75, -0.75])) shoot(a + Math.PI * k, per * 0.7);
}
function pvpBotBullets(dt) {
  const M = G.pvp, arr = M.bb, p = G.player;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    b.life -= dt;
    if (b.life <= 0 || M.phase !== 'fight') { swapRemove(arr, i); continue; }
    b.px = b.x; b.py = b.y; b.x += b.vx * dt; b.y += b.vy * dt;
    if (solidAt(b.x, b.y)) {
      if (b.bounce > 0) { b.bounce--; const sx = solidAt(b.x, b.py), sy = solidAt(b.px, b.y); if (sx) b.vx = -b.vx; if (sy) b.vy = -b.vy; if (!sx && !sy) { b.vx = -b.vx; b.vy = -b.vy; } b.x = b.px; b.y = b.py; b.hits.length = 0; }
      else { sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 1.2, TEAM_COL[b.team], 2, 60); swapRemove(arr, i); continue; }
    }
    let gone = false;
    for (const id in M.players) {
      const o = M.players[id];
      if (o.team === b.team || o.left || b.hits.includes(id)) continue;
      const mine = id === Net.id, ox = mine ? p.x : o.x, oy = mine ? p.y : o.y;
      if (mine ? !p.alive : !o.alive) continue;
      const rr = b.r + (mine ? PLAYER_HITBOX : 8);
      if (segPointDist2(ox, oy, b.px, b.py, b.x, b.y) > rr * rr) continue;
      const owner = M.players[b.owner];
      if (mine) pvpTakeHit(b.dmg, b.owner);
      else if (o.bot) pvpBotHit(o, b.dmg, b.owner);
      else if (owner) owner.outH.push([id, Math.round(b.dmg * 10) / 10, b.crit ? 1 : 0]); // the victim's client decides (dash, shield)
      if (!mine && !o.bot) pvpLedger(o, b.dmg, b.owner);
      if (b.pierce > 0) { b.pierce--; b.hits.push(id); } else { gone = true; break; }
    }
    if (gone) swapRemove(arr, i);
  }
}
function pvpBotHit(pl, dmg, by, storm) {
  const M = G.pvp, b = pl.sim;
  if (!b || !pl.alive || M.phase !== 'fight') return;
  if (!storm) {
    if (b.dashIfr > 0 || M.roundT < 1) return;
    if (b.shield) { b.shield = 0; b.shieldT = pl.st.aegisCd; return; }
  }
  b.hp -= dmg; pl.hp = Math.max(0, b.hp / b.maxHp);
  if (pl.proxy) pl.proxy.flash = 0.08;
  if (b.hp <= 0) pvpForceDie(pl, by);
}

// opponent proxies follow their owner's reports smoothly
AI.pvp = function (e, dt) {
  const M = G.pvp, pl = M && M.players[e.pid];
  if (!pl) return;
  if (pl.bot && mpIsHost()) { e.x = pl.x; e.y = pl.y; }
  else { const k = Math.min(1, dt * 14); e.x += (pl.tx - e.x) * k; e.y += (pl.ty - e.y) * k; }
  e.vx = e.vy = 0; e.kx = e.ky = 0;
  e.untarget = !pl.alive;
};
function pvpTeardown() {
  document.documentElement.classList.remove('pvp');
  Net.fast(false);
  if (G.pvp) clearTimeout(G.pvp.nextT);
  G.pvp = null; G.pvpArena = null; G.enemies.length = 0; G.eb.length = 0; G.pb.length = 0;
}
function mpBackToLobby() { // rooms: everybody back to the room
  pvpTeardown(); MP.match = null; G.state = 'menu';
  UI.showHud(false); Sound.music(false);
  Social.track();
  UI.openLobby();
}
function mpLeave() { mpLeaveAll(); UI.showHud(false); Sound.music(false); goMenu(); }
