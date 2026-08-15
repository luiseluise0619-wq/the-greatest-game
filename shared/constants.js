// Shared tuning constants. Imported by both the Node server and the browser client.
// Everything gameplay-relevant lives here so the two stay in lockstep.

export const TICK_RATE = 20;                 // server simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const INPUT_RATE = 30;                // client -> server movement updates per second
export const SNAPSHOT_RATE = 20;             // server -> client world updates per second

// ---------------------------------------------------------------------------
// Player physics
// ---------------------------------------------------------------------------
export const PLAYER = {
  radius: 0.42,
  height: 1.8,
  eye: 1.62,
  crouchHeight: 1.15,
  crouchEye: 1.0,
  maxHealth: 100,
  walkSpeed: 4.4,
  sprintSpeed: 7.1,
  crouchSpeed: 2.2,
  accel: 55,
  airAccel: 12,
  friction: 9,
  gravity: 22,
  jumpSpeed: 6.6,
  stepHeight: 0.62,
  staminaMax: 5.0,          // seconds of sprint
  staminaRegen: 0.9,        // per second
  // Server-side sanity clamp: how far a client may claim to have moved per second.
  maxServerSpeed: 12.5,
};

// ---------------------------------------------------------------------------
// Weapons. Hitscan except dynamite.
// ---------------------------------------------------------------------------
export const WEAPONS = {
  revolver: {
    id: 'revolver',
    name: 'Peacemaker Revolver',
    short: 'REVOLVER',
    slot: 1,
    damage: 32,
    headMult: 2.0,
    limbMult: 0.8,
    pellets: 1,
    fireInterval: 0.28,
    spread: 0.011,           // radians, hip
    spreadMoving: 0.030,
    magSize: 6,
    reserve: 30,
    reserveMax: 42,
    reloadTime: 2.1,
    range: 70,
    falloffStart: 26,
    falloffEnd: 60,
    falloffMin: 0.55,
    recoil: 1.5,
    auto: false,
    swapTime: 0.42,
    noise: 42,               // metres at which the shot can be "heard" by bots
  },
  shotgun: {
    id: 'shotgun',
    name: 'Coach Gun',
    short: 'COACH GUN',
    slot: 2,
    damage: 12,
    headMult: 1.4,
    limbMult: 0.9,
    pellets: 9,
    fireInterval: 0.62,
    spread: 0.075,
    spreadMoving: 0.095,
    magSize: 2,
    reserve: 12,
    reserveMax: 20,
    reloadTime: 2.5,
    range: 32,
    falloffStart: 7,
    falloffEnd: 22,
    falloffMin: 0.2,
    recoil: 4.2,
    auto: false,
    swapTime: 0.55,
    noise: 55,
  },
  rifle: {
    id: 'rifle',
    name: 'Lever Rifle',
    short: 'LEVER RIFLE',
    slot: 3,
    damage: 58,
    headMult: 2.0,
    limbMult: 0.85,
    pellets: 1,
    fireInterval: 0.85,
    spread: 0.020,
    spreadMoving: 0.055,
    spreadAds: 0.0012,
    magSize: 5,
    reserve: 20,
    reserveMax: 30,
    reloadTime: 2.9,
    range: 140,
    falloffStart: 60,
    falloffEnd: 130,
    falloffMin: 0.7,
    recoil: 3.0,
    auto: false,
    swapTime: 0.62,
    ads: true,
    noise: 70,
  },
};

export const DYNAMITE = {
  fuse: 2.6,
  radius: 6.2,
  damage: 115,
  minDamage: 22,
  throwSpeed: 15,
  maxCarried: 2,
  selfDamageMult: 0.75,
  noise: 90,
};

export const WEAPON_ORDER = ['revolver', 'shotgun', 'rifle'];

// ---------------------------------------------------------------------------
// Factions & roles
// ---------------------------------------------------------------------------
export const FACTION = {
  LAW: 'law',
  OUTLAW: 'outlaw',
  RENEGADE: 'renegade',
};

