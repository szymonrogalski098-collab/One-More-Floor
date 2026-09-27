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
      if (buy && !buy.disabled) { if (buy.dataset.ship) this.buyShip(buy.dataset.ship); else this.buyMeta(buy.dataset.id); return; }
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
  // switched between touch and mouse & keyboard: texts that name the controls follow
  onControlsChanged() {
    const h = $('m-controls'), maim = Save.data.settings.mouseAim;
    document.documentElement.classList.toggle('maim', !!maim);
    if (h) h.textContent = Input.pc ? 'WASD to move · ' + (maim ? 'aim with the mouse' : 'auto-aim') + ' · SPACE or click to dash' : 'Drag anywhere to move · auto-fire · DASH to dodge';
  },

  back() {
    const prev = this.stack.pop();
    this.show(prev || 's-menu');
    if (prev === 's-menu' || !prev) this.renderMenu();
    if (prev === 's-dead') this.refreshDeathDots();
  },

  action(a, el) {
    Sound.init();
    switch (a) {
      case 'play': sfx('select'); startGame(false); break;
      case 'continue': sfx('select'); startGame(true); break;
      case 'meta': sfx('select'); this.renderMeta(); this.push('s-meta'); break;
      case 'records': sfx('select'); this.renderRecords(); this.push('s-records'); break;
      case 'training': sfx('select'); this.renderTraining(); this.push('s-training'); break;
      case 'train-inc': case 'train-dec': this.trainCount(el.dataset.k, a === 'train-inc' ? 1 : -1); break;
      case 'train-boss': this.trainBoss(el.dataset.k); break;
      case 'train-opt': { const c = Save.data.trainCfg; c[el.dataset.k] = !c[el.dataset.k]; Save.save(); sfx('select'); this.renderTraining(); break; }
      case 'train-go': if (this.trainReady()) { sfx('select'); startTraining(JSON.parse(JSON.stringify(Save.data.trainCfg))); } break;
      case 'train-exit': sfx('select'); exitTraining(); break;
      case 'shop-buy': shopBuy(+el.dataset.i); break;
      case 'shop-heal': shopHeal(); break;
      case 'shop-reroll': shopReroll(); break;
      case 'shop-leave': sfx('select'); shopLeave(); break;
      case 'altar-pick': altarChoose(+el.dataset.i); break;
      case 'altar-leave': sfx('select'); altarChoose(-1); break;
      case 'challenges': sfx('select'); this.renderChallenges(); this.push('s-challenges'); break;
      case 'ship-prev': case 'ship-next': this.cycleShip(a === 'ship-next' ? 1 : -1); break;
      case 'asc-prev': case 'asc-next': this.cycleAsc(a === 'asc-next' ? 1 : -1); break;
      case 'start-prev': case 'start-next': this.cycleStart(a === 'start-next' ? 1 : -1); break;
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
    if (!on) this.stairInfo(null);
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
    if (G.training) {
      const tr = G.training, key = tr.hits + '|' + Math.floor(tr.t);
      if (h.floor !== key) { h.floor = key; $('hud-floor').textContent = 'TRAINING'; $('hud-best').textContent = 'HITS ' + tr.hits + ' · ' + fmtTime(tr.t); $('hud-best').style.color = tr.hits ? 'var(--danger)' : 'var(--good)'; }
    } else if (h.floor !== run.floor) {
      h.floor = run.floor;
      $('hud-floor').textContent = 'FLOOR ' + run.floor;
      const best = Save.data.best.floor;
      $('hud-best').textContent = run.floor > best && best > 0 ? 'NEW RECORD' : 'BEST ' + best;
      $('hud-best').style.color = run.floor > best && best > 0 ? 'var(--gold)' : '';
    }
    if (h.shards !== run.shards) { h.shards = run.shards; $('hud-shards').textContent = run.shards; }
    const upKey = run.order.map((id) => id + run.upgrades[id]).join(',') + '|' + (run.curses || []).join(',');
    if (h.ups !== upKey) {
      h.ups = upKey;
      $('hud-ups').innerHTML = run.order.map((id) => {
        const u = UPG[id], n = run.upgrades[id];
        return `<span class="chip" style="--c:${TAGS[u.tag].color}">${u.icon}${n > 1 ? '<b>' + n + '</b>' : ''}</span>`;
      }).join('') + (run.curses || []).map((c) => `<span class="chip curse">${CURSE[c].icon}</span>`).join('');
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

  // Preview of the floor behind a staircase (shown while standing on / against it).
  stairInfo(st) {
    const el = $('stair-info');
    if (!st) { el.classList.add('hidden'); return; }
    const next = G.run.floor + 1, R = ROOM[st.type];
    let title = R.name + ' · FLOOR ' + next, sub = '';
    if (st.type === 'combat') sub = 'Fight rooms and corridors. Reward: 1 upgrade.';
    else if (st.type === 'elite') sub = 'Elite enemies guard the last room. Reward: a rare or better upgrade and extra shards.';
    else if (st.type === 'rest') sub = 'No enemies. Heal or train for a random upgrade.';
    else if (st.type === 'shop') sub = 'No enemies. Buy upgrades or healing with the shards from this run (spent shards are not paid out).';
    else if (st.type === 'risk') sub = 'No enemies. Take an epic upgrade together with a curse that lasts the whole run, or walk away.';
    else {
      const b = BOSSES[bossKindFor(next)];
      title = 'BOSS · ' + b.name;
      sub = b.side ? 'An elevator ride in side view: left/right and dash only. It cannot be hurt, and dashing will not dodge its attacks. Survive to win.'
        : 'A boss waits upstairs. Reward: boss upgrade and healing.';
    }
    el.querySelector('.si-title').textContent = title;
    el.querySelector('.si-sub').textContent = sub;
    el.querySelector('.si-hint').textContent = st.locked ? 'Locked — clear the floor first' : st.side ? 'Walk through the door to leave' : 'Walk up the stairs to climb';
    el.style.setProperty('--sc', st.locked ? '#9c96c9' : R.color);
    el.classList.remove('hidden');
    const lay = G.previews && G.previews[G.stairs.indexOf(st)];
    if (lay) Render.drawMapPreview($('si-map'), lay, st.type);
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
    // ship picker (shows locked ships too, with how to get them)
    const sh = SHIP[S.ship] || SHIP.striker, owned = S.ships.includes(sh.id);
    $('pk-ship-name').textContent = sh.name + (owned ? '' : ' · LOCKED');
    $('pk-ship-name').classList.toggle('locked', !owned);
    $('pk-ship-name').style.color = owned ? sh.color : '';
    const ch = CHALLENGES.find((c) => c.reward.ship === sh.id);
    $('pk-ship-desc').textContent = owned ? sh.desc : 'Unlock: ' + (ch ? ch.name + ' (' + ch.desc.replace(/\.$/, '') + ')' : '') + ' or buy in the Workshop';
    this.renderStartPicker();
    // ascension picker
    const A = S.asc, un = A.unlocked | 0;
    $('pick-asc').classList.toggle('hidden', un < 1);
    const sel = Math.min(A.selected | 0, un);
    $('pk-asc-name').textContent = sel === 0 ? 'OFF' : 'LEVEL ' + sel + ' · +' + sel * 15 + '% SHARDS';
    $('pk-asc-desc').textContent = sel === 0 ? 'Normal tower. Up to Ascension ' + un + ' unlocked.' : ASCENSION.slice(0, sel).slice(-2).join(' · ') + (sel > 2 ? ' · +' + (sel - 2) + ' more' : '');
    const done = CHALLENGES.filter((c) => S.challenges[c.id]).length;
    $('m-ch-count').textContent = done + '/' + CHALLENGES.length;
  },

  // ---------- Training ----------
  trainReady() { const c = Save.data.trainCfg; return !!c.boss || TRAIN_ENEMIES.some((k) => (c.enemies[k] | 0) > 0); },
  trainCount(k, d) {
    const c = Save.data.trainCfg, total = TRAIN_ENEMIES.reduce((a, x) => a + (c.enemies[x] | 0), 0);
    if (!trainingUnlocked(k) || (d > 0 && total >= TRAIN_MAX)) return;
    c.enemies[k] = clamp((c.enemies[k] | 0) + d, 0, 8);
    if (d > 0) c.boss = null;
    Save.save(); sfx('select'); this.renderTraining();
  },
  trainBoss(k) {
    const c = Save.data.trainCfg;
    if (!trainingUnlocked(k)) return;
    c.boss = c.boss === k ? null : k;
    if (c.boss) c.enemies = {};
    Save.save(); sfx('select'); this.renderTraining();
  },
  renderTraining() {
    const c = Save.data.trainCfg;
    c.enemies = c.enemies || {};
    $('tr-enemies').innerHTML = TRAIN_ENEMIES.map((k) => {
      const d = ENEMY[k], ok = trainingUnlocked(k), n = c.enemies[k] | 0;
      return `<div class="tr-tile${n ? ' on' : ''}${ok ? '' : ' locked'}" style="--c:${d.color}">
        <span class="tr-dot"></span><span class="tr-name">${ok ? d.name : '???'}</span>
        <div class="tr-count"><button data-action="train-dec" data-k="${k}" aria-label="Fewer">−</button><b>${n}</b><button data-action="train-inc" data-k="${k}" aria-label="More">+</button></div></div>`;
    }).join('');
    $('tr-bosses').innerHTML = BOSS_ORDER.map((k) => {
      const b = BOSSES[k], ok = trainingUnlocked(k);
      return `<button class="tr-tile tr-boss${c.boss === k ? ' on' : ''}${ok ? '' : ' locked'}" style="--c:${b.color}" data-action="train-boss" data-k="${k}">
        <span class="tr-dot"></span><span class="tr-name">${ok ? b.name : '???'}</span><span class="tr-floor">${trainingBossFloor(k)}</span></button>`;
    }).join('');
    document.querySelectorAll('#s-training [data-action="train-opt"]').forEach((t) => {
      t.classList.toggle('on', !!c[t.dataset.k]);
      t.classList.toggle('dim', (t.dataset.k === 'elite' && !!c.boss) || (t.dataset.k === 'hard' && !c.boss));
    });
    $('tr-go').disabled = !this.trainReady();
  },

  cycleShip(dir) {
    const S = Save.data, i = SHIPS.findIndex((x) => x.id === S.ship);
    S.ship = SHIPS[(i + dir + SHIPS.length) % SHIPS.length].id;
    Save.save(); sfx('select'); this.renderMenu();
  },
  cycleStart(dir) {
    const S = Save.data, list = checkpointsFor(Math.min(S.asc.selected | 0, S.asc.unlocked | 0));
    let i = Math.max(0, list.indexOf(S.startSel | 0));
    i = clamp(i + dir, 0, list.length - 1);
    S.startSel = list[i];
    Save.save(); sfx('select'); this.renderMenu();
  },
  renderStartPicker() {
    const S = Save.data, list = checkpointsFor(Math.min(S.asc.selected | 0, S.asc.unlocked | 0));
    if (!list.includes(S.startSel | 0)) S.startSel = list.filter((f) => f <= (S.startSel | 0)).pop() || 1;
    const f = S.startSel | 0;
    $('pick-start').classList.toggle('hidden', list.length < 2);
    $('pk-start-name').textContent = f === 1 ? 'FLOOR 1' : 'CHECKPOINT · FLOOR ' + f;
    $('pk-start-name').style.color = f === 1 ? '' : 'var(--good)';
    const kit = checkpointKit(f), build = f > 1 && checkpointBuild(Math.min(S.asc.selected | 0, S.asc.unlocked | 0), f);
    $('pk-start-desc').textContent = f === 1 ? 'From the bottom. Checkpoints: ' + (list.length - 1) + ' unlocked.'
      : (build ? 'Your build from the run to floor ' + build.reached + ': ' + Math.max(0, build.order.length - 1) + ' of ' + build.order.length + ' upgrades (one lost at random)'
        : 'Starting kit: ' + checkpointBonus(f).map((id) => UPG[id].name).join(', ') + ' + ' + kit.picks + ' picks')
        + ' · +' + kit.rerolls + ' rerolls · floors below ' + f + ' pay no shards';
  },

  cycleAsc(dir) {
    const A = Save.data.asc;
    A.selected = clamp((A.selected | 0) + dir, 0, A.unlocked | 0);
    Save.save(); sfx('select'); this.renderMenu();
  },

  toast(title, sub) {
    const el = $('toast');
    el.querySelector('.t-title').textContent = title;
    el.querySelector('.t-sub').textContent = sub || '';
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 3200);
  },

  renderChallenges() {
    const S = Save.data;
    const done = CHALLENGES.filter((c) => S.challenges[c.id]).length;
    $('ch-progress').textContent = done + '/' + CHALLENGES.length;
    $('ch-list').innerHTML = CHALLENGES.map((c) => {
      const ok = !!S.challenges[c.id];
      const rw = c.reward.ship ? 'Ship: ' + SHIP[c.reward.ship].name : '+' + c.reward.shards + ' shards';
      return `<div class="meta-item ${ok ? 'done maxed' : ''}"><div><div class="mi-name">${c.name}</div><div class="mi-desc">${c.desc}</div><div class="ch-reward">${rw}</div></div>${ok ? '<button class="buy max" disabled>DONE</button>' : ''}</div>`;
    }).join('');
  },

  buyShip(id) {
    const S = Save.data, sh = SHIP[id];
    if (!sh || S.ships.includes(id) || S.shards < sh.cost) return;
    S.shards -= sh.cost; S.ships.push(id); S.ship = id;
    Save.save(); sfx('buy'); this.renderMeta();
    if (SHIPS.every((x) => S.ships.includes(x.id)) && !S.challenges.ships) { S.challenges.ships = Date.now(); S.shards += 300; Save.save(); this.toast('CHALLENGE · HANGAR FULL', '+300 shards'); this.renderMeta(); }
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
    $('up-title').textContent = kind === 'kit' ? 'STARTING KIT' : kind === 'boss' ? 'BOSS REWARD' : kind === 'elite' ? 'ELITE REWARD' : 'CHOOSE AN UPGRADE';
    $('up-sub').textContent = kind === 'kit' ? 'Checkpoint · floor ' + run.start + ' · pick ' + (run.kitTotal - run.kitLeft + 1) + ' of ' + run.kitTotal : 'Floor ' + run.floor + ' cleared';
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

  // ---------- Shop ----------
  showShop() {
    const sh = G.shop, run = G.run, wallet = shopWallet(), p = G.player, s = G.stats;
    $('shop-wallet').textContent = wallet;
    const card = (attrs, badge, top, name, desc, price, sold, cls) => `<button class="card shop-card ${cls}" ${attrs}${sold || price > wallet || cls.includes('full') ? ' disabled' : ''}>${badge}
      <div class="card-body"><div class="card-top">${top}</div><div class="card-name">${name}</div><div class="card-desc">${desc}</div></div>
      <div class="price${sold ? ' sold' : ''}">${sold ? 'SOLD' : '<span class="shard-ico"></span>' + price}</div></button>`;
    $('shop-cards').innerHTML = sh.items.map((it, i) => {
      const u = UPG[it.id], lvl = (run.upgrades[u.id] || 0) + (it.sold ? 0 : 1);
      return card(`data-action="shop-buy" data-i="${i}" style="--tc:${TAGS[u.tag].color}"`, upgBadge(u),
        `<span class="rar">${RARITY[u.rarity].name}</span><span class="tg">${TAGS[u.tag].name}</span>`,
        u.name + (u.max > 1 ? `<span class="lvl">lvl ${lvl}/${u.max}</span>` : ''), u.desc, it.price, it.sold, 'r' + u.rarity);
    }).join('') + card(`data-action="shop-heal" style="--tc:${TAGS.tank.color}"`, `<div class="badge" style="--tc:${TAGS.tank.color}">+HP</div>`,
      `<span class="tg">${TAGS.tank.name}</span>`, 'Repair Kit', 'Heal ' + SHOP_HEAL.hp + ' HP (' + p.hp + '/' + s.maxHp + ').', SHOP_HEAL.price,
      sh.healBought, p.hp >= s.maxHp && !sh.healBought ? 'r0 full' : 'r0');
    $('btn-shop-reroll').innerHTML = 'Reroll · <span class="shard-ico"></span>' + SHOP_REROLL_PRICE;
    $('btn-shop-reroll').disabled = wallet < SHOP_REROLL_PRICE;
    if (this.current !== 's-shop') this.show('s-shop', { lock: 350 });
  },

  // ---------- Altar ----------
  showAltar(offers) {
    $('altar-cards').innerHTML = offers.map((o, i) => {
      const u = UPG[o.id], c = CURSE[o.curse];
      return `<button class="card altar-card r${u.rarity}" data-action="altar-pick" data-i="${i}" style="--tc:${TAGS[u.tag].color}">${upgBadge(u)}
        <div class="card-body"><div class="card-top"><span class="rar">${RARITY[u.rarity].name}</span><span class="tg">${TAGS[u.tag].name}</span></div>
        <div class="card-name">${u.name}</div><div class="card-desc">${u.desc}</div>
        <div class="curse-line"><b>CURSE · ${c.name}</b> ${c.desc}</div></div></button>`;
    }).join('') || '<div class="hint">The altar is silent.</div>';
    this.show('s-altar', { lock: 450 });
  },

  showRest() {
    const p = G.player, s = G.stats;
    const heal = restHealAmount();
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
    document.querySelectorAll('#s-pause .run-only').forEach((b) => b.classList.toggle('hidden', !!G.training));
    document.querySelectorAll('#s-pause .train-only').forEach((b) => b.classList.toggle('hidden', !G.training));
    $('p-nopay').classList.toggle('hidden', !!G.training || run.floor - (run.start || 1) + 1 > 3);
    $('p-info').textContent = G.training ? 'Training · ' + fmtTime(G.training.t) + ' · ' + G.training.hits + ' hits'
      : 'Floor ' + run.floor + ' · ' + fmtTime(run.time) + ' · ' + run.kills + ' kills';
    $('p-build').classList.toggle('hidden', !!G.training);
    // progress toward the run-long challenges
    const goals = [];
    if (!G.training && !challengeDone('flawless') && run.hurt === 0 && (run.start || 1) === 1 && run.floor < 25) goals.push('Flawless Ascent: no hits so far');
    if (!G.training && !challengeDone('ironwill') && run.floor < 40) goals.push('Iron Will: ' + Math.min(30, run.hurt) + '/30 HP lost');
    $('p-goals').textContent = goals.join(' · ');
    const buildHtml = run.order.map((id) => {
      const u = UPG[id];
      return `<div class="build-item">${upgBadge(u)}<div><div class="bi-name">${u.name} ×${run.upgrades[id]}</div><div class="bi-desc">${u.desc}</div></div></div>`;
    }).join('') + (run.curses || []).map((c) => `<div class="build-item curse"><div class="badge">${CURSE[c].icon}</div><div><div class="bi-name">Curse: ${CURSE[c].name}</div><div class="bi-desc">${CURSE[c].desc}</div></div></div>`).join('');
    $('p-build').innerHTML = buildHtml || '<div class="hint">No upgrades yet — clear a floor to pick your first one.</div>';
    this.stack = [];
    this.show('s-pause');
  },

  // ---------- Death ----------
  showDeath(r) {
    this.stack = [];
    this.showHud(false);
    $('d-record').classList.toggle('hidden', !r.record);
    $('d-title').textContent = r.abandon ? 'RUN ENDED' : 'RUN OVER';
    $('d-title').textContent += r.asc ? ' · ASC ' + r.asc : '';
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
    if (r.noPay) next = 'Runs ended within their first 3 floors earn no shards.';
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
    }).join('') + '<div class="meta-sec">HANGAR</div>' + SHIPS.filter((x) => x.cost > 0).map((sh) => {
      const owned = S.ships.includes(sh.id);
      const btn = owned ? '<button class="buy max" disabled>OWNED</button>' : `<button class="buy" data-ship="${sh.id}" ${S.shards < sh.cost ? 'disabled' : ''}><span class="shard-ico"></span>${sh.cost}</button>`;
      return `<div class="meta-item ${owned ? 'maxed' : ''}"><div><div class="mi-name" style="color:${sh.color}">${sh.name}</div><div class="mi-desc">${sh.desc}</div></div>${btn}</div>`;
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
      ${(S.asc.unlocked | 0) > 0 ? '<div class="hist-title">BEST FLOOR PER ASCENSION</div><div class="rec-grid">' + Array.from({ length: (S.asc.unlocked | 0) + 1 }, (_, i) => `<div><span class="k">${i ? 'Ascension ' + i : 'Normal'}</span><span class="v">${S.asc.best[i] | 0}</span></div>`).join('') + '</div>' : ''}
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
    if (key === 'mouseAim') this.onControlsChanged();
    this.renderSettings();
    sfx('select');
  },
};

function chooseUpgradeFromUI(id) {
  if (G.state !== 'reward') return;
  UI.show(null);
  chooseUpgrade(id);
}
