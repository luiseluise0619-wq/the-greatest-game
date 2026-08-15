// The match. One room, one town, up to 8 gunhands (humans + bots).
//
// Authority split, chosen deliberately for a prototype:
//   - movement is client-simulated and server-clamped (keeps aiming crisp)
//   - EVERYTHING that matters - hits, damage, deaths, roles, who-learns-what -
//     is resolved here and never trusted to a client.

import {
  PLAYER, WEAPONS, DYNAMITE, WEAPON_ORDER, ROLES, PHASE, TIMING, ENDGAME,
  SOCIAL, HITBOX, CHARACTERS, GAMBLER_BOONS, LOOT_RESPAWN, VOICE_LINES,
  TICK_MS, MIN_PLAYERS, MAX_PLAYERS, rolesForPlayerCount, clamp,
} from '../shared/constants.js';
import MAP, { zoneAt, SPAWNS, LOOT_SPAWNS } from '../shared/map.js';
import { raycastWorld, rayPlayerBox, lineOfSight } from '../shared/collision.js';
import { C, S } from '../shared/protocol.js';
import { BotBrain, BOT_NAMES } from './bots.js';

const now = () => Date.now() / 1000;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const r2 = (v) => Math.round(v * 100) / 100;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function playerHeight(p) { return p.crouch ? PLAYER.crouchHeight : PLAYER.height; }
export function eyeOf(p) {
  return { x: p.pos.x, y: p.pos.y + (p.crouch ? PLAYER.crouchEye : PLAYER.eye), z: p.pos.z };
}
export function chestOf(p) {
  return { x: p.pos.x, y: p.pos.y + playerHeight(p) * 0.6, z: p.pos.z };
}

let nextId = 1;

