'use strict';
// DOM UI: screens, HUD, cards, meta shop, records, settings.

const $ = (id) => document.getElementById(id);

function upgBadge(u, cls = 'badge') {
  const tc = TAGS[u.tag].color;
  return `<div class="${cls}" style="--tc:${tc}">${u.icon}</div>`;
}

let bannerTimer = 0;
function showBanner(title, sub, type) {
  const b = $('banner');
  b.querySelector('.b-title').textContent = title;
  b.querySelector('.b-sub').textContent = sub || '';
  b.style.setProperty('--bc', type && ROOM[type] ? ROOM[type].color : '#4df3ff');
  b.classList.remove('show');
  void b.offsetWidth; // restart animation
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 2000);
}

const UI = {
  current: null,
  stack: [],
  hud: { hp: -1, max: -1, shield: -1, floor: -1, shards: -1, ups: '', dashP: -1, dashC: -1, dashM: -1 },
  _safeTop: null,

  init() {
    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (t) { this.action(t.dataset.action, t); return; }
      const card = e.target.closest('.card');
      if (card) { chooseUpgradeFromUI(card.dataset.id); return; }
      const buy = e.target.closest('.buy');
      if (buy && !buy.disabled) { this.buyMeta(buy.dataset.id); return; }
      const tog = e.target.closest('[data-set]');
      if (tog) { this.toggleSetting(tog.dataset.set); return; }
      const q = e.target.closest('[data-q]');
      if (q) { Save.data.settings.quality = q.dataset.q; Save.save(); applyQualitySetting(); this.renderSettings(); }
    });
    document.querySelectorAll('[data-range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        Save.data.settings[inp.dataset.range] = parseFloat(inp.value);
        Sound.applySettings();
      });
      inp.addEventListener('change', () => { Save.save(); sfx('select'); });
    });
    $('btn-pause').addEventListener('click', (e) => { e.stopPropagation(); pauseGame(); });
    $('ver').textContent = APP_VERSION;
  },

  safeTop() {
    if (this._safeTop === null) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden';
      document.body.appendChild(probe);
      this._safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
      probe.remove();
    }
    return this._safeTop;
  },

  show(id, opts = {}) {
    document.querySelectorAll('.screen.active').forEach((s) => { if (s.id !== id) s.classList.remove('active'); });
    if (!id) { this.current = null; return; }
    const el = $(id);
    el.classList.add('active');
    this.current = id;
    if (opts.lock) {
      el.classList.add('locked');
      setTimeout(() => el.classList.remove('locked'), opts.lock);
    }
  },

  // screens with a "back" button return to whatever opened them
  push(id) { this.stack.push(this.current); this.show(id); },
  back() {
    const prev = this.stack.pop();
    this.show(prev || 's-menu');
    if (prev === 's-menu' || !prev) this.renderMenu();
    if (prev === 's-dead') this.refreshDeathDots();
  },

  action(a) {
    Sound.init();
    switch (a) {
      case 'play': sfx('select'); startGame(false); break;
      case 'continue': sfx('select'); startGame(true); break;
      case 'meta': sfx('select'); this.renderMeta(); this.push('s-meta'); break;
      case 'records': sfx('select'); this.renderRecords(); this.push('s-records'); break;
      case 'settings': sfx('select'); this.renderSettings(); this.push('s-settings'); break;
      case 'back': sfx('select'); this.back(); break;
      case 'resume': sfx('select'); resumeGame(); break;
      case 'save-quit': sfx('select'); saveAndQuit(); break;
      case 'abandon': sfx('select'); this.show(null); abandonRun(); break;
      case 'menu': sfx('select'); goMenu(); break;
      case 'reroll': rerollChoices(); break;
      case 'reset': this.push('s-confirm'); break;
      case 'reset-yes': Save.reset(); this.stack = []; goMenu(); break;
    }
  },

  // ---------- HUD ----------
  showHud(on) {
    $('hud').classList.toggle('hidden', !on);
    $('btn-dash').classList.toggle('hidden', !on);
    $('btn-dash').classList.toggle('left', !!Save.data.settings.lefty);
    if (on) { this.hud.ups = null; this.hud.hp = -1; this.hud.floor = -1; this.hud.dashP = -1; this.hud.dashC = -1; }
  },

  updateHud() {
    const p = G.player, s = G.stats, run = G.run, h = this.hud;
    if (!p || !s) return;
    const shield = p.shield > 0 ? 1 : 0;
    if (h.hp !== p.hp || h.max !== s.maxHp || h.shield !== shield) {
      h.hp = p.hp; h.max = s.maxHp; h.shield = shield;
      let html = '';
      for (let i = 0; i < s.maxHp; i++) html += i < p.hp ? '<i></i>' : '<i class="empty"></i>';
      if (shield) html += '<i class="shield"></i>';
      $('hud-hp').innerHTML = html;
    }
    if (h.floor !== run.floor) {
      h.floor = run.floor;
      $('hud-floor').textContent = 'FLOOR ' + run.floor;
      const best = Save.data.best.floor;
      $('hud-best').textContent = run.floor > best && best > 0 ? 'NEW RECORD' : 'BEST ' + best;
      $('hud-best').style.color = run.floor > best && best > 0 ? 'var(--gold)' : '';
    }
    if (h.shards !== run.shards) { h.shards = run.shards; $('hud-shards').textContent = run.shards; }
    const upKey = run.order.map((id) => id + run.upgrades[id]).join(',');
    if (h.ups !== upKey) {
      h.ups = upKey;
      $('hud-ups').innerHTML = run.order.map((id) => {
        const u = UPG[id], n = run.upgrades[id];
        return `<span class="chip" style="--c:${TAGS[u.tag].color}">${u.icon}${n > 1 ? '<b>' + n + '</b>' : ''}</span>`;
      }).join('');
    }
    // dash button
    const full = p.dashCharges >= s.dashCharges;
    const prog = full ? 1 : Math.round((p.dashRecharge / s.dashCd) * 40) / 40;
    if (h.dashP !== prog) { h.dashP = prog; $('btn-dash').style.setProperty('--p', prog); }
    if (h.dashC !== p.dashCharges || h.dashM !== s.dashCharges) {
      h.dashC = p.dashCharges; h.dashM = s.dashCharges;
      let pips = '';
      if (s.dashCharges > 1) for (let i = 0; i < s.dashCharges; i++) pips += i < p.dashCharges ? '<i></i>' : '<i class="off"></i>';
      $('dash-pips').innerHTML = pips;
      $('btn-dash').classList.toggle('empty', p.dashCharges === 0);
    }
    // boss
    if (G.boss) $('boss-fill').style.transform = 'scaleX(' + Math.max(0, G.boss.hp / G.boss.maxHp).toFixed(3) + ')';
  },

  bossBar(b) {
    $('bossbar').classList.toggle('hidden', !b);
    if (b) { $('boss-name').textContent = b.name; $('boss-fill').style.transform = 'scaleX(1)'; }
  },

  // ---------- Menu ----------
  renderMenu() {
    const S = Save.data;
    $('m-best').textContent = S.best.floor;
    $('m-shards').textContent = S.shards;
    $('m-runs').textContent = S.runs;
    const snap = S.snapshot;
    const c = $('btn-continue');
    c.classList.toggle('hidden', !snap);
    if (snap) c.textContent = 'CONTINUE · FLOOR ' + snap.floor;
    $('m-meta-dot').classList.toggle('hidden', !this.canAffordAny());
  },

  canAffordAny() { return META.some((m) => { const l = Save.metaLvl(m.id); return l < m.max && Save.data.shards >= m.cost[l]; }); },
  cheapestAffordable() {
    let best = null;
    for (const m of META) { const l = Save.metaLvl(m.id); if (l < m.max && Save.data.shards >= m.cost[l] && (!best || m.cost[l] < best.cost)) best = { m, cost: m.cost[l] }; }
    return best;
  },
  cheapestNext() {
    let best = null;
    for (const m of META) { const l = Save.metaLvl(m.id); if (l < m.max && (!best || m.cost[l] < best.cost)) best = { m, cost: m.cost[l] }; }
    return best;
  },

  // ---------- Upgrade cards ----------
  showUpgrade(choices, kind) {
    const run = G.run;
    $('up-title').textContent = kind === 'boss' ? 'BOSS REWARD' : kind === 'elite' ? 'ELITE REWARD' : 'CHOOSE AN UPGRADE';
    $('up-sub').textContent = 'Floor ' + run.floor + ' cleared';
    $('up-cards').innerHTML = choices.map((u) => {
      const lvl = (run.upgrades[u.id] || 0) + 1;
      return `<button class="card r${u.rarity}" data-id="${u.id}" style="--tc:${TAGS[u.tag].color}">
        ${upgBadge(u)}
        <div class="card-body">
          <div class="card-top"><span class="rar">${RARITY[u.rarity].name}</span><span class="tg">${TAGS[u.tag].name}</span></div>
          <div class="card-name">${u.name}${u.max > 1 ? `<span class="lvl">lvl ${lvl}/${u.max}</span>` : ''}</div>
          <div class="card-desc">${u.desc}</div>
        </div></button>`;
    }).join('');
    const rr = $('btn-reroll');
    rr.classList.toggle('hidden', run.rerolls <= 0);
    rr.textContent = 'Reroll (' + run.rerolls + ')';
    this.show('s-upgrade', { lock: 450 });
  },

  showRest() {
    const p = G.player, s = G.stats;
    const heal = Math.max(2, Math.ceil(s.maxHp * 0.5));
    $('up-title').textContent = 'REST';
    $('up-sub').textContent = 'HP: ' + p.hp + '/' + s.maxHp;
    const card = (id, icon, tag, rar, name, desc) => `<button class="card r${rar}" data-id="${id}" style="--tc:${TAGS[tag].color}">
      <div class="badge" style="--tc:${TAGS[tag].color}">${icon}</div>
      <div class="card-body"><div class="card-top"><span class="tg">${TAGS[tag].name}</span></div>
      <div class="card-name">${name}</div><div class="card-desc">${desc}</div></div></button>`;
    $('up-cards').innerHTML =
      card('__heal', '+HP', 'tank', 0, 'Rest', 'Heal ' + heal + ' HP.') +
      card('__train', 'UP', 'core', 1, 'Train', 'Get a random upgrade.');
    $('btn-reroll').classList.add('hidden');
    this.show('s-upgrade', { lock: 450 });
  },

  // ---------- Pause ----------
  showPause() {
    const run = G.run;
    $('p-info').textContent = 'Floor ' + run.floor + ' · ' + fmtTime(run.time) + ' · ' + run.kills + ' kills';
    $('p-build').innerHTML = run.order.length ? run.order.map((id) => {
      const u = UPG[id];
      return `<div class="build-item">${upgBadge(u)}<div><div class="bi-name">${u.name} ×${run.upgrades[id]}</div><div class="bi-desc">${u.desc}</div></div></div>`;
    }).join('') : '<div class="hint">No upgrades yet — clear a floor to pick your first one.</div>';
    this.stack = [];
    this.show('s-pause');
  },

  // ---------- Death ----------
  showDeath(r) {
    this.stack = [];
    this.showHud(false);
    $('d-record').classList.toggle('hidden', !r.record);
    $('d-title').textContent = r.abandon ? 'RUN ENDED' : 'RUN OVER';
    $('d-sub').textContent = r.record ? (r.prevBest > 0 ? 'Previous best: floor ' + r.prevBest : 'Your first record. Now beat it.') : 'Best: floor ' + Save.data.best.floor;
    $('d-floor').textContent = r.floor;
    $('d-kills').textContent = r.kills;
    $('d-time').textContent = fmtTime(r.time);
    $('d-bosses').textContent = r.bosses;
    $('d-dmg').textContent = r.dmg >= 10000 ? (r.dmg / 1000).toFixed(1) + 'k' : Math.round(r.dmg);
    $('d-dodges').textContent = r.dodges;
    $('d-build').innerHTML = r.order.map((id) => {
      const u = UPG[id];
      return `<span class="chip" style="--c:${TAGS[u.tag].color}">${u.name}${r.upgrades[id] > 1 ? ' <b>×' + r.upgrades[id] + '</b>' : ''}</span>`;
    }).join('');
    // count-up
    const el = $('d-earned');
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 900);
      el.textContent = Math.round(r.earned * easeOut(k));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // goal gradient
    let next = '';
    const aff = this.cheapestAffordable();
    if (aff) next = 'You can afford: ' + aff.m.name;
    else {
      const nx = this.cheapestNext();
      if (nx) next = (nx.cost - Save.data.shards) + ' more shards for “' + nx.m.name + '”';
    }
    if (!r.record && Save.data.best.floor - r.floor > 0 && Save.data.best.floor - r.floor <= 3) next = 'Only ' + (Save.data.best.floor - r.floor) + ' ' + (Save.data.best.floor - r.floor === 1 ? 'floor' : 'floors') + ' short of your record. ' + next;
    $('d-next').textContent = next;
    this.refreshDeathDots();
    this.show('s-dead', { lock: 700 });
    if (r.record) setTimeout(() => sfx('record'), 300);
  },
  refreshDeathDots() { $('d-meta-dot').classList.toggle('hidden', !this.canAffordAny()); },

  // ---------- Meta ----------
  renderMeta() {
    const S = Save.data;
    $('meta-shards').textContent = S.shards;
    $('meta-list').innerHTML = META.map((m) => {
      const l = Save.metaLvl(m.id), maxed = l >= m.max, cost = maxed ? 0 : m.cost[l];
      let pips = '';
      if (m.max > 1) { pips = '<div class="mi-lvl">'; for (let i = 0; i < m.max; i++) pips += `<i class="${i < l ? 'on' : ''}"></i>`; pips += '</div>'; }
      const btn = maxed
        ? `<button class="buy max" disabled>${m.unlock ? 'UNLOCKED' : 'MAX'}</button>`
        : `<button class="buy" data-id="${m.id}" ${S.shards < cost ? 'disabled' : ''}><span class="shard-ico"></span>${cost}</button>`;
      return `<div class="meta-item ${maxed ? 'maxed' : ''}"><div><div class="mi-name">${m.name}</div><div class="mi-desc">${m.desc}</div>${pips}</div>${btn}</div>`;
    }).join('');
  },

  buyMeta(id) {
    const m = META.find((x) => x.id === id);
    const S = Save.data, l = Save.metaLvl(id);
    if (!m || l >= m.max || S.shards < m.cost[l]) return;
    S.shards -= m.cost[l];
    S.meta[id] = l + 1;
    Save.save();
    sfx('buy');
    this.renderMeta();
  },

  // ---------- Records ----------
  renderRecords() {
    const S = Save.data;
    const rows = S.history.map((h) => {
      const d = new Date(h.date);
      const tg = TAGS[h.build] || TAGS.core;
      return `<div class="hist-item"><span><b>Floor ${h.floor}</b> <span class="muted">· ${h.kills} kills · ${fmtTime(h.time)}</span></span><span class="chip" style="--c:${tg.color}">${tg.name}</span></div>`;
    }).join('') || '<div class="hint">Nothing yet. Play your first run!</div>';
    $('rec-body').innerHTML = `
      <div class="rec-grid">
        <div><span class="k">Highest floor</span><span class="v">${S.best.floor}</span></div>
        <div><span class="k">Most kills</span><span class="v">${S.best.kills}</span></div>
        <div><span class="k">Runs played</span><span class="v">${S.runs}</span></div>
        <div><span class="k">Bosses defeated</span><span class="v">${S.totals.bosses}</span></div>
        <div><span class="k">Total kills</span><span class="v">${S.totals.kills}</span></div>
        <div><span class="k">Time played</span><span class="v">${fmtTime(S.totals.time)}</span></div>
      </div>
      <div class="hist-title">RECENT RUNS</div>
      <div class="hist">${rows}</div>`;
  },

  // ---------- Settings ----------
  renderSettings() {
    const s = Save.data.settings;
    document.querySelectorAll('[data-set]').forEach((t) => t.classList.toggle('on', !!s[t.dataset.set]));
    document.querySelectorAll('[data-range]').forEach((i) => { i.value = s[i.dataset.range]; });
    document.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === s.quality));
  },
  toggleSetting(key) {
    const s = Save.data.settings;
    s[key] = !s[key];
    Save.save();
    Sound.applySettings();
    if (key === 'lefty') $('btn-dash').classList.toggle('left', s.lefty);
    if (key === 'shake' && !s.shake) G.trauma = 0;
    this.renderSettings();
    sfx('select');
  },
};

function chooseUpgradeFromUI(id) {
  if (G.state !== 'reward') return;
  UI.show(null);
  chooseUpgrade(id);
}
