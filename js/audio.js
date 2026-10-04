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

  // ---------- Music: themes on a lookahead step sequencer ----------
  // Every zone (10 floors), the calm rooms and every boss has its own theme: key, chords, tempo, metre,
  // instruments and drum patterns. A melody is generated from a seed each time a theme starts, so it
  // never plays exactly the same. Drums follow the intensity (a fight is on or not).
  const MUS = { on: false, step: 0, next: 0, timer: 0, theme: 'z1', song: null, mel: null, intensity: 0.4 };
  const Q = { m: [0, 3, 7], M: [0, 4, 7], s: [0, 5, 7], d: [0, 3, 6], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], d7: [0, 4, 7, 10] };
  const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], harm: [0, 2, 3, 5, 7, 8, 11], penta: [0, 3, 5, 7, 10] };
  // prog: [midi root, quality] per bar; bass/kick/snare/hat: one char per step ('x' hit, 'o' octave up, '.' rest)
  const SONGS = {
    z1:   { step: 0.14,  key: 57, scale: 'minor',  prog: [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M']], bass: 'x.x.x.o.x.x.x.o.', arp: 'square',   arpPat: 'xx.xx.xxx.xx.xx.', kick: 'x.......x.......', snare: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', lead: 'sine' },
    z2:   { step: 0.13,  key: 50, scale: 'dorian', prog: [[38, 'm7'], [43, 'M'], [38, 'm7'], [36, 'M']], bass: 'x..x..x.x..x..o.', arp: 'triangle', arpPat: 'x.x.xx.x.x.xx.x.', kick: 'x..x....x..x....', snare: '....x.......x..x', hat: 'x.xxx.xxx.xxx.xx', lead: 'square' },
    z3:   { step: 0.125, key: 52, scale: 'minor',  prog: [[40, 'm'], [36, 'M'], [43, 'M'], [38, 'M']], bass: 'x.o.x.o.x.o.x.o.', arp: 'triangle', arpPat: 'xxxxxxxxxxxxxxxx', kick: 'x.......x.x.....', snare: '....x.......x...', hat: '..x...x...x...x.', lead: 'sine', high: true },
    z4:   { step: 0.12,  key: 49, scale: 'phryg',  prog: [[37, 'm'], [38, 'M'], [37, 'm'], [35, 'M']], bass: 'x...x..xx...x..x', arp: 'square',   arpPat: 'x...x...x.x.x...', kick: 'x...x...x...x...', snare: '......x.......x.', hat: '.xx..xx..xx..xx.', lead: 'sawtooth' },
    z5:   { step: 0.11,  key: 54, scale: 'harm',   prog: [[42, 'm'], [38, 'M'], [45, 'M'], [40, 'd7']], bass: 'xoxoxoxoxoxoxoxo', arp: 'square',   arpPat: 'xxxxxxxxxxxxxxxx', kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', lead: 'sawtooth', high: true },
    rest: { step: 0.2,   key: 53, scale: 'major',  prog: [[41, 'M7'], [45, 'm7'], [38, 'm7'], [36, 'M']], bass: 'x.......x.......', arp: 'sine',     arpPat: 'x..x..x..x..x...', pad: true, lead: 'sine', calm: true },
    shop: { step: 0.15,  key: 60, scale: 'major',  prog: [[48, 'M'], [45, 'm'], [41, 'M'], [43, 'd7']], bass: 'x.x.x.x.x.x.x.x.', walk: true, arp: 'triangle', arpPat: '.x.x.x.x.x.x.x.x', hat: '..x...x...x...x.', lead: 'triangle', calm: true },
    altar:{ step: 0.22,  key: 50, scale: 'phryg',  prog: [[38, 'm'], [39, 'M'], [38, 'm'], [37, 'd']], bass: 'x...............', arp: 'sine',     arpPat: 'x.......x.......', pad: true, drone: true, lead: 'sine', calm: true, bell: true },
    boss: { step: 0.105, key: 57, scale: 'harm',   prog: [[45, 'm'], [41, 'M'], [38, 'm'], [40, 'd7']], bass: 'xoxoxoxoxoxoxoxo', arp: 'square',   arpPat: 'xxxxxxxxxxxxxxxx', kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', lead: 'sawtooth', boss: true },
    polarity: { step: 0.11, key: 60, scale: 'minor', prog: [[48, 'm'], [44, 'M'], [51, 'M'], [46, 'M']], bass: 'x.o.x.o.x.o.x.o.', arp: 'square', arpPat: 'x.x.x.x.x.x.x.x.', arp2: 'sine', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', lead: 'square', boss: true },
    keys:  { step: 0.16, key: 47, scale: 'phryg', prog: [[35, 'm'], [36, 'M'], [35, 'm'], [34, 'd']], bass: 'x..x............', kick: 'x..x............', hat: '........x.......', lead: 'sine', bell: true, boss: true, drone: true },
    collapse: { step: 0.1, key: 55, scale: 'minor', prog: [[43, 'm'], [39, 'M'], [41, 'M'], [38, 'm']], bass: 'xxoxxxoxxxoxxxox', arp: 'sawtooth', arpPat: 'x.x.x.x.x.x.x.x.', kick: 'x...x...x...x...', snare: '....x.......x.x.', hat: 'xxxxxxxxxxxxxxxx', lead: 'sawtooth', boss: true },
    puppeteer: { step: 0.13, key: 52, scale: 'harm', bar: 12, prog: [[40, 'm'], [47, 'd7'], [40, 'm'], [45, 'm']], bass: 'x.....x.....', arp: 'triangle', arpPat: '..x.x...x.x.', kick: 'x...........', snare: '....x...x...', hat: '..x.x...x.x.', lead: 'triangle', boss: true, bell: true },
    elevator: { step: 0.12, key: 50, scale: 'dorian', prog: [[38, 'm'], [38, 'm'], [46, 'M'], [48, 'M']], bass: 'x.x.x.x.x.x.x.x.', arp: 'square', arpPat: 'x..x..x..x..x..x', kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', click: true, lead: 'square', boss: true },
    architect: { step: 0.1, key: 57, scale: 'minor', prog: [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M']], bass: 'xoxoxoxoxoxoxoxo', arp: 'sawtooth', arpPat: 'xxxxxxxxxxxxxxxx', kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', lead: 'sawtooth', boss: true, high: true, pad: true },
  };
  // the classic bosses get their own takes on the battle themes
  const shift = (song, d, extra) => ({ ...song, key: song.key + d, prog: song.prog.map(([r, q]) => [r + d, q]), ...extra });
  SONGS.warden = shift(SONGS.boss, -2);
  SONGS.loom = shift(SONGS.z2, 2, { step: 0.1, boss: true, kick: 'x...x...x...x...', hat: 'xxxxxxxxxxxxxxxx' });
  SONGS.mirror = shift(SONGS.z3, 3, { step: 0.105, boss: true, kick: 'x...x...x...x...', bell: true });
  SONGS.forge = shift(SONGS.boss, -5, { lead: 'square', step: 0.11, bass: 'xxoxxxoxxxoxxxox' });
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // a short melody (two bars) built from the theme's scale, regenerated whenever the theme starts
  function makeMelody(song) {
    const sc = SCALES[song.scale], bar = song.bar || 16, out = [];
    let deg = 0;
    for (let i = 0; i < bar * 2; i += 2) {
      if (Math.random() < (song.calm ? 0.45 : 0.3)) { out.push(null); continue; }
      deg = Math.max(-2, Math.min(9, deg + [-2, -1, -1, 0, 1, 1, 2, 3][(Math.random() * 8) | 0]));
      const o = Math.floor(deg / sc.length), k = ((deg % sc.length) + sc.length) % sc.length;
      out.push(song.key + 12 * o + sc[k] + (song.high ? 12 : 0));
    }
    return out;
  }
  function schedStep(t) {
    const S = MUS.song, bar = S.bar || 16, st = S.step;
    const barN = Math.floor(MUS.step / bar), s = MUS.step % bar, [root, q] = S.prog[barN % S.prog.length];
    const chord = Q[q], I = MUS.intensity, at = (pat) => pat && pat[s % pat.length];
    // bass (and a walking line in the shop)
    const bp = at(S.bass);
    if (bp === 'x' || bp === 'o') {
      const n = S.walk ? root + [0, 4, 7, 9, 12, 9, 7, 4][(s >> 1) % 8] : root + (bp === 'o' ? 12 : 0);
      schedTone('triangle', mtof(n), t, st * (S.calm ? 3 : 1.6), S.boss ? 0.34 : 0.3);
    }
    // pad / drone on the bar
    if (s === 0 && S.pad) for (const iv of chord) schedTone('sine', mtof(root + 24 + iv), t, st * bar * 0.95, 0.035, 0.4);
    if (s === 0 && S.drone) schedTone('sawtooth', mtof(root), t, st * bar, 0.02, 0.6);
    // arpeggio
    if (S.arp && at(S.arpPat) === 'x') {
      const n = root + 24 + chord[(s + barN) % chord.length] + (S.high ? 12 : 0);
      schedTone(S.arp2 && barN % 2 ? S.arp2 : S.arp, mtof(n), t, st * 0.8, S.calm ? 0.03 : S.boss ? 0.05 : 0.04);
    }
    // drums follow the intensity
    if (I > 0.55 && at(S.kick) === 'x') schedKick(t, S.boss ? 0.5 : 0.38);
    if (I > 0.55 && at(S.snare) === 'x') schedNoise(t, 0.12, S.boss ? 0.12 : 0.09, 'bandpass', 1800);
    if (I > 0.2 && at(S.hat) === 'x') schedNoise(t, 0.03, (S.calm ? 0.025 : 0.045) * (0.6 + I * 0.4));
    if (S.click && s % 4 === 2) schedNoise(t, 0.02, 0.08, 'lowpass', 900);
    // melody: two bars on, two bars off; a bell sound in the eerie themes
    const ph = barN % 4;
    if (ph >= 2 && s % 2 === 0) {
      const n = MUS.mel[((ph - 2) * bar + s) / 2 | 0];
      if (n != null) schedTone(S.bell ? 'sine' : S.lead, mtof(n + (S.bell ? 12 : 0)), t, st * (S.bell ? 6 : 2.2), S.bell ? 0.06 : 0.045, S.bell ? 0.8 : 0);
    }
    if (barN % 8 === 7 && s === bar - 1) MUS.mel = makeMelody(S); // a new phrase every 8 bars
    MUS.step++;
    return st;
  }
  function schedKick(t, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(musBus); o.start(t); o.stop(t + 0.18);
  }
  function schedTone(type, f, t, dur, vol, attack = 0.01) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(attack, dur * 0.5));
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
  // music(on, theme): theme is a SONGS key; unknown boss kinds use the generic boss theme
  function music(on, mode) {
    if (mode) setTheme(mode);
    if (on === MUS.on) return;
    MUS.on = on;
    if (on) {
      if (!MUS.timer) MUS.timer = setInterval(musicTick, 90);
    } else if (MUS.timer) { clearInterval(MUS.timer); MUS.timer = 0; }
  }

  function setTheme(name) {
    const key = SONGS[name] ? name : name === 'normal' ? MUS.theme : 'boss';
    if (MUS.song && key === MUS.theme) return;
    MUS.theme = key; MUS.song = SONGS[key]; MUS.mel = makeMelody(MUS.song); MUS.step = 0;
  }
  function intensity(x) { MUS.intensity = x; }
  setTheme('z1');
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

  return { init, play, applySettings, music, intensity, get theme() { return MUS.theme; }, suspend, resume, get ready() { return !!ctx; }, get state() { return ctx ? ctx.state : 'none'; } };
})();

function sfx(name) { Sound.play(name); }