export class Room {
  constructor() {
    this.clients = new Set();
    this.players = new Map();
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = 0;
    this.tick = 0;
    this.loot = [];
    this.dynamites = [];
    this.footprints = [];
    this.results = null;
    this.matchNumber = 0;
    this.lastTime = now();
    this.botFillTarget = 6;
    this.resetLoot();
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------
  addConnection(ws) {
    const client = { ws, playerId: null };
    this.clients.add(client);
    this.send(client, { t: S.WELCOME, map: MAP.name, phase: this.phase, maxPlayers: MAX_PLAYERS });
    return client;
  }

  removeConnection(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    const p = this.players.get(client.playerId);
    if (p) {
      if (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULTS) {
        this.players.delete(p.id);
      } else {
        // Mid-match disconnects leave a corpse so the deduction state stays honest.
        p.connected = false;
        if (p.alive) this.killPlayer(p, null, 'left', null);
        else this.players.delete(p.id);
      }
      this.pushLobby();
    }
  }

  send(client, msg) {
    if (!client || !client.ws || client.ws.readyState !== 1) return;
    try { client.ws.send(JSON.stringify(msg)); } catch { /* dropped */ }
  }

  emit(player, msg) {
    if (!player || player.bot || !player.client) return;
    this.send(player.client, msg);
  }

  broadcast(msg, filter = null) {
    for (const p of this.players.values()) {
      if (p.bot || !p.client) continue;
      if (filter && !filter(p)) continue;
      this.send(p.client, msg);
    }
  }

  // -------------------------------------------------------------------------
  // Player construction
  // -------------------------------------------------------------------------
  makePlayer(opts) {
    const id = nextId++;
    const character = CHARACTERS[opts.character] ? opts.character : 'gunslinger';
    return {
      id,
      name: (opts.name || 'Stranger').slice(0, 16),
      bot: !!opts.bot,
      client: opts.client || null,
      connected: true,
      character,
      role: null,
      faction: null,
      intel: null,
      alive: false,
      health: PLAYER.maxHealth,
      maxHealth: PLAYER.maxHealth,
      armour: 0,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0,
      crouch: false, sprint: false, moving: false, grounded: true,
      guns: { revolver: { mag: WEAPONS.revolver.magSize, reserve: WEAPONS.revolver.reserve } },
      slot: 'revolver',
      dynamite: 0,
      reloading: null,
      nextFireAt: 0,
      swapUntil: 0,
      abilityReadyAt: 0,
      abilityUntil: 0,
      abilityKind: null,
      buffs: {},
      badge: false,
      kills: 0,
      damageDealt: 0,
      deaths: 0,
      lastHitBy: null,
      lastHitAt: 0,
      lastFootprintAt: 0,
      lastChatAt: 0,
      lastAccuseAt: 0,
      lastInputAt: now(),
      revealUntil: 0,
      trailGroup: 0,
      brain: null,
      spawnIndex: 0,
      firedAt: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------
  handleMessage(client, msg) {
    if (msg.t === C.JOIN) return this.onJoin(client, msg);
    const p = this.players.get(client.playerId);
    if (!p) return;
    switch (msg.t) {
      case C.INPUT: return this.onInput(p, msg);
      case C.SHOOT: return this.onShoot(p, msg);
      case C.RELOAD: return this.startReload(p);
      case C.SWAP: return this.onSwap(p, msg);
      case C.PICKUP: return this.onPickup(p, msg);
      case C.ABILITY: return this.onAbility(p);
      case C.THROW: return this.onThrow(p, msg);
      case C.CHAT: return this.onChat(p, msg);
      case C.ACCUSE: return this.onAccuse(p, msg);
      case C.VOICE: return this.onVoice(p, msg);
      case C.BADGE: return this.onBadge(p);
      case C.ADD_BOT: return this.onAddBot(p, msg);
      case C.START: return this.onStart(p, msg);
      case C.RESTART: return this.onRestart(p);
      default: return;
    }
  }

  onJoin(client, msg) {
    if (client.playerId) return;
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    if (humans >= MAX_PLAYERS) {
      return this.send(client, { t: S.ERROR, msg: 'Town is full - 8 guns is the limit.' });
    }
    const p = this.makePlayer({
      name: String(msg.name || '').trim() || `Stranger ${humans + 1}`,
      character: msg.character,
      client,
    });
    client.playerId = p.id;
    this.players.set(p.id, p);
    this.send(client, { t: S.WELCOME, selfId: p.id, map: MAP.name, phase: this.phase, maxPlayers: MAX_PLAYERS });
    this.sendPhaseTo(client);

    // A human joining mid-match takes over the quietest bot so they play now,
    // rather than watching a 10 minute round from the lobby.
    if (this.phase !== PHASE.LOBBY && this.phase !== PHASE.RESULTS) {
      const bot = [...this.players.values()].find((b) => b.bot && b.alive);
      if (bot) {
        this.players.delete(p.id);
        bot.bot = false;
        bot.brain = null;
        bot.client = client;
        bot.name = p.name;
        bot.character = p.character;
        client.playerId = bot.id;
        this.send(client, { t: S.WELCOME, selfId: bot.id, map: MAP.name, phase: this.phase, maxPlayers: MAX_PLAYERS });
        this.sendRole(bot);
        this.sendPhaseTo(client);
        this.pushLobby();
        return;
      }
    }
    this.pushLobby();
  }

  onAddBot(p, msg) {
    if (this.phase !== PHASE.LOBBY) return;
    const delta = msg.remove ? -1 : 1;
    this.botFillTarget = clamp(this.botFillTarget + delta, MIN_PLAYERS, MAX_PLAYERS);
    this.pushLobby();
  }

  onStart(p, msg) {
    if (this.phase !== PHASE.LOBBY) return;
    if (msg && msg.character && CHARACTERS[msg.character]) p.character = msg.character;
    if (msg && msg.name) p.name = String(msg.name).slice(0, 16);
    this.beginMatch();
  }

  onRestart(p) {
    if (this.phase !== PHASE.RESULTS) return;
    this.toLobby();
  }

  onInput(p, msg) {
    if (!p.alive) return;
    const t = now();
    const dt = clamp(t - p.lastInputAt, 0.001, 0.25);
    p.lastInputAt = t;

    if (typeof msg.yaw === 'number') p.yaw = msg.yaw;
    if (typeof msg.pitch === 'number') p.pitch = clamp(msg.pitch, -1.55, 1.55);
    p.crouch = !!msg.crouch;
    p.sprint = !!msg.sprint;
    p.moving = !!msg.moving;

    if (msg.pos && Number.isFinite(msg.pos.x)) {
      const nx = clamp(msg.pos.x, MAP.bounds.min, MAP.bounds.max);
      const ny = clamp(msg.pos.y, -2, 40);
      const nz = clamp(msg.pos.z, MAP.bounds.min, MAP.bounds.max);
      // Speed clamp: generous enough for stairs and falls, tight enough that a
      // hacked client cannot teleport across the map.
      const allowed = PLAYER.maxServerSpeed * dt + 0.6;
      const dx = nx - p.pos.x, dy = ny - p.pos.y, dz = nz - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d <= allowed || d > 400) {
        p.pos.x = nx; p.pos.y = ny; p.pos.z = nz;
      } else {
        const k = allowed / d;
        p.pos.x += dx * k; p.pos.y += dy * k; p.pos.z += dz * k;
      }
    }
  }

  onSwap(p, msg) {
    if (!p.alive) return;
    const slot = String(msg.slot || '');
    if (!p.guns[slot] || p.slot === slot) return;
    p.slot = slot;
    p.reloading = null;
    const mult = p.character === 'gunslinger' ? 0.5 : 1;
    p.swapUntil = now() + WEAPONS[slot].swapTime * mult;
    this.pushSelf(p);
  }

  // -------------------------------------------------------------------------
  // Shooting
  // -------------------------------------------------------------------------
  canFire(p) {
    const t = now();
    if (!p.alive) return false;
    if (t < p.swapUntil || t < p.nextFireAt) return false;
    if (p.reloading) return false;
    const g = p.guns[p.slot];
    return g && g.mag > 0;
  }

  onShoot(p, msg) {
    if (!this.canFire(p)) return;
    const w = WEAPONS[p.slot];
    const g = p.guns[p.slot];
    const t = now();

    const fireMult = p.buffs.fireRateMult || 1;
    g.mag -= 1;
    p.nextFireAt = t + w.fireInterval * fireMult;
    p.firedAt = t;

    const origin = eyeOf(p);
    let dir = normalize(msg.dir);
    if (!dir) return;
    // The client tells us where it is looking; we own everything after that.
    const ads = !!msg.ads && w.ads;
    let spread = ads ? (w.spreadAds ?? w.spread * 0.25) : (p.moving ? w.spreadMoving : w.spread);
    if (p.buffs.spreadMult) spread *= p.buffs.spreadMult;

    const rays = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = spread > 0 ? jitter(dir, spread) : dir;
      const hit = this.traceShot(p, origin, d, w);
      rays.push(hit.ray);
      if (hit.victim) this.applyDamage(hit.victim, p, hit.damage, w.id, hit.point, hit.zone);
    }

    this.broadcast({
      t: S.SHOT,
      id: p.id,
      w: w.id,
      o: [r2(origin.x), r2(origin.y), r2(origin.z)],
      rays: rays.map((r) => [r2(r.x), r2(r.y), r2(r.z)]),
    });
    this.notifyBots('gunshot', { pos: origin, shooter: p, weapon: w });
    if (g.mag === 0) this.startReload(p);
    this.pushSelf(p);
  }

  /** One bullet: nearest of world geometry and player boxes. */
  traceShot(shooter, origin, dir, w) {
    const worldHit = raycastWorld(origin, dir, w.range, MAP.solids);
    let bestT = worldHit ? worldHit.t : w.range;
    let victim = null, point = null, part = 'body';

    for (const p of this.players.values()) {
      if (p === shooter || !p.alive) continue;
      const h = rayPlayerBox(origin, dir, p.pos.x, p.pos.y, p.pos.z, PLAYER.radius, playerHeight(p), bestT);
      if (h && h.t < bestT) {
        bestT = h.t;
        victim = p;
        point = h.point;
      }
    }

    const ray = {
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
    };

    if (!victim) return { ray, victim: null };

    const rel = point.y - victim.pos.y;
    const h = playerHeight(victim);
    if (rel > (victim.crouch ? HITBOX.headY * 0.7 : HITBOX.headY)) part = 'head';
    else if (rel < HITBOX.legY * (h / PLAYER.height)) part = 'legs';

    let dmg = w.damage;
    if (part === 'head') dmg *= w.headMult;
    else if (part === 'legs') dmg *= w.limbMult;

    // Range falloff keeps the coach gun honest and the rifle king at distance.
    if (bestT > w.falloffStart) {
      const k = clamp((bestT - w.falloffStart) / (w.falloffEnd - w.falloffStart), 0, 1);
      dmg *= 1 - (1 - w.falloffMin) * k;
    }
    dmg *= shooter.buffs.damageMult || 1;

    return { ray, victim, damage: dmg, point, zone: part };
  }

  applyDamage(victim, attacker, amount, cause, point, part = 'body') {
    if (!victim.alive) return;
    if (this.phase === PHASE.PREP) return;                       // guns are noise only in prep
    if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.ENDGAME) return;

    let dmg = amount;
    if (victim.badge) dmg *= SOCIAL.badgeDamageResist;
    if (victim.buffs.resist) dmg *= victim.buffs.resist;

    if (victim.armour > 0) {
      const soaked = Math.min(victim.armour, dmg * 0.6);
      victim.armour -= soaked;
      dmg -= soaked;
    }
    dmg = Math.round(dmg);
    if (dmg <= 0) return;

    victim.health -= dmg;
    if (attacker && attacker !== victim) {
      attacker.damageDealt += dmg;
      victim.lastHitBy = attacker.id;
      victim.lastHitAt = now();
    }

    this.emit(victim, {
      t: S.DAMAGE, amount: dmg, hp: Math.max(0, victim.health),
      from: attacker ? [r2(attacker.pos.x), r2(attacker.pos.y), r2(attacker.pos.z)] : null,
      part,
    });
    if (attacker && !attacker.bot) {
      this.emit(attacker, { t: S.HIT, part, lethal: victim.health <= 0, amount: dmg });
    }
    this.notifyBots('damaged', { victim, attacker, amount: dmg });

    if (victim.health <= 0) this.killPlayer(victim, attacker, cause, point);
    else this.pushSelf(victim);
  }

