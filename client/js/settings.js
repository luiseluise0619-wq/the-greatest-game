// Player settings: mouse, view, sound.
//
// All of it is local to the browser - the server has no opinion about your
// sensitivity - so this is a small store over localStorage with a change
// callback, and nothing on the wire. Every read and write is guarded: a private
// window or a browser with site data blocked throws on access rather than
// returning null, and a settings panel is not worth breaking the game over.

import { LANGS, pickLang } from '../../shared/i18n.js';

const KEY = 'hnh.settings.v1';

/** What the browser says it would rather read. Guarded: not every host has one. */
function browserLanguages() {
  try {
    const n = globalThis.navigator;
    if (!n) return [];
    return n.languages && n.languages.length ? [...n.languages] : [n.language];
  } catch { return []; }
}

export const LIMITS = {
  sensitivity: { min: 0.0005, max: 0.0075, step: 0.0001 },
  fov: { min: 65, max: 110, step: 1 },
  volume: { min: 0, max: 1, step: 0.01 },
};

export const DEFAULTS = {
  // Not a preference so much as a first guess: whatever the browser asked for,
  // changeable in the panel like everything else here.
  lang: pickLang(browserLanguages()),
  sensitivity: 0.0022,
  invertY: false,
  adsScale: 0.55,      // how much slower the mouse gets down the sights
  fov: 76,
  volume: 0.55,
  muted: false,
  showFps: false,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The one preference here that is not ours to store, because the browser
// already knows it. Somebody who has told their machine that moving pictures
// make them ill has said it once and should not have to say it again in a
// settings panel. Read live rather than cached: the answer can change while
// the page is open, and a round runs for eleven minutes.
const REDUCE = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export function reduceMotion() { return !!REDUCE?.matches; }
/** How much of a decorative movement to keep. */
export function motionScale(floor = 0.25) { return reduceMotion() ? floor : 1; }

/** Coerce anything that came out of storage into a settings object we trust. */
export function sanitise(raw) {
  const s = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;
  if (Number.isFinite(raw.sensitivity)) {
    s.sensitivity = clamp(raw.sensitivity, LIMITS.sensitivity.min, LIMITS.sensitivity.max);
  }
  if (Number.isFinite(raw.fov)) s.fov = Math.round(clamp(raw.fov, LIMITS.fov.min, LIMITS.fov.max));
  if (Number.isFinite(raw.volume)) s.volume = clamp(raw.volume, 0, 1);
  if (Number.isFinite(raw.adsScale)) s.adsScale = clamp(raw.adsScale, 0.2, 1);
  s.lang = LANGS.includes(raw.lang) ? raw.lang : DEFAULTS.lang;
  s.invertY = !!raw.invertY;
  s.muted = !!raw.muted;
  s.showFps = !!raw.showFps;
  return s;
}

export class Settings {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.values = sanitise(read());
  }

  get(key) { return this.values[key]; }

  /** Set one value, persist, and tell the game to apply it. */
  set(key, value) {
    if (!(key in DEFAULTS)) return;
    const next = sanitise({ ...this.values, [key]: value });
    this.values = next;
    write(next);
    this.onChange(next, key);
  }

  reset() {
    this.values = { ...DEFAULTS };
    write(this.values);
    this.onChange(this.values, null);
  }
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function write(values) {
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* nothing to do */ }
}