export const ROLES = {
  sheriff: {
    id: 'sheriff',
    bonusHealth: 20,
    name: 'Sheriff',
    faction: FACTION.LAW,
    color: '#e8c15a',
    objective: 'Put down every Outlaw and the Renegade. You alone wear the star.',
    blurb: 'The town is yours to hold. Nobody knows your face - yet.',
  },
  deputy: {
    id: 'deputy',
    name: 'Deputy',
    faction: FACTION.LAW,
    color: '#7fb2e5',
    objective: 'Keep the Sheriff breathing and bury the Outlaws.',
    blurb: 'You were sworn in at dawn. You have a hunch who pinned the star on.',
  },
  outlaw: {
    id: 'outlaw',
    name: 'Outlaw',
    faction: FACTION.OUTLAW,
    color: '#d2564a',
    objective: 'Kill the Sheriff. Nothing else on this earth matters.',
    blurb: 'You rode in with the gang. You only recognised one other face.',
  },
  renegade: {
    id: 'renegade',
    name: 'Renegade',
    faction: FACTION.RENEGADE,
    color: '#a878d8',
    objective: 'Be the last soul standing in this town.',
    blurb: 'Everyone here is in your way. Some of them just do not know it yet.',
  },
};

// Role tables keyed by player count. Deliberately our own balance table.
export const ROLE_TABLE = {
  4: ['sheriff', 'outlaw', 'outlaw', 'renegade'],
  5: ['sheriff', 'deputy', 'outlaw', 'outlaw', 'renegade'],
  6: ['sheriff', 'deputy', 'outlaw', 'outlaw', 'outlaw', 'renegade'],
  7: ['sheriff', 'deputy', 'deputy', 'outlaw', 'outlaw', 'outlaw', 'renegade'],
  8: ['sheriff', 'deputy', 'deputy', 'deputy', 'outlaw', 'outlaw', 'outlaw', 'renegade'],
};

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;

// ---------------------------------------------------------------------------
// Characters. Original silhouettes + one active ability each.
// ---------------------------------------------------------------------------
export const CHARACTERS = {
  gunslinger: {
    id: 'gunslinger',
    name: 'Cassidy "Quickhand" Vane',
    role: 'Gunslinger',
    ability: 'Hair Trigger',
    desc: 'Passive: swaps weapons twice as fast. Active: 5s of rapid fire and instant reloads.',
    cooldown: 34,
    duration: 5,
    hat: '#3a2a20', coat: '#7a4f2a', accent: '#d9b25c',
  },
  medic: {
    id: 'medic',
    name: 'Doc Marisol Vega',
    role: 'Sawbones',
    ability: 'Field Dressing',
    desc: 'Patch the player in your sights for 45 health (or yourself for 30). Trust is a resource.',
    cooldown: 26,
    duration: 0,
    heal: 45,
    selfHeal: 30,
    healRange: 6,
    hat: '#2a2a30', coat: '#c9c2b2', accent: '#b7443c',
  },
  scout: {
    id: 'scout',
    name: 'Wren Ashcroft',
    role: 'Lookout',
    ability: 'Bird Call',
    desc: 'For 4s, anyone moving within 38m glows through walls. Movement only - crouch-holders stay hidden.',
    cooldown: 30,
    duration: 4,
    radius: 38,
    hat: '#4a5a3a', coat: '#59683f', accent: '#c8b280',
    passive: 'Quieter footsteps.',
  },
  duelist: {
    id: 'duelist',
    name: 'Silas Redgrave',
    role: 'Duelist',
    ability: 'Called Shot',
    desc: '6s of near-perfect accuracy and +20% damage - if you can hold your nerve at range.',
    cooldown: 38,
    duration: 6,
    damageMult: 1.2,
    hat: '#1f1c1c', coat: '#2f2a34', accent: '#9a1f2b',
  },
  gambler: {
    id: 'gambler',
    name: 'Odette "Aces" Fontaine',
    role: 'Gambler',
    ability: 'Draw a Card',
    desc: 'Pulls one random boon: speed, armour, a full belt of ammo, a damage streak, or a dust cloud.',
    cooldown: 24,
    duration: 7,
    hat: '#5a2233', coat: '#7d2f42', accent: '#e0c060',
  },
  tracker: {
    id: 'tracker',
    name: 'Nahele Cross',
    role: 'Tracker',
    ability: 'Read the Dust',
    desc: 'Reveals the last 12s of everyone\'s footprints for 8s. Prints are colourless - work out whose they are.',
    cooldown: 32,
    duration: 8,
    trailWindow: 12,
    hat: '#3d3226', coat: '#6b5334', accent: '#8aa06a',
  },
};