  // -------------------------------------------------------------------------
  // Death + the information rules that make this a deduction game
  // -------------------------------------------------------------------------
  killPlayer(victim, killer, cause, point) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.deaths += 1;
    if (killer && killer !== victim) killer.kills += 1;

    const place = zoneAt(victim.pos.x, victim.pos.z, victim.pos.y);
    const role = ROLES[victim.role];

    // Who actually SAW the shooter? Only they learn the name. Everyone else gets
    // a rumour: a body, a place, and the dead player's role.
    const witnesses = new Set();
    if (killer && killer !== victim) {
      witnesses.add(killer.id);
      witnesses.add(victim.id);   // you always know who shot you
      for (const p of this.players.values()) {
        if (!p.alive || p.id === killer.id || p.id === victim.id) continue;
        const eye = eyeOf(p);
        const kc = chestOf(killer);
        const d = Math.hypot(kc.x - eye.x, kc.y - eye.y, kc.z - eye.z);
        if (d > SOCIAL.witnessRange) continue;
        const to = { x: (kc.x - eye.x) / d, y: (kc.y - eye.y) / d, z: (kc.z - eye.z) / d };
        const fwd = forwardOf(p);
        if (to.x * fwd.x + to.y * fwd.y + to.z * fwd.z < SOCIAL.witnessFov) continue;
        if (!lineOfSight(eye, kc, MAP.solids)) continue;
        witnesses.add(p.id);
      }
    }

    for (const p of this.players.values()) {
      const saw = witnesses.has(p.id);
      this.emit(p, {
        t: S.KILL,
        victim: victim.id,
        victimName: victim.name,
        victimRole: victim.role,
        roleName: role?.name,
        roleColor: role?.color,
        killer: saw && killer ? killer.id : null,
        killerName: saw && killer ? killer.name : null,
        witnessed: saw,
        place,
        cause,
        youDied: p.id === victim.id,
        youKilled: killer ? p.id === killer.id : false,
      });
    }
    this.notifyBots('kill', { victim, killer, witnesses });

    // Drop the good guns where you fell - the body is worth investigating.
    for (const slot of WEAPON_ORDER) {
      if (slot !== 'revolver' && victim.guns[slot]) {
        this.spawnLoot(victim.pos.x, victim.pos.y + 0.2, victim.pos.z, slot, true);
      }
    }
    if (victim.dynamite > 0) this.spawnLoot(victim.pos.x + 0.5, victim.pos.y + 0.2, victim.pos.z, 'dynamite', true);

