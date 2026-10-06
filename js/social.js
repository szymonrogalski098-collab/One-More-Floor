'use strict';
// Google account, pilot name, friends, who is online, invites and the friend QR code.
//  - Signing in with Google gives a profile (unique name, rating) and friends; casual play works without.
//  - Online friends: presence on one shared channel ("omf-online"); invites travel on it too
//    (addressed by id, ignored by everyone else). Invites show up anywhere except inside a match.
//  - A friend QR code is a link to the game with ?friend=<id>: scanning it with any camera opens the game,
//    which then sends the request.

const Social = {
  me: null,        // { id, name, rating, wins, ... } once signed in with Google and named
  friends: [],     // [{ id, name, rating, status: 'pending' | 'accepted', incoming }]
  online: new Map(), // id -> { name, busy }
  ch: null, invite: null, needName: false, busy: false,

  init() {
    // ?friend=<id> from a scanned QR code: remembered until we are signed in
    const q = new URLSearchParams(location.search), f = q.get('friend');
    if (f && /^[0-9a-zA-Z-]{6,40}$/.test(f)) {
      try { localStorage.setItem('omf-friend-pending', f); } catch (e) { /* private mode */ }
      q.delete('friend');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    }
    const r = Net.boot();
    const go = (res) => {
      if (res && res.error) UI.toast('GOOGLE SIGN-IN FAILED', res.error);
      if (Net.google) this.refresh().then(() => { if (res && res.ok) { UI.toast('SIGNED IN', this.me ? 'Welcome back, ' + this.me.name : 'Pick your pilot name'); UI.openMp(); } });
      else if (this.pendingFriend()) UI.toast('FRIEND REQUEST', 'Sign in with Google in Multiplayer to add your friend');
    };
    if (r && r.then) r.then(go); else go(r);
  },
  pendingFriend() { try { return localStorage.getItem('omf-friend-pending'); } catch (e) { return null; } },

  async refresh() {
    if (!Net.google) { this.me = null; this.friends = []; this.needName = false; this.offline(); UI.renderMp(); return; }
    try {
      const me = await Net.rpc('pvp_me');
      this.me = me && me.id ? me : null;
      this.needName = !this.me;
    } catch (e) { this.status = e.message; }
    if (this.me) {
      await this.loadFriends();
      this.goOnline();
      const f = this.pendingFriend();
      if (f && f !== Net.id) { try { localStorage.removeItem('omf-friend-pending'); } catch (e) { /* ignore */ } this.add({ id: f }); }
    }
    UI.renderMp(); UI.renderFriends();
  },
  async setName(name) {
    try {
      this.me = await Net.rpc('pvp_set_name', { p_name: name });
      this.needName = false;
      Save.data.mpName = this.me.name; Save.save();
      await this.refresh();
      return null;
    } catch (e) { return e.message; }
  },
  async login() { await Net.googleLogin(); if (NET_LOCAL) await this.refresh(); },
  async logout() { this.offline(); await Net.signOut(); this.me = null; this.friends = []; this.needName = false; UI.renderMp(); UI.renderFriends(); },

  // ---------- friends ----------
  async loadFriends() {
    if (!this.me) return;
    try { this.friends = (await Net.rpc('friend_list')) || []; } catch (e) { this.friends = []; }
    UI.renderFriends(); UI.renderMp();
  },
  async add(o) {
    try {
      const st = await Net.rpc('friend_add', o.id ? { p_id: o.id } : { p_name: o.name });
      UI.toast(st === 'accepted' ? 'FRIENDS NOW' : 'FRIEND REQUEST SENT', st === 'accepted' ? 'You can invite each other' : 'They will see it next time they are online');
      await this.loadFriends();
      const f = this.friends.find((x) => (o.id ? x.id === o.id : x.name.toLowerCase() === String(o.name).toLowerCase()));
      if (f && this.ch) this.ch.send('fr', { to: f.id }); // refresh their list if they are online
      return null;
    } catch (e) { UI.toast('NOT ADDED', e.message); return e.message; }
  },
  async respond(id, yes) {
    try { await Net.rpc('friend_respond', { p_id: id, p_accept: yes }); if (yes && this.ch) this.ch.send('fr', { to: id }); } catch (e) { UI.toast('ERROR', e.message); }
    this.loadFriends();
  },
  async remove(id) {
    try { await Net.rpc('friend_remove', { p_id: id }); if (this.ch) this.ch.send('fr', { to: id }); } catch (e) { UI.toast('ERROR', e.message); }
    this.loadFriends();
  },
  accepted() { return this.friends.filter((f) => f.status === 'accepted'); },
  requests() { return this.friends.filter((f) => f.status === 'pending' && f.incoming).length; },
  onlineCount() { return this.accepted().filter((f) => this.online.has(f.id)).length; },

  // ---------- online & invites ----------
  goOnline() {
    if (this.ch || !this.me) return;
    this.ch = Net.channel('omf-online', {
      on: {
        inv: (m) => this.onInvite(m),
        'inv-no': (m) => { if (m.to === Net.id) UI.toast(String(m.name || 'Friend').slice(0, 16).toUpperCase(), m.why === 'busy' ? 'is in a match right now' : 'said no this time'); },
        fr: (m) => { if (m.to === Net.id) this.loadFriends(); },
      },
      presence: (list) => {
        this.online = new Map(list.filter((p) => p.id !== Net.id).map((p) => [p.id, p]));
        UI.renderFriends(); UI.renderMp();
      },
    });
    this.ch.ready.then(() => this.track());
  },
  offline() { if (this.ch) { this.ch.leave(); this.ch = null; } this.online = new Map(); },
  track() { if (this.ch && this.me) this.ch.track({ name: this.me.name, busy: !!G.pvp }); },
  async inviteFriend(id) {
    const f = this.friends.find((x) => x.id === id);
    if (!f || !this.ch) return;
    if (!MP.ch || MP.mode !== 'room' || G.pvp) { if (!(await mpCreate())) return; }
    this.ch.send('inv', { to: id, from: Net.id, name: this.me.name, code: MP.code });
    UI.toast('INVITE SENT', f.name + ' · room ' + MP.code);
  },
  onInvite(m) {
    if (m.to !== Net.id || !this.accepted().some((f) => f.id === m.from)) return; // friends only
    if (G.pvp) { if (this.ch) this.ch.send('inv-no', { to: m.from, name: this.me && this.me.name, why: 'busy' }); return; } // never inside a match
    if (MP.ch && MP.code === m.code) return; // already there
    this.invite = m;
    UI.showInvite(m);
  },
  acceptInvite() {
    const m = this.invite; this.invite = null; UI.hideInvite();
    if (!m) return;
    // a single-player run is kept: the snapshot taken now is what Continue resumes
    if (G.run && !G.pvp && (G.state === 'play' || G.state === 'paused' || G.state === 'reward')) { if (G.state === 'play') saveSnapshot(); goMenu(); }
    if (G.training) exitTraining();
    UI.openMp();
    mpJoin(m.code);
  },
  declineInvite() {
    const m = this.invite; this.invite = null; UI.hideInvite();
    if (m && this.ch) this.ch.send('inv-no', { to: m.from, name: this.me && this.me.name, why: 'no' });
  },

  // ---------- QR ----------
  friendLink() { return location.origin + location.pathname + '?friend=' + Net.id; },
  drawQR(canvas, text) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), quiet = 3, px = Math.floor(canvas.width / (n + quiet * 2)), off = Math.floor((canvas.width - px * n) / 2);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#0b0918';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect(off + x * px, off + y * px, px, px);
  },
  // the camera, where the browser can read QR codes itself (Chrome on Android); elsewhere the phone's camera app does it
  canScan() { return 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
  async scan(video, done) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (e) { done(null, 'No camera access'); return; }
    video.srcObject = stream; await video.play().catch(() => {});
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    let on = true;
    const stop = () => { on = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
    const tick = async () => {
      if (!on) return;
      try {
        const codes = await det.detect(video);
        for (const c of codes) { const id = new URL(c.rawValue, location.href).searchParams.get('friend'); if (id) { stop(); done(id); return; } }
      } catch (e) { /* frame not ready */ }
      setTimeout(tick, 250);
    };
    tick();
    return stop;
  },
};
