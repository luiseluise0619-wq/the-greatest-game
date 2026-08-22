// The match. One room, one town, up to 8 gunhands (humans + bots).
//
// Authority split, chosen deliberately for a prototype:
//   - movement is client-simulated and server-clamped (keeps aiming crisp)
//   - EVERYTHING that matters - hits, damage, deaths, roles, who-learns-what -
//     is resolved here and never trusted to a client.

import {
  PLAYER, WEAPONS, DYNAMITE, WEAPON_ORDER, ROLES, PHASE, TIMING, ENDGAME,
  SOCIAL, HITBOX, CHARACTERS, GAMBLER_BOONS, LOOT_RESPAWN, VOICE_LINES, VISION, REPLAY,
  CARDS, CARD_ORDER, CARD_DEAL,
  MIN_PLAYERS, MAX_PLAYERS, rolesForPlayerCount, clamp, stepStamina,
} from '../shared/constants.js';
import MAP, { zoneAt, SPAWNS, LOOT_SPAWNS } from '../shared/map.js';
import { raycastWorld, rayPlayerBox, lineOfSight, moveAndCollide } from '../shared/collision.js';
import { C, S } from '../shared/protocol.js';
import { BotBrain, BOT_NAMES } from './bots.js';
import { telemetry } from './telemetry.js';
import { randomUUID } from 'node:crypto';

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
  constructor(opts = {}) {
    this.code = opts.code || 'LOCAL';
    this.isPublic = opts.isPublic !== false;
    this.emptySince = now();
    this.clients = new Set();
    this.players = new Map();
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = 0;
    this.tick = 0;
    this.loot = [];
    this.dynamites = [];
    this.footprints = [];
    this.history = [];      // rolling position log, for death replays
    this.shotLog = [];
    this.timeline = [];     // the round's public account, shown on the results screen
    this.results = null;
    this.matchNumber = 0;
    this.lobbyStartAt = 0;      // public rooms deal themselves in - see stepLobby
    this.lastTime = now();
    this.botFillTarget = 6;
    this.resetLoot();
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------
  addConnection(client) {
    client.room = this;
    client.playerId = client.playerId ?? null;
    this.clients.add(client);
    this.emptySince = 0;
    this.send(client, this.welcomeMsg());
    return client;
  }

  welcomeMsg(selfId = null, token = null) {
    return {
      t: S.WELCOME,
      selfId,
      token,
      map: MAP.name,
      phase: this.phase,
      maxPlayers: MAX_PLAYERS,
      code: this.code,
      isPublic: this.isPublic,
      humans: this.humanCount(),
    };
  }

  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot && p.connected) n++;
    return n;
  }

  removeConnection(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    client.room = null;
    if (!this.clients.size) this.emptySince = now();
    const p = this.players.get(client.playerId);
    if (p) {
      telemetry.sessionEnd(p, now() - (p.joinedAt || now()));
      if (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULTS) {
        this.players.delete(p.id);
      } else if (p.alive) {
        // Mid-match, the body stays: standing in the street, silent, and every
        // bit as shootable as it was. Come back inside the grace and it is
        // yours again; do not, and it falls over where it stands, because a
        // vanishing player would take the round's evidence with them.
        p.connected = false;
        p.client = null;
        p.disconnectedAt = now();
        p.moving = false;
        p.sprint = false;
        p.vel = { x: 0, y: 0, z: 0 };
      } else {
        this.players.delete(p.id);
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
      token: randomUUID(),      // lets one tab reclaim this body after a refresh
      disconnectedAt: 0,
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
      hand: [],                 // cards still unplayed
      armed: new Set(),         // cards played and waiting on a trigger
      cardsPlayed: [],
      barrelUntil: 0,           // still soaking the rest of one burst
      dmgCarry: 0,              // sub-point damage waiting to add up
      noPrintsUntil: 0,
      glassUntil: 0,
      glassMarks: new Map(),    // id -> until: shooters the Long Glass has lit up
      lastCardAt: 0,
      kills: 0,
      damageDealt: 0,
      deaths: 0,
      lastHitBy: null,
      lastHitAt: 0,
      lastFootprintAt: 0,
      lastStepAt: 0,
      lastChatAt: 0,
      lastAccuseAt: 0,
      lastInputAt: now(),
      moveSlack: PLAYER.serverSlack,   // see onInput: jitter budget, not per packet
      stamina: PLAYER.staminaMax,
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
      case C.CARD: return this.onCard(p, msg);
      case C.ADD_BOT: return this.onAddBot(p, msg);
      case C.START: return this.onStart(p, msg);
      case C.RESTART: return this.onRestart(p);
      default: return;
    }
  }

  onJoin(client, msg) {
    if (client.playerId) return;

    // A refresh is not a decision to leave. If this tab still has the token for
    // a body in this town, give it back.
    //
    // Deliberately not conditional on the old socket having been reaped first:
    // a reload opens the new connection before the browser's close reaches us
    // about half the time, and the loser of that race would be handed a
    // stranger's body instead of their own. A token owns exactly one seat, so
    // claiming it evicts whoever is sitting in it.
    if (msg.token) {
      const back = [...this.players.values()].find((o) => !o.bot && o.token === msg.token);
      if (back) {
        const stale = back.client;
        if (stale && stale !== client) {
          stale.playerId = null;        // so its close does not take the body with it
          try { stale.ws.close(4000, 'seat reclaimed'); } catch { /* already gone */ }
        }
        return this.resumePlayer(client, back);
      }
    }

    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    if (humans >= MAX_PLAYERS) {
      return this.send(client, { t: S.ERROR, msg: 'Town is full - 8 guns is the limit.' });
    }
    const p = this.makePlayer({
      name: String(msg.name || '').trim() || `Stranger ${humans + 1}`,
      character: msg.character,
      client,
    });
    p.joinedAt = now();
    client.playerId = p.id;
    this.players.set(p.id, p);
    this.send(client, this.welcomeMsg(p.id, p.token));
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
        bot.token = randomUUID();
        bot.connected = true;
        this.send(client, this.welcomeMsg(bot.id, bot.token));
        this.sendRole(bot);
        this.pushCards(bot);
        this.pushSelf(bot);
        this.sendPhaseTo(client);
        this.pushLobby();
        return;
      }
    }
    this.pushLobby();
  }

  /** Hand a reconnecting tab its own body back, exactly where it left it. */
  resumePlayer(client, p) {
    p.connected = true;
    p.client = client;
    p.disconnectedAt = 0;
    p.lastInputAt = now();
    p.moveSlack = PLAYER.serverSlack;
    client.playerId = p.id;

    this.send(client, this.welcomeMsg(p.id, p.token));
    if (p.role) this.sendRole(p, { resumed: true });   // also snaps the camera to the body
    this.pushCards(p);
    this.sendPhaseTo(client);
    this.pushSelf(p);
    this.pushLobby();
    this.emit(p, {
      t: S.FEED,
      text: p.alive
        ? 'You are back. Your body never left the street - hope nobody used the quiet.'
        : 'You are back, and still dead.',
      tone: 'system',
    });
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

    if (!msg.pos || !Number.isFinite(msg.pos.x) || !Number.isFinite(msg.pos.y) || !Number.isFinite(msg.pos.z)) return;

    const want = {
      x: clamp(msg.pos.x, MAP.bounds.min + 0.5, MAP.bounds.max - 0.5),
      y: clamp(msg.pos.y, -2, 40),
      z: clamp(msg.pos.z, MAP.bounds.min + 0.5, MAP.bounds.max - 0.5),
    };

    // 1. Speed clamp. Generous enough for stairs and falls, tight enough that a
    //    hacked client cannot teleport across the map.
    let dx = want.x - p.pos.x, dy = want.y - p.pos.y, dz = want.z - p.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    // Slack absorbs network jitter, but it is a budget that refills over time,
    // not a free allowance per packet: dt shrinks with the message rate, so a
    // client flooding inputs would otherwise turn a constant into a teleport.
    p.moveSlack = Math.min(
      PLAYER.serverSlack,
      (p.moveSlack ?? PLAYER.serverSlack) + dt * PLAYER.serverSlackRefill,
    );
    const fair = PLAYER.maxServerSpeed * dt;
    const allowed = fair + p.moveSlack;
    if (dist > allowed) {
      const k = allowed / dist;
      dx *= k; dy *= k; dz *= k;
      p.moveSlack = 0;
    } else {
      p.moveSlack -= Math.max(0, dist - fair);
    }

    // Sprint budget, measured from what the player actually did rather than the
    // flag they sent - a client that simply never admits to sprinting should not
    // get free running out of it. The cap is horizontal only, so a fall still
    // gets the full 3D allowance above.
    const boost = p.buffs.speedMult || 1;
    const horiz = Math.hypot(dx, dz);
    const running = horiz / dt > PLAYER.walkSpeed * boost * 1.12;
    p.stamina = stepStamina(p.stamina, running, dt);
    const topSpeed = (p.stamina > 0 ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * boost * 1.3;
    const horizCap = topSpeed * dt + PLAYER.serverSlack;
    if (horiz > horizCap) {
      const k = horizCap / horiz;
      dx *= k; dz *= k;
    }

    // 2. Walk the move through the actual world instead of taking the client's
    //    word for it. The claimed position is a *target*: we move toward it
    //    against the same geometry the client collides with, so no amount of
    //    lying gets anybody through a wall. Sub-stepped so a fast move resolves
    //    the way the client's per-frame integration did, rather than tunnelling.
    const height = p.crouch ? PLAYER.crouchHeight : PLAYER.height;
    const steps = Math.min(8, Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 0.25)));
    const cur = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    for (let i = 0; i < steps; i++) {
      const res = moveAndCollide(
        cur, { x: dx / steps, y: dy / steps, z: dz / steps },
        PLAYER.radius, height, MAP.solids, PLAYER.stepHeight,
      );
      cur.x = res.x; cur.y = res.y; cur.z = res.z;
    }

    p.pos.x = cur.x; p.pos.y = cur.y; p.pos.z = cur.z;

    // 3. If the server's honest answer is far from what the client believes,
    //    tell it once so it snaps back rather than fighting us every tick.
    const drift = Math.hypot(want.x - cur.x, want.y - cur.y, want.z - cur.z);
    if (drift > 2.0 && t - (p.lastCorrectAt || 0) > 0.5) {
      p.lastCorrectAt = t;
      this.emit(p, { t: S.CORRECT, pos: [r2(cur.x), r2(cur.y), r2(cur.z)] });
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

    const shot = {
      t: S.SHOT,
      w: w.id,
      o: [r2(origin.x), r2(origin.y), r2(origin.z)],
      rays: rays.map((r) => [r2(r.x), r2(r.y), r2(r.z)]),
    };
    this.shotLog.push({ t, id: p.id, o: shot.o, rays: shot.rays, w: w.id });
    for (const viewer of this.players.values()) {
      if (viewer.bot || !viewer.client) continue;
      // Tracers and noise are physical and everyone gets them; the shooter's
      // identity is only attached for players who can actually see them.
      const named = viewer.id === p.id || this.canSeeCached(viewer, p.id);
      this.send(viewer.client, named ? { ...shot, id: p.id } : shot);
    }
    // Long Glass: anyone holding it up gets a face put to this shot, wherever
    // in town it was fired from.
    for (const viewer of this.players.values()) {
      if (viewer.id === p.id || t >= (viewer.glassUntil || 0)) continue;
      if (!viewer.glassMarks) viewer.glassMarks = new Map();
      viewer.glassMarks.set(p.id, t + CARDS.spyglass.mark);
    }

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

    // Rain Barrel. It absorbs the shot AND the feedback: we return before the
    // attacker is told anything, so their hitmarker never fires and their
    // damage number never appears. Believing you hit someone you did not is a
    // far more useful lie than a few points of armour.
    if (attacker && attacker !== victim) {
      const tb = now();
      if (victim.barrelUntil > tb) return;              // same burst, still soaking
      if (victim.armed && victim.armed.has('barrel')) {
        victim.armed.delete('barrel');
        victim.barrelUntil = tb + CARDS.barrel.soak;
        this.emit(victim, {
          t: S.FEED,
          text: 'The rain barrel takes it. Whoever fired that is certain they missed.',
          tone: 'good',
        });
        this.pushCards(victim);
        return;
      }
    }

    let dmg = amount;
    if (victim.badge) dmg *= SOCIAL.badgeDamageResist;
    if (victim.buffs.resist) dmg *= victim.buffs.resist;

    if (victim.armour > 0) {
      const soaked = Math.min(victim.armour, dmg * 0.6);
      victim.armour -= soaked;
      dmg -= soaked;
    }

    // Carry the fraction instead of rounding it away. Without this any source
    // that deals less than half a point per call is silently free: the dust
    // storm ticks 9 dps at 20Hz, which is 0.45 a tick, which rounded to zero -
    // the whole endgame was cosmetic.
    dmg += victim.dmgCarry || 0;
    const whole = Math.floor(dmg);
    victim.dmgCarry = dmg - whole;
    dmg = whole;
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
    // Buy a Witness erases the whole chain of custody for one kill: no
    // bystanders, no killcam, and - the part that makes it worth a card - not
    // even the victim, who normally always knows who shot them.
    const bought = !!(killer && killer !== victim && killer.armed && killer.armed.has('witness'));
    if (bought) {
      killer.armed.delete('witness');
      witnesses.add(killer.id);   // the killer obviously still knows
      this.pushCards(killer);
      this.emit(killer, { t: S.FEED, text: 'Nobody saw a thing. Money well spent.', tone: 'good' });
      this.emit(victim, { t: S.FEED, text: 'A shot out of the dark. You never saw the face behind it.', tone: 'bad' });
    } else if (killer && killer !== victim) {
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

    // Dead Man's Ledger pays out here, by simply adding its holder to the
    // witness set - so the name reaches them through the exact same channel a
    // real sighting would, with no second code path to leak anything extra.
    // A bought kill leaves nothing to read, so the ledger stays armed.
    if (!bought && killer && killer !== victim) {
      for (const p of this.players.values()) {
        if (!p.alive || witnesses.has(p.id) || !p.armed || !p.armed.has('ledger')) continue;
        p.armed.delete('ledger');
        witnesses.add(p.id);
        this.emit(p, { t: S.FEED, text: 'The ledger writes itself. You know who did that one.', tone: 'good' });
        this.pushCards(p);
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
    this.timeline.push({
      at: Math.max(0, Math.round(now() - (this.stats?.started || now()))),
      type: 'death', victim: victim.name, victimRole: victim.role,
      killer: killer && killer !== victim ? killer.name : null,
      killerRole: killer && killer !== victim ? killer.role : null,
      cause, place,
    });
    if (!bought && killer && killer !== victim && !victim.bot && victim.client) {
      const replay = this.buildReplay(victim, killer, now());
      if (replay) this.emit(victim, replay);
    }
    telemetry.death(this, victim, killer, cause, bought ? 0 : witnesses.size, place);
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
    telemetry.social(this, 'ability');
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
    const midMatch = this.phase !== PHASE.LOBBY && this.phase !== PHASE.RESULTS;
    const ghost = !p.alive && midMatch;
    this.broadcast(
      { t: S.CHAT, from: p.name, id: p.id, text, dead: !p.alive, ghost },
      ghost ? (o) => !o.alive : null,
    );
    telemetry.social(this, 'chat');
    if (!ghost) this.notifyBots('chat', { from: p, text });
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
    this.timeline.push({
      at: Math.max(0, Math.round(now() - (this.stats?.started || now()))),
      type: 'accuse', who: p.name, target: target.name,
    });
    telemetry.social(this, 'accuse');
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
    telemetry.social(this, 'badge');
    p.maxHealth = PLAYER.maxHealth + (ROLES.sheriff.bonusHealth || 0) + SOCIAL.badgeHealthBonus;
    p.health = p.maxHealth;
    this.timeline.push({ at: Math.max(0, Math.round(now() - (this.stats?.started || now()))), type: 'badge', who: p.name });
    this.broadcast({ t: S.BADGE, id: p.id, name: p.name });
    this.broadcast({
      t: S.FEED,
      text: `${p.name} pins on the star and claims the law. Believe it at your own risk.`,
      tone: 'badge',
    });
    this.notifyBots('badge', { sheriff: p });
    this.pushSelf(p);
  }

  // -------------------------------------------------------------------------
  // The Deck
  //
  // Two cards a round, and every one of them edits what the town is allowed to
  // know rather than adding damage. Note what is NOT here: no card is announced
  // to the room. The Wanted Poster broadcasts because being seen to point the
  // finger is its cost; the other five are silent on purpose, because a card
  // everybody watched you play cannot manipulate anybody.
  // -------------------------------------------------------------------------
  onCard(p, msg) {
    const t = now();
    if (!p.alive) return;
    if (this.phase !== PHASE.PREP && this.phase !== PHASE.COMBAT && this.phase !== PHASE.ENDGAME) return;
    if (t - (p.lastCardAt || 0) < SOCIAL.cardCooldown) return;

    const id = String(msg.card || '');
    const card = CARDS[id];
    const idx = p.hand.indexOf(id);
    if (!card || idx < 0) return;

    // Targeted cards resolve against whoever is actually down the barrel. No
    // menu, no clicking a name on a list: you have to look them in the face.
    let target = null;
    if (card.target === 'aim') {
      target = this.playerInCrosshair(p, card.range);
      if (!target || !target.alive) {
        this.emit(p, { t: S.FEED, text: 'Nobody in your sights to put a name to.', tone: 'bad' });
        return;
      }
    }

    p.hand.splice(idx, 1);
    p.lastCardAt = t;
    p.cardsPlayed.push(id);
    telemetry.card(this, p, id);

    switch (id) {
      case 'barrel':
      case 'witness':
      case 'ledger':
        p.armed.add(id);
        this.emit(p, { t: S.FEED, text: ARMED_LINE[id], tone: 'good' });
        break;

      case 'tracks':
        this.footprints = this.footprints.filter((f) => f.g !== p.trailGroup);
        p.noPrintsUntil = t + card.duration;
        this.emit(p, {
          t: S.FEED,
          text: 'You sweep the street behind you. Every print you left is gone, and you leave none for a while.',
          tone: 'good',
        });
        break;

      case 'spyglass':
        p.glassUntil = t + card.duration;
        if (!p.glassMarks) p.glassMarks = new Map();
        this.emit(p, {
          t: S.FEED,
          text: 'Glass to your eye. For the next few seconds every shot fired in this town has a face on it.',
          tone: 'good',
        });
        break;

      case 'poster': {
        const star = target.role === 'sheriff';
        this.broadcast({
          t: S.FEED,
          text: `${p.name} nails a wanted poster to the church door with ${target.name}'s name on it.`,
          tone: 'accuse', from: p.id, target: target.id,
        });
        this.emit(p, {
          t: S.FEED,
          text: star
            ? `The poster answers you: ${target.name} wears the star.`
            : `The poster answers you: ${target.name} does not wear the star.`,
          tone: star ? 'good' : 'bad',
        });
        this.emit(target, {
          t: S.FEED,
          text: 'Your name just went up on the church door. Everyone in town can read it.',
          tone: 'bad',
        });
        if (p.bot && p.brain) p.brain.markSheriffness(target.id, star ? 1.4 : -1.4);
        this.notifyBots('accuse', { from: p, target });
        break;
      }
    }

    this.timeline.push({
      at: Math.max(0, Math.round(t - (this.stats?.started || t))),
      type: 'card', who: p.name, card: id, cardName: card.name,
      target: target ? target.name : null,
      secret: id !== 'poster',
    });
    this.pushCards(p);
  }

  /** A player's own hand. Never sent to anybody else - that is the whole point. */
  pushCards(p) {
    if (p.bot || !p.client) return;
    this.emit(p, { t: S.CARDS, hand: p.hand.slice(), armed: [...p.armed] });
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
    this.lobbyStartAt = 0;
    this.results = null;
    this.dynamites = [];
    this.footprints = [];
    this.history = [];
    this.shotLog = [];
    this.timeline = [];
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
      // Two cards each, dealt independently, so no two hands are the same and
      // nobody can reason backwards from what they were given to what you hold.
      p.hand = shuffle(CARD_ORDER.slice()).slice(0, CARD_DEAL);
      p.armed = new Set();
      p.cardsPlayed = [];
      p.barrelUntil = 0;
      p.dmgCarry = 0;
      p.noPrintsUntil = 0;
      p.glassUntil = 0;
      p.glassMarks = new Map();
      p.lastCardAt = 0;
      p.lastHitBy = null;
      p.moveSlack = PLAYER.serverSlack;
      p.stamina = PLAYER.staminaMax;
      p.seenAt = new Map();
      p.lastVisible = null;
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
      this.pushCards(p);
    }

    telemetry.matchStart(this);
    telemetry.cardsDealt(all.length * CARD_DEAL);
    this.pushLobby();          // seeds every client's scoreboard roster
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

  sendRole(p, opts = {}) {
    if (p.bot) return;
    const r = ROLES[p.role];
    this.emit(p, {
      t: S.ROLE,
      // The client forgets what it has learned when the match number changes,
      // so a reconnect mid-round has to carry the same one - otherwise coming
      // back would quietly wipe every body you had already identified.
      match: this.matchNumber,
      resumed: !!opts.resumed,
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
      // Somebody can leave during preparation - the Sheriff, even - and their
      // corpse settles a faction's win condition before a shot is fired.
      // checkVictory only runs from a kill, and it ignores the prep phase, so
      // without this the round would run on until the next death.
      this.checkVictory();
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
      cards: (p.cardsPlayed || []).slice(),
      won: p.faction === winner,
    })).sort((a, b) => (b.won - a.won) || (b.kills - a.kills) || (b.damage - a.damage));

    this.results = { winner, blurb, rows, timeline: this.timeline.slice(-24) };
    telemetry.matchEnd(this, winner, blurb);
    this.setPhase(PHASE.RESULTS);
    this.broadcast({
      t: S.RESULTS, winner, blurb, rows, timeline: this.results.timeline,
      title: winner === 'law' ? 'THE LAW HOLDS'
        : winner === 'outlaw' ? 'THE OUTLAWS RIDE OUT'
        : winner === 'renegade' ? 'THE RENEGADE STANDS ALONE' : 'NOBODY WINS',
    });
  }

  toLobby() {
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = 0;
    this.lobbyStartAt = 0;
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
      startsIn: this.lobbyStartAt ? Math.max(0, Math.ceil(this.lobbyStartAt - now())) : 0,
    });
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------
  resetClock() { this.lastTime = now(); }

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
    } else if (this.phase === PHASE.LOBBY) {
      this.stepLobby(t);
    }

    this.sendSnapshots(t);
  }

  /**
   * A public town deals itself in. Strangers dropping into a lobby should not
   * have to work out that somebody has to press the button, and the second
   * person to arrive is the signal that a real round is possible. A private
   * room never does this: you made it to wait for the people you invited.
   */
  stepLobby(t) {
    if (!this.isPublic) return;
    const humans = this.humanCount();
    if (humans < 2) {
      if (this.lobbyStartAt) { this.lobbyStartAt = 0; this.pushLobby(); }
      return;
    }
    if (!this.lobbyStartAt) {
      this.lobbyStartAt = t + TIMING.lobbyCountdown;
      this.pushLobby();
      return;
    }
    if (t >= this.lobbyStartAt) {
      this.lobbyStartAt = 0;
      this.beginMatch();
    }
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

  /** Rolling snapshot log at REPLAY.rate, kept only long enough to build a killcam. */
  recordHistory(t) {
    if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.ENDGAME) return;
    if (this.lastRecord && t - this.lastRecord < 1 / REPLAY.rate) return;
    this.lastRecord = t;
    const ps = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      ps.push({
        id: p.id, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
        yw: r2(p.yaw), pt: r2(p.pitch),
        st: (p.crouch ? 1 : 0) | (p.sprint ? 2 : 0) | (p.moving ? 4 : 0) | (t - p.firedAt < 0.15 ? 64 : 0),
      });
    }
    this.history.push({ t, ps });
    const cutoff = t - REPLAY.window;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    while (this.shotLog.length && this.shotLog[0].t < cutoff) this.shotLog.shift();
  }

  /**
   * The last few seconds from behind the killer, carrying only the killer's and
   * the victim's tracks. The victim already learns who shot them, so this adds
   * no information - it just makes it legible, and clippable.
   */
  buildReplay(victim, killer, t) {
    const from = t - REPLAY.duration;
    const ids = new Set([victim.id, killer.id]);
    const frames = [];
    for (const f of this.history) {
      if (f.t < from) continue;
      const ps = f.ps.filter((e) => ids.has(e.id));
      if (ps.length) frames.push({ rt: r2(f.t - from), ps });
    }
    if (frames.length < 3) return null;
    return {
      t: S.REPLAY,
      duration: REPLAY.duration,
      killer: killer.id,
      killerName: killer.name,
      killerChar: killer.character,
      victim: victim.id,
      victimChar: victim.character,
      place: zoneAt(victim.pos.x, victim.pos.z, victim.pos.y),
      frames,
      shots: this.shotLog
        .filter((s) => s.t >= from && s.id === killer.id)
        .map((s) => ({ rt: r2(s.t - from), o: s.o, rays: s.rays, w: s.w })),
    };
  }

  stepPlayers(t, dt) {
    this.recordHistory(t);
    for (const p of this.players.values()) {
      // Nobody came back for this one.
      if (!p.bot && !p.connected && p.alive && t - p.disconnectedAt > SOCIAL.reconnectGrace) {
        this.killPlayer(p, null, 'left', null);
      }
      if (!p.alive) continue;

      if (p.reloading && t >= p.reloading.until) this.finishReload(p);
      if (p.buffs.until && t >= p.buffs.until) {
        p.buffs = {};
        this.pushSelf(p);
      }
      if (p.abilityUntil && t >= p.abilityUntil) p.abilityUntil = 0;

      // Footprint trail (the Tracker reads these later).
      if (p.moving && t >= (p.noPrintsUntil || 0) && t - p.lastFootprintAt > SOCIAL.footprintInterval) {
        p.lastFootprintAt = t;
        this.footprints.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, t, g: p.trailGroup });
      }

      this.stepSound(p, t);
    }
    const cutoff = t - SOCIAL.footprintTtl;
    if (this.footprints.length > 900) this.footprints = this.footprints.filter((f) => f.t >= cutoff);
  }

  /**
   * Boots on boards. This is the one information channel the game had missing:
   * you could see people and you could hear their guns, but somebody walking
   * past on the other side of a wall made no sound at all.
   *
   * Built exactly like a gunshot, and for the same reason - a step is sent to
   * everyone in earshot with a position and NO identity. You learn that
   * somebody is in the alley. You do not learn who, and the position carries a
   * little slop so it is a direction rather than a pin. Crouching is the
   * counterplay, and the Lookout's boots carry barely half as far as anyone's.
   */
  stepSound(p, t) {
    if (!p.moving || !p.alive) return;
    const gait = p.crouch ? 'crouch' : p.sprint ? 'sprint' : 'walk';
    if (t - (p.lastStepAt || 0) < SOCIAL.stepInterval[gait]) return;
    p.lastStepAt = t;

    const quiet = CHARACTERS[p.character]?.stepQuiet ?? 1;
    const range = SOCIAL.stepRange[gait] * quiet;
    const fuzz = SOCIAL.stepFuzz;

    for (const o of this.players.values()) {
      if (o.bot || !o.client || o.id === p.id) continue;
      // The dead hear the whole town - they have nothing left to do with it.
      const heard = !o.alive || Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) <= range;
      if (!heard) continue;
      this.send(o.client, {
        t: S.STEP,
        x: r2(p.pos.x + rnd(-fuzz, fuzz)),
        y: r2(p.pos.y),
        z: r2(p.pos.z + rnd(-fuzz, fuzz)),
        s: gait === 'sprint' ? 1 : 0,
        r: r2(range),
      });
    }
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
  // Visibility
  // -------------------------------------------------------------------------
  /**
   * Which players may this viewer be told about? Line of sight, with a short
   * memory so corner-peeking does not strobe, and a proximity floor so someone
   * pressed against you is never invisible.
   *
   * This is the difference between "you only know what you saw" being a design
   * and being a decoration: without it, any modified client sees everyone.
   */
  visibleTo(viewer, t) {
    const set = new Set([viewer.id]);
    // Once the round is over, or once you are dead, there is nothing left to
    // protect - the results screen reveals everything anyway.
    const revealAll = this.phase === PHASE.RESULTS || !viewer.alive;
    if (!viewer.seenAt) viewer.seenAt = new Map();

    const eye = eyeOf(viewer);
    for (const o of this.players.values()) {
      if (o.id === viewer.id) continue;
      if (revealAll) { set.add(o.id); continue; }

      const dx = o.pos.x - viewer.pos.x;
      const dz = o.pos.z - viewer.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > VISION.far * VISION.far) continue;

      let seen = false;
      if (d2 < VISION.near * VISION.near) seen = true;
      else seen = lineOfSight(eye, chestOf(o), MAP.solids);

      if (seen) {
        viewer.seenAt.set(o.id, t);
        set.add(o.id);
      } else if (t - (viewer.seenAt.get(o.id) ?? -99) < VISION.memory) {
        set.add(o.id);
      }
    }
    return set;
  }

  /** Can this viewer see the shooter right now? Reads the set cached by the last snapshot. */
  canSeeCached(viewer, targetId) {
    return viewer.lastVisible ? viewer.lastVisible.has(targetId) : true;
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
      // Long Glass marks ride the same channel as a scout reveal.
      if (viewer.glassMarks && viewer.glassMarks.size) {
        for (const [id, until] of viewer.glassMarks) {
          if (t >= until) { viewer.glassMarks.delete(id); continue; }
          const o = this.players.get(id);
          if (!o || !o.alive) continue;
          if (!reveal) reveal = [];
          if (!reveal.includes(id)) reveal.push(id);
        }
      }
      // Scout reveals punch through the cull, otherwise the ability would do
      // nothing for anyone standing behind a wall.
      const visible = this.visibleTo(viewer, t);
      if (reveal) for (const id of reveal) visible.add(id);
      viewer.lastVisible = visible;

      this.send(viewer.client, {
        t: S.SNAPSHOT,
        k: this.tick,
        ps: base.filter((e) => visible.has(e.id)),
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
      stam: r2(p.stamina ?? PLAYER.staminaMax),
      stamMax: PLAYER.staminaMax,
      buffs: Object.keys(p.buffs).filter((k) => k !== 'until'),
      loot: this.loot.filter((l) => l.active).map(lootWire),
    });
  }
}

const ARMED_LINE = {
  barrel: 'You roll the rain barrel into place. The next shot that finds you finds water instead.',
  witness: 'The money changes hands. Your next kill never happened.',
  ledger: 'The ledger is open. The next man to die in this town writes a name in it for you.',
};

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
