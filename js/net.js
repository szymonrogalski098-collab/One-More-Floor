'use strict';
// Online play over Supabase without any library: auth (anonymous or Google), the ranking / friends RPCs over
// REST, rooms over the Realtime websocket (Phoenix protocol: broadcast + presence). `?net=local` swaps the
// transport for a BroadcastChannel between tabs of the same browser and the database for localStorage
// (tests and offline development).

const NET_CFG = {
  url: 'https://hmghpqgjwjkwzyqpvwxe.supabase.co',
  key: 'sb_publishable_Q-W4dUV7i3cWxZkzE74jZA_Fop0dVg7', // publishable: meant to be public
};
const NET_LOCAL = /[?&]net=local\b/.test(location.search);

const Net = {
  session: null,
  down: false, // tests: simulate a dead connection (local transport only)
  get id() { return this.session && this.session.user && this.session.user.id; },
  get google() { const u = this.session && this.session.user; return !!(u && u.is_anonymous === false); },

  // ---------- auth ----------
  // called once at boot: a Google sign-in comes back with the tokens in the URL hash
  boot() {
    try { this.session = JSON.parse(localStorage.getItem(NET_LOCAL ? 'omf-l-session' : 'omf-sb-session') || 'null'); } catch (e) { this.session = null; }
    if (NET_LOCAL) {
      try { this.session = JSON.parse(sessionStorage.getItem('omf-l-session') || 'null'); } catch (e) { this.session = null; } // one identity per tab
      return null;
    }
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('error_description')) { history.replaceState(null, '', location.pathname + location.search); return { error: h.get('error_description') }; }
    if (!h.get('access_token')) return null;
    history.replaceState(null, '', location.pathname + location.search);
    const s = { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: +h.get('expires_at') || Math.floor(Date.now() / 1000) + (+h.get('expires_in') || 3600) };
    this.session = s;
    return this.fetchUser().then(() => ({ ok: true })).catch((e) => ({ error: e.message }));
  },
  async fetchUser() {
    const res = await fetch(NET_CFG.url + '/auth/v1/user', { headers: this.headers() });
    if (!res.ok) throw new Error('user ' + res.status);
    this.session.user = await res.json();
    this.store();
  },
  store() {
    try {
      if (NET_LOCAL) sessionStorage.setItem('omf-l-session', JSON.stringify(this.session));
      else if (this.session) localStorage.setItem('omf-sb-session', JSON.stringify(this.session));
      else localStorage.removeItem('omf-sb-session');
    } catch (e) { /* private mode */ }
  },
  async signIn() {
    if (NET_LOCAL) {
      if (!this.session) { this.session = { user: { id: 'L' + Math.random().toString(36).slice(2, 10), is_anonymous: true }, access_token: 'local' }; this.store(); }
      return this.session;
    }
    const s = this.session, now = Date.now() / 1000;
    if (s && s.user && s.expires_at && s.expires_at - 120 > now) return s;
    if (s && s.refresh_token) {
      try { const r = await this.authCall('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token }); return this.keep(r); } catch (e) { /* fall through */ }
    }
    if (s && s.user && s.user.is_anonymous === false) { this.session = null; this.store(); } // the Google session expired for good
    const r = await this.authCall('/auth/v1/signup', { data: {} }); // anonymous sign-in
    return this.keep(r);
  },
  keep(r) {
    r.expires_at = r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600);
    this.session = r;
    this.store();
    RT.auth();
    return r;
  },
  async authCall(path, body) {
    const res = await fetch(NET_CFG.url + path, { method: 'POST', headers: { apikey: NET_CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.msg || j.error_description || j.message || 'auth ' + res.status);
    return j;
  },
  headers() { return { apikey: NET_CFG.key, Authorization: 'Bearer ' + this.session.access_token, 'Content-Type': 'application/json' }; },
  googleLogin() {
    if (NET_LOCAL) { // tests: pretend Google said yes
      const id = this.session && this.session.user ? this.session.user.id : 'G' + Math.random().toString(36).slice(2, 10);
      this.session = { user: { id, is_anonymous: false, email: 'local@test' }, access_token: 'local' }; this.store();
      return Promise.resolve(true);
    }
    const back = location.origin + location.pathname;
    location.assign(NET_CFG.url + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(back));
    return new Promise(() => {}); // the page leaves
  },
  async signOut() {
    if (!NET_LOCAL && this.session) fetch(NET_CFG.url + '/auth/v1/logout', { method: 'POST', headers: this.headers() }).catch(() => {});
    this.session = null; this.store();
    if (NET_LOCAL) sessionStorage.removeItem('omf-l-session');
  },

  // ---------- database (RPCs; see tools/supabase.sql) ----------
  async rpc(fn, args) {
    if (NET_LOCAL) return LocalDB.rpc(fn, args || {});
    await this.signIn();
    const res = await fetch(NET_CFG.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: this.headers(), body: JSON.stringify(args || {}) });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && (j.message || j.hint)) || fn + ' ' + res.status);
    return j;
  },
  async leaderboard() {
    if (NET_LOCAL) return LocalDB.board();
    await this.signIn();
    const res = await fetch(NET_CFG.url + '/rest/v1/pvp_players?select=id,name,rating,wins,losses,kills,deaths&wins=gte.0&order=rating.desc&limit=50', { headers: this.headers() });
    if (!res.ok) throw new Error('ranking ' + res.status);
    return (await res.json()).filter((r) => r.wins + r.losses > 0);
  },
  myStats() { return this.google ? this.rpc('pvp_me') : Promise.resolve(null); },

  // ---------- channels ----------
  // channel(topic, { on: { event: fn(payload) }, presence: fn(list), error: fn }) → { send, track, leave, ready }
  channel(topic, h) { return NET_LOCAL ? localChannel(topic, h) : RT.channel(topic, h); },
  // after the app was in the background the socket may be dead without knowing it
  wake(away) { if (!NET_LOCAL) RT.wake(away); },
  // am I connected right now? (in a match the server answers a heartbeat every 2 s)
  online() { return NET_LOCAL ? !this.down : RT.open && Date.now() - RT.lastRx < 4500; },
  fast(on) { RT.fast = !!on; },
};

