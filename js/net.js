'use strict';
// Online play over Supabase without any library: anonymous sign-in and ranking via REST, rooms via the
// Realtime websocket (Phoenix protocol: broadcast + presence). `?net=local` swaps the transport for a
// BroadcastChannel between tabs of the same browser (tests and offline development).

const NET_CFG = {
  url: 'https://hmghpqgjwjkwzyqpvwxe.supabase.co',
  key: 'sb_publishable_Q-W4dUV7i3cWxZkzE74jZA_Fop0dVg7', // publishable: meant to be public
};
const NET_LOCAL = /[?&]net=local\b/.test(location.search);

const Net = {
  session: null,
  get id() { return this.session && this.session.user && this.session.user.id; },

  // ---------- auth (anonymous) ----------
  async signIn() {
    if (NET_LOCAL) { this.session = this.session || { user: { id: 'L' + Math.random().toString(36).slice(2, 10) }, access_token: 'local' }; return this.session; }
    let s = null;
    try { s = JSON.parse(localStorage.getItem('omf-sb-session') || 'null'); } catch (e) { s = null; }
    const now = Date.now() / 1000;
    if (s && s.expires_at && s.expires_at - 60 > now) { this.session = s; return s; }
    if (s && s.refresh_token) {
      try { const r = await this.authCall('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token }); return this.keep(r); } catch (e) { /* fall through to a fresh sign-in */ }
    }
    const r = await this.authCall('/auth/v1/signup', { data: {} }); // anonymous sign-in
    return this.keep(r);
  },
  keep(r) {
    r.expires_at = r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600);
    this.session = r;
    try { localStorage.setItem('omf-sb-session', JSON.stringify(r)); } catch (e) { /* private mode */ }
    return r;
  },
  async authCall(path, body) {
    const res = await fetch(NET_CFG.url + path, { method: 'POST', headers: { apikey: NET_CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.msg || j.error_description || j.message || 'auth ' + res.status);
    return j;
  },
  headers() { return { apikey: NET_CFG.key, Authorization: 'Bearer ' + this.session.access_token, 'Content-Type': 'application/json' }; },

  // ---------- ranking ----------
  async report(r) {
    if (NET_LOCAL) { const me = this.localBoard()[this.id] || { name: r.name, rating: 1000, wins: 0, losses: 0, kills: 0, deaths: 0 }; me.name = r.name; if (r.ranked) me.rating += r.won ? 16 : -16; me.wins += r.won ? 1 : 0; me.losses += r.won ? 0 : 1; me.kills += r.kills; me.deaths += r.deaths; localStorage.setItem('omf-lb:' + this.id, JSON.stringify(me)); return me; }
    await this.signIn();
    const res = await fetch(NET_CFG.url + '/rest/v1/rpc/pvp_report', { method: 'POST', headers: this.headers(),
      body: JSON.stringify({ p_name: r.name, p_won: r.won, p_kills: r.kills, p_deaths: r.deaths, p_opp_rating: r.oppRating | 0, p_ranked: !!r.ranked }) });
    if (!res.ok) throw new Error('report ' + res.status);
    return res.json();
  },
  async leaderboard() {
    if (NET_LOCAL) return Object.entries(this.localBoard()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.rating - a.rating);
    await this.signIn();
    const res = await fetch(NET_CFG.url + '/rest/v1/pvp_players?select=id,name,rating,wins,losses,kills,deaths&order=rating.desc&limit=25', { headers: this.headers() });
    if (!res.ok) throw new Error('ranking ' + res.status);
    return res.json();
  },
  async myStats() {
    if (NET_LOCAL) return this.localBoard()[this.id] || null;
    await this.signIn();
    const res = await fetch(NET_CFG.url + '/rest/v1/pvp_players?select=name,rating,wins,losses,kills,deaths&id=eq.' + this.id, { headers: this.headers() });
    if (!res.ok) return null;
    return (await res.json())[0] || null;
  },
  localBoard() { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('omf-lb:')) try { out[k.slice(7)] = JSON.parse(localStorage.getItem(k)); } catch (e) { /* skip */ } } return out; },

  // ---------- channels ----------
  // channel(topic, { on: { event: fn(payload) }, presence: fn(list) }) → { send, track, leave, ready }
  channel(topic, h) { return NET_LOCAL ? localChannel(topic, h) : RT.channel(topic, h); },
};

// ---------- Supabase Realtime (Phoenix) socket ----------
const RT = {
  ws: null, ref: 0, chans: new Map(), hb: 0, open: false, queue: [],
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const u = NET_CFG.url.replace('https://', 'wss://') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(NET_CFG.key) + '&vsn=1.0.0';
    const ws = this.ws = new WebSocket(u);
    ws.onopen = () => {
      this.open = true;
      clearInterval(this.hb);
      this.hb = setInterval(() => this.push({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) }), 25000);
      for (const c of this.chans.values()) c.join(); // (re)join everything
      const q = this.queue; this.queue = [];
      for (const m of q) this.push(m);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      const c = this.chans.get(m.topic);
      if (c) c.handle(m);
    };
    ws.onclose = () => {
      this.open = false; clearInterval(this.hb);
      if (this.chans.size) setTimeout(() => this.connect(), 1500); // keep the rooms alive
    };
  },
  push(m) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); else this.queue.push(m); },
  channel(name, h) {
    const topic = 'realtime:' + name, rt = this;
    const pres = {}; // key -> metas
    const c = {
      topic, joinRef: null, joined: false, meta: null, h,
      ready: null, _ok: null,
      join() {
        this.joinRef = String(++rt.ref); this.joined = false;
        rt.push({ topic, event: 'phx_join', join_ref: this.joinRef, ref: this.joinRef,
          payload: { config: { broadcast: { self: false, ack: false }, presence: { key: Net.id }, postgres_changes: [], private: false }, access_token: Net.session.access_token } });
      },
      handle(m) {
        if (m.event === 'phx_reply' && m.ref === this.joinRef) {
          if (m.payload && m.payload.status === 'ok') { this.joined = true; if (this.meta) this.track(this.meta); this._ok && this._ok(); }
          else if (h.error) h.error(m.payload && m.payload.response);
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
        } else if (m.event === 'phx_error' || m.event === 'phx_close') {
          if (h.error) h.error(m.event);
        }
      },
      emitPresence() { if (h.presence) h.presence(Object.keys(pres).map((k) => ({ id: k, ...(pres[k][pres[k].length - 1] || {}) }))); },
      send(event, payload) { if (this.joined) rt.push({ topic, event: 'broadcast', ref: String(++rt.ref), join_ref: this.joinRef, payload: { type: 'broadcast', event, payload } }); },
      track(meta) { this.meta = meta; if (this.joined) rt.push({ topic, event: 'presence', ref: String(++rt.ref), join_ref: this.joinRef, payload: { type: 'presence', event: 'track', payload: meta } }); },
      leave() { rt.push({ topic, event: 'phx_leave', ref: String(++rt.ref), join_ref: this.joinRef, payload: {} }); rt.chans.delete(topic); },
    };
    c.ready = new Promise((ok) => { c._ok = ok; });
    this.chans.set(topic, c);
    this.connect();
    if (this.open) c.join();
    return c;
  },
};

