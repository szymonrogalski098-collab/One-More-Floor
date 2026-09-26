'use strict';
// Procedural SFX + tiny generative music via Web Audio API. No asset files.

const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  let voices = 0;
  const lastPlay = {};
  const MIN_GAP = { shoot: 0.065, hit: 0.035, kill: 0.03, pickup: 0.03, chain: 0.08, burn: 0.1, eshoot: 0.05, shatter: 0.05 };

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    musBus = ctx.createGain();
    sfxBus.connect(master); musBus.connect(master);
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    applySettings();
  }

  function applySettings() {
    if (!ctx) return;
    const s = Save.data.settings;
    master.gain.value = s.sound ? 1 : 0;
    sfxBus.gain.value = s.sfxVol * 0.55;
    musBus.gain.value = s.music ? s.musVol * 0.35 : 0;
  }

  function track(node, end) {
    voices++;
    node.onended = () => { voices--; };
    node.stop(end);
  }

  function tone(type, f0, f1, dur, vol, delay = 0, bus = sfxBus) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); track(o, t + dur + 0.02);
  }

  function noise(dur, vol, f0, f1, ftype = 'bandpass', q = 1, delay = 0) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t, Math.random() * 0.5); track(src, t + dur + 0.02);
  }

  const SFX = {
    shoot() { tone('square', 880 + Math.random() * 120, 440, 0.05, 0.05); },
    eshoot() { tone('triangle', 520, 300, 0.08, 0.06); },
    hit() { tone('square', 300 + Math.random() * 60, 120, 0.05, 0.07); },
    crit() { tone('square', 1200, 500, 0.08, 0.1); noise(0.06, 0.1, 4000, 1500); },
    kill() { noise(0.14, 0.22, 1800, 200); tone('square', 220, 60, 0.12, 0.1); },
    bigkill() { noise(0.35, 0.35, 1200, 80, 'lowpass'); tone('sawtooth', 160, 40, 0.3, 0.2); },
    dash() { noise(0.16, 0.25, 600, 3000, 'bandpass', 2); },
    dodge() { tone('sine', 700, 1400, 0.18, 0.18); tone('sine', 1050, 2100, 0.18, 0.1, 0.05); },
    hurt() { tone('sawtooth', 220, 70, 0.25, 0.3); noise(0.2, 0.3, 900, 150, 'lowpass'); },
    shield() { tone('triangle', 900, 300, 0.25, 0.25); noise(0.15, 0.15, 3000, 800); },
    shieldUp() { tone('sine', 500, 1000, 0.15, 0.12); },
    pickup() { tone('sine', 1300 + Math.random() * 300, 1900, 0.06, 0.07); },
    heal() { [0, 0.07, 0.14].forEach((d, i) => tone('sine', 520 * (1 + i * 0.26), 700 * (1 + i * 0.26), 0.14, 0.14, d)); },
    upgrade() { [0, 0.06, 0.12, 0.2].forEach((d, i) => tone('triangle', [523, 659, 784, 1046][i], [523, 659, 784, 1046][i], 0.18, 0.16, d)); },
    select() { tone('square', 660, 880, 0.05, 0.07); },
    door() { tone('sine', 220, 440, 0.4, 0.2); noise(0.4, 0.12, 300, 1800, 'bandpass', 1.5); },
    clear() { [0, 0.09, 0.18].forEach((d, i) => tone('square', [392, 523, 784][i], [392, 523, 784][i], 0.16, 0.09, d)); },
    spawn() { tone('sine', 180, 360, 0.18, 0.05); },
    explode() { noise(0.45, 0.4, 900, 60, 'lowpass'); tone('sine', 110, 35, 0.4, 0.3); },
    fuse() { tone('square', 1500, 1500, 0.04, 0.05); },
    charge() { tone('sawtooth', 120, 480, 0.6, 0.12); },
    laser() { noise(0.5, 0.18, 2500, 600, 'bandpass', 3); tone('sawtooth', 90, 80, 0.5, 0.14); },
    slam() { noise(0.5, 0.5, 500, 40, 'lowpass'); tone('sine', 90, 30, 0.45, 0.45); },
    jump() { tone('sine', 120, 380, 0.35, 0.15); },
    roar() { tone('sawtooth', 80, 45, 1.1, 0.3); tone('square', 120, 60, 1.1, 0.12); noise(1.0, 0.2, 400, 100, 'lowpass'); },
    bossdie() { noise(1.4, 0.5, 1500, 40, 'lowpass'); tone('sawtooth', 200, 30, 1.4, 0.3); [0, 0.25, 0.5].forEach((d, i) => tone('triangle', [392, 523, 659][i], [392, 523, 659][i], 0.5, 0.15, 0.6 + d)); },
    death() { tone('sawtooth', 300, 40, 1.2, 0.3); noise(1.0, 0.35, 1500, 60, 'lowpass'); },
    chain() { noise(0.08, 0.14, 5000, 2000, 'highpass'); },
    burn() { noise(0.08, 0.06, 1200, 600); },
    shatter() { noise(0.18, 0.2, 5000, 1500, 'highpass'); tone('triangle', 1500, 600, 0.15, 0.08); },
    record() { [0, 0.1, 0.2, 0.3, 0.45].forEach((d, i) => tone('square', [523, 659, 784, 1046, 1318][i], [523, 659, 784, 1046, 1318][i], 0.22, 0.12, d)); },
    buy() { tone('triangle', 660, 1320, 0.2, 0.16); tone('sine', 990, 1980, 0.2, 0.08, 0.05); },
  };

  function play(name) {
    if (!ctx || ctx.state !== 'running' || !Save.data.settings.sound) return;
    if (voices > 28) return;
    const now = ctx.currentTime, gap = MIN_GAP[name] || 0.02;
    if (lastPlay[name] && now - lastPlay[name] < gap) return;
    lastPlay[name] = now;
    const f = SFX[name];
    if (f) f();
  }

  // ---------- Music: lookahead step sequencer ----------
  const MUS = { on: false, step: 0, next: 0, timer: 0, mode: 'normal' };
  const PROG = [[55, 65.4, 82.4], [43.65, 55, 65.4], [49, 61.7, 73.4], [41.2, 49, 61.7]]; // Am F G Em-ish (Hz roots)
  const LEAD = [440, 523, 587, 659, 784, 659, 587, 523];

  function schedStep(t) {
    const bpmStep = MUS.mode === 'boss' ? 0.115 : 0.14;
    const bar = Math.floor(MUS.step / 16) % PROG.length;
    const s = MUS.step % 16;
    const chord = PROG[bar];
    // bass (8ths)
    if (s % 2 === 0) {
      const f = chord[0] * (s % 8 === 6 ? 2 : 1);
      schedTone('triangle', f, t, bpmStep * 1.6, 0.32);
    }
    // arp (16ths, sparse)
    if (MUS.mode === 'boss' || s % 4 !== 3) {
      const f = chord[(s + bar) % 3] * 4;
      schedTone('square', f, t, bpmStep * 0.7, MUS.mode === 'boss' ? 0.06 : 0.04);
    }
    // hat
    if (s % 2 === 1) schedNoise(t, 0.03, MUS.mode === 'boss' ? 0.07 : 0.045);
    if (s % 8 === 4 && MUS.mode === 'boss') schedNoise(t, 0.12, 0.12, 'lowpass', 400);
    // lead line every other bar
    if (bar % 2 === 1 && s % 4 === 0) schedTone('sine', LEAD[(s / 4 + bar) % LEAD.length] * (MUS.mode === 'boss' ? 1 : 0.5), t, bpmStep * 3, 0.05);
    MUS.step++;
    return bpmStep;
  }
  function schedTone(type, f, t, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function schedNoise(t, dur, vol, type = 'highpass', f = 7000) {
    const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; fl.type = type; fl.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(musBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  function musicTick() {
    if (!ctx || !MUS.on) return;
    if (ctx.state !== 'running') return;
    if (MUS.next < ctx.currentTime) MUS.next = ctx.currentTime + 0.05;
    while (MUS.next < ctx.currentTime + 0.25) MUS.next += schedStep(MUS.next);
  }
  function music(on, mode) {
    if (mode) MUS.mode = mode;
    if (on === MUS.on) return;
    MUS.on = on;
    if (on) {
      if (!MUS.timer) MUS.timer = setInterval(musicTick, 90);
    } else if (MUS.timer) { clearInterval(MUS.timer); MUS.timer = 0; }
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

  return { init, play, applySettings, music, suspend, resume, get ready() { return !!ctx; }, get state() { return ctx ? ctx.state : 'none'; } };
})();

function sfx(name) { Sound.play(name); }
