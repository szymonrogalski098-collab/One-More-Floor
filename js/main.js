'use strict';
// Boot, main loop (fixed 60 Hz simulation + variable render), app lifecycle, PWA registration.

const APP_VERSION = '1.7.0';
const STEP = 1 / 60;

const Loop = { last: 0, acc: 0, frameAvg: 1 / 60, slowFor: 0, hudT: 0, raf: 0 };

function applyQualitySetting() {
  const q = Save.data.settings.quality;
  applyQuality(q === 'low' ? 0 : 2);
  Loop.slowFor = 0;
  if (Render.cv) Render.resize();
}

function startGame(resume) {
  Sound.init();
  UI.stack = [];
  UI.show(null);
  UI.showHud(true);
  const snap = resume ? Save.data.snapshot : null;
  if (!snap && !Save.data.ships.includes(Save.data.ship)) UI.toast('SHIP LOCKED', 'Flying the Striker this run');
  newRun(snap);
  G.fade = 1; G.fadeDir = -1;
}

function pauseGame() {
  if (G.state !== 'play') return;
  saveSnapshot(); // app may be killed while in the background: keep the exact spot
  G.state = 'paused';
  Input.reset();
  Sound.music(false);
  UI.showPause();
}

function resumeGame() {
  if (G.state !== 'paused') return;
  UI.stack = [];
  UI.show(null);
  G.state = 'play';
  Input.reset();
  Loop.last = performance.now();
  Sound.music(true);
}

function onPauseKey() {
  if (G.state === 'play') pauseGame();
  else if (G.state === 'paused' && UI.current === 's-pause') resumeGame();
  else if (UI.stack.length && ['s-meta', 's-records', 's-settings', 's-challenges', 's-confirm'].includes(UI.current)) UI.back(); // Esc closes sub-screens
}

function saveAndQuit() {
  // the snapshot taken at floor entry already holds progress; just leave
  goMenu();
}

function goMenu() {
  G.state = 'menu';
  G.run = null;
  Input.reset();
  Sound.music(false);
  UI.showHud(false);
  UI.bossBar(null);
  UI.stack = [];
  UI.renderMenu();
  UI.show('s-menu');
}

function frame(now) {
  Loop.raf = requestAnimationFrame(frame);
  let dt = (now - Loop.last) / 1000;
  Loop.last = now;
  if (!(dt > 0)) dt = STEP;
  if (dt > 0.1) dt = 0.1;

  // adaptive quality: only steps down, never oscillates
  Loop.frameAvg += (dt - Loop.frameAvg) * 0.05;
  if (Save.data.settings.quality === 'auto' && G.state === 'play') {
    if (Loop.frameAvg > 1 / 45) Loop.slowFor += dt; else Loop.slowFor = Math.max(0, Loop.slowFor - dt * 0.5);
    if (Loop.slowFor > 2.5 && Q.level > 0) { applyQuality(Q.level - 1); Render.resize(); Loop.slowFor = 0; }
  }

  const simulating = G.state === 'play' || G.state === 'dying' || G.state === 'climb';
  if (simulating) {
    Loop.acc += dt;
    let steps = 0;
    while (Loop.acc >= STEP && steps < 5) {
      Loop.acc -= STEP; steps++;
      if (G.hitstop > 0) { G.hitstop -= STEP; continue; }
      let sdt = STEP;
      if (G.slowT > 0) { G.slowT -= STEP; sdt *= G.slowScale; }
      step(sdt);
      if (G.state !== 'play' && G.state !== 'dying' && G.state !== 'climb') break;
    }
    if (steps >= 5) Loop.acc = 0;
  } else {
    Loop.acc = 0;
  }

  // fade transitions (between floors)
  if (G.fadeDir !== 0) {
    G.fade = clamp(G.fade + G.fadeDir * dt * 3.6, 0, 1);
    if (G.fadeDir > 0 && G.fade >= 1) {
      G.fadeDir = -1;
      const cb = G.transCb; G.transCb = null;
      if (cb) cb();
    } else if (G.fadeDir < 0 && G.fade <= 0) G.fadeDir = 0;
  }
  if (G.state === 'reward' || G.state === 'paused' || G.state === 'trans') updateFx(dt * 0.25);
  updateFeel(dt);
  Render.updateCamera(dt);

  if (G.run && (G.state === 'play' || G.state === 'reward' || G.state === 'trans' || G.state === 'dying' || G.state === 'climb')) {
    Loop.hudT -= dt;
    if (G.hudDirty || Loop.hudT <= 0) { UI.updateHud(); G.hudDirty = false; Loop.hudT = 0.05; }
  }
  Render.draw();
}

function boot() {
  Save.load();
  applyQualitySetting();
  UI.init();
  UI.onControlsChanged();
  Render.init($('cv'));
  Input.init($('cv'), $('btn-dash'));
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseGame(); Sound.suspend(); }
    else Sound.resume();
  });
  window.addEventListener('pagehide', () => Save.save());
  // unlock audio on first interaction anywhere
  const unlock = () => { Sound.init(); };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  G.state = 'menu';
  UI.renderMenu();
  UI.show('s-menu');
  Loop.last = performance.now();
  Loop.raf = requestAnimationFrame(frame);
  registerSW();
  setupInstallHint();
  if (/[?&]debug\b/.test(location.search)) window.OMF = { G, Save, step, guideTarget, guidePoint, routeTo, distField, clearFloor: debugClearFloor, newRun, enterFloor, spawnBoss, addUpgrade, computeStats, Render, UI, Input, Q, killEnemy, chooseUpgrade, goThroughDoor, startGame, hurtPlayer, rollChoices };
}

let resizeT = 0;
function onResize() {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { UI._safeTop = null; Render.resize(); }, 60);
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('SW registration failed', e));
  });
}

let deferredInstall = null;
function setupInstallHint() {
  const hint = $('install-hint');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (standalone) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    hint.innerHTML = '<button class="btn btn-ghost small" id="btn-install">Install app</button>';
    hint.classList.remove('hidden');
    $('btn-install').addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (err) { /* ignore */ }
      deferredInstall = null;
      hint.classList.add('hidden');
    });
  });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    hint.textContent = 'iOS: tap Share → “Add to Home Screen” to install.';
    hint.classList.remove('hidden');
  }
}

boot();