// ---------- local transport: BroadcastChannel between tabs ----------
function localChannel(topic, h) {
  const bc = new BroadcastChannel('omf-net:' + topic), me = Net.id, pres = new Map(); // id -> { meta, seen }
  let meta = null, alive = true;
  const emit = () => { if (h.presence) h.presence([...pres.entries()].map(([id, v]) => ({ id, ...v.meta }))); };
  bc.onmessage = (ev) => {
    const m = ev.data;
    if (!alive || m.from === me) return;
    if (m.k === 'bc') { const fn = h.on && h.on[m.event]; if (fn) fn(m.payload); }
    else if (m.k === 'track') { const had = pres.has(m.from); pres.set(m.from, { meta: m.meta, seen: Date.now() }); if (!had || JSON.stringify(pres.get(m.from).meta) !== JSON.stringify(m.meta)) emit(); else emit(); }
    else if (m.k === 'untrack') { pres.delete(m.from); emit(); }
    else if (m.k === 'hello' && meta) bc.postMessage({ k: 'track', from: me, meta });
  };
  const tick = setInterval(() => {
    if (meta) bc.postMessage({ k: 'track', from: me, meta });
    let gone = false;
    for (const [id, v] of pres) if (id !== me && Date.now() - v.seen > 3500) { pres.delete(id); gone = true; }
    if (gone) emit();
  }, 1000);
  const c = {
    ready: Promise.resolve(),
    send(event, payload) { if (alive) bc.postMessage({ k: 'bc', from: me, event, payload }); },
    track(m) { meta = m; pres.set(me, { meta: m, seen: Date.now() }); bc.postMessage({ k: 'track', from: me, meta: m }); emit(); },
    leave() { if (!alive) return; bc.postMessage({ k: 'untrack', from: me }); alive = false; clearInterval(tick); bc.close(); },
  };
  setTimeout(() => bc.postMessage({ k: 'hello', from: me }), 0);
  return c;
}
