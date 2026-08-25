// The match. One room, one town, up to 8 gunhands (humans + bots).
//
// Authority split, chosen deliberately for a prototype:
//   - movement is client-simulated and server-clamped (keeps aiming crisp)
//   - EVERYTHING that matters - hits, damage, deaths, roles, who-learns-what -
//     is resolved here and never trusted to a client.

import {
  PLAYER, WEAPONS, DYNAMITE, WEAPON_ORDER, ROLES, PHASE, TIMING, ENDGAME,
  SOCIAL, HITBOX, CHARACTERS, GAMBLER_BOONS, LOOT_RESPAWN, VOICE_LINES, VISION, REPLAY,
  CARDS, CARD_ORDER, CARD_DEAL, DUEL, MODES, DEFAULT_MODE,
  MIN_PLAYERS, MAX_PLAYERS, rolesForPlayerCount, clamp, stepStamina, swapTime,
} from '../shared/constants.js';
import MAP, { zoneAt, SPAWNS, LOOT_SPAWNS, seatAt, seatsApart } from '../shared/map.js';
import { raycastWorld, rayPlayerBox, lineOfSight, moveAndCollide } from '../shared/collision.js';
import { C, S } from '../shared/protocol.js';
import { BotBrain, BOT_NAMES } from './bots.js';
import { Pile, handLimit, drawCheck } from './deck.js';
import { DUEL_CARDS, KIND, inReach, reachOf, DISTANCE_UNIT } from '../shared/deck.js';
import { GUNHANDS, GUNHAND_ORDER, healthOf, trait } from '../shared/gunhands.js';
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
    // How this town plays. See DUEL in shared/constants.js.
    this.mode = opts.mode === MODES.FREE ? MODES.FREE : DEFAULT_MODE;
    this.turnOrder = [];
    this.turnPtr = -1;
    this.turn = null;
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
      code: this.code,
      isPublic: this.isPublic,
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
        // The people still here may have been waiting on the one who just left.
        this.checkReady();
      } else {
        // Mid-match nobody is removed. A living body stays standing in the
        // street, silent and every bit as shootable as it was; come back inside
        // the grace and it is yours again, do not and it falls over where it
        // stands. A dead one stays dead and stays in the round's account -
        // deleting it would take a role off the aftermath screen and orphan the
        // token of a spectator who was only reloading. toLobby sweeps both.
        p.connected = false;
        p.client = null;
        p.disconnectedAt = now();
        p.moving = false;
        p.sprint = false;
        p.vel = { x: 0, y: 0, z: 0 };
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
      wantsAgain: false,
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
      case C.SELFSHOT: return this.onSelfShot(p);
      case C.BRACE: return this.onBrace(p);
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
        // The hand, the running order and the chamber, exactly as a
        // reconnecting tab gets them. Without this a human walking into a
        // turn-mode round in progress took over the body and got a screen
        // with nothing on it: pushCards is the free-for-all's six-card deck
        // and says nothing at all in a mode with eighty. The same bug was
        // found and fixed on the refresh path and never on this one, because
        // this one only happens when somebody turns up late.
        this.resumeDuel(bot);
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
    this.resumeDuel(p);
    this.sendPhaseTo(client);
    this.pushSelf(p);
    this.pushLobby();
    this.emit(p, {
      t: S.FEED,
      k: p.alive ? 'feed.backAlive' : 'feed.backDead',
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

  /**
   * "Ride again" used to dump everybody back to the lobby, where somebody then
   * had to press deal - so the button lied about what it did, and the countdown
   * next to it lied too. It is a readiness call now: the moment every human
   * still connected has pressed it, the next round starts. Alone with bots that
   * is instant, which is what it always should have been.
   */
  onRestart(p) {
    if (this.phase !== PHASE.RESULTS) return;
    if (p.wantsAgain) return;
    p.wantsAgain = true;

    const humans = [...this.players.values()].filter((o) => !o.bot && o.connected);
    const ready = humans.filter((o) => o.wantsAgain).length;
    if (humans.length > 1) {
      this.broadcast({
        t: S.FEED,
        text: `${p.name} is ready to ride again (${ready}/${humans.length}).`,
        tone: 'system',
      });
    }
    this.checkReady();
  }

  /**
   * Deal again once everybody still here has asked for it. Called when somebody
   * presses the button AND when somebody leaves, because otherwise the last
   * player to walk out could strand the rest waiting on a vote that can never
   * arrive.
   */
  checkReady() {
    if (this.phase !== PHASE.RESULTS) return;
    const humans = [...this.players.values()].filter((o) => !o.bot && o.connected);
    if (!humans.length) return;
    const ready = humans.filter((o) => o.wantsAgain).length;
    this.broadcast({ t: S.READY, ready, of: humans.length });
    if (ready >= humans.length) {
      this.toLobby();
      this.beginMatch();
    }
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

    // At your marks. Where you stand was decided during the walk; a client that
    // keeps sending positions through a turn is simply not listened to. Heads
    // still turn - being able to look is what makes standing still bearable.
    if (this.rooted) { p.moving = false; p.sprint = false; return; }

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
    p.swapUntil = now() + swapTime(slot, p.character);
    this.pushSelf(p);
  }

  // -------------------------------------------------------------------------
  // Shooting
  // -------------------------------------------------------------------------
  canFire(p) {
    const t = now();
    if (!p.alive) return false;
    // The whole point of the mode: one gun is live at a time, and the town can
    // see whose. During a walk nobody's is.
    if (this.duel && this.turnHolder !== p.id) return false;
    // And ammunition is cards. Without one of these in hand the hammer falls on
    // nothing, however full the cylinder is - and one a turn unless the gun in
    // front of you says otherwise.
    if (this.duel && !this.canBang(p)) return false;
    if (t < p.swapUntil || t < p.nextFireAt) return false;
    if (p.reloading) return false;
    const g = p.guns[p.slot];
    return g && g.mag > 0;
  }

  /**
   * Everybody still at the table, in seat order. A man who is down is out of
   * the circle and the two either side of him become neighbours, which is the
   * original's rule and the reason a round gets sharper as it thins.
   */
  seated() {
    return [...this.players.values()]
      .filter((p) => p.alive && p.seat != null)
      .sort((a, b) => a.seat - b.seat);
  }

  /** How many places apart these two are, the short way round the table. */
  seatsBetween(a, b) {
    if (!this.duel || a?.seat == null || b?.seat == null) return null;
    const ring = this.seated();
    const i = ring.findIndex((p) => p.id === a.id);
    const j = ring.findIndex((p) => p.id === b.id);
    if (i < 0 || j < 0) return null;
    return seatsApart(i, j, ring.length);
  }

  /** Is there a shot left in this hand, and in this turn? */
  canBang(p) {
    if (!this.shotCard(p)) return false;
    const gun = p.weaponCard ? DUEL_CARDS[p.weaponCard] : null;
    if (gun?.unlimited || trait(p, 'unlimited')) return true;
    return (p.bangsThisTurn || 0) < 1;
  }

  /**
   * Which card in this hand is a shot. One man on the table reads a Missed! as
   * a Bang! and a Bang! as a Missed!, so "have you got one" is a question about
   * the man as well as the hand.
   */
  shotCard(p) {
    const hand = p.duelHand || [];
    if (hand.includes('bang')) return 'bang';
    if (trait(p, 'swap') && hand.includes('missed')) return 'missed';
    return null;
  }

  /** And the other way round: what he can spend to not be there. */
  answerCard(p) {
    const hand = p.duelHand || [];
    if (hand.includes('missed')) return 'missed';
    if (trait(p, 'swap') && hand.includes('bang')) return 'bang';
    return null;
  }

  /** Spend one, face up, where the discard pile can see it. */
  spendBang(p) {
    const card = this.shotCard(p);
    const at = card ? p.duelHand.indexOf(card) : -1;
    if (at < 0) return false;
    p.duelHand.splice(at, 1);
    this.pile.put(card);
    p.bangsThisTurn = (p.bangsThisTurn || 0) + 1;
    // Two different questions. bangsThisTurn is the RULE - one shot a go, and
    // a blank out of the barrel turned round buys the go back and zeroes it.
    // These two are the RECORD, and nothing gives them back: the round went
    // off, whatever the chamber had in it. Reading the rule for the record
    // meant a go spent putting the gun to your own head and hearing a click
    // was written down as a go where nothing happened at all.
    p.firedThisTurn = true;
    p.cardsThisTurn = (p.cardsThisTurn || 0) + 1;
    // A Bang! is fired rather than played, but it is still a card that left
    // this man's hand, so it belongs on the account of the round with the rest.
    p.cardsPlayed.push(card);
    this.checkEmptyHand(p);
    this.pushDuel(p);
    return true;
  }

  onShoot(p, msg) {
    if (!this.canFire(p)) return;
    if (this.duel) {
      // The barrel has to have been steady on somebody long enough for them to
      // have seen it coming. This is the draw, and it is the only warning
      // anybody gets - so it is also the only thing to watch on somebody
      // else's go.
      if ((p.aimDwell || 0) < DUEL.drawTime) return;
      if (!this.spendBang(p)) return;
      p.roundIsLive = this.nextRound();
      // A number for this pull of the trigger, so that however many pellets
      // come out of the barrel only the first one to find anybody counts.
      p.shotSerial = (p.shotSerial || 0) + 1;
      p.shotSpent = null;
    }
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
    // Where you put the shot decides whether it lands, not what it is worth.
    // The storm and a lit stick are the two things that still work in points.
    if (this.duel && cause !== 'storm' && cause !== 'dynamite') {
      amount = DUEL.damagePerHit;
      if (attacker && attacker !== victim) {
        // One card, one shot, one man. A coach gun throws nine pellets and the
        // card being spent for them is a single Bang!, so the first pellet to
        // reach anybody is the shot and the other eight are smoke - whether it
        // landed, went into a barrel or turned out to be a blank.
        if (WEAPONS[cause]) {
          if (attacker.shotSpent === attacker.shotSerial) return;
          attacker.shotSpent = attacker.shotSerial;
        }
        if (!this.duelShotLands(victim, attacker, cause)) return;
      }
    }
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
          k: 'feed.barrelSoak',
          text: 'The rain barrel takes it. Whoever fired that is certain they missed.',
          tone: 'good',
        });
        this.pushCards(victim);
        return;
      }
    }

    let dmg = amount;
    // The star is armour in the free-for-all, where wearing it is a decision
    // and a target. In the turn mode it is neither - it was dealt face up -
    // and a hit there is worth exactly a hit whoever is wearing what.
    if (victim.badge && !this.duel) dmg *= SOCIAL.badgeDamageResist;
    if (victim.buffs.resist && !this.duel) dmg *= victim.buffs.resist;

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
      // What this shooter knows he has put into that man. A bot picking off
      // the wounded used to read the victim's health straight off the server,
      // and nothing puts another man's health in a snapshot - so the bots knew
      // who was nearly down and the human across from them did not. This is
      // the honest version: what you saw land, because you fired it.
      if (!attacker.dealtTo) attacker.dealtTo = new Map();
      attacker.dealtTo.set(victim.id, (attacker.dealtTo.get(victim.id) || 0) + dmg);
    }
    if (this.duel) this.onHitTaken(victim, attacker, dmg);

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
    // What was in his hands does not go in the ground with him.
    this.onDeathSpoils(victim);

    const place = zoneAt(victim.pos.x, victim.pos.z, victim.pos.y);

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
      this.emit(killer, { t: S.FEED, k: 'feed.bought', text: 'Nobody saw a thing. Money well spent.', tone: 'good' });
      this.emit(victim, { t: S.FEED, k: 'feed.outOfDark', text: 'A shot out of the dark. You never saw the face behind it.', tone: 'bad' });
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
        this.emit(p, { t: S.FEED, k: 'feed.ledger', text: 'The ledger writes itself. You know who did that one.', tone: 'good' });
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

  /**
   * A shot has found somebody. Between the bullet and the wound there are two
   * things that can happen instead: the barrel it hits, and the card they were
   * holding for exactly this. Both are spent here rather than asked about -
   * there is no pausing a first-person game to offer somebody a decision.
   */
  duelShotLands(victim, attacker, cause) {
    // Anything a trigger sent. The cause a fired gun carries is the gun's own
    // name rather than the word "shot", which is how the chamber, the range,
    // the barrel and the card in his hand all quietly stopped applying to
    // actual gunfire and only ever applied to the tests.
    if (cause !== 'shot' && !WEAPONS[cause]) return true;
    // The chamber is shared and nobody knows the order. A blank is a bang and
    // a puff of smoke and nothing else, and it still cost a card.
    if (attacker.roundIsLive === false) {
      this.emit(attacker, { t: S.FEED, k: 'feed.blankMine', text: 'A blank. Smoke and noise.', tone: 'bad' });
      this.emit(victim, { t: S.FEED, k: 'feed.blankAtYou', text: 'A blank, aimed at you.', tone: 'good' });
      return false;
    }
    // Out of range is out of range, whatever the bullet did.
    const d = Math.hypot(victim.pos.x - attacker.pos.x, victim.pos.z - attacker.pos.z);
    if (!inReach(attacker, victim, d, this.seatsBetween(attacker, victim))) {
      this.emit(attacker, {
        t: S.FEED, k: 'feed.tooFar', text: 'Too far. The shot goes wide of anything that matters.', tone: 'bad',
      });
      return false;
    }
    if (((victim.gear || []).includes('barrel') || trait(victim, 'barrel'))
      && this.drawFor(victim, 'barrel')) {
      this.emit(victim, { t: S.FEED, k: 'feed.intoBarrel', text: 'It goes into the barrel.', tone: 'good' });
      this.emit(attacker, { t: S.FEED, k: 'feed.woodNotMeat', text: 'Wood, not meat.', tone: 'bad' });
      return false;
    }
    // And the card in your hand only helps if you saw it coming and moved.
    // Spending it for you would be doing the only decision anybody gets to
    // make on somebody else's turn. One man's shot takes two of them.
    const need = trait(attacker, 'needsTwo') ? 2 : 1;
    const answers = [];
    for (const card of ['missed', 'bang']) {
      if (card === 'bang' && !trait(victim, 'swap')) continue;
      for (const c of (victim.duelHand || [])) if (c === card) answers.push(card);
    }
    const at = answers.length ? 0 : -1;
    if (answers.length >= need && (victim.bracedUntil || 0) > now()) {
      victim.bracedUntil = 0;
      for (let i = 0; i < need; i++) {
        const idx = victim.duelHand.indexOf(answers[i]);
        if (idx >= 0) {
          victim.duelHand.splice(idx, 1);
          this.pile.put(answers[i]);
          // Spent on somebody else's go, but spent - and getting out of the
          // way is half of what anybody does with a hand in this mode, so the
          // account of the round is wrong without it.
          victim.cardsPlayed.push(answers[i]);
        }
      }
      this.emit(victim, { t: S.FEED, k: 'feed.notThere', text: 'You were not standing where he thought.', tone: 'good' });
      this.emit(attacker, { t: S.FEED, k: 'feed.heWasReady', text: 'Missed. He was ready for it.', tone: 'bad' });
      this.checkEmptyHand(victim);
      this.pushDuel(victim);
      return false;
    }
    if (answers.length && answers.length < need && (victim.bracedUntil || 0) > now()) {
      this.emit(victim, {
        t: S.FEED, k: 'feed.needTwo',
        text: 'One was not enough. He puts two in.', tone: 'bad',
      });
    }
    if (at >= 0) {
      this.emit(victim, { t: S.FEED, k: 'feed.neverMoved', text: 'You had one in your hand and never moved.', tone: 'bad' });
    }
    return true;
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
        return this.endMatch('renegade', 'The Renegade stands alone in the dust.', 'end.renegadeDust');
      }
      if (aliveOutlaws > 0) {
        return this.endMatch('outlaw', 'The Sheriff is dead. The gang rides out rich.', 'end.starDead');
      }
      if (aliveRenegades > 0) {
        return this.endMatch('renegade', 'The star fell and the Renegade was the last hand on a trigger.', 'end.starFellRenegade');
      }
      return this.endMatch('law', 'Everyone hostile died before the Sheriff bled out. The town holds.', 'end.holdsBleeding');
    }

    if (aliveOutlaws === 0 && aliveRenegades === 0) {
      return this.endMatch('law', 'Every outlaw and the renegade are buried. The law holds Perdition Flats.', 'end.allBuried');
    }
    if (alive.length === 1 && aliveRenegades === 1) {
      return this.endMatch('renegade', 'The Renegade is the last soul standing.', 'end.lastSoul');
    }
    if (alive.length === 0) {
      return this.endMatch('none', 'Nobody walked away. The buzzards win.', 'end.buzzards');
    }
    if (aliveLaw === 0 && aliveOutlaws > 0 && aliveRenegades === 0 && (!sheriff || !sheriff.alive)) {
      return this.endMatch('outlaw', 'The law is wiped out.', 'end.lawGone');
    }
  }

  // -------------------------------------------------------------------------
  // Loot
  // -------------------------------------------------------------------------
  resetLoot() {
    // In the turn mode a stick of dynamite is a card - one of them, lit, going
    // round the table - and there is no second kind lying in a shed. A thrown
    // one carries the cause the card's blast carries, which is the one cause
    // that is allowed past the one-hit rule, so a looted stick was worth about
    // a hundred hits to a man who has four.
    const spawns = this.duel ? LOOT_SPAWNS.filter((l) => l.type !== 'dynamite') : LOOT_SPAWNS;
    this.loot = spawns.map((l, i) => ({
      id: i + 1, x: l.x, y: l.y, z: l.z, type: l.type, active: true, respawnAt: 0, dropped: false,
    }));
    this.nextLootId = spawns.length + 1;
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
        p.swapUntil = now() + swapTime(item.type, p.character);
      } else {
        const g = p.guns[item.type];
        if (g.reserve >= w.reserveMax) took = false;
        else g.reserve = Math.min(w.reserveMax, g.reserve + w.magSize * 2);
      }
    }

    if (!took) {
      // Silence here reads as a broken keybind. Say why instead.
      this.emit(p, {
        t: S.FEED, k: NO_ROOM[item.type] ? `deny.full.${item.type}` : 'deny.full.other',
        text: NO_ROOM[item.type] || 'You have no use for that.', tone: 'bad', deny: true,
      });
      return;
    }
    item.active = false;
    item.respawnAt = item.dropped ? 0 : now() + LOOT_RESPAWN;
    if (item.dropped) item.remove = true;
    // Same rule as a gunshot: the item is gone for everybody - walk into the
    // store and the coach gun is not there any more - but only somebody who
    // could see it happen learns whose hands it went into.
    const gone = { t: S.PICKED, id: item.id, type: item.type };
    for (const o of this.players.values()) {
      if (o.bot || !o.client) continue;
      const named = o.id === p.id || this.canSeeCached(o, p.id);
      this.send(o.client, named ? { ...gone, by: p.id } : gone);
    }
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
    // The turn mode has its own sixteen and one of them has something to press.
    if (this.duel) return this.onGunhandAbility(p);
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
        p.buffs.fireRateMult = c.fireMult;
        p.buffs.reloadMult = c.reloadMult;
        p.buffs.until = t + c.duration;
        break;
      case 'medic': {
        const target = this.playerInCrosshair(p, c.healRange);
        if (target) {
          target.health = Math.min(target.maxHealth, target.health + c.heal);
          payload.target = target.id;
          this.emit(target, {
            t: S.FEED, k: 'feed.patchedYou', p: { name: p.name, n: c.heal },
            text: `${p.name} patched you up (+${c.heal}).`, tone: 'good',
          });
          this.emit(p, {
            t: S.FEED, k: 'feed.youPatched', p: { name: target.name },
            text: `You patched up ${target.name}.`, tone: 'good',
          });
          this.pushSelf(target);
          this.notifyBots('healed', { medic: p, target });
        } else {
          p.health = Math.min(p.maxHealth, p.health + c.selfHeal);
          this.emit(p, {
            t: S.FEED, k: 'feed.bandagedSelf', p: { n: c.selfHeal },
            text: `You bandaged yourself (+${c.selfHeal}).`, tone: 'good',
          });
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
        this.emit(p, {
          t: S.FEED, k: `boon.${boon.id}`, text: boon.label,
          tone: boon.id === 'bust' ? 'bad' : 'good',
        });
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

    // An ability is a physical thing somebody did, so it goes to the people who
    // could watch them do it and nobody else. Broadcasting it named every
    // Scout, Medic and Gambler in town the moment they used it, through walls,
    // to everybody - which is the exact leak the snapshot cull exists to close.
    // The private half of the payload (which boon the Gambler drew) never
    // leaves the player who drew it.
    const { boon, label, ...seenByOthers } = payload;
    for (const viewer of this.players.values()) {
      if (viewer.bot || !viewer.client) continue;
      if (viewer.id === p.id) { this.send(viewer.client, payload); continue; }
      if (!this.canSeeCached(viewer, p.id)) continue;
      this.send(viewer.client, seenByOthers);
    }
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
    // A shout carries as far as a shout carries. This is the whole difference
    // between the wheel and all-chat: T reaches the town, V reaches the street.
    // The dead hear everything, having nothing better to do.
    const shout = {
      // Shouted, so it travels as a key too - a Korean town hears it in Korean.
      t: S.CHAT, from: p.name, id: p.id, text: line.text, k: `voice.${line.id}`, voice: true,
      x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
    };
    this.broadcast(shout, (o) => (
      o.id === p.id || !o.alive
      || Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) <= SOCIAL.shoutRange
    ));
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
      k: 'feed.callsOut', p: { a: p.name, b: target.name },
      text: `${p.name} calls out ${target.name}.`,
      tone: 'accuse', from: p.id, target: target.id,
    });
    this.notifyBots('accuse', { from: p, target });
  }

  onBadge(p) {
    if (!p.alive || p.role !== 'sheriff' || p.badge) return;
    p.badge = true;
    telemetry.social(this, 'badge');
    // In the turn mode the star is not armour, because it is not a decision:
    // it was already on him at the deal, and the health it would buy is
    // already in DUEL.sheriffHealth.
    if (!this.duel) {
      p.maxHealth = PLAYER.maxHealth + (ROLES.sheriff.bonusHealth || 0) + SOCIAL.badgeHealthBonus;
      p.health = p.maxHealth;
    }
    this.timeline.push({ at: Math.max(0, Math.round(now() - (this.stats?.started || now()))), type: 'badge', who: p.name });
    this.broadcast({ t: S.BADGE, id: p.id, name: p.name });
    // Two different sentences for two different games. In the free-for-all
    // anybody could be wearing it as far as the town knows, and the doubt is
    // the point. In the turn mode the manual says in as many words that the
    // star is the one role that is not a secret - so telling that town to
    // believe it at their own risk is telling them to doubt the one fact the
    // mode hands them.
    this.broadcast(this.duel ? {
      t: S.FEED,
      k: 'feed.starIsOn', p: { name: p.name },
      text: `${p.name} wears the star. That much the whole town knows for certain.`,
      tone: 'badge',
    } : {
      t: S.FEED,
      k: 'feed.pinsStar', p: { name: p.name },
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
  /**
   * A card, played off your own hand, on your own go.
   *
   * Two of the originals ask the table a question and wait for an answer -
   * whether you will spend a Bang! to survive a duel, which card you take off
   * the store shelf. There is no pausing a first-person game to ask, so those
   * resolve the way a player with any sense would answer: spend the card if you
   * are holding one, take the hit if you are not.
   */
  onDuelCard(p, msg) {
    if (!p.alive || !this.pile) return;
    if (this.turnHolder !== p.id) return;      // your own go, nobody else's
    const id = String(msg.card || '');
    const card = DUEL_CARDS[id];
    if (!card) return;
    const at = (p.duelHand || []).indexOf(id);
    if (at < 0) return;

    const target = msg.target != null ? this.players.get(msg.target) : null;
    /**
     * The card leaves the hand. Where it goes next depends on the card: most
     * are done with and go on the discard pile, but a gun, a barrel, a scope,
     * a horse and a cell all STAY - face up, in front of somebody, still in
     * the game. Those must not also be put on the pile, and for a long time
     * they were: `spend()` discarded unconditionally and the branch below then
     * laid the same id down in front of a player, so every gear card ever
     * played printed itself a second copy. Eighty cards that quietly became
     * more than eighty, and the draw odds with them.
     */
    const spend = (keep = false) => {
      p.duelHand.splice(at, 1);
      if (!keep) this.pile.put(id);
      p.cardsThisTurn = (p.cardsThisTurn || 0) + 1;
      // The aftermath prints every card a man played, and for a long time it
      // printed nothing at all in the mode that is entirely about cards: this
      // list was only ever appended to by the free-for-all's six-card deck.
      p.cardsPlayed.push(id);
    };
    // Key, English, holes. The English is the line; the key is how the same
    // line gets said in Korean, where the card names decline and the verb is
    // at the end - which is why the holes travel as data rather than as a
    // sentence with somebody else's word order baked into it.
    const say = (k, text, tone = 'system', holes = null) =>
      this.emit(p, { t: S.FEED, k, p: holes, text, tone });
    const tell = (k, text, tone = 'system', holes = null) =>
      this.broadcast({ t: S.FEED, k, p: holes, text, tone });
    const cardName = (cid) => `duel.${cid}.name`;
    const metres = (o) => Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);

    switch (card.kind) {
      case KIND.SHOT:
        return;                                 // fired with the mouse, not with a key

      case KIND.REACTION:
        say('duel.say.reaction', 'That one is for when somebody shoots at you.', 'bad');
        return;

      case KIND.WEAPON: {
        spend(true);                             // it goes on the table, not on the pile
        if (p.weaponCard) this.pile.put(p.weaponCard);   // the one it replaces does
        p.weaponCard = id;
        tell('duel.tell.weapon', `${p.name} lays a ${card.name} on the table.`, 'system',
          { name: p.name, card: card.name, cardKey: cardName(id) });
        break;
      }

      case KIND.GEAR: {
        if ((p.gear || []).includes(id)) { say('duel.say.gearOut', 'You already have one of those out.', 'bad'); return; }
        spend(true);                             // face up in front of him, still in play
        if (id === 'dynamite') {
          p.hasDynamite = true;
          tell('duel.tell.lights', `${p.name} lights a stick and sets it down.`, 'bad', { name: p.name });
        } else {
          p.gear.push(id);
          tell('duel.tell.gear', `${p.name} puts a ${card.name} in front of them.`, 'system',
            { name: p.name, card: card.name, cardKey: cardName(id) });
        }
        break;
      }

      case KIND.CURSE: {
        if (!target || !target.alive || target.id === p.id) { say('duel.say.noCurseTarget', 'Nobody to put that on.', 'bad'); return; }
        if (card.notOn && target.role === card.notOn) { say('duel.say.notTheStar', 'Not the man wearing the star.', 'bad'); return; }
        if ((target.gear || []).includes(id)) { say('duel.say.alreadyIn', 'They are already in one.', 'bad'); return; }
        spend(true);                             // the cell goes in front of him, not away
        target.gear.push(id);
        target.jailed = true;
        tell('duel.tell.jail', `${p.name} locks ${target.name} up.`, 'bad', { a: p.name, b: target.name });
        break;
      }

      case KIND.TARGET: {
        if (!target || !target.alive || target.id === p.id) { say('duel.say.noTarget', 'Nobody in mind for that.', 'bad'); return; }
        // Seats, the way the original counts them - Panic! reaches the man
        // next to you and Cat Balou reaches across the table.
        const range = card.range ?? 1;
        const away = this.seatsBetween(p, target);
        const tooFar = away != null
          ? away > range
          : Number.isFinite(range * DISTANCE_UNIT) && metres(target) > range * DISTANCE_UNIT;
        if (tooFar) {
          say('duel.say.notClose', 'Not close enough for that.', 'bad');
          return;
        }
        if (id === 'panic' || id === 'catbalou') {
          const taken = this.stripCard(target);
          if (!taken) { say('duel.say.nothingToTake', 'They have nothing to take.', 'bad'); return; }
          spend();
          if (id === 'panic') { p.duelHand.push(taken); } else { this.pile.put(taken); }
          tell(id === 'panic' ? 'duel.tell.panic' : 'duel.tell.catbalou',
            id === 'panic'
              ? `${p.name} takes something off ${target.name}.`
              : `${p.name} makes ${target.name} throw a card away.`,
            'bad', { a: p.name, b: target.name });
        } else if (id === 'duel') {
          spend();
          this.resolveDuel(p, target);
        }
        break;
      }

      case KIND.PLAY: {
        if (id === 'beer') {
          const alive = [...this.players.values()].filter((o) => o.alive).length;
          if (alive <= 2) { say('duel.say.noPouring', 'Nobody is pouring with two men left.', 'bad'); return; }
          if (p.health >= p.maxHealth) { say('duel.say.notHurt', 'You are not hurt enough to want it.', 'bad'); return; }
          spend();
          p.health = Math.min(p.maxHealth, p.health + card.heal);
          say('duel.say.oneBack', 'One hit back.', 'good');
        } else if (id === 'saloon') {
          spend();
          for (const o of this.players.values()) {
            if (o.alive) o.health = Math.min(o.maxHealth, o.health + card.healAll);
          }
          tell('duel.tell.saloon', `${p.name} buys the house a round.`, 'good', { name: p.name });
        } else if (card.draw) {
          spend();
          p.duelHand.push(...this.pile.takeMany(card.draw));
          say('duel.say.moreCards', `${card.draw} more cards.`, 'good', { n: card.draw });
        } else if (id === 'store') {
          spend();
          this.resolveStore(p);
        } else if (id === 'indians') {
          spend();
          tell('duel.tell.indians', `${p.name} points at the ridge.`, 'bad', { name: p.name });
          for (const o of this.players.values()) {
            if (!o.alive || o.id === p.id) continue;
            // What HE can shoot back with, not the literal word "bang". The
            // gunhand whose whole ability is that nothing in his hand is dead
            // was being made to take the hit while holding a Missed! he is
            // allowed to fire - because this reached for the card id directly
            // instead of asking what he can answer with.
            const card = this.shotCard(o);
            const at = card ? o.duelHand.indexOf(card) : -1;
            if (at >= 0) {
              o.duelHand.splice(at, 1);
              this.pile.put(card);
              o.cardsPlayed.push(card);       // spent on somebody else's go, but spent
              this.checkEmptyHand(o);
            } else {
              this.applyDamage(o, p, 1, 'indians', null);
            }
          }
        } else if (id === 'gatling') {
          spend();
          tell('duel.tell.gatling', `${p.name} opens up on the whole street.`, 'bad', { name: p.name });
          for (const o of this.players.values()) {
            if (!o.alive || o.id === p.id) continue;
            const card = this.answerCard(o);
            const at = card ? o.duelHand.indexOf(card) : -1;
            if (at >= 0) {
              o.duelHand.splice(at, 1);
              this.pile.put(card);
              o.cardsPlayed.push(card);
              this.checkEmptyHand(o);
            } else {
              this.applyDamage(o, p, 1, 'gatling', null);
            }
          }
        }
        break;
      }

      default: return;
    }

    for (const o of this.players.values()) if (o.alive) this.pushSelf(o);
    this.pushDuelAll();
    this.checkVictory();
  }

  /** Take one card off somebody: from the table in front of them, or the hand. */
  stripCard(target) {
    if ((target.gear || []).length) {
      const taken = target.gear.pop();
      // The cell is the one thing in front of a man that is not his. Taking it
      // opens the door, the way it does in the original - and it has to clear
      // the flag as well as the card, or the man stays locked in a cell that
      // is no longer there and the top of his go puts a second one back on the
      // pile. Eighty cards, and one of them printed twice.
      if (taken === 'jail') target.jailed = false;
      return taken;
    }
    if (target.weaponCard) { const w = target.weaponCard; target.weaponCard = null; return w; }
    if ((target.duelHand || []).length) {
      const at = Math.floor(Math.random() * target.duelHand.length);
      return target.duelHand.splice(at, 1)[0];
    }
    return null;
  }

  /**
   * Called out. You each put a Bang! down in turn, the man called out going
   * first, and whoever runs out of them takes the hit.
   */
  resolveDuel(caller, target) {
    this.broadcast({
      t: S.FEED, k: 'feed.callsOut', p: { a: caller.name, b: target.name },
      text: `${caller.name} calls out ${target.name}.`, tone: 'bad',
    });
    let turn = target;
    let other = caller;
    for (let round = 0; round < 40; round++) {
      // Whatever this man reads as a shot, which for one of the sixteen is not
      // only the card with Bang! printed on it.
      const card = this.shotCard(turn);
      const at = card ? turn.duelHand.indexOf(card) : -1;
      if (at < 0) {
        this.applyDamage(turn, other, 1, 'duel', null);
        return;
      }
      turn.duelHand.splice(at, 1);
      this.pile.put(card);
      turn.cardsPlayed.push(card);          // a called-out man's cards are cards played
      this.checkEmptyHand(turn);
      [turn, other] = [other, turn];
    }
  }

  /**
   * One card turned up for every man alive, and everybody takes one starting
   * with whoever laid the store out. The original lets you look and choose;
   * six seconds is not long enough to ask eight people what they want, so the
   * shelf is dealt out in turn order instead.
   */
  resolveStore(p) {
    const living = this.turnOrder.map((id) => this.players.get(id)).filter((o) => o && o.alive);
    const shelf = this.pile.takeMany(living.length);
    const from = Math.max(0, living.findIndex((o) => o.id === p.id));
    for (let i = 0; i < living.length && shelf.length; i++) {
      living[(from + i) % living.length].duelHand.push(shelf.shift());
    }
    this.broadcast({
      t: S.FEED, k: 'feed.storeOut', p: { name: p.name },
      text: `${p.name} lays the store out.`, tone: 'system',
    });
  }

  onCard(p, msg) {
    const t = now();
    if (this.duel) return this.onDuelCard(p, msg);
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
        this.emit(p, { t: S.FEED, k: 'feed.noSights', text: 'Nobody in your sights to put a name to.', tone: 'bad' });
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
        this.emit(p, { t: S.FEED, k: `card.${id}.armed`, text: ARMED_LINE[id], tone: 'good' });
        break;

      case 'tracks':
        this.footprints = this.footprints.filter((f) => f.g !== p.trailGroup);
        p.noPrintsUntil = t + card.duration;
        this.emit(p, {
          t: S.FEED,
          k: 'feed.swept',
          text: 'You sweep the street behind you. Every print you left is gone, and you leave none for a while.',
          tone: 'good',
        });
        break;

      case 'spyglass':
        p.glassUntil = t + card.duration;
        if (!p.glassMarks) p.glassMarks = new Map();
        this.emit(p, {
          t: S.FEED,
          k: 'feed.glass',
          text: 'Glass to your eye. For the next few seconds every shot fired in this town has a face on it.',
          tone: 'good',
        });
        break;

      case 'poster': {
        const star = target.role === 'sheriff';
        this.broadcast({
          t: S.FEED,
          k: 'feed.poster', p: { a: p.name, b: target.name },
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
          k: 'feed.postered',
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
    // Sixteen gunhands and at most eight men, dealt without repeats.
    const gunhands = shuffle(GUNHAND_ORDER.slice());

    all.forEach((p, i) => {
      p.role = roles[i];
      p.faction = ROLES[p.role].faction;
      p.alive = true;
      if (this.duel) {
        // Hits, not hit points. One shot is a quarter of a life - and which
        // quarter depends on the man, because two of the sixteen only have
        // three of them and are harder to reach for it.
        p.gunhand = gunhands[i % gunhands.length];
        const base = healthOf(p.gunhand, DUEL.health);
        p.maxHealth = base + (p.role === 'sheriff' ? DUEL.sheriffHealth - DUEL.health : 0);
      } else {
        p.gunhand = null;
        p.maxHealth = PLAYER.maxHealth + (ROLES[p.role].bonusHealth || 0);
      }
      p.health = p.maxHealth;
      p.armour = 0;
      p.badge = false;
      p.wantsAgain = false;
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
      // The turn mode has eighty cards of its own and no room on the screen or
      // in the round for a second hand, so it does without these entirely.
      p.hand = this.duel ? [] : shuffle(CARD_ORDER.slice()).slice(0, CARD_DEAL);
      p.armed = new Set();
      p.cardsPlayed = [];
      p.barrelUntil = 0;
      p.shotSerial = 0;
      p.shotSpent = null;
      p.dmgCarry = 0;
      p.noPrintsUntil = 0;
      p.glassUntil = 0;
      p.glassMarks = new Map();
      p.lastCardAt = 0;
      p.lastHitBy = null;
      p.dealtTo = new Map();
      p.moveSlack = PLAYER.serverSlack;
      p.stamina = PLAYER.staminaMax;
      p.seenAt = new Map();
      p.lastVisible = null;
      if (this.duel) {
        // A mark on the ground round the table, and facing it. Where you stand
        // is dealt to you like everything else, and it does not change again.
        p.seat = i;
        const seat = seatAt(i, all.length);
        p.pos = { x: seat.x, y: seat.y, z: seat.z };
        p.yaw = seat.yaw;
      } else {
        p.seat = null;
        const s = SPAWNS[spawnOrder[i % SPAWNS.length]];
        p.pos = { x: s.x, y: s.y, z: s.z };
        p.yaw = s.yaw;
      }
      p.vel = { x: 0, y: 0, z: 0 };
      p.pitch = 0;
      if (p.bot) p.brain = p.brain || new BotBrain(this, p);
      if (p.bot) p.brain.reset();
    });

    // The star, in the mode that deals it face up.
    //
    // The card game this mode is modelled on puts the Sheriff's role card face
    // up in front of him from the first turn, and everybody else's face down.
    // That is not a detail: it is the balance. The gang wins by killing one
    // named man while the law wins by killing whoever is left, so a gang that
    // cannot see its target is shooting at random and the law wins by
    // attrition. Sixty rounds of the harness with the star hidden came out at
    // law 67%, gang 28% - and it was 75/23 after the gang were made better at
    // guessing, because the extra shooting killed more of them than of the law.
    //
    // Hiding it is the free-for-all's game, and the free-for-all keeps it.
    if (this.duel) {
      const star = all.find((p) => p.role === 'sheriff');
      if (star) this.onBadge(star);
    }

    // Partial intel: the engine of the whole deduction layer.
    for (const p of all) {
      p.intel = this.buildIntel(p, all);
      this.sendRole(p);
      this.pushCards(p);
    }

    // The order the town takes its turns in, fixed for the round and shown to
    // everybody. Shuffled rather than seating order, because there are no seats
    // - but the star goes first, the way the card game deals it. That is not
    // decoration either: he is the one man everybody else can see, and the
    // first go of the round is the only one he takes before they have all had
    // a walk to get near him.
    this.turnOrder = this.duel ? shuffle(all.map((p) => p.id)) : [];
    if (this.duel) {
      const star = all.find((p) => p.role === 'sheriff');
      if (star) {
        this.turnOrder = [star.id, ...this.turnOrder.filter((id) => id !== star.id)];
      }
    }
    this.turnPtr = -1;
    this.turn = null;

    if (this.duel) {
      // Eighty cards, and a starting hand the size of your health - so the
      // Sheriff opens one card richer as well as one hit harder to kill.
      this.pile = new Pile();
      for (const p of all) {
        p.duelHand = this.pile.takeMany(p.maxHealth);
        p.gear = [];
        p.weaponCard = null;
        p.bangsThisTurn = 0;
        p.jailed = false;
        p.hasDynamite = false;
      }
    }

    telemetry.matchStart(this);
    telemetry.cardsDealt(this.duel ? 0 : all.length * CARD_DEAL);
    if (this.duel) telemetry.duelStart(this, all);
    this.pushLobby();          // seeds every client's scoreboard roster
    this.setPhase(PHASE.PREP);
    // The hand is dealt face down to everybody else and face up to you, and it
    // is dealt now rather than when your first turn comes round: the walk you
    // spend before anybody may fire is the walk you spend deciding where to
    // stand, and you cannot decide that without knowing how far your gun goes.
    this.pushDuelAll();
    this.broadcast({
      t: S.FEED,
      k: 'feed.rolesDealt',
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
      return {
        kind: 'pair', k: 'intel.pair', p: { a: pair[0], b: pair[1] },
        text: `The Sheriff is one of these two: ${pair.join('  or  ')}.`,
      };
    }
    if (p.role === 'outlaw') {
      const mates = others.filter((o) => o.role === 'outlaw');
      if (!mates.length) {
        return { kind: 'none', k: 'intel.alone', text: 'You ride alone. The rest of the gang never made it.' };
      }
      const mate = pick(mates).name;
      return { kind: 'name', k: 'intel.mate', p: { name: mate }, text: `You recognise one face from the gang: ${mate}.` };
    }
    if (p.role === 'renegade') {
      const lawmen = others.filter((o) => o.faction === 'law');
      if (!lawmen.length) {
        return { kind: 'none', k: 'intel.nothing', text: 'You know nothing about anyone here. Good.' };
      }
      const lawman = pick(lawmen).name;
      return {
        kind: 'name', k: 'intel.lawman', p: { name: lawman },
        text: `You know ${lawman} wears a badge of some kind - star or not.`,
      };
    }
    return {
      kind: 'none', k: 'intel.sheriff',
      text: 'Nobody knows your face. Keep it that way, or pin on the star and dare them.',
    };
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
      // The one sentence that decides your whole round, so it travels as a key
      // and its names as holes rather than as English prose.
      intelK: p.intel?.k || null,
      intelP: p.intel?.p || null,
      character: p.character,
      // Which of the sixteen you were dealt, in the mode that deals them.
      gunhand: p.gunhand || null,
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
    if (phase === PHASE.COMBAT && this.duel) {
      // Straight into a walk: nobody has chosen where to stand yet.
      this.turnPtr = -1;
      this.setTurn({ kind: 'reposition', holder: null, endsAt: now() + DUEL.reposition });
      this.loadChamber();
    }
    if (phase !== PHASE.COMBAT && phase !== PHASE.ENDGAME) this.turn = null;
    if (phase === PHASE.COMBAT) {
      this.broadcast({ t: S.FEED, k: 'feed.bell', text: 'The bell rings. Nothing is holstered now.', tone: 'system' });
      this.broadcast({ t: S.SOUND, sound: 'bell' });
      // Somebody can leave during preparation - the Sheriff, even - and their
      // corpse settles a faction's win condition before a shot is fired.
      // checkVictory only runs from a kill, and it ignores the prep phase, so
      // without this the round would run on until the next death.
      this.checkVictory();
    }
    if (phase === PHASE.ENDGAME) {
      this.broadcast({
        t: S.FEED, k: 'feed.storm',
        text: 'A dust storm closes on the town square. Get in or choke.', tone: 'bad',
      });
    }
  }

  endMatch(winner, blurb, blurbKey = null) {
    if (this.phase === PHASE.RESULTS) return;
    const rows = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, bot: p.bot, role: p.role,
      roleName: ROLES[p.role]?.name, color: ROLES[p.role]?.color,
      faction: p.faction, character: p.character,
      characterName: CHARACTERS[p.character]?.role,
      // The turn mode deals a gunhand instead of letting anybody pick a
      // character, so the character column was printing a lobby default
      // nobody chose and nobody used. What a man was dealt is the thing that
      // decided how he played the round, and it is worth reading afterwards.
      gunhand: p.gunhand || null,
      gunhandName: p.gunhand ? GUNHANDS[p.gunhand]?.ability : null,
      alive: p.alive, kills: p.kills, damage: Math.round(p.damageDealt),
      cards: (p.cardsPlayed || []).slice(),
      duel: this.duel,
      won: p.faction === winner,
    })).sort((a, b) => (b.won - a.won) || (b.kills - a.kills) || (b.damage - a.damage));

    // The account of the round. Cards and badges are always kept: they are the
    // whole payoff of a deck nobody could see being played, and a busy round
    // would otherwise push the early ones off the end of a plain tail slice.
    const recent = new Set(
      this.timeline.filter((e) => e.type !== 'card' && e.type !== 'badge').slice(-20),
    );
    const timeline = this.timeline
      .filter((e) => e.type === 'card' || e.type === 'badge' || recent.has(e))
      .slice(-40);

    this.results = { winner, blurb, blurbKey, rows, timeline };
    telemetry.matchEnd(this, winner, blurb);
    if (this.duel) {
      telemetry.duelEnd(this, [...this.players.values()].filter((x) => x.alive));
    }
    this.setPhase(PHASE.RESULTS);
    this.broadcast({
      t: S.RESULTS, winner, blurb, blurbKey, rows, timeline: this.results.timeline,
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
      p.wantsAgain = false;
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
      // Which game this town is playing. The two have different rules, and a
      // manual that describes the wrong one is worse than no manual.
      mode: this.mode,
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
      if (this.phase !== PHASE.PREP) { this.stepAim(t); this.stepTurns(t); }
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

  /** Shorthand, because it is asked on nearly every path through this file. */
  get duel() { return this.mode === MODES.DUEL; }

  /**
   * True while nobody is allowed to walk, which in the turn mode is always:
   * the game is played standing at a table and the mark you were given is the
   * mark you keep. It is where the whole of the original's sense of distance
   * comes from - the man next to you is one away and the man opposite is not.
   */
  get rooted() { return this.duel; }

  /** Whose gun is live right now, if anybody's. */
  get turnHolder() { return this.turn?.kind === 'turn' ? this.turn.holder : null; }

  setTurn(turn) {
    this.turn = turn;
    this.pushTurn();
  }

  /**
   * Whose go it is, the running order and the clock. Broadcast when it changes
   * and sent to one client when they turn up in the middle of a round, which
   * is the same packet either way.
   */
  turnMsg() {
    return {
      t: S.TURN,
      kind: this.turn ? this.turn.kind : null,
      holder: this.turn ? this.turn.holder : null,
      // Seconds remaining rather than a moment in time: the browser's clock and
      // this one are not the same clock, and the difference is a countdown that
      // starts wrong. The client ticks it down itself from here.
      left: this.turn ? r2(Math.max(0, this.turn.endsAt - now())) : 0,
      // The whole running order, so every screen can show the same table.
      order: this.turnOrder.filter((id) => this.players.get(id)?.alive),
    };
  }

  pushTurn() {
    if (!this.duel) return;
    this.broadcast(this.turnMsg());
  }

  /**
   * Everything the turn mode has that a refresh would otherwise lose: the hand,
   * whose go it is, and how much is left in the chamber.
   *
   * A reload used to hand you back your body, your role and your six
   * information cards - none of which the turn mode uses - and none of your
   * eighty. You came back to an empty screen in a game where the hand IS the
   * ammunition, and the round was over for you.
   */
  resumeDuel(p) {
    if (!this.duel || !p.client) return;
    this.send(p.client, this.turnMsg());
    if (this.chamber) {
      this.send(p.client, {
        t: S.CHAMBER,
        live: this.chamberMix ? this.chamberMix.live : undefined,
        blank: this.chamberMix ? this.chamberMix.blank : undefined,
        left: this.chamber.length,
      });
    }
    this.pushDuel(p);
  }

  /**
   * The clock that runs the round: a walk for everybody, then one short go
   * each, then a walk again. Called every step while a duel round is live.
   */
  stepTurns(t) {
    if (!this.duel || !this.turn) return;
    if (t < this.turn.endsAt) return;
    this.advanceTurn(t);
  }

  advanceTurn(t) {
    // Whoever just had their go throws away what they cannot hold on to.
    if (this.turnHolder) this.onTurnEnd(this.players.get(this.turnHolder));
    // Walk the order looking for the next living player. Running off the end is
    // the end of the round of turns, and everybody gets up and moves again.
    for (let guard = this.turnOrder.length + 1; guard > 0; guard -= 1) {
      this.turnPtr += 1;
      if (this.turnPtr >= this.turnOrder.length) {
        this.turnPtr = -1;
        this.setTurn({ kind: 'reposition', holder: null, endsAt: t + DUEL.reposition });
        this.broadcast({ t: S.SOUND, sound: 'bell' });
        this.loadChamber();
        return;
      }
      const p = this.players.get(this.turnOrder[this.turnPtr]);
      if (p && p.alive) {
        this.setTurn({ kind: 'turn', holder: p.id, endsAt: t + DUEL.turn });
        this.onTurnStart(p);
        return;
      }
    }
    this.turnPtr = -1;
    this.setTurn({ kind: 'reposition', holder: null, endsAt: t + DUEL.reposition });
  }

  /** Your go. Everything you are given for it arrives here, in order. */
  onTurnStart(p) {
    // Standing still is not resting, but it is not running either.
    p.stamina = PLAYER.staminaMax;
    p.sprint = false;
    p.moving = false;
    p.vel = { x: 0, y: 0, z: 0 };
    p.bangsThisTurn = 0;
    p.cardsThisTurn = 0;
    p.firedThisTurn = false;
    if (!this.pile) { this.pushSelf(p); return; }

    // 1. The lit stick, if it stopped with you. It travels with the turn, so
    //    this is the moment it either goes off or moves on.
    if (p.hasDynamite) {
      p.hasDynamite = false;
      if (this.drawFor(p, 'dynamite')) {
        this.pile.put('dynamite');
        this.broadcast({
          t: S.FEED, k: 'feed.stickGoesOff', p: { name: p.name },
          text: `The stick goes off in ${p.name}'s hands.`, tone: 'bad',
        });
        this.applyDamage(p, null, DUEL_CARDS.dynamite.blast, 'dynamite', null);
        if (!p.alive) { this.pushDuelAll(); return; }
      } else {
        const next = this.nextLivingAfter(p.id);
        if (next && next.id !== p.id) {
          next.hasDynamite = true;
          this.emit(p, { t: S.FEED, k: 'feed.fusePassed', text: 'The fuse is still going. You pass it on.', tone: 'system' });
          this.emit(next, { t: S.FEED, k: 'feed.handedStick', text: 'Somebody hands you a lit stick of dynamite.', tone: 'bad' });
        } else {
          p.hasDynamite = true;
        }
      }
    }

    // 2. A cell costs you the whole go, unless you talk your way out of it.
    if (p.jailed) {
      p.jailed = false;
      const had = (p.gear || []).includes('jail');
      p.gear = (p.gear || []).filter((g) => g !== 'jail');
      // Only put back a card that was actually there. Somebody may have taken
      // it off him in the meantime, and the pile is eighty cards exactly.
      if (had) this.pile.put('jail');
      if (this.drawFor(p, 'jail')) {
        this.broadcast({
          t: S.FEED, k: 'feed.outOfCell', p: { name: p.name },
          text: `${p.name} is out of the cell.`, tone: 'system',
        });
      } else {
        this.broadcast({
          t: S.FEED, k: 'feed.behindBars', p: { name: p.name },
          text: `${p.name} spends their go behind bars.`, tone: 'system',
        });
        this.pushDuelAll();
        this.advanceTurn(now());
        return;
      }
    }

    // 3. Two cards - or whatever this man's two cards are, which for six of
    //    the sixteen is not two off the top of the pile.
    this.drawForTurn(p);
    this.pushDuelAll();
    this.pushSelf(p);
  }

  /**
   * The two cards at the top of a go, dealt the way this man is dealt them.
   * Six of the sixteen take theirs from somewhere other than the top of the
   * pile, and all six are here rather than scattered through the draw.
   */
  drawForTurn(p) {
    const take = (n) => p.duelHand.push(...this.pile.takeMany(n));
    if (trait(p, 'id') === undefined && !p.gunhand) { take(DUEL.draw); return; }
    switch (p.gunhand) {
      case 'cutpurse': {
        // Off somebody else's hand rather than the pile. The nearest man
        // holding anything, because a bot has to choose and so does a player
        // with six seconds - and near is the one thing they can both see.
        const from = this.nearestHolding(p);
        if (from) {
          const at = Math.floor(Math.random() * from.duelHand.length);
          p.duelHand.push(from.duelHand.splice(at, 1)[0]);
          this.emit(from, {
            t: S.FEED, k: 'feed.lifted', p: { name: p.name },
            text: `${p.name} lifted one out of your hand.`, tone: 'bad',
          });
          take(DUEL.draw - 1);
        } else take(DUEL.draw);
        break;
      }
      case 'ragpicker': {
        // Off the top of the discard, face up, which is the whole point: the
        // town watched it go in there and can watch it come back out.
        const off = this.pile.discard.pop();
        if (off) {
          p.duelHand.push(off);
          this.broadcast({
            t: S.FEED, k: 'feed.offTheFloor', p: { name: p.name, card: DUEL_CARDS[off]?.name || off, cardKey: `duel.${off}.name` },
            text: `${p.name} takes a ${DUEL_CARDS[off]?.name || off} back off the floor.`, tone: 'system',
          });
          take(DUEL.draw - 1);
        } else take(DUEL.draw);
        break;
      }
      case 'cardsharp': {
        // The second one face up, and a red one buys another - also face up.
        take(1);
        for (let guard = 0; guard < 6; guard += 1) {
          const card = this.pile.take();
          if (!card) break;
          p.duelHand.push(card);
          const red = Math.random() < 0.5;
          this.broadcast({
            t: S.FEED, k: red ? 'feed.showsRed' : 'feed.showsBlack',
            p: { name: p.name, card: DUEL_CARDS[card]?.name || card, cardKey: `duel.${card}.name` },
            text: red
              ? `${p.name} turns a ${DUEL_CARDS[card]?.name || card} face up. Red - she takes another.`
              : `${p.name} turns a ${DUEL_CARDS[card]?.name || card} face up. Black, and that is that.`,
            tone: 'system',
          });
          if (!red) break;
        }
        break;
      }
      case 'surveyor': {
        // Three off the top, two kept. The original lets you look and choose;
        // six seconds is not long enough to ask, so the one that goes back is
        // the one a player with any sense would put back.
        const three = this.pile.takeMany(DUEL.draw + 1);
        three.sort((a, b) => this.cardWorth(p, b) - this.cardWorth(p, a));
        p.duelHand.push(...three.slice(0, DUEL.draw));
        for (const back of three.slice(DUEL.draw)) this.pile.draw.push(back);
        break;
      }
      default:
        take(DUEL.draw);
    }
  }

  /** The nearest man with anything in his hand at all. */
  nearestHolding(p) {
    let best = null, bestD = Infinity;
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive || !(o.duelHand || []).length) continue;
      const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /**
   * Roughly what a card is worth to this man, for the two places the server has
   * to choose on somebody's behalf. Ammunition first, then not dying, then the
   * cards that buy more cards. It is a heuristic and it is meant to be.
   */
  cardWorth(p, id) {
    if (id === 'bang') return this.canBang(p) || trait(p, 'unlimited') ? 9 : 7;
    if (id === 'missed') return 8;
    if (id === 'beer') return p.health < p.maxHealth ? 8.5 : 3;
    const card = DUEL_CARDS[id];
    if (!card) return 0;
    if (card.kind === 'weapon') return (card.reach || 1) > 2 ? 7.5 : 5;
    if (card.draw) return 6.5;
    if (card.kind === 'gear') return 6;
    return 4;
  }

  /** A "draw!", asked twice for the man who gets asked twice. */
  drawFor(p, which) {
    const once = drawCheck(which);
    if (!trait(p, 'lucky')) return once;
    return once || drawCheck(which);
  }

  /**
   * A hit has landed. Two of the sixteen are worth more the more they are shot:
   * one bleeds a card into his own hand for every hit and the other takes one
   * off whoever put it there. Both are the same argument - shooting a man is
   * supposed to cost you something.
   */
  onHitTaken(victim, attacker, dmg) {
    if (!this.pile || !victim.alive) return;
    const hits = Math.max(1, Math.round(dmg));
    if (victim.gunhand === 'ironhide') {
      victim.duelHand.push(...this.pile.takeMany(hits));
      this.emit(victim, {
        t: S.FEED, k: 'feed.bleedsSlow', p: { n: hits },
        text: `That is ${hits} more card${hits === 1 ? '' : 's'} in your hand.`, tone: 'good',
      });
      this.pushDuel(victim);
    }
    if (victim.gunhand === 'scavenger' && attacker && attacker !== victim) {
      let got = 0;
      for (let i = 0; i < hits; i += 1) {
        const taken = this.stripCard(attacker);
        if (!taken) break;
        victim.duelHand.push(taken);
        got += 1;
      }
      // Nothing to take off a man holding nothing, and telling him he lost one
      // when he did not is worse than saying nothing.
      if (got) {
        this.emit(attacker, {
          t: S.FEED, k: 'feed.takesItBack', p: { name: victim.name },
          text: `${victim.name} takes one off you for it.`, tone: 'bad',
        });
        // And the man whose hands did it hears about it too. Every other
        // gunhand in the sixteen says something to the person it fired for;
        // this one told the victim's attacker and left the victim to notice
        // his own hand had grown.
        this.emit(victim, {
          t: S.FEED, k: 'feed.tookItBack', p: { name: attacker.name, n: got },
          text: `You take ${got} out of ${attacker.name}'s hand for it.`, tone: 'good',
        });
        this.pushDuelAll();
      }
    }
  }

  /**
   * The one of the sixteen with a key to press: two cards off the table buys a
   * hit back. On his own go, as often as he can pay for it.
   */
  onGunhandAbility(p) {
    if (!this.pile || !p.alive) return;
    if (p.gunhand !== 'fieldsurgeon') {
      this.emit(p, {
        t: S.FEED, k: 'gun.nothingToPress',
        text: 'Your hand does its work without being asked.', tone: 'bad', deny: true,
      });
      return;
    }
    if (this.turnHolder !== p.id) {
      this.emit(p, {
        t: S.FEED, k: 'gun.notYourGo', text: 'Not on somebody else\'s go.', tone: 'bad', deny: true,
      });
      return;
    }
    if (p.health >= p.maxHealth) {
      this.emit(p, { t: S.FEED, k: 'duel.say.notHurt', text: 'You are not hurt enough to want it.', tone: 'bad', deny: true });
      return;
    }
    if ((p.duelHand || []).length < 2) {
      this.emit(p, {
        t: S.FEED, k: 'gun.needTwoCards', text: 'That costs two cards and you have not got them.',
        tone: 'bad', deny: true,
      });
      return;
    }
    // The two it can most afford to lose, by the same reckoning the rest of
    // this file uses when it has to choose for somebody.
    const order = p.duelHand
      .map((id, i) => ({ id, i, worth: this.cardWorth(p, id) }))
      .sort((a, b) => a.worth - b.worth)
      .slice(0, 2)
      .sort((a, b) => b.i - a.i);
    for (const { i } of order) {
      const spent = p.duelHand.splice(i, 1)[0];
      this.pile.put(spent);
      // Two cards off the table is two cards played, on the account of the
      // round and on the count of what this man did with his six seconds.
      p.cardsPlayed.push(spent);
      p.cardsThisTurn = (p.cardsThisTurn || 0) + 1;
    }
    p.health = Math.min(p.maxHealth, p.health + 1);
    this.emit(p, { t: S.FEED, k: 'gun.twoForOne', text: 'Two off the table, one hit back.', tone: 'good' });
    this.checkEmptyHand(p);
    this.pushSelf(p);
    this.pushDuelAll();
  }

  /** Everything in a dead man's hands ends up in one man's. */
  onDeathSpoils(victim) {
    if (!this.duel || !this.pile) return;
    const sam = [...this.players.values()].find((o) => o.alive && o.gunhand === 'undertaker' && o !== victim);

    // What was in front of him goes on the pile. Only the hand was being
    // cleared, so a dead man's gun and his barrel and his horse stayed lying
    // on a table nobody could reach across - out of the game and out of the
    // pile both. Five men down in a round of seven is a dozen cards frozen in
    // front of corpses, and everybody still standing drawing from what is
    // left of eighty. The gunhand that goes through pockets takes the hand,
    // which is what it says it takes; the table is cleared either way.
    const table = [...(victim.gear || [])];
    if (victim.weaponCard) table.push(victim.weaponCard);
    victim.gear = [];
    victim.weaponCard = null;
    victim.jailed = false;
    if (victim.hasDynamite) { table.push('dynamite'); victim.hasDynamite = false; }
    this.pile.putMany(table);

    const hand = [...(victim.duelHand || [])];
    victim.duelHand = [];
    if (!hand.length) return;
    if (!sam) { this.pile.putMany(hand); return; }
    sam.duelHand.push(...hand);
    this.emit(sam, {
      t: S.FEED, k: 'feed.pockets', p: { name: victim.name, n: hand.length },
      text: `You go through ${victim.name}'s pockets. ${hand.length} more in your hand.`, tone: 'good',
    });
    this.pushDuel(sam);
  }

  /** Her hand is empty and she is never holding nothing. */
  checkEmptyHand(p) {
    if (!this.duel || !this.pile || !p.alive) return;
    if (p.gunhand !== 'emptyhand' || (p.duelHand || []).length) return;
    const card = this.pile.take();
    if (!card) return;
    p.duelHand.push(card);
    this.emit(p, {
      t: S.FEED, k: 'feed.neverEmpty',
      text: 'Your hand went empty and something was already in it.', tone: 'good',
    });
    this.pushDuel(p);
  }

  /**
   * The end of a go: you may not be holding more cards than you have health.
   * The quiet cruelty of the whole system - the closer you are to dying, the
   * less you are allowed to do about it.
   */
  onTurnEnd(p) {
    if (!this.duel || !p || !this.pile) return;
    // What the go amounted to, before the hand is trimmed. A Bang! spent is
    // both a shot and a card, so the two counts overlap on purpose.
    telemetry.goEnd(this, p, !!p.firedThisTurn, (p.cardsThisTurn || 0) > 0);
    const limit = handLimit(p);
    while (p.duelHand.length > limit) this.pile.put(p.duelHand.pop());
    this.pushDuel(p);
  }

  // ------------------------------------------------------------- the chamber
  /**
   * Load the chamber for a lap and tell the town what went into it - how many
   * live and how many blank, never the order. One round per man alive, so by
   * the time it comes back round to you everybody has been counting.
   */
  loadChamber() {
    const living = [...this.players.values()].filter((p) => p.alive).length;
    const rounds = Math.max(2, living);
    // At least one of each, or there is nothing to count and nothing to gamble.
    const live = Math.min(rounds - 1, Math.max(1, Math.round(rounds * DUEL.liveShare)));
    this.chamber = shuffle([
      ...Array(live).fill(true),
      ...Array(rounds - live).fill(false),
    ]);
    // What went in, kept - so somebody who reloads mid-lap is told the same
    // thing everybody else was told rather than a bare number left.
    this.chamberMix = { live, blank: rounds - live };
    this.broadcast({ t: S.CHAMBER, live, blank: rounds - live, left: this.chamber.length });
    this.broadcast({
      t: S.FEED,
      k: 'feed.chamberLoaded', p: { live, blank: rounds - live },
      text: `The chamber is loaded: ${live} live, ${rounds - live} blank. Nobody is told the order.`,
      tone: 'system',
    });
  }

  /**
   * Getting ready to not be there. Costs nothing if no shot comes; spends the
   * card in your hand if one does. The only move anybody makes on somebody
   * else's turn, which is the point of it.
   */
  onBrace(p) {
    if (!this.duel || !p.alive) return;
    if (this.turnHolder === p.id) return;         // your own go is for shooting
    p.bracedUntil = now() + DUEL.drawTime + 0.35;
    this.emit(p, { t: S.FEED, k: 'feed.shiftWeight', text: 'You shift your weight.', tone: 'system' });
  }

  /**
   * Watch the barrel. While somebody has a go, whoever they are pointing at is
   * told - and how long it has been steady decides whether the gun will fire
   * at all.
   */
  stepAim(t) {
    if (!this.duel) return;
    const p = this.turnHolder ? this.players.get(this.turnHolder) : null;
    if (!p || !p.alive) {
      if (this.aimedAt) { this.tellAimed(this.aimedAt, false); this.aimedAt = null; }
      this.aimedBy = null;
      return;
    }
    // Whose gun this is, as well as who it is on. A go ending is a barrel
    // coming off somebody whether or not the next man happens to be pointing
    // at the same person, and comparing against the new holder's own stale
    // aimAt meant the warning stayed up - so a player could be told HE HAS YOU
    // while the screen also said YOUR GO.
    if (this.aimedBy !== p.id) {
      p.aimAt = null;
      p.aimSince = t;
      if (this.aimedAt) { this.tellAimed(this.aimedAt, false); this.aimedAt = null; }
      this.aimedBy = p.id;
    }
    const found = this.playerInCrosshair(p, reachOf(p));
    const onto = found ? found.id : null;
    if (onto !== this.aimedAt) {
      p.aimAt = onto;
      p.aimSince = t;
      if (this.aimedAt) this.tellAimed(this.aimedAt, false);
      this.aimedAt = onto;
      if (onto) this.tellAimed(onto, true, p);
    }
    p.aimDwell = onto ? t - p.aimSince : 0;
  }

  tellAimed(id, on, by = null) {
    const target = this.players.get(id);
    if (!target || target.bot || !target.client) return;
    this.send(target.client, { t: S.AIMED, on, by: by ? by.id : null });
  }

  /** The next round out of the shared chamber. Reloaded rather than run dry. */
  nextRound() {
    if (!this.chamber || !this.chamber.length) this.loadChamber();
    const live = this.chamber.pop();
    this.broadcast({ t: S.CHAMBER, left: this.chamber.length });
    return live;
  }

  /**
   * The barrel turned round. A blank buys another go; a live round is a hit,
   * and it does not stop at you - it carries on out of your back and takes
   * whoever chose to stand in line behind you.
   */
  onSelfShot(p) {
    if (!this.duel || !p.alive) return;
    if (this.turnHolder !== p.id) return;
    if (!this.canBang(p)) return;
    if (!this.spendBang(p)) return;

    const live = this.nextRound();
    this.broadcast({ t: S.SOUND, sound: 'gunshot', pos: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)] });
    if (!live) {
      this.broadcast({
        t: S.FEED, k: 'feed.selfClick', p: { name: p.name },
        text: `${p.name} puts it to their own head. It clicks.`, tone: 'good',
      });
      // A blank costs you a card and nothing else - and the floor is yours again.
      this.setTurn({ kind: 'turn', holder: p.id, endsAt: now() + DUEL.turn });
      p.bangsThisTurn = 0;
      this.pushDuelAll();
      return;
    }

    this.broadcast({
      t: S.FEED, k: 'feed.selfLive', p: { name: p.name },
      text: `${p.name} puts it to their own head. It was not a blank.`, tone: 'bad',
    });
    const behind = this.linedUpBehind(p);
    this.applyDamage(p, p, 1, 'selfshot', null);
    if (behind) {
      // The round out of your back is still a round. It used to be the one
      // thing in the game no card could stop - not a barrel, not a Missed! -
      // because 'selfshot' is not a weapon id and duelShotLands waves anything
      // that is not through without looking. So the gunhand whose whole
      // sentence is "every shot at him may find wood" had one shot in the
      // eighty that could not, and turning on your heel was a guaranteed hit
      // on any man at the table for the price of one of your own.
      //
      // Reach is deliberately not checked: the corridor out of your back is
      // its own measure and the manual says so. What a man gets is what he
      // has in front of him and what he did about it.
      if (this.throughStopped(behind, p)) {
        this.pushDuelAll();
        return;
      }
      this.broadcast({
        t: S.FEED,
        k: 'feed.throughInto', p: { name: behind.name },
        text: `It goes straight through and finds ${behind.name} stood behind them.`,
        tone: 'bad',
      });
      this.applyDamage(behind, p, 1, 'selfshot', null);
    }
    this.pushDuelAll();
  }

  /**
   * The two things that stop a bullet nobody warned you about: wood in front
   * of you, and having already got out of the way. Range is not one of them -
   * the corridor out of a man's back is its own measure - and neither is the
   * draw, because there was no barrel levelled at anybody to see.
   */
  throughStopped(victim, shooter) {
    if ((victim.gear || []).includes('barrel') || trait(victim, 'barrel')) {
      if (this.drawFor(victim, 'barrel')) {
        this.broadcast({
          t: S.FEED, k: 'feed.throughWood', p: { name: victim.name },
          text: `It comes out of his back and buries itself in ${victim.name}'s barrel.`,
          tone: 'system',
        });
        return true;
      }
    }
    const need = trait(shooter, 'needsTwo') ? 2 : 1;
    const answers = [];
    for (const card of ['missed', 'bang']) {
      if (card === 'bang' && !trait(victim, 'swap')) continue;
      for (const c of (victim.duelHand || [])) if (c === card) answers.push(card);
    }
    if (answers.length >= need && (victim.bracedUntil || 0) > now()) {
      victim.bracedUntil = 0;
      for (let i = 0; i < need; i += 1) {
        const at = victim.duelHand.indexOf(answers[i]);
        if (at >= 0) {
          victim.duelHand.splice(at, 1);
          this.pile.put(answers[i]);
          victim.cardsPlayed.push(answers[i]);
        }
      }
      this.broadcast({
        t: S.FEED, k: 'feed.throughMissed', p: { name: victim.name },
        text: `It comes out of his back and ${victim.name} is not there any more.`,
        tone: 'system',
      });
      this.checkEmptyHand(victim);
      return true;
    }
    return false;
  }

  /**
   * Whoever is standing in the corridor out of this player's back. Nearest
   * first: a round that has already been through one man does not go through
   * a second.
   */
  linedUpBehind(p) {
    const back = forwardOf(p);
    let best = null;
    let bestD = DUEL.selfShot.reach;
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      const dx = o.pos.x - p.pos.x;
      const dz = o.pos.z - p.pos.z;
      // Behind means the wrong side of them, so the sign is flipped.
      const along = -(dx * back.x + dz * back.z);
      if (along <= 0 || along > bestD) continue;
      const off = Math.abs(dx * -back.z + dz * back.x);
      if (off > DUEL.selfShot.corridor) continue;
      best = o;
      bestD = along;
    }
    return best;
  }

  /** Whoever is next in the running order and still breathing. */
  nextLivingAfter(id) {
    const at = this.turnOrder.indexOf(id);
    if (at < 0) return null;
    for (let i = 1; i <= this.turnOrder.length; i++) {
      const p = this.players.get(this.turnOrder[(at + i) % this.turnOrder.length]);
      if (p && p.alive) return p;
    }
    return null;
  }

  /** Your hand and what is on the table in front of everybody. Not their hands. */
  pushDuel(p) {
    if (!this.duel || p.bot || !p.client) return;
    this.send(p.client, {
      t: S.DUEL,
      hand: p.duelHand || [],
      gear: p.gear || [],
      weapon: p.weaponCard || null,
      reach: r2(reachOf(p)),
      limit: handLimit(p),
      bangs: p.bangsThisTurn || 0,
      pile: this.pile ? this.pile.remaining : 0,
      // Gear is played face up, so this much is public. Hands are a count.
      table: [...this.players.values()].filter((o) => o.alive).map((o) => ({
        id: o.id, gear: o.gear || [], weapon: o.weaponCard || null,
        cards: (o.duelHand || []).length, dynamite: !!o.hasDynamite,
      })),
    });
  }

  pushDuelAll() {
    if (!this.duel) return;
    for (const p of this.players.values()) this.pushDuel(p);
  }

  advancePhase() {
    if (this.phase === PHASE.PREP) return this.setPhase(PHASE.COMBAT);
    if (this.phase === PHASE.COMBAT) return this.setPhase(PHASE.ENDGAME);
    if (this.phase === PHASE.ENDGAME) {
      const sheriff = [...this.players.values()].find((p) => p.role === 'sheriff');
      if (sheriff && sheriff.alive) {
        return this.endMatch('law', 'Sundown. The Sheriff is still standing and the town keeps its name.', 'end.sundown');
      }
      return this.endMatch('none', 'The storm took whoever was left.', 'end.stormTook');
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
      if (o.id === p.id) continue;
      // The dead hear the whole town - they have nothing left to do with it.
      const heard = !o.alive || Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) <= range;
      if (!heard) continue;
      // Bots have ears too, or crouching past one would do nothing at all and
      // the counterplay would exist only against humans.
      if (o.bot) {
        if (o.alive && o.brain) o.brain.onEvent('step', { pos: p.pos, sprint: gait === 'sprint' });
        continue;
      }
      if (!o.client) continue;
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

const NO_ROOM = {
  whiskey: 'You are not hurt enough to want it.',
  ammo: 'Every belt you carry is already full.',
  dynamite: 'You cannot carry another stick.',
  shotgun: 'You have a coach gun and all the shells for it.',
  rifle: 'You have a lever rifle and all the rounds for it.',
};

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