// ---------- Supabase Realtime (Phoenix) socket ----------
const RT = {
  ws: null, ref: 0, chans: new Map(), hb: 0, open: false, queue: [], lastRx: 0, lastHb: 0, fast: false,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const u = NET_CFG.url.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(NET_CFG.key) + '&vsn=1.0.0';
    const ws = this.ws = new WebSocket(u);
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.open = true; this.lastRx = Date.now();
      clearInterval(this.hb);
      this.hb = setInterval(() => {
        const now = Date.now();
        if (now - this.lastRx > (this.fast ? 9000 : 45000)) { this.restart(); return; } // no answer: dead
        if (now - this.lastHb < (this.fast ? 2000 : 20000)) return;
        this.lastHb = now;
        this.raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) });
      }, 1000);
      for (const c of this.chans.values()) c.join(); // (re)join everything
      const q = this.queue; this.queue = [];
      for (const m of q) this.raw(m);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      this.lastRx = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      const c = this.chans.get(m.topic);
      if (c) c.handle(m);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.open = false; clearInterval(this.hb);
      for (const c of this.chans.values()) c.joined = false;
      if (this.chans.size) setTimeout(() => this.connect(), 1200); // keep the rooms alive
    };
  },
  restart() {
    const old = this.ws; this.ws = null; this.open = false; clearInterval(this.hb);
    for (const c of this.chans.values()) c.joined = false;
    if (old) { old.onclose = null; try { old.close(); } catch (e) { /* already gone */ } }
    if (this.chans.size) this.connect();
  },
  wake(away) { if (this.chans.size && (away > 4000 || !this.open)) this.restart(); },
  raw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  // control messages (join / track / leave) wait for the socket; game state is dropped while offline:
  // replaying seconds of stale positions and shots after a reconnect only floods the others
  push(m, keep) { if (this.open && this.ws && this.ws.readyState === 1) this.raw(m); else if (keep) this.queue.push(m); },
  auth() { if (!Net.session) return; for (const c of this.chans.values()) if (c.joined) this.push({ topic: c.topic, event: 'access_token', payload: { access_token: Net.session.access_token }, ref: String(++this.ref) }); },
  channel(name, h) {
    const topic = 'realtime:' + name, rt = this;
    const pres = {}; // key -> metas
    const c = {
      topic, joinRef: null, joined: false, meta: null, h,
      ready: null, _ok: null,
      join() {
        this.joinRef = String(++rt.ref); this.joined = false;
        rt.raw({ topic, event: 'phx_join', join_ref: this.joinRef, ref: this.joinRef,
          payload: { config: { broadcast: { self: false, ack: false }, presence: { key: Net.id }, postgres_changes: [], private: false }, access_token: Net.session.access_token } });
      },
      handle(m) {
        if (m.event === 'phx_reply' && m.ref === this.joinRef) {
          if (m.payload && m.payload.status === 'ok') { this.joined = true; if (this.meta) this.track(this.meta); this._ok && this._ok(); }
          else if (h.error) h.error(m.payload && m.payload.response && (m.payload.response.reason || JSON.stringify(m.payload.response)));
        } else if (m.event === 'broadcast') {
          const p = m.payload || {}, fn = h.on && h.on[p.event];
          if (fn) fn(p.payload || {});
        } else if (m.event === 'presence_state') {
          for (const k in pres) delete pres[k];
          for (const k in m.payload) pres[k] = m.payload[k].metas;
          this.emitPresence();
        } else if (m.event === 'presence_diff') {
          const { joins = {}, leaves = {} } = m.payload || {};
          for (const k in leaves) delete pres[k];
          for (const k in joins) pres[k] = joins[k].metas;
          this.emitPresence();
        } else if (m.event === 'phx_error') {
          this.joined = false;
          setTimeout(() => { if (rt.chans.get(topic) === this && rt.open) this.join(); }, 1000);
        }
      },
      emitPresence() { if (h.presence) h.presence(Object.keys(pres).map((k) => ({ id: k, ...(pres[k][pres[k].length - 1] || {}) }))); },
      send(event, payload) { if (this.joined) rt.push({ topic, event: 'broadcast', ref: String(++rt.ref), join_ref: this.joinRef, payload: { type: 'broadcast', event, payload } }); },
      track(meta) { this.meta = meta; if (this.joined) rt.push({ topic, event: 'presence', ref: String(++rt.ref), join_ref: this.joinRef, payload: { type: 'presence', event: 'track', payload: meta } }); },
      leave() { if (this.joined) rt.push({ topic, event: 'phx_leave', ref: String(++rt.ref), join_ref: this.joinRef, payload: {} }); rt.chans.delete(topic); },
    };
    c.ready = new Promise((ok) => { c._ok = ok; });
    const old = this.chans.get(topic); if (old) old.leave();
    this.chans.set(topic, c);
    this.connect();
    if (this.open) c.join();
    return c;
  },
};