export const CHARACTER_ORDER = ['gunslinger', 'medic', 'scout', 'duelist', 'gambler', 'tracker'];

// Gambler outcomes
export const GAMBLER_BOONS = [
  { id: 'speed', label: 'ACE OF SPURS - fleet footed', speedMult: 1.35, duration: 8 },
  { id: 'armour', label: 'IRON PLATE - damage soaked', armour: 45, duration: 12 },
  { id: 'ammo', label: 'FULL BELT - every gun loaded', duration: 0 },
  { id: 'damage', label: 'HOT STREAK - shots bite deeper', damageMult: 1.35, duration: 8 },
  { id: 'dust', label: 'DUST DEVIL - harder to see', dust: true, duration: 7 },
  { id: 'bust', label: 'BUSTED - the deck was cold', duration: 0 },
];

// ---------------------------------------------------------------------------
// Match structure
// ---------------------------------------------------------------------------
export const PHASE = {
  LOBBY: 'lobby',
  PREP: 'prep',
  COMBAT: 'combat',
  ENDGAME: 'endgame',
  RESULTS: 'results',
};

export const TIMING = {
  prep: 45,          // seconds: roles handed out, no damage, grab guns
  combat: 11 * 60,   // main phase
  endgame: 90,       // sudden-death: ring of dust closes on the town square
  results: 22,       // victory screen before auto-restart
  lobbyCountdown: 12,
};

export const ENDGAME = {
  startRadius: 62,
  endRadius: 14,
  centre: { x: 0, z: 0 },
  dps: 9,
};

// ---------------------------------------------------------------------------
// Social systems
// ---------------------------------------------------------------------------
export const SOCIAL = {
  // A kill only names the killer if a third party actually had eyes on them.
  witnessRange: 55,
  witnessFov: Math.cos(Math.PI / 3.1),
  accuseCooldown: 8,
  chatCooldown: 0.6,
  voiceCooldown: 2.5,
  // The Sheriff may pin on the star for a permanent buff and a permanent target.
  badgeHealthBonus: 45,
  badgeDamageResist: 0.85,
  footprintInterval: 0.55,
  footprintTtl: 24,
};

export const VOICE_LINES = [
  { id: 'friendly', text: 'Easy now - I ain\'t your problem.' },
  { id: 'follow', text: 'Stick with me, we\'ll live longer.' },
  { id: 'sawthat', text: 'I saw what you just did.' },
  { id: 'help', text: 'They\'ve got me pinned! Anyone!' },
  { id: 'lawman', text: 'I ride with the law. Believe that or don\'t.' },
  { id: 'liar', text: 'That is a lie and you know it.' },
  { id: 'truce', text: 'Truce. For now.' },
  { id: 'clear', text: 'Nothing over here. Moving on.' },
];

// ---------------------------------------------------------------------------
// Damage / feedback helpers
// ---------------------------------------------------------------------------
export const HITBOX = {
  headY: 1.42,       // above this (feet-relative) counts as a head
  legY: 0.85,        // below this counts as limbs
};

export const LOOT_RESPAWN = 28;   // seconds before a picked-up crate refills

export function rolesForPlayerCount(n) {
  const table = ROLE_TABLE[n] || ROLE_TABLE[MAX_PLAYERS];
  return table.slice();
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