    this.emit(victim, { t: S.SELF, dead: true });
    this.checkVictory();
  }

  checkVictory() {
    if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.ENDGAME) return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    const sheriff = [...this.players.values()].find((p) => p.role === 'sheriff');
    const aliveOutlaws = alive.filter((p) => p.role === 'outlaw').length;
    const aliveRenegades = alive.filter((p) => p.role === 'renegade').length;
    const aliveLaw = alive.filter((p) => p.faction === 'law').length;

    if (sheriff && !sheriff.alive) {
      // The star falls: the round is over one way or the other.
      if (aliveRenegades === 1 && alive.length === 1) {
        return this.endMatch('renegade', 'The Renegade stands alone in the dust.');
      }
      if (aliveOutlaws > 0) {
        return this.endMatch('outlaw', 'The Sheriff is dead. The gang rides out rich.');
      }
      if (aliveRenegades > 0) {
        return this.endMatch('renegade', 'The star fell and the Renegade was the last hand on a trigger.');
      }
      return this.endMatch('law', 'Everyone hostile died before the Sheriff bled out. The town holds.');
    }

    if (aliveOutlaws === 0 && aliveRenegades === 0) {
      return this.endMatch('law', 'Every outlaw and the renegade are buried. The law holds Perdition Flats.');
    }
    if (alive.length === 1 && aliveRenegades === 1) {
      return this.endMatch('renegade', 'The Renegade is the last soul standing.');
    }
    if (alive.length === 0) {
      return this.endMatch('none', 'Nobody walked away. The buzzards win.');
    }
    if (aliveLaw === 0 && aliveOutlaws > 0 && aliveRenegades === 0 && (!sheriff || !sheriff.alive)) {
      return this.endMatch('outlaw', 'The law is wiped out.');
    }
  }

  // -------------------------------------------------------------------------
  // Loot
  // -------------------------------------------------------------------------
  resetLoot() {
    this.loot = LOOT_SPAWNS.map((l, i) => ({
      id: i + 1, x: l.x, y: l.y, z: l.z, type: l.type, active: true, respawnAt: 0, dropped: false,
    }));
    this.nextLootId = LOOT_SPAWNS.length + 1;
  }

  spawnLoot(x, y, z, type, dropped = false) {
    const item = { id: this.nextLootId++, x, y, z, type, active: true, respawnAt: 0, dropped };
    this.loot.push(item);
    this.broadcast({ t: S.LOOT, add: [lootWire(item)] });
    return item;
  }

  onPickup(p, msg) {
    if (!p.alive) return;
    const item = this.loot.find((l) => l.id === msg.id && l.active);
    if (!item) return;
    const d = Math.hypot(item.x - p.pos.x, item.y - (p.pos.y + 0.9), item.z - p.pos.z);
    if (d > 2.6) return;

    let took = true;
    if (item.type === 'whiskey') {
      if (p.health >= p.maxHealth) took = false;
      else p.health = Math.min(p.maxHealth, p.health + 35);
    } else if (item.type === 'ammo') {
      let any = false;
      for (const slot of Object.keys(p.guns)) {
        const w = WEAPONS[slot];
        const g = p.guns[slot];
        const add = Math.ceil(w.magSize * 2);
        if (g.reserve < w.reserveMax) { g.reserve = Math.min(w.reserveMax, g.reserve + add); any = true; }
      }
      took = any;
    } else if (item.type === 'dynamite') {
      if (p.dynamite >= DYNAMITE.maxCarried) took = false;
      else p.dynamite += 1;
    } else if (WEAPONS[item.type]) {
      const w = WEAPONS[item.type];
      if (!p.guns[item.type]) {
        p.guns[item.type] = { mag: w.magSize, reserve: Math.round(w.reserve * 0.6) };
        p.slot = item.type;
        p.swapUntil = now() + w.swapTime;
      } else {
        const g = p.guns[item.type];
        if (g.reserve >= w.reserveMax) took = false;
        else g.reserve = Math.min(w.reserveMax, g.reserve + w.magSize * 2);
      }
    }

    if (!took) return;
    item.active = false;
    item.respawnAt = item.dropped ? 0 : now() + LOOT_RESPAWN;
    if (item.dropped) item.remove = true;
    this.broadcast({ t: S.PICKED, id: item.id, by: p.id, type: item.type });
    this.pushSelf(p);
  }

  // -------------------------------------------------------------------------
  // Reload / abilities / dynamite
  // -------------------------------------------------------------------------
  startReload(p) {
    if (!p.alive || p.reloading) return;
    const w = WEAPONS[p.slot];
    const g = p.guns[p.slot];
    if (!g || g.mag >= w.magSize || g.reserve <= 0) return;
    const mult = p.buffs.reloadMult || 1;
    p.reloading = { weapon: p.slot, until: now() + w.reloadTime * mult };
    this.pushSelf(p);
  }

  finishReload(p) {
    const r = p.reloading;
    p.reloading = null;
    const w = WEAPONS[r.weapon];
    const g = p.guns[r.weapon];
    if (!g) return;
    const want = w.magSize - g.mag;
    const take = Math.min(want, g.reserve);
    g.mag += take;
    g.reserve -= take;
    this.pushSelf(p);
  }

  onAbility(p) {
    if (!p.alive) return;
    const t = now();
    if (t < p.abilityReadyAt) return;
    const c = CHARACTERS[p.character];
    p.abilityReadyAt = t + c.cooldown;
    p.abilityKind = c.id;
    p.abilityUntil = t + (c.duration || 0);
    let payload = { t: S.ABILITY, id: p.id, kind: c.id, duration: c.duration || 0 };

    switch (c.id) {
      case 'gunslinger':
        p.buffs.fireRateMult = 0.55;
        p.buffs.reloadMult = 0.35;
        p.buffs.until = t + c.duration;
        break;
      case 'medic': {
        const target = this.playerInCrosshair(p, c.healRange);
        if (target) {
          target.health = Math.min(target.maxHealth, target.health + c.heal);
          payload.target = target.id;
          this.emit(target, { t: S.FEED, text: `${p.name} patched you up (+${c.heal}).`, tone: 'good' });
          this.emit(p, { t: S.FEED, text: `You patched up ${target.name}.`, tone: 'good' });
          this.pushSelf(target);
          this.notifyBots('healed', { medic: p, target });
        } else {
          p.health = Math.min(p.maxHealth, p.health + c.selfHeal);
          this.emit(p, { t: S.FEED, text: `You bandaged yourself (+${c.selfHeal}).`, tone: 'good' });
        }
        break;
      }
      case 'scout':
        p.revealUntil = t + c.duration;
        break;
      case 'duelist':
        p.buffs.spreadMult = 0.06;
        p.buffs.damageMult = c.damageMult;
        p.buffs.until = t + c.duration;
        break;
      case 'gambler': {
        const boon = pick(GAMBLER_BOONS);
        payload.boon = boon.id;
        payload.label = boon.label;
        if (boon.speedMult) p.buffs.speedMult = boon.speedMult;
        if (boon.damageMult) p.buffs.damageMult = boon.damageMult;
        if (boon.armour) p.armour = boon.armour;
        if (boon.dust) p.buffs.dust = true;
        if (boon.id === 'ammo') {
          for (const slot of Object.keys(p.guns)) {
            const w = WEAPONS[slot];
            p.guns[slot].mag = w.magSize;
            p.guns[slot].reserve = w.reserveMax;
          }
          p.dynamite = Math.min(DYNAMITE.maxCarried, p.dynamite + 1);
        }
        if (boon.duration) p.buffs.until = t + boon.duration;
        this.emit(p, { t: S.FEED, text: boon.label, tone: boon.id === 'bust' ? 'bad' : 'good' });
        break;
      }
      case 'tracker': {
        const cutoff = t - c.trailWindow;
        const prints = this.footprints
          .filter((f) => f.t >= cutoff)
          .map((f) => [r2(f.x), r2(f.y), r2(f.z), f.g]);
        this.emit(p, { t: S.FOOTPRINTS, prints, duration: c.duration });
        break;
      }
    }

    this.broadcast(payload);
    this.pushSelf(p);
  }

  playerInCrosshair(p, range) {
    const origin = eyeOf(p);
    const dir = forwardOf(p);
    const worldHit = raycastWorld(origin, dir, range, MAP.solids);
    let bestT = worldHit ? worldHit.t : range;
    let found = null;
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      const h = rayPlayerBox(origin, dir, o.pos.x, o.pos.y, o.pos.z, PLAYER.radius * 2.0, playerHeight(o), bestT);
      if (h && h.t < bestT) { bestT = h.t; found = o; }
    }
    return found;
  }

  onThrow(p, msg) {
    if (!p.alive || p.dynamite <= 0) return;
    if (now() < p.swapUntil) return;
    p.dynamite -= 1;
    const origin = eyeOf(p);
    const dir = normalize(msg.dir) || forwardOf(p);
    const d = {
      id: nextId++,
      owner: p.id,
      pos: { x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6 },
      vel: { x: dir.x * DYNAMITE.throwSpeed, y: dir.y * DYNAMITE.throwSpeed + 2.2, z: dir.z * DYNAMITE.throwSpeed },
      explodeAt: now() + DYNAMITE.fuse,
    };
    this.dynamites.push(d);
    this.pushSelf(p);
    this.notifyBots('dynamite', { pos: d.pos, owner: p });
  }

  explode(d) {
    const owner = this.players.get(d.owner);
    this.broadcast({ t: S.EXPLOSION, x: r2(d.pos.x), y: r2(d.pos.y), z: r2(d.pos.z) });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const c = chestOf(p);
      const dist = Math.hypot(c.x - d.pos.x, c.y - d.pos.y, c.z - d.pos.z);
      if (dist > DYNAMITE.radius) continue;
      if (!lineOfSight(d.pos, c, MAP.solids)) continue;
      const k = 1 - clamp(dist / DYNAMITE.radius, 0, 1);
      let dmg = DYNAMITE.minDamage + (DYNAMITE.damage - DYNAMITE.minDamage) * k;
      if (owner && p.id === owner.id) dmg *= DYNAMITE.selfDamageMult;
      this.applyDamage(p, owner || null, dmg, 'dynamite', d.pos);
    }
    this.notifyBots('gunshot', { pos: d.pos, shooter: owner, weapon: { noise: DYNAMITE.noise } });
  }

  // -------------------------------------------------------------------------
  // Social layer
  // -------------------------------------------------------------------------
  onChat(p, msg) {
    const t = now();
    if (t - p.lastChatAt < SOCIAL.chatCooldown) return;
    p.lastChatAt = t;
    const text = String(msg.text || '').slice(0, 140).trim();
    if (!text) return;
    this.broadcast({ t: S.CHAT, from: p.name, id: p.id, text, dead: !p.alive });
    this.notifyBots('chat', { from: p, text });
  }

  onVoice(p, msg) {
    const t = now();
    if (t - p.lastChatAt < SOCIAL.voiceCooldown) return;
    p.lastChatAt = t;
    const line = VOICE_LINES.find((v) => v.id === msg.line);
    if (!line || !p.alive) return;
    this.broadcast({
      t: S.CHAT, from: p.name, id: p.id, text: line.text, voice: true,
      x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
    });
    this.notifyBots('voice', { from: p, line: line.id });
  }

  onAccuse(p, msg) {
    const t = now();
    if (!p.alive || t - p.lastAccuseAt < SOCIAL.accuseCooldown) return;
    const target = this.players.get(msg.target);
    if (!target || target === p || !target.alive) return;
    p.lastAccuseAt = t;
    this.broadcast({
      t: S.FEED,
      text: `${p.name} calls out ${target.name}.`,
      tone: 'accuse', from: p.id, target: target.id,
    });
    this.notifyBots('accuse', { from: p, target });
  }

  onBadge(p) {
    if (!p.alive || p.role !== 'sheriff' || p.badge) return;
    p.badge = true;
    p.maxHealth = PLAYER.maxHealth + (ROLES.sheriff.bonusHealth || 0) + SOCIAL.badgeHealthBonus;
    p.health = p.maxHealth;
    this.broadcast({ t: S.BADGE, id: p.id, name: p.name });
    this.broadcast({
      t: S.FEED,
      text: `${p.name} pins on the star and claims the law. Believe it at your own risk.`,
      tone: 'badge',
    });
    this.notifyBots('badge', { sheriff: p });
    this.pushSelf(p);
  }

  notifyBots(kind, data) {
    for (const p of this.players.values()) {
      if (p.bot && p.brain && p.alive) p.brain.onEvent(kind, data);
    }
  }

  // -------------------------------------------------------------------------
  // Match flow
  // -------------------------------------------------------------------------
  beginMatch() {
    this.matchNumber += 1;
    this.results = null;
    this.dynamites = [];
    this.footprints = [];
    this.resetLoot();

    // Drop leftover bots, then refill to the table size.
    for (const [id, p] of [...this.players]) if (p.bot) this.players.delete(id);
    const humans = [...this.players.values()];
    const target = clamp(Math.max(this.botFillTarget, humans.length), MIN_PLAYERS, MAX_PLAYERS);
    const names = shuffle(BOT_NAMES.slice());
    const chars = shuffle(Object.keys(CHARACTERS));
    let ci = humans.length;
    for (let i = humans.length; i < target; i++) {
      const bot = this.makePlayer({
        name: names[i % names.length],
        bot: true,
        character: chars[ci++ % chars.length],
      });
      bot.brain = new BotBrain(this, bot);
      this.players.set(bot.id, bot);
    }

    const all = [...this.players.values()];
    const roles = shuffle(rolesForPlayerCount(all.length));
    const spawnOrder = shuffle(SPAWNS.map((s, i) => i));
    const groups = shuffle(all.map((_, i) => i));

    all.forEach((p, i) => {
      p.role = roles[i];
      p.faction = ROLES[p.role].faction;
      p.alive = true;
      p.maxHealth = PLAYER.maxHealth + (ROLES[p.role].bonusHealth || 0);
      p.health = p.maxHealth;
      p.armour = 0;
      p.badge = false;
      p.kills = 0; p.deaths = 0; p.damageDealt = 0;
      p.guns = { revolver: { mag: WEAPONS.revolver.magSize, reserve: WEAPONS.revolver.reserve } };
      p.slot = 'revolver';
      p.dynamite = 0;
      p.reloading = null;
      p.buffs = {};
      p.abilityReadyAt = now() + 10;
      p.abilityUntil = 0;
      p.revealUntil = 0;
      p.trailGroup = groups[i];
      p.lastHitBy = null;
      const s = SPAWNS[spawnOrder[i % SPAWNS.length]];
      p.pos = { x: s.x, y: s.y, z: s.z };
      p.vel = { x: 0, y: 0, z: 0 };
      p.yaw = s.yaw; p.pitch = 0;
      if (p.bot) p.brain = p.brain || new BotBrain(this, p);
      if (p.bot) p.brain.reset();
    });

    // Partial intel: the engine of the whole deduction layer.
    for (const p of all) {
      p.intel = this.buildIntel(p, all);
      this.sendRole(p);
    }

    this.setPhase(PHASE.PREP);
    this.broadcast({
      t: S.FEED,
      text: 'Roles dealt. Guns stay holstered until the church bell rings.',
      tone: 'system',
    });
  }

  /**
   * Nobody gets the full picture, everybody gets a thread to pull.
   *  - Deputy: "the Sheriff is one of these two."
   *  - Outlaw: the name of exactly one accomplice.
   *  - Renegade: the name of one lawman (Sheriff or Deputy) - but not which.
   *  - Sheriff: nothing. The star is lonely.
   */
  buildIntel(p, all) {
    const others = all.filter((o) => o.id !== p.id);
    if (p.role === 'deputy') {
      const sheriff = all.find((o) => o.role === 'sheriff');
      const decoyPool = others.filter((o) => o.role !== 'sheriff' && o.role !== 'deputy');
      const decoy = pick(decoyPool.length ? decoyPool : others);
      const pair = shuffle([sheriff?.name, decoy?.name].filter(Boolean));
      return { kind: 'pair', text: `The Sheriff is one of these two: ${pair.join('  or  ')}.` };
    }
    if (p.role === 'outlaw') {
      const mates = others.filter((o) => o.role === 'outlaw');
      if (!mates.length) return { kind: 'none', text: 'You ride alone. The rest of the gang never made it.' };
      return { kind: 'name', text: `You recognise one face from the gang: ${pick(mates).name}.` };
    }
    if (p.role === 'renegade') {
      const lawmen = others.filter((o) => o.faction === 'law');
      if (!lawmen.length) return { kind: 'none', text: 'You know nothing about anyone here. Good.' };
      return { kind: 'name', text: `You know ${pick(lawmen).name} wears a badge of some kind - star or not.` };
    }
    return { kind: 'none', text: 'Nobody knows your face. Keep it that way, or pin on the star and dare them.' };
  }

  sendRole(p) {
    if (p.bot) return;
    const r = ROLES[p.role];
    this.emit(p, {
      t: S.ROLE,
      role: p.role,
      roleName: r.name,
      faction: p.faction,
      color: r.color,
      objective: r.objective,
      blurb: r.blurb,
      intel: p.intel?.text || '',
      character: p.character,
      canBadge: p.role === 'sheriff',
      tp: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)],
      yaw: r2(p.yaw),
    });
  }

  /** Current phase for one client - without this a late joiner never leaves the menu. */
  sendPhaseTo(client) {
    this.send(client, {
      t: S.PHASE, phase: this.phase, endsAt: this.phaseEndsAt,
      duration: TIMING[this.phase] || 0,
      alive: [...this.players.values()].filter((p) => p.alive).length,
      total: this.players.size,
    });
  }

  setPhase(phase) {
    this.phase = phase;
    const dur = TIMING[phase] || 0;
    this.phaseEndsAt = now() + dur;
    this.broadcast({
      t: S.PHASE, phase, endsAt: this.phaseEndsAt, duration: dur,
      alive: [...this.players.values()].filter((p) => p.alive).length,
      total: this.players.size,
    });
    if (phase === PHASE.COMBAT) {
      this.broadcast({ t: S.FEED, text: 'The bell rings. Nothing is holstered now.', tone: 'system' });
      this.broadcast({ t: S.SOUND, sound: 'bell' });
    }
    if (phase === PHASE.ENDGAME) {
      this.broadcast({ t: S.FEED, text: 'A dust storm closes on the town square. Get in or choke.', tone: 'bad' });
    }
  }

  endMatch(winner, blurb) {
    if (this.phase === PHASE.RESULTS) return;
    const rows = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, bot: p.bot, role: p.role,
      roleName: ROLES[p.role]?.name, color: ROLES[p.role]?.color,
      faction: p.faction, character: p.character,
      characterName: CHARACTERS[p.character]?.role,
      alive: p.alive, kills: p.kills, damage: Math.round(p.damageDealt),
      won: p.faction === winner,
    })).sort((a, b) => (b.won - a.won) || (b.kills - a.kills) || (b.damage - a.damage));

    this.results = { winner, blurb, rows };
    this.setPhase(PHASE.RESULTS);
    this.broadcast({
      t: S.RESULTS, winner, blurb, rows,
      title: winner === 'law' ? 'THE LAW HOLDS'
        : winner === 'outlaw' ? 'THE OUTLAWS RIDE OUT'
        : winner === 'renegade' ? 'THE RENEGADE STANDS ALONE' : 'NOBODY WINS',
    });
  }

  toLobby() {
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = 0;
    for (const [id, p] of [...this.players]) {
      if (p.bot || !p.connected) { this.players.delete(id); continue; }
      p.alive = false;
      p.role = null; p.faction = null; p.intel = null; p.badge = false;
    }
    this.pushLobby();
    this.broadcast({ t: S.PHASE, phase: PHASE.LOBBY, endsAt: 0, duration: 0 });
  }

  pushLobby() {
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, bot: p.bot, character: p.character,
    }));
    this.broadcast({
      t: S.LOBBY, players: list, botTarget: this.botFillTarget,
      min: MIN_PLAYERS, max: MAX_PLAYERS, phase: this.phase,
    });
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------
  start() {
    this.lastTime = now();
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  step() {
    const t = now();
    const dt = clamp(t - this.lastTime, 0.001, 0.2);
    this.lastTime = t;
    this.tick += 1;

    if (this.phase === PHASE.PREP || this.phase === PHASE.COMBAT || this.phase === PHASE.ENDGAME) {
      this.stepPlayers(t, dt);
      this.stepBots(t, dt);
      this.stepDynamite(t, dt);
      this.stepLoot(t);
      if (this.phase === PHASE.ENDGAME) this.stepRing(t, dt);
      if (t >= this.phaseEndsAt) this.advancePhase();
    } else if (this.phase === PHASE.RESULTS) {
      if (t >= this.phaseEndsAt) this.toLobby();
    }

    this.sendSnapshots(t);
  }

  advancePhase() {
    if (this.phase === PHASE.PREP) return this.setPhase(PHASE.COMBAT);
    if (this.phase === PHASE.COMBAT) return this.setPhase(PHASE.ENDGAME);
    if (this.phase === PHASE.ENDGAME) {
      const sheriff = [...this.players.values()].find((p) => p.role === 'sheriff');
      if (sheriff && sheriff.alive) {
        return this.endMatch('law', 'Sundown. The Sheriff is still standing and the town keeps its name.');
      }
      return this.endMatch('none', 'The storm took whoever was left.');
    }
  }

  stepPlayers(t, dt) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;

      if (p.reloading && t >= p.reloading.until) this.finishReload(p);
      if (p.buffs.until && t >= p.buffs.until) {
        p.buffs = {};
        this.pushSelf(p);
      }
      if (p.abilityUntil && t >= p.abilityUntil) p.abilityUntil = 0;

      // Footprint trail (the Tracker reads these later).
      if (p.moving && t - p.lastFootprintAt > SOCIAL.footprintInterval) {
        p.lastFootprintAt = t;
        this.footprints.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, t, g: p.trailGroup });
      }
    }
    const cutoff = t - SOCIAL.footprintTtl;
    if (this.footprints.length > 900) this.footprints = this.footprints.filter((f) => f.t >= cutoff);
  }

  stepBots(t, dt) {
    for (const p of this.players.values()) {
      if (p.bot && p.brain) p.brain.update(t, dt);
    }
  }

  stepDynamite(t, dt) {
    for (let i = this.dynamites.length - 1; i >= 0; i--) {
      const d = this.dynamites[i];
      d.vel.y -= PLAYER.gravity * dt;
      const step = { x: d.vel.x * dt, y: d.vel.y * dt, z: d.vel.z * dt };
      const len = Math.hypot(step.x, step.y, step.z);
      if (len > 0.001) {
        const dir = { x: step.x / len, y: step.y / len, z: step.z / len };
        const hit = raycastWorld(d.pos, dir, len + 0.16, MAP.solids);
        if (hit) {
          d.pos.x = hit.point.x + hit.normal.x * 0.12;
          d.pos.y = hit.point.y + hit.normal.y * 0.12;
          d.pos.z = hit.point.z + hit.normal.z * 0.12;
          const dot = d.vel.x * hit.normal.x + d.vel.y * hit.normal.y + d.vel.z * hit.normal.z;
          d.vel.x = (d.vel.x - 2 * dot * hit.normal.x) * 0.32;
          d.vel.y = (d.vel.y - 2 * dot * hit.normal.y) * 0.32;
          d.vel.z = (d.vel.z - 2 * dot * hit.normal.z) * 0.32;
        } else {
          d.pos.x += step.x; d.pos.y += step.y; d.pos.z += step.z;
        }
      }
      if (d.pos.y < 0) { d.pos.y = 0; d.vel.y = Math.abs(d.vel.y) * 0.3; }
      if (t >= d.explodeAt) {
        this.explode(d);
        this.dynamites.splice(i, 1);
      }
    }
  }

  stepLoot(t) {
    const add = [];
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      if (l.remove) { this.loot.splice(i, 1); continue; }
      if (!l.active && l.respawnAt && t >= l.respawnAt) {
        l.active = true; l.respawnAt = 0;
        add.push(lootWire(l));
      }
    }
    if (add.length) this.broadcast({ t: S.LOOT, add });
  }

  stepRing(t, dt) {
    const k = clamp(1 - (this.phaseEndsAt - t) / TIMING.endgame, 0, 1);
    this.ringRadius = ENDGAME.startRadius + (ENDGAME.endRadius - ENDGAME.startRadius) * k;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - ENDGAME.centre.x, p.pos.z - ENDGAME.centre.z);
      if (d > this.ringRadius) this.applyDamage(p, null, ENDGAME.dps * dt, 'storm', null);
    }
  }

  // -------------------------------------------------------------------------
  // Outbound state
  // -------------------------------------------------------------------------
  sendSnapshots(t) {
    if (this.phase === PHASE.LOBBY) return;
    const base = [];
    for (const p of this.players.values()) {
      base.push({
        id: p.id,
        n: p.name,
        x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
        yw: r2(p.yaw), pt: r2(p.pitch),
        st: (p.crouch ? 1 : 0) | (p.sprint ? 2 : 0) | (p.moving ? 4 : 0) |
            (p.buffs.dust ? 8 : 0) | (p.badge ? 16 : 0) | (p.alive ? 0 : 32) |
            (t - p.firedAt < 0.12 ? 64 : 0),
        w: p.slot,
        ch: p.character,
      });
    }

    for (const viewer of this.players.values()) {
      if (viewer.bot || !viewer.client) continue;
      let reveal = null;
      if (t < viewer.revealUntil) {
        const c = CHARACTERS.scout;
        reveal = [];
        for (const o of this.players.values()) {
          if (o.id === viewer.id || !o.alive || !o.moving) continue;
          if (Math.hypot(o.pos.x - viewer.pos.x, o.pos.z - viewer.pos.z) <= c.radius) reveal.push(o.id);
        }
      }
      this.send(viewer.client, {
        t: S.SNAPSHOT,
        k: this.tick,
        ps: base,
        dyn: this.dynamites.map((d) => ({ id: d.id, x: r2(d.pos.x), y: r2(d.pos.y), z: r2(d.pos.z) })),
        ring: this.phase === PHASE.ENDGAME ? r2(this.ringRadius || ENDGAME.startRadius) : 0,
        reveal,
        left: Math.max(0, Math.round(this.phaseEndsAt - t)),
        aliveCount: [...this.players.values()].filter((x) => x.alive).length,
      });
    }

    if (this.tick % 4 === 0) {
      for (const p of this.players.values()) if (!p.bot) this.pushSelf(p);
    }
  }

  pushSelf(p) {
    if (p.bot || !p.client) return;
    const g = p.guns[p.slot];
    const t = now();
    this.send(p.client, {
      t: S.SELF,
      hp: Math.max(0, Math.round(p.health)),
      maxHp: p.maxHealth,
      armour: Math.round(p.armour),
      weapon: p.slot,
      mag: g ? g.mag : 0,
      reserve: g ? g.reserve : 0,
      guns: Object.keys(p.guns),
      dyn: p.dynamite,
      reloading: p.reloading ? r2(p.reloading.until - t) : 0,
      swap: Math.max(0, r2(p.swapUntil - t)),
      cd: Math.max(0, r2(p.abilityReadyAt - t)),
      cdMax: CHARACTERS[p.character].cooldown,
      active: p.abilityUntil > t ? r2(p.abilityUntil - t) : 0,
      alive: p.alive,
      badge: p.badge,
      buffs: Object.keys(p.buffs).filter((k) => k !== 'until'),
      loot: this.loot.filter((l) => l.active).map(lootWire),
    });
  }
}

function lootWire(l) {
  return { id: l.id, x: r2(l.x), y: r2(l.y), z: r2(l.z), type: l.type };
}

function normalize(v) {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function forwardOf(p) {
  const cp = Math.cos(p.pitch);
  return { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp };
}

function jitter(dir, spread) {
  // Random cone around dir, built from an arbitrary perpendicular basis.
  let up = Math.abs(dir.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = cross(dir, up); nrm(right);
  const realUp = cross(right, dir); nrm(realUp);
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spread;
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const out = {
    x: dir.x + right.x * ox + realUp.x * oy,
    y: dir.y + right.y * ox + realUp.y * oy,
    z: dir.z + right.z * ox + realUp.z * oy,
  };
  nrm(out);
  return out;
}
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function nrm(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l; v.y /= l; v.z /= l;
  return v;
}
