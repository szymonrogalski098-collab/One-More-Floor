'use strict';
// Two control schemes, switched automatically by the last device used:
//  - touch: floating joystick anywhere on the canvas, dash button, second-finger tap = dash;
//  - PC: WASD/arrows to move, aim with the mouse, Space/Shift or a mouse click to dash.

const Input = {
  R: 54,           // joystick radius (CSS px)
  dead: 0.12,
  stick: { id: null, ox: 0, oy: 0, cx: 0, cy: 0, x: 0, y: 0, mag: 0, active: false },
  keys: {},
  dashQueued: false,
  tapStarts: new Map(),
  anyTouch: false,
  pc: false,                       // mouse & keyboard mode
  mouse: { x: 0, y: 0, seen: false },

  init(canvas, dashBtn) {
    const opts = { passive: false };
    this.setPc(!!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches));
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
      if (!this.pc) this.setPc(true);
    }, { passive: true });
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && this.pc) this.setPc(false);
      else if (e.pointerType === 'mouse' && !this.pc) this.setPc(true);
    }, { capture: true, passive: true });
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    window.addEventListener('pointermove', (e) => this.onMove(e), opts);
    window.addEventListener('pointerup', (e) => this.onUp(e), opts);
    window.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const pressDash = (e) => {
      e.preventDefault(); e.stopPropagation();
      Sound.init();
      this.dashQueued = true;
      dashBtn.classList.add('pressed');
    };
    const releaseDash = (e) => { e.preventDefault(); dashBtn.classList.remove('pressed'); };
    dashBtn.addEventListener('pointerdown', pressDash, opts);
    dashBtn.addEventListener('pointerup', releaseDash, opts);
    dashBtn.addEventListener('pointercancel', releaseDash, opts);
    dashBtn.addEventListener('pointerleave', releaseDash, opts);

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!this.keys[k] && (k === ' ' || k === 'shift' || k === 'k' || k === 'l')) this.dashQueued = true;
      if (k === 'escape' || k === 'p') { if (typeof onPauseKey === 'function') onPauseKey(); }
      if ((k === 'e' || k === 'enter') && !this.keys[k] && typeof G !== 'undefined' && G.stallOn && typeof stallUse === 'function') stallUse(); // shop / altar
      this.keys[k] = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.release(); });
  },

  setPc(on) {
    this.pc = on;
    document.documentElement.classList.toggle('pc', on);
    document.documentElement.classList.toggle('touch', !on);
    this.release();
    if (typeof UI !== 'undefined' && UI.onControlsChanged) UI.onControlsChanged();
  },

  onDown(e) {
    e.preventDefault();
    Sound.init();
    if (e.pointerType === 'mouse') { // PC: a click is a dash, never a joystick
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
      if (e.button === 0 || e.button === 2) this.dashQueued = true;
      return;
    }
    if (e.pointerType === 'touch') this.anyTouch = true;
    const st = this.stick;
    if (st.id === null) {
      st.id = e.pointerId; st.active = true;
      st.ox = st.cx = e.clientX; st.oy = st.cy = e.clientY;
      st.x = st.y = st.mag = 0;
    } else {
      // second finger: quick tap = dash
      this.tapStarts.set(e.pointerId, { t: performance.now(), x: e.clientX, y: e.clientY });
      this.dashQueued = true;
    }
  },

  onMove(e) {
    const st = this.stick;
    if (e.pointerId !== st.id) return;
    e.preventDefault();
    st.cx = e.clientX; st.cy = e.clientY;
    let dx = st.cx - st.ox, dy = st.cy - st.oy;
    const len = Math.hypot(dx, dy);
    if (len > this.R) {
      // drag the origin along so reversing direction is instant
      const k = (len - this.R) / len;
      st.ox += dx * k; st.oy += dy * k;
      dx = st.cx - st.ox; dy = st.cy - st.oy;
    }
    const l2 = Math.hypot(dx, dy);
    let m = l2 / this.R;
    if (m < this.dead) { st.x = st.y = st.mag = 0; return; }
    m = Math.min(1, (m - this.dead) / (1 - this.dead));
    st.mag = m;
    st.x = (dx / l2) * m; st.y = (dy / l2) * m;
  },

  onUp(e) {
    if (e.pointerId === this.stick.id) this.release();
    this.tapStarts.delete(e.pointerId);
  },

  release() {
    const st = this.stick;
    st.id = null; st.active = false; st.x = st.y = st.mag = 0;
  },

  // Returns movement vector with magnitude 0..1
  vector() {
    let kx = 0, ky = 0;
    const k = this.keys;
    if (k.a || k.arrowleft) kx -= 1;
    if (k.d || k.arrowright) kx += 1;
    if (k.w || k.arrowup) ky -= 1;
    if (k.s || k.arrowdown) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      return { x: kx / l, y: ky / l, mag: 1 };
    }
    const st = this.stick;
    return { x: st.x, y: st.y, mag: st.mag };
  },

  consumeDash() {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  },

  reset() {
    this.release();
    this.dashQueued = false;
    this.tapStarts.clear();
  },
};
