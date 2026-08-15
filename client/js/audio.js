// All sound is synthesised at runtime with WebAudio - no audio files anywhere.
// Distant shots get rolled off and given a canyon tail, which is genuinely
// useful information: you can tell "inside the saloon" from "out on the flats".

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // Shared noise buffer (2s of white noise).
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // A cheap convolver gives the town a bit of canyon.
    const rlen = this.ctx.sampleRate * 1.2;
    const ir = this.ctx.createBuffer(2, rlen, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < rlen; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rlen, 2.6) * 0.5;
      }
    }
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = ir;
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.34;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.ready = true;
    this.startAmbient();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setListener(x, y, z, yaw) { this.listener = { x, y, z, yaw }; }

  /** Returns {gain, pan} for a world position, or null if far out of range. */
  spatial(pos, maxDist = 120) {
    if (!pos) return { gain: 1, pan: 0, dist: 0 };
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const dy = (pos.y ?? 0) - this.listener.y;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDist) return null;
    const gain = Math.max(0, 1 - dist / maxDist) ** 1.7;
    // Project onto the listener's right vector for stereo placement.
    const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
    const len = Math.hypot(dx, dz) || 1;
    const pan = Math.max(-1, Math.min(1, ((dx / len) * rx + (dz / len) * rz)));
    return { gain, pan, dist };
  }

  chain(pan, extraVerb = 1) {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    const g = this.ctx.createGain();
    g.connect(panner);
    panner.connect(this.master);
    const send = this.ctx.createGain();
    send.gain.value = 0.5 * extraVerb;
    panner.connect(send);
    send.connect(this.verb);
    return g;
  }

  noise(dur, gainNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(gainNode);
    src.start();
    src.stop(this.ctx.currentTime + dur);
    return src;
  }

  // -------------------------------------------------------------- gunfire
  gunshot(weapon, pos) {
    if (!this.ready || !this.enabled) return;
    const s = this.spatial(pos, weapon === 'rifle' ? 220 : 160);
    if (!s) return;
    const t = this.ctx.currentTime;
    const far = Math.min(1, s.dist / 70);

    const out = this.chain(s.pan, 0.6 + far * 1.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 12000 - far * 10500;     // distance eats the crack
    lp.connect(out);

    const body = this.ctx.createGain();
    body.connect(lp);

    const profile = {
      revolver: { g: 0.85, dur: 0.30, hp: 320 },
      shotgun: { g: 1.0, dur: 0.42, hp: 180 },
      rifle: { g: 0.95, dur: 0.36, hp: 260 },
    }[weapon] || { g: 0.8, dur: 0.3, hp: 300 };

    const vol = profile.g * s.gain;
    body.gain.setValueAtTime(vol, t);
    body.gain.exponentialRampToValueAtTime(0.0008, t + profile.dur + far * 0.5);

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = profile.hp * (1 - far * 0.6);
    hp.connect(body);
    this.noise(profile.dur + far * 0.6, hp);

    // Low thump so shots have weight up close.
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    og.gain.setValueAtTime(vol * 0.7 * (1 - far * 0.5), t);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    osc.connect(og); og.connect(out);
    osc.start(t); osc.stop(t + 0.2);
  }

  explosion(pos) {
    if (!this.ready || !this.enabled) return;
    const s = this.spatial(pos, 220);
    if (!s) return;
    const t = this.ctx.currentTime;
    const out = this.chain(s.pan, 2.2);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 1.1);
    lp.connect(out);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.5 * s.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    g.connect(lp);
    this.noise(1.4, g);
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 0.6);
    og.gain.setValueAtTime(1.4 * s.gain, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(og); og.connect(out);
    osc.start(t); osc.stop(t + 0.75);
  }

  // ---------------------------------------------------------------- local
  blip(freq, dur, type = 'square', vol = 0.2, slideTo = null) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  hitmarker(kill) {
    this.blip(kill ? 660 : 1250, kill ? 0.16 : 0.06, 'square', 0.16, kill ? 220 : null);
  }

  hurt(amount) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.12 + amount / 160), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    g.connect(lp); lp.connect(this.master);
    this.noise(0.24, g);
    this.blip(140, 0.2, 'sawtooth', 0.09, 70);
  }

  footstep(sprint, surfaceY) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(sprint ? 0.11 : 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = surfaceY > 0.05 ? 520 : 950;   // boardwalk vs dirt
    bp.Q.value = 1.1;
    g.connect(bp); bp.connect(this.master);
    this.noise(0.1, g);
  }

  reloadClick(i) { this.blip(300 + i * 120, 0.045, 'square', 0.1); }
  pickup() { this.blip(520, 0.09, 'triangle', 0.16, 880); }
  deny() { this.blip(150, 0.09, 'square', 0.11, 90); }
  ability() { this.blip(420, 0.22, 'triangle', 0.16, 900); }

  bell() {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (const [f, v, d] of [[440, 0.28, 2.6], [660, 0.14, 2.0], [880, 0.08, 1.5], [1320, 0.05, 1.0]]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + d);
      osc.connect(g); g.connect(this.verb); g.connect(this.master);
      osc.start(t); osc.stop(t + d + 0.05);
    }
  }

  startAmbient() {
    if (!this.ready) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start();
    // Slow gusts.
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.032;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    lfo.start();
    this.ambient = { g, src };
  }
}
