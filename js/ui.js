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
      case 'play': sfx('select'); this.openNewRun(); break;
      case 'again': { sfx('select'); const S = Save.data; this.nr = { asc: Math.min(S.asc.selected | 0, S.asc.unlocked | 0), cp: S.startSel | 0 || 1, ship: S.ship, supplies: [], wager: 0 }; this.nrStart(); break; } // same setup, no shopping
      case 'stall-use': stallUse(); break;
      case 'nr-back': sfx('select'); this.nrBack(); break;
      case 'nr-pick': sfx('select'); this.nrPick(el.dataset.k, el.dataset.v); break;
      case 'nr-go': sfx('select'); this.nrForward(); break;
      case 'nr-skip': sfx('select'); this.nrSkip(); break;
      case 'continue': sfx('select'); startGame(true); break;
      case 'meta': sfx('select'); this.renderMeta(); this.push('s-meta'); break;
      case 'records': sfx('select'); this.renderRecords(); this.push('s-records'); break;
      case 'training': sfx('select'); this.renderTraining(); this.push('s-training'); break;
      case 'train-inc': case 'train-dec': this.trainCount(el.dataset.k, a === 'train-inc' ? 1 : -1); break;
      case 'train-boss': this.trainBoss(el.dataset.k); break;
      case 'train-opt': { const c = Save.data.trainCfg; c[el.dataset.k] = !c[el.dataset.k]; Save.save(); sfx('select'); this.renderTraining(); break; }
      case 'train-go': if (this.trainReady()) { sfx('select'); startTraining(JSON.parse(JSON.stringify(Save.data.trainCfg))); } break;
      case 'train-exit': sfx('select'); exitTraining(); break;
      case 'challenges': sfx('select'); this.renderChallenges(); this.push('s-challenges'); break;
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
    const upKey = run.order.map((id) => id + run.upgrades[id]).join(',') + '|' + (run.curses || []).join(',') + '|' + Object.keys(run.sealed || {}).join(',');
    if (h.ups !== upKey) {
      h.ups = upKey;
      $('hud-ups').innerHTML = run.order.map((id) => {
        const u = UPG[id], n = run.upgrades[id];
        return `<span class="chip${isSealed(id) ? ' sealed' : ''}" style="--c:${TAGS[u.tag].color}">${u.icon}${n > 1 ? '<b>' + n + '</b>' : ''}</span>`;
      }).join('') + (run.curses || []).map((c) => `<span class="chip curse">${CURSE[c].icon}</span>`).join('');
    }
    // dash button (it swaps colour against The Polarity)
    const lbl = polarityActive() ? 'SWAP' : 'DASH';
    if (h.dashLbl !== lbl) { h.dashLbl = lbl; document.querySelector('#btn-dash .dash-label').textContent = lbl; }
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

  // ---------- New run: mode → checkpoint / ascension → ship, supplies & wager ----------
  // Steps with nothing to choose are skipped; with nothing to choose at all PLAY starts at once.
  nrOptions() {
    const S = Save.data;
    return {
      asc: S.asc.unlocked | 0,
      cps: checkpointsFor(0).filter((f) => f > 1),
      ships: SHIPS.filter((x) => S.ships.includes(x.id)),
      buy: S.shards >= Math.min(...SUPPLIES.map((x) => x.cost), WAGER_STAKES[0]),
    };
  },
  // loadout steps, one screen each: ship → supplies → wager (a step you cannot use is skipped)
  nrLoadoutSteps() {
    const S = Save.data, o = this.nrOptions(), out = [];
    if (o.ships.length > 1) out.push('ship');
    if (S.shards >= Math.min(...SUPPLIES.map((x) => x.cost))) out.push('supplies');
    if (S.shards >= WAGER_STAKES[0]) out.push('wager');
    return out;
  },
  nrHasLoadout() { return this.nrLoadoutSteps().length > 0; },
  // the next loadout step after `from` that still makes sense with the shards left, or null (= start)
  nrAfter(from) {
    const steps = this.nrLoadoutSteps(), i = from ? steps.indexOf(from) : -1, left = Save.data.shards - this.nrCost();
    for (const st of steps.slice(i + 1)) {
      if (st === 'supplies' && left < Math.min(...SUPPLIES.map((x) => x.cost))) continue;
      if (st === 'wager' && left < WAGER_STAKES[0]) continue;
      return st;
    }
    return null;
  },
  nrForward() { const nx = this.nrAfter(this.nr.step); if (nx) this.nrGoto(nx); else this.nrStart(); },
  openNewRun() {
    const S = Save.data, o = this.nrOptions();
    this.nr = { step: 'mode', hist: [], mode: 'normal', asc: 0, cp: 1, ship: S.ships.includes(S.ship) ? S.ship : 'striker', supplies: [], wager: 0 };
    if (!o.asc && !o.cps.length && !this.nrHasLoadout()) { this.nrStart(); return; }
    if (!o.asc && !o.cps.length) this.nr.step = this.nrAfter(null);
    this.push('s-newrun');
    this.renderNewRun();
  },
  nrGoto(step) { this.nr.hist.push(this.nr.step); this.nr.step = step; this.renderNewRun(); },
  nrBack() { if (!this.nr || !this.nr.hist.length) { this.back(); return; } this.nr.step = this.nr.hist.pop(); this.renderNewRun(); },
  // after the start floor is settled: the loadout if there is one, else go
  nrNext() { const nx = this.nrAfter(null); if (nx) this.nrGoto(nx); else this.nrStart(); },
  nrPick(k, v) {
    const n = this.nr, S = Save.data;
    if (k === 'mode') {
      n.mode = v; n.asc = 0; n.cp = 1;
      if (v === 'normal') this.nrNext();
      else if (v === 'cp') this.nrGoto('cp');
      else if ((S.asc.unlocked | 0) === 1) { n.asc = 1; if (checkpointsFor(1).length > 1) this.nrGoto('cp'); else this.nrNext(); }
      else this.nrGoto('asc');
    } else if (k === 'asc') {
      n.asc = +v; n.cp = 1;
      if (checkpointsFor(n.asc).length > 1) this.nrGoto('cp'); else this.nrNext();
    } else if (k === 'cp') { n.cp = +v; this.nrNext(); }
    else if (k === 'ship') { n.ship = v; this.nrForward(); } // tapping a ship picks it and moves on
    else if (k === 'supply') {
      const i = n.supplies.indexOf(v);
      if (i >= 0) n.supplies.splice(i, 1);
      else if (n.supplies.length < SUPPLY_MAX && this.nrCost() + SUPPLY[v].cost <= S.shards) n.supplies.push(v);
      this.renderNewRun();
    } else if (k === 'wager') {
      const w = +v;
      if (w === n.wager) n.wager = 0; else if (this.nrCost() - n.wager + w <= S.shards) n.wager = w;
      this.renderNewRun();
    }
  },
  // NEXT / START below the loadout steps; SKIP drops what was picked on this step
  nrSkip() {
    const n = this.nr;
    if (n.step === 'ship') n.ship = Save.data.ships.includes(Save.data.ship) ? Save.data.ship : 'striker';
    if (n.step === 'supplies') n.supplies = [];
    if (n.step === 'wager') n.wager = 0;
    this.nrForward();
  },
  nrCost() { const n = this.nr; return n.supplies.reduce((a, id) => a + SUPPLY[id].cost, 0) + n.wager; },
  nrStart() {
    const S = Save.data, n = this.nr, cost = this.nrCost();
    S.asc.selected = n.asc; S.startSel = n.cp;
    if (S.ships.includes(n.ship)) S.ship = n.ship;
    S.shards -= cost;
    G.pendingLoadout = { supplies: n.supplies.slice(), wager: n.wager };
    Save.save();
    this.nr = null;
    startGame(false);
  },
  nrCard(k, v, title, sub, extra) {
    const e = extra || {};
    return `<button class="nr-card${e.on ? ' on' : ''}${e.dim ? ' dim' : ''}${e.big ? ' big' : ''}" style="--c:${e.color || 'var(--accent)'}" data-action="nr-pick" data-k="${k}" data-v="${v}"${e.dim ? ' disabled' : ''}>
      ${e.tag ? `<span class="nr-tag">${e.tag}</span>` : ''}<span class="nr-title">${title}</span><span class="nr-sub">${sub}</span></button>`;
  },
  renderNewRun() {
    const n = this.nr, S = Save.data, o = this.nrOptions();
    const body = $('nr-body');
    let title = 'NEW RUN', hint = '', html = '';
    if (n.step === 'mode') {
      hint = 'Where do you start?';
      html = '<div class="nr-grid nr-modes">' + this.nrCard('mode', 'normal', 'FLOOR 1', 'The whole tower, from the bottom.', { big: true });
      if (o.cps.length) html += this.nrCard('mode', 'cp', 'CHECKPOINT', o.cps.length + ' unlocked · highest: floor ' + o.cps[o.cps.length - 1], { big: true, color: 'var(--good)' });
      if (o.asc) html += this.nrCard('mode', 'asc', 'ASCENSION', 'Harder towers, more shards · up to level ' + o.asc, { big: true, color: '#ff4f8b' });
      html += '</div>';
    } else if (n.step === 'asc') {
      title = 'ASCENSION'; hint = 'Every level adds one rule on top of the ones before.';
      html = '<div class="nr-grid">';
      for (let l = o.asc; l >= 1; l--) html += this.nrCard('asc', l, 'LEVEL ' + l, ASCENSION[l - 1] + '<br><small>+' + l * 15 + '% shards · best floor ' + ((S.asc.best || [])[l] | 0) + '</small>', { color: '#ff4f8b', tag: 'A' + l });
      html += '</div>';
    } else if (n.step === 'cp') {
      title = n.asc ? 'ASCENSION ' + n.asc : 'CHECKPOINT'; hint = 'Pick a floor. Floors below it pay no shards.';
      const list = checkpointsFor(n.asc).slice().reverse();
      html = '<div class="nr-grid nr-floors">';
      for (const f of list) {
        if (f === 1 && n.mode === 'cp') continue;
        if (f === 1) { html += this.nrCard('cp', 1, 'FLOOR 1', 'From the bottom'); continue; }
        const kit = checkpointKit(f), build = checkpointBuild(n.asc, f);
        html += this.nrCard('cp', f, String(f), (build ? build.order.length - 1 + ' upgrades from your run' : 'Kit + ' + kit.picks + ' picks') + ' · +' + kit.rerolls + ' rerolls', { color: 'var(--good)', tag: 'FLOOR' });
      }
      html += '</div>';
    } else if (n.step === 'ship' || n.step === 'supplies' || n.step === 'wager') {
      const left = S.shards - this.nrCost();
      hint = 'Shards: <b class="shard-v">' + left + '</b>' + (this.nrCost() ? ' <span class="muted">(−' + this.nrCost() + ')</span>' : '');
      if (n.step === 'ship') {
        title = 'SHIP'; hint = 'Tap a ship to fly it.';
        html = '<div class="nr-grid nr-ships">';
        for (const sh of o.ships) html += `<button class="nr-card nr-shipcard${n.ship === sh.id ? ' on' : ''}" style="--c:${sh.color}" data-action="nr-pick" data-k="ship" data-v="${sh.id}">
          <canvas class="nr-shipcv" data-ship="${sh.id}" width="192" height="192"></canvas><span class="nr-title">${sh.name}</span><span class="nr-sub">${sh.desc}</span></button>`;
        html += '</div>';
      } else if (n.step === 'supplies') {
        title = 'SUPPLIES'; hint += ' · this run only, up to ' + SUPPLY_MAX;
        html = '<div class="nr-grid nr-supplies">';
        for (const x of SUPPLIES) {
          const on = n.supplies.includes(x.id), dim = !on && (n.supplies.length >= SUPPLY_MAX || x.cost > left);
          html += this.nrCard('supply', x.id, x.name, x.desc, { on, dim, color: COL.gold, tag: x.cost + ' ◆' });
        }
        html += '</div>';
      } else {
        title = 'WAGER'; const target = wagerTarget(n.cp, S.best.floor);
        hint += '<br>Reach floor <b>' + target + '</b> this run and get double back.';
        html = '<div class="nr-grid nr-wager">';
        for (const w of WAGER_STAKES) {
          const on = n.wager === w, dim = !on && w - n.wager > left;
          html += this.nrCard('wager', w, w + ' ◆', 'win ' + w * 2, { on, dim, color: '#ff4f8b', big: true });
        }
        html += '</div>';
      }
    }
    $('nr-title').textContent = title;
    $('nr-hint').innerHTML = hint;
    body.innerHTML = html;
    body.scrollTop = 0;
    const go = $('nr-go'), skip = $('nr-skip'), load = ['ship', 'supplies', 'wager'].includes(n.step), last = load && !this.nrAfter(n.step);
    go.classList.toggle('hidden', !load || n.step === 'ship');
    skip.classList.toggle('hidden', !load);
    go.textContent = last ? 'START' + (n.cp > 1 ? ' · FLOOR ' + n.cp : '') + (n.asc ? ' · A' + n.asc : '') : 'NEXT';
    skip.textContent = n.step === 'ship' ? 'Skip · keep ' + (SHIP[n.ship] || SHIP.striker).name : last ? 'Skip & start' : 'Skip';
    body.querySelectorAll('.nr-shipcv').forEach((cv) => { const g = cv.getContext('2d'); g.clearRect(0, 0, 192, 192); g.translate(96, 96); g.rotate(-Math.PI / 2); g.scale(5.2, 5.2); Render.drawShip(g, cv.dataset.ship, COL.player); });
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
          <div class="card-desc">${u.desc}</div>${u.evo ? `<div class="evo-line">${UPG[u.evo[0]].name} MAX + ${UPG[u.evo[1]].name}</div>` : ''}
        </div></button>`;
    }).join('');
    const rr = $('btn-reroll');
    rr.classList.toggle('hidden', run.rerolls <= 0);
    rr.textContent = 'Reroll (' + run.rerolls + ')';
    this.show('s-upgrade', { lock: 450 });
  },

  // ---------- Shop ----------
  // ---------- shop & altar: the info panel of the pedestal / stone you stand on ----------
  stallInfo(it) {
    const el = $('stall-info');
    if (!el) return;
    if (!it || !G.stall) { el.classList.add('hidden'); return; }
    const S = G.stall, wallet = shopWallet(), btn = $('stall-btn');
    let title = '', sub = '', label = '', ok = true, col = ROOM.shop.color;
    if (it.type === 'up') {
      const u = UPG[it.id], lvl = (G.run.upgrades[u.id] || 0) + (it.sold ? 0 : 1);
      col = TAGS[u.tag].color; title = u.name + (u.max > 1 ? ' · lvl ' + lvl + '/' + u.max : '');
      sub = RARITY[u.rarity].name + ' ' + TAGS[u.tag].name + ' — ' + u.desc;
      label = it.sold ? 'SOLD' : 'BUY · ◆' + it.price; ok = !it.sold && wallet >= it.price;
    } else if (it.type === 'heal') {
      col = TAGS.tank.color; title = 'Repair Kit'; sub = 'Heal ' + SHOP_HEAL.hp + ' HP (' + G.player.hp + '/' + G.stats.maxHp + ').';
      label = it.sold ? 'SOLD' : 'BUY · ◆' + SHOP_HEAL.price; ok = !it.sold && wallet >= SHOP_HEAL.price && G.player.hp < G.stats.maxHp;
    } else if (it.type === 'reroll') {
      title = 'Reroll'; sub = 'New upgrades on the pedestals that are not sold yet.';
      label = 'REROLL · ◆' + SHOP_REROLL_PRICE; ok = wallet >= SHOP_REROLL_PRICE;
    } else if (it.type === 'trade') {
      title = 'Trade box'; sub = 'Put ' + SHOP_TRADE.cost + ' of your banked shards in (you have ' + Save.data.shards + '), take ◆' + SHOP_TRADE.gain + ' to spend here. Once per shop.';
      label = it.sold ? 'TRADED' : 'TRADE'; ok = !it.sold && Save.data.shards >= SHOP_TRADE.cost;
    } else if (it.type === 'pact') {
      const u = UPG[it.id], have = G.run.upgrades[u.id] || 0;
      col = '#ff4f8b'; title = 'PACT · ' + it.why;
      const give = it.curse ? 'Curse “' + CURSE[it.curse].name + '”: ' + CURSE[it.curse].desc : 'Your ' + UPG[it.lose].name + ((G.run.upgrades[it.lose] || 0) > 1 ? ' (all ' + G.run.upgrades[it.lose] + ' levels)' : '');
      sub = '<b class="pact-give">SACRIFICE</b> ' + give + '<br><b class="pact-get">RECEIVE</b> ' + u.name + (it.levels > 1 ? ' +' + it.levels + ' levels (' + have + ' → ' + (have + it.levels) + ')' : '') + ' — ' + u.desc;
      label = S.done ? (it.taken ? 'SEALED' : 'BROKEN') : 'ACCEPT THE PACT'; ok = !S.done;
    }
    el.querySelector('.st-title').textContent = title;
    el.querySelector('.st-sub').innerHTML = sub;
    el.querySelector('.st-wallet').innerHTML = S.kind === 'shop' ? '<span class="shard-ico"></span>' + wallet + ' this run' : '';
    btn.textContent = label; btn.disabled = !ok;
    el.style.setProperty('--sc', col);
    el.classList.remove('hidden');
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
    if (run.wager && !run.wager.won) goals.push('Wager ' + run.wager.stake + ': reach floor ' + run.wager.target);
    if (run.reviveLeft > 0) goals.push('Last Breath ready');
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