// ---------- local transport: BroadcastChannel between tabs ----------
function localChannel(topic, h) {
  const bc = new BroadcastChannel('omf-net:' + topic), me = Net.id, pres = new Map(); // id -> { meta, seen }
  let meta = null, alive = true, wasDown = false;
  const emit = () => { if (h.presence) h.presence([...pres.entries()].map(([id, v]) => ({ id, ...v.meta }))); };
  bc.onmessage = (ev) => {
    const m = ev.data;
    if (!alive || m.from === me || Net.down) return;
    if (m.k === 'bc') { const fn = h.on && h.on[m.event]; if (fn) fn(m.payload); }
    else if (m.k === 'track') { pres.set(m.from, { meta: m.meta, seen: Date.now() }); emit(); }
    else if (m.k === 'untrack') { pres.delete(m.from); emit(); }
    else if (m.k === 'hello' && meta) bc.postMessage({ k: 'track', from: me, meta });
  };
  const tick = setInterval(() => {
    if (Net.down) { wasDown = true; return; }
    if (wasDown) { wasDown = false; bc.postMessage({ k: 'hello', from: me }); } // back online: like a rejoin
    if (meta) bc.postMessage({ k: 'track', from: me, meta });
    let gone = false;
    for (const [id, v] of pres) if (id !== me && Date.now() - v.seen > 3500) { pres.delete(id); gone = true; }
    if (gone) emit();
  }, 1000);
  const c = {
    ready: Promise.resolve(),
    send(event, payload) { if (alive && !Net.down) bc.postMessage({ k: 'bc', from: me, event, payload }); },
    track(m) { meta = m; pres.set(me, { meta: m, seen: Date.now() }); if (!Net.down) bc.postMessage({ k: 'track', from: me, meta: m }); emit(); },
    leave() { if (!alive) return; bc.postMessage({ k: 'untrack', from: me }); alive = false; clearInterval(tick); bc.close(); },
  };
  setTimeout(() => bc.postMessage({ k: 'hello', from: me }), 0);
  return c;
}

// ---------- local database (?net=local): the same RPCs as tools/supabase.sql, in localStorage ----------
// Every tab only writes its own rows (no cross-tab races): results settle when the reporting player looks.
const LocalDB = {
  get(k) { try { return JSON.parse(localStorage.getItem('omf-l-' + k) || 'null'); } catch (e) { return null; } },
  set(k, v) { localStorage.setItem('omf-l-' + k, JSON.stringify(v)); },
  keys(prefix) { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('omf-l-' + prefix)) out.push(k.slice(6)); } return out; },
  me() { return this.get('p:' + Net.id); },
  byName(n) { for (const k of this.keys('p:')) { const p = this.get(k); if (p && p.name.toLowerCase() === String(n).toLowerCase()) return p; } return null; },
  board() { this.settleMine(); return this.keys('p:').map((k) => this.get(k)).filter((p) => p && p.wins + p.losses > 0).sort((a, b) => b.rating - a.rating); },
  friendRow(a, b) { return this.get('f:' + a + ':' + b); },
  settleMine() {
    for (const k of this.keys('r:')) {
      const r = this.get(k);
      if (!r || r.player !== Net.id || r.applied || r.winner == null) continue;
      const m = this.get('m:' + r.match); if (!m) continue;
      const reps = this.keys('r:' + r.match + ':').map((x) => this.get(x)).filter((x) => x && x.winner != null);
      if (reps.some((x) => x.winner !== r.winner)) { r.applied = 'void'; this.set(k, r); continue; }
      const teams = new Set(reps.map((x) => m.teams[m.players.indexOf(x.player)]));
      if (teams.size < 2) continue;
      const me = this.me(), myTeam = m.teams[m.players.indexOf(Net.id)], won = r.winner === myTeam;
      const r0 = (id) => { const x = this.get('r:' + r.match + ':' + id); return x && x.r0 != null ? x.r0 : (this.get('p:' + id) || { rating: 1000 }).rating; }; // ratings before the match
      const opp = m.players.filter((id, i) => m.teams[i] !== myTeam).map(r0);
      const oppR = opp.reduce((a, b) => a + b, 0) / Math.max(1, opp.length), ex = 1 / (1 + Math.pow(10, (oppR - r0(Net.id)) / 400));
      me.rating = Math.max(0, me.rating + Math.round(32 * ((won ? 1 : 0) - ex)));
      me.wins += won ? 1 : 0; me.losses += won ? 0 : 1; me.kills += Math.min(30, r.kills); me.deaths += Math.min(30, r.deaths);
      this.set('p:' + Net.id, me); r.applied = true; this.set(k, r);
    }
  },
  rpc(fn, a) {
    const me = Net.id, google = Net.google;
    const need = () => { if (!google) throw new Error('sign in with Google'); };
    switch (fn) {
      case 'pvp_me': { this.settleMine(); return this.me(); }
      case 'pvp_set_name': {
        need();
        const n = String(a.p_name || '').trim();
        if (!/^[A-Za-z0-9_]{3,14}$/.test(n)) throw new Error('3-14 letters, digits or _');
        const o = this.byName(n); if (o && o.id !== me) throw new Error('name taken');
        const row = this.me() || { id: me, rating: 1000, wins: 0, losses: 0, kills: 0, deaths: 0 };
        row.name = n; this.set('p:' + me, row); return row;
      }
      case 'friend_add': {
        need(); if (!this.me()) throw new Error('pick a name first');
        const t = a.p_id ? this.get('p:' + a.p_id) : this.byName(a.p_name);
        if (!t) throw new Error('no such pilot'); if (t.id === me) throw new Error('that is you');
        const back = this.friendRow(t.id, me);
        if (back) { back.status = 'accepted'; this.set('f:' + t.id + ':' + me, back); return 'accepted'; }
        if (this.friendRow(me, t.id)) return this.friendRow(me, t.id).status;
        this.set('f:' + me + ':' + t.id, { a: me, b: t.id, status: 'pending' }); return 'pending';
      }
      case 'friend_respond': {
        need(); const r = this.friendRow(a.p_id, me); if (!r) return null;
        if (a.p_accept) { r.status = 'accepted'; this.set('f:' + a.p_id + ':' + me, r); } else localStorage.removeItem('omf-l-f:' + a.p_id + ':' + me);
        return true;
      }
      case 'friend_remove': { need(); localStorage.removeItem('omf-l-f:' + a.p_id + ':' + me); localStorage.removeItem('omf-l-f:' + me + ':' + a.p_id); return true; }
      case 'friend_list': {
        need();
        return this.keys('f:').map((k) => this.get(k)).filter((r) => r && (r.a === me || r.b === me)).map((r) => {
          const id = r.a === me ? r.b : r.a, p = this.get('p:' + id) || { name: '?', rating: 1000 };
          return { id, name: p.name, rating: p.rating, status: r.status, incoming: r.b === me };
        });
      }
      case 'pvp_start': {
        need(); if (!this.get('m:' + a.p_match)) this.set('m:' + a.p_match, { players: a.p_players, teams: a.p_teams });
        if (!this.get('r:' + a.p_match + ':' + me)) this.set('r:' + a.p_match + ':' + me, { match: a.p_match, player: me, winner: null, r0: (this.me() || { rating: 1000 }).rating });
        return true;
      }
      case 'pvp_report': {
        need(); const k = 'r:' + a.p_match + ':' + me, r = this.get(k);
        if (!r || r.winner != null) throw new Error('no such match');
        r.winner = a.p_winner; r.kills = a.p_kills; r.deaths = a.p_deaths; this.set(k, r);
        this.settleMine();
        const row = this.me(); return { rating: row.rating, settled: !!this.get(k).applied };
      }
    }
    throw new Error('unknown rpc ' + fn);
  },
};
