// Bot gunhands.
//
// The point of these bots is NOT to be good shots. It is to be legible: to move
// like someone with an agenda, to shoot the wrong person sometimes, to hold fire
// on somebody they have decided to trust, and to shout about it afterwards.
// Everything below is built around a per-bot suspicion table plus a faction goal.

import {
  PLAYER, WEAPONS, CHARACTERS, CARDS, PHASE, VISION, DUEL, clamp, stepStamina, canSprint,
} from '../shared/constants.js';
import { DUEL_CARDS, DISTANCE_UNIT, inReach, reachOf, coverOf } from '../shared/deck.js';
import { trait } from '../shared/gunhands.js';
import MAP, { NAV_NODES, zoneAt, placeParts } from '../shared/map.js';
import { moveAndCollide, lineOfSight } from '../shared/collision.js';

export const BOT_NAMES = [
  'Dutch Kessler', 'Mae Rowan', 'Cortez', 'Bishop Lyle', 'Ruby Fane',
  'Ezra Bell', 'Solomon Pike', 'Ines Aguirre', 'Whit Barlow', 'Calla Vance',
  'Jed Mercer', 'Nova Sackett', 'Hollis Grange', 'Perla Ruiz', 'Amos Teague',
];

// What a bot says out loud, and the key it says it under. These go out over
// the chat channel like anything anybody types, so the line travels composed;
// the key travels beside it so a client in another language can say it again.
const CHATTER = {
  suspicious: [
    ['bot.sus1', 'Somebody just took a shot at nothing. Who was that?'],
    ['bot.sus2', 'I do not like how quiet {name} is being.'],
    ['bot.sus3', '{name} keeps circling me. Explain yourself.'],
    ['bot.sus4', 'That was gunfire near {place}.'],
  ],
  friendly: [
    ['bot.fr1', '{name}, you and me, back to back.'],
    ['bot.fr2', 'Truce holds as long as your barrel stays down.'],
    ['bot.fr3', 'I got no quarrel with you.'],
  ],
  accuse: [
    ['bot.ac1', '{name} shot first. I saw it.'],
    ['bot.ac2', 'It is {name}. Has to be.'],
    ['bot.ac3', 'Do not turn your back on {name}.'],
  ],
  hurt: [
    ['bot.hu1', 'I am hit! {name} did it!'],
    ['bot.hu2', 'Somebody put lead in me over by {place}.'],
  ],
  lawful: [
    ['bot.la1', 'I ride with the law, whatever you believe.'],
    ['bot.la2', 'Put it down and nobody has to be buried today.'],
  ],
};

// ---------------------------------------------------------------------------
// Nav graph: ground nodes only. Rooftops stay a human advantage.
// ---------------------------------------------------------------------------
const NAV = NAV_NODES
  .filter((n) => !n.y || n.y < 1)
  .map((n, i) => ({ x: n.x, y: 0, z: n.z, i, links: [] }));

(function buildLinks() {
  for (let i = 0; i < NAV.length; i++) {
    for (let j = i + 1; j < NAV.length; j++) {
      const a = NAV[i], b = NAV[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 26) continue;
      if (!lineOfSight({ x: a.x, y: 1.1, z: a.z }, { x: b.x, y: 1.1, z: b.z }, MAP.solids)) continue;
      a.links.push({ i: j, d });
      b.links.push({ i, d });
    }
  }
})();

function nearestNode(x, z) {
  let best = null, bd = Infinity;
  for (const n of NAV) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function findPath(from, to) {
  const start = nearestNode(from.x, from.z);
  const goal = nearestNode(to.x, to.z);
  if (!start || !goal) return [];
  if (start.i === goal.i) return [goal];

  const open = [start.i];
  const came = new Map();
  const g = new Map([[start.i, 0]]);
  const f = new Map([[start.i, heur(start, goal)]]);
  const seen = new Set();

  while (open.length) {
    open.sort((a, b) => (f.get(a) ?? Infinity) - (f.get(b) ?? Infinity));
    const cur = open.shift();
    if (cur === goal.i) {
      const path = [NAV[cur]];
      let c = cur;
      while (came.has(c)) { c = came.get(c); path.unshift(NAV[c]); }
      path.shift();
      return path;
    }
    seen.add(cur);
    for (const link of NAV[cur].links) {
      if (seen.has(link.i)) continue;
      const tentative = (g.get(cur) ?? Infinity) + link.d;
      if (tentative < (g.get(link.i) ?? Infinity)) {
        came.set(link.i, cur);
        g.set(link.i, tentative);
        f.set(link.i, tentative + heur(NAV[link.i], goal));
        if (!open.includes(link.i)) open.push(link.i);
      }
    }
  }
  return [];
}
function heur(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// Local helpers (duplicated from room.js on purpose: keeps the import graph acyclic)
const eyeOf = (p) => ({ x: p.pos.x, y: p.pos.y + (p.crouch ? PLAYER.crouchEye : PLAYER.eye), z: p.pos.z });
const chestOf = (p) => ({ x: p.pos.x, y: p.pos.y + (p.crouch ? PLAYER.crouchHeight : PLAYER.height) * 0.62, z: p.pos.z });
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

// Draw-your-gun line. Tuned so that a stranger (~0.3) never crosses it and a
// confirmed enemy (>2.0) always does. Lower this and the match becomes a
// deathmatch; raise it and nobody ever starts anything.
//
// This and BADGE_ODDS below are the two knobs worth sweeping against real
// playtest data, so they are overridable from the environment - see the tuning
// section of the README. They are read once, at import, deliberately: changing
// how bots think halfway through a round would make any measurement worthless.
export const BOT_TUNING = {
  hostility: envNumber('HNH_HOSTILITY', 1.25),
  // How often a Sheriff bot decides to pin the star on at all. The star is
  // armour and a target at the same time, and the measurements say it is very
  // close to a coin flip which of those wins - so this one is worth leaving
  // alone without human data.
  badgeOdds: envNumber('HNH_BADGE_ODDS', 0.6),
};

function envNumber(key, fallback) {
  const raw = process.env[key];
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) ? n : fallback;
}

const HOSTILITY_THRESHOLD = BOT_TUNING.hostility;

/**
 * The same line, for a game where the gun is only live for six seconds in
 * every lap. A bot with the floor, a Bang! in hand and somebody in range has
 * one decision to make and one go to make it in, so it is a good deal readier
 * than it would be with all afternoon - but it still is not readiness on
 * sight: a stranger scores about 0.3 and stays alive.
 */
const DUEL_HOSTILITY = envNumber('HNH_DUEL_HOSTILITY', 0.5);

function weightedPick(items, weightOf) {
  let total = 0;
  const weights = items.map((it) => { const w = Math.max(0.001, weightOf(it)); total += w; return w; });
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
export class BotBrain {
  constructor(room, self) {
    this.room = room;
    this.self = self;
    this.reset();
  }

  reset() {
    const p = this.self;
    this.suspicion = new Map();     // id -> 0..1
    this.trust = new Map();         // id -> 0..1 (raised by being healed / fighting together)
    this.allies = new Set();
    this.knownFriends = new Set();  // from role intel
    this.sheriffGuess = null;
    this.sheriffCertain = false;
    this.protectee = null;
    this.target = null;
    this.threatUntil = 0;
    this.visible = [];
    this.lastSeen = new Map();      // id -> {pos, t}
    this.noise = null;              // last heard gunshot
    this.path = [];
    this.goal = null;
    this.state = 'patrol';
    this.nextThink = 0;
    this.nextPerceive = 0;
    this.nextChatAt = rnd(25, 70);
    this.nextCardAt = rnd(8, 40);
    this.reactionUntil = 0;
    this.fleeUntil = 0;
    this.burstRestUntil = 0;
    this.acquiredAt = 0;
    this.burst = 0;
    this.aimError = { x: 0, y: 0 };
    this.nextAimJitter = 0;
    this.stuckSince = 0;
    this.lastPos = { x: p.pos.x, z: p.pos.z };
    this.wantBadgeAt = 0;
    this.lootTarget = null;
    this.primeSuspect = null;       // outlaws pick someone to lean on
    this.protecteeThreat = null;    // deputies remember who went for their man
    this.nextProbeAt = 0;
    this.nextDuelActAt = 0;
    this.duelTurnKey = null;
    this.gambled = false;
    this.braceRolled = false;
    this.braceAt = 0;
    // Nobody levels a gun for exactly as long as anybody else, so the moment
    // the shot comes is not a number the man on the other end can learn.
    this.drawPatience = rnd(0.04, 0.5);
    this.sheriffness = new Map();   // id -> "looks like the law" score
    this.glassBumped = new Map();   // id -> t, so the Long Glass cannot stack suspicion per bullet
    // Skill spread so a lobby of bots does not feel like one machine.
    this.skill = clamp(rnd(0.32, 0.86), 0, 1);
    this.reactionTime = rnd(0.55, 0.24 + (1 - this.skill) * 0.9);
    this.paranoia = rnd(0.2, 0.9);
    this.aggression = rnd(0.25, 0.95);
    this.chattiness = rnd(0.2, 1.0);
  }

  // -------------------------------------------------------------------------
  // Intel handed out at role assignment
  // -------------------------------------------------------------------------
  seedFromIntel() {
    const p = this.self;
    const all = [...this.room.players.values()];
    if (p.role === 'outlaw') {
      const mates = all.filter((o) => o.id !== p.id && o.role === 'outlaw');
      if (mates.length) this.knownFriends.add(pick(mates).id);
    } else if (p.role === 'deputy') {
      // Two problems here in the turn mode, and they compounded.
      //
      // The star goes on at the bell there, so the badge event had already
      // told this brain who the Sheriff is and set sheriffCertain - and then
      // this ran, because seeding is lazy and happens on the first update
      // AFTER beginMatch. It overwrote a known man with a coin flip between
      // him and a decoy and left "certain" standing. Half the bot deputies at
      // a table spent the round defending the wrong man while the star was in
      // plain sight across it.
      //
      // And the pair itself is the free-for-all's thread. A human deputy in
      // the turn mode gets the mirror of what an outlaw gets - one face that
      // is no friend of the star - so a bot one gets the same, or the two are
      // playing different games at the same table.
      if (this.room.duel) {
        const star = all.find((o) => o.role === 'sheriff');
        if (star) {
          this.sheriffGuess = star.id;
          this.sheriffCertain = true;
          this.protectee = star.id;
          this.allies.add(star.id);
          this.trustUp(star.id, 0.8);
        }
        const enemies = all.filter((o) => o.id !== p.id && o.faction !== 'law');
        if (enemies.length) this.suspect(pick(enemies).id, 0.5);
      } else {
        const sheriff = all.find((o) => o.role === 'sheriff');
        const decoys = all.filter((o) => o.id !== p.id && o.role !== 'sheriff');
        this.pairGuess = [sheriff?.id, decoys.length ? pick(decoys).id : null].filter(Boolean);
        this.sheriffGuess = pick(this.pairGuess);
        this.protectee = this.sheriffGuess;
        this.allies.add(this.protectee);
        this.trustUp(this.protectee, 0.4);
      }
    } else if (p.role === 'sheriff') {
      // Sheriffs sometimes go loud. It is the most interesting thing they can do.
      this.wantBadgeAt = Math.random() < BOT_TUNING.badgeOdds ? rnd(30, 190) : Infinity;
    } else if (p.role === 'renegade') {
      // Not the man in the star, in the mode where he is wearing it: being
      // handed the one name the whole table already has is being handed
      // nothing, and this is the only thread the role gets. Same rule as the
      // human's, in shared/room.js buildIntel.
      const lawmen = all.filter((o) => o.id !== p.id && o.faction === 'law'
        && !(this.room.duel && o.role === 'sheriff'));
      if (lawmen.length) this.suspect(pick(lawmen).id, 0.25);
    }
  }

  markSheriffness(id, amount) {
    if (id == null || id === this.self.id) return;
    this.sheriffness.set(id, clamp((this.sheriffness.get(id) || 0.2) + amount, 0, 2));
  }

  /**
   * Outlaws have a deadline and no information, so periodically one of them
   * decides a particular stranger smells like the law and leans on them. This is
   * where nearly every round's first shot comes from - and it is often wrong,
   * which is exactly what makes the fallout interesting.
   */
  pickPrimeSuspect(t) {
    const me = this.self;
    this.nextProbeAt = t + rnd(55, 115);
    const candidates = [...this.room.players.values()].filter(
      (p) => p.alive && p.id !== me.id && !this.knownFriends.has(p.id),
    );
    if (!candidates.length) { this.primeSuspect = null; return; }
    this.primeSuspect = weightedPick(candidates, (p) => {
      let w = 0.35;
      w += (this.sheriffness.get(p.id) || 0.2) * 1.4;
      w += this.susOf(p.id) * 0.8;
      // Hanging around the office is either bravado or a confession.
      const place = zoneAt(p.pos.x, p.pos.z, p.pos.y);
      if (place === "the Sheriff's Office") w += 0.7;
      if (this.lastSeen.has(p.id) && t - this.lastSeen.get(p.id).t < 20) w += 0.3;
      return w;
    }).id;
  }

  suspect(id, amount) {
    if (id == null || id === this.self.id) return;
    this.suspicion.set(id, clamp((this.suspicion.get(id) || 0.15) + amount, 0, 1));
  }
  trustUp(id, amount) {
    if (id == null || id === this.self.id) return;
    this.trust.set(id, clamp((this.trust.get(id) || 0) + amount, 0, 1));
  }
  susOf(id) {
    let s = this.suspicion.get(id) ?? 0.15;
    s -= (this.trust.get(id) || 0) * 0.5;
    if (this.knownFriends.has(id)) s -= 0.9;
    return clamp(s, 0, 1);
  }

  // -------------------------------------------------------------------------
  // Events pushed in by the room
  // -------------------------------------------------------------------------
  onEvent(kind, data) {
    const me = this.self;
    if (!me.alive) return;
    const t = Date.now() / 1000;

    switch (kind) {
      case 'gunshot': {
        const d = Math.hypot(data.pos.x - me.pos.x, data.pos.z - me.pos.z);
        const heard = d < (data.weapon?.noise ?? 45);
        const glass = t < (me.glassUntil || 0);

        // The Long Glass puts a name and an exact place on any shot in town.
        // Two things it deliberately does NOT do, because it does not do them
        // for a player either: it is identity, not guilt - so the suspicion it
        // buys is small and rate limited rather than stacking once per bullet -
        // and it is not somewhere to GO. Seeing a man fire four hundred yards
        // off is not the same as hearing it happen next door.
        if (data.shooter && glass) {
          this.lastSeen.set(data.shooter.id, { x: data.pos.x, y: 0, z: data.pos.z, t });
          if (t - (this.glassBumped.get(data.shooter.id) ?? -99) > 3) {
            this.glassBumped.set(data.shooter.id, t);
            this.suspect(data.shooter.id, 0.09 * this.paranoia);
          }
        }

        if (heard) {
          // A shot heard is a lead, not a fact - the position is fuzzed, and
          // the shooter only gets named if this bot could actually see them.
          const named = !!data.shooter && (glass || this.canSee(data.shooter));
          this.noise = {
            x: glass ? data.pos.x : data.pos.x + rnd(-4, 4),
            z: glass ? data.pos.z : data.pos.z + rnd(-4, 4),
            t,
            shooter: named ? data.shooter.id : null,
          };
          if (!glass && this.noise.shooter) this.suspect(this.noise.shooter, 0.1 * this.paranoia);
        }
        break;
      }
      case 'step': {
        // Boots nearby. A lead, never a name, and a much weaker one than a
        // gunshot: if there has been shooting recently that is the better
        // thread to pull, and a step points at a rough area rather than a spot.
        if (this.noise && !this.noise.soft && t - this.noise.t < 5) break;
        if (Math.random() > 0.35 + this.paranoia * 0.4) break;
        this.noise = {
          x: data.pos.x + rnd(-4, 4), z: data.pos.z + rnd(-4, 4),
          t, shooter: null, soft: true,
        };
        break;
      }

      case 'damaged': {
        if (data.victim === me && data.attacker) {
          this.suspect(data.attacker.id, 0.6);
          this.allies.delete(data.attacker.id);
          this.knownFriends.delete(data.attacker.id);
          this.target = data.attacker.id;
          this.threatUntil = t + 9;
          this.reactionUntil = t + this.reactionTime * 0.5;
          if (Math.random() < 0.3 * this.chattiness) {
            this.say(pick(CHATTER.hurt), { name: data.attacker.name, place: zoneAt(me.pos.x, me.pos.z) });
          }
        } else if (data.attacker && data.attacker !== me && this.canSee(data.attacker)) {
          this.suspect(data.attacker.id, 0.3 * this.paranoia);
          // Shooting the man with the star on is loud, and in the turn mode it
          // is also public: one gun is live at a time and the other six are
          // standing still watching it. It is a lead rather than a verdict,
          // though - the law jumping on the first man it saw fire at the star
          // put the gang's win share UP, because a sixth of all shooting is
          // friendly fire and the law spent the round shooting each other.
          // Shooting the man with the star on is the loudest thing anybody can
          // do, and at a table it is also the most public: one gun is live at a
          // time and everybody else is standing still watching it. Whoever
          // pulls that trigger has told the table what he is.
          if (data.victim?.badge) {
            if (me.faction === 'law') {
              this.suspect(data.attacker.id, 0.8);
              this.target = data.attacker.id;
              this.threatUntil = t + 30;
            } else this.suspect(data.attacker.id, 0.15);
          }
          if (data.victim && this.allies.has(data.victim.id)) {
            this.suspect(data.attacker.id, 0.35);
            this.target = data.attacker.id;
            this.threatUntil = t + 7;
          }
          // Someone going after my man answers the only question I care about.
          if (data.victim && data.victim.id === this.protectee) {
            this.protecteeThreat = data.attacker.id;
            this.target = data.attacker.id;
            this.threatUntil = t + 12;
            this.suspect(data.attacker.id, 0.5);
          }
          // People who take fire from several directions start to look important.
          if (data.victim) this.markSheriffness(data.victim.id, 0.12);
        }
        break;
      }
      case 'kill': {
        const { victim, killer, witnesses } = data;
        if (!killer) break;
        if (witnesses.has(me.id) && killer.id !== me.id) this.suspect(killer.id, 0.4);
        // The corpse tells everyone its role. Update the model accordingly.
        if (victim.role === 'outlaw') {
          if (me.faction === 'law') { this.trustUp(killer.id, 0.3); this.suspicion.set(killer.id, clamp(this.susOf(killer.id) - 0.25, 0, 1)); }
          if (me.role === 'outlaw' && witnesses.has(me.id)) this.suspect(killer.id, 0.4);
        } else if (victim.faction === 'law' && witnesses.has(me.id)) {
          if (me.faction === 'law') this.suspect(killer.id, 0.5);
          else this.trustUp(killer.id, 0.2);
        }
        if (this.protectee === victim.id) {
          this.protectee = null;
          this.sheriffGuess = this.pairGuess ? this.pairGuess.find((id) => id !== victim.id) ?? null : null;
          if (this.sheriffGuess) this.protectee = this.sheriffGuess;
        }
        if (this.target === victim.id) this.target = null;
        if (this.primeSuspect === victim.id) {
          // Wrong man. Pick a new one after a beat, and feel a little worse.
          this.primeSuspect = null;
          this.nextProbeAt = t + rnd(8, 20);
        }
        if (killer.id === me.id) {
          // A beat to look at what you just did before swinging onto the next one.
          this.reactionUntil = t + rnd(0.7, 1.8);
          this.burstRestUntil = t + rnd(0.5, 1.2);
          this.target = null;
        }
        this.allies.delete(victim.id);
        break;
      }
      case 'badge': {
        const s = data.sheriff;
        this.sheriffGuess = s.id;
        this.sheriffCertain = true;
        this.primeSuspect = null;
        this.markSheriffness(s.id, 2);
        if (me.role === 'outlaw') { this.target = s.id; this.threatUntil = t + 30; }
        if (me.role === 'deputy') { this.protectee = s.id; this.trustUp(s.id, 0.8); }
        if (me.role === 'renegade') this.trustUp(s.id, 0.2);  // let the gang soften him first
        if (me.role === 'sheriff') { /* it was us */ }
        break;
      }
      case 'accuse': {
        const weight = 0.1 + 0.15 * (this.trust.get(data.from.id) || 0);
        if (data.target.id === me.id) {
          this.suspect(data.from.id, 0.2 * this.paranoia);
        } else {
          this.suspect(data.target.id, weight * this.paranoia);
        }
        break;
      }
      case 'healed': {
        if (data.target === me) { this.trustUp(data.medic.id, 0.6); this.allies.add(data.medic.id); }
        else if (this.canSee(data.medic)) {
          // Two people helping each other is the loudest signal in the game.
          if (me.faction !== 'law') { this.suspect(data.medic.id, 0.2); this.suspect(data.target.id, 0.2); }
          this.markSheriffness(data.target.id, 0.55);   // you do not patch up a nobody
          this.markSheriffness(data.medic.id, 0.15);
        }
        break;
      }
      case 'voice': {
        if (data.line === 'friendly' || data.line === 'truce') this.trustUp(data.from.id, 0.08);
        if (data.line === 'lawman' && me.role === 'outlaw') this.suspect(data.from.id, 0.25);
        break;
      }
    }
  }

  say([key, template], vars = {}) {
    const text = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? 'somebody');
    // A place is a place rather than a phrase, so it travels with its id and
    // gets named again on the other side in whatever language is over there.
    const holes = { ...vars };
    const where = vars.place ? placeParts(vars.place) : null;
    if (where?.ids?.length) holes.placeKey = `place.${where.ids[0]}`;
    this.room.broadcast({
      t: 'chat', from: this.self.name, id: this.self.id, text, bot: true,
      k: key, p: holes,
    });
  }

  // -------------------------------------------------------------------------
  // Perception
  // -------------------------------------------------------------------------
  canSee(other) {
    if (!other || !other.alive) return false;
    const me = this.self;
    const eye = eyeOf(me);
    const c = chestOf(other);
    const d = Math.hypot(c.x - eye.x, c.z - eye.z);
    if (d > VISION.botSight) return false;
    const dir = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= len; dir.y /= len; dir.z /= len;
    const fwd = this.forward();
    // ~130 degree cone: bots do not have eyes in the back of their heads.
    if (dir.x * fwd.x + dir.y * fwd.y + dir.z * fwd.z < -0.42) return false;
    return lineOfSight(eye, c, MAP.solids);
  }

  forward() {
    const p = this.self;
    const cp = Math.cos(p.pitch);
    return { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp };
  }

  perceive(t) {
    const me = this.self;
    this.visible = [];
    for (const o of this.room.players.values()) {
      if (o.id === me.id || !o.alive) continue;
      if (this.canSee(o)) {
        this.visible.push(o);
        this.lastSeen.set(o.id, { x: o.pos.x, y: o.pos.y, z: o.pos.z, t });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Goal selection
  // -------------------------------------------------------------------------
  /**
   * How badly do I want this person dead? Above HOSTILITY_THRESHOLD I draw.
   *
   * The numbers matter more than they look: a stranger scores ~0.3, which is
   * deliberately below the threshold. Bots do NOT shoot people on sight. Violence
   * has to be *caused* - by being shot at, by witnessing something, by an
   * accusation landing, or by an Outlaw deciding you look like the law.
   */
  wantsDead(o) {
    const me = this.self;
    if (this.knownFriends.has(o.id)) return -1;
    if (o.id === this.protectee) return -1;
    const t = Date.now() / 1000;
    const sus = this.susOf(o.id);
    const alive = [...this.room.players.values()].filter((p) => p.alive).length;

    // Somebody who just put lead in me gets answered whatever their politics.
    if (me.lastHitBy === o.id && t - me.lastHitAt < 10) return 2.4;

    switch (me.role) {
      case 'outlaw':
        if (o.badge) return 3.2;
        if (this.sheriffGuess === o.id) return this.sheriffCertain ? 3.2 : 1.5;
        if (this.primeSuspect === o.id) return 1.35;
        return 0.12 + sus * 1.4;
      case 'deputy':
        if (this.protecteeThreat === o.id && t < this.threatUntil) return 2.4;
        return 0.08 + sus * 1.5;
      case 'sheriff':
        return 0.10 + sus * 1.6;
      case 'renegade': {
        // The Renegade wants a thin crowd, not a fast kill. He turns late.
        const late = alive <= 3;
        // The star has to stay up until everyone else is down, or somebody
        // else's win condition fires first and he gets nothing.
        if (o.badge || this.sheriffGuess === o.id) return late ? 2.8 : -1;
        // Until then he draws only on somebody he is genuinely certain of. The
        // old numbers here topped out at 1.0 against a threshold of 1.25, which
        // meant a Renegade could not draw on anybody at all before the turn
        // except in self defence - he spent two thirds of every round as
        // scenery. He is still the least trigger-happy man in town, because
        // every fight he is not in is one he does not have to win.
        return (late ? 1.5 : 0.1) + sus * (late ? 1.2 : 1.25);
      }
      default:
        return 0.15 + sus;
    }
  }

  chooseTarget(t) {
    const me = this.self;
    let best = null, bestScore = HOSTILITY_THRESHOLD;
    for (const o of this.visible) {
      let score = this.wantsDead(o);
      if (score < 0) continue;
      const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      score *= clamp(1.35 - d / 60, 0.35, 1.35);
      // Finish the wounded - but only the ones this bot put the wounds in.
      // Reading o.health here was reading a number no player is ever sent.
      const known = me.dealtTo ? (me.dealtTo.get(o.id) || 0) : 0;
      score *= 1 + Math.min(1, known / Math.max(1, o.maxHealth)) * 0.8;
      score *= 0.7 + this.aggression * 0.6;
      if (this.target === o.id) score *= 1.35;                  // commitment
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      if (this.target !== best.id) {
        this.reactionUntil = t + this.reactionTime;
        this.acquiredAt = t;
        this.burst = 0;
      }
      this.target = best.id;
      this.threatUntil = t + 6;
      return best;
    }
    if (this.threatUntil > t && this.target != null) {
      const held = this.room.players.get(this.target);
      if (held && held.alive) return held;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  update(t, dt) {
    const me = this.self;
    if (!me.alive) return;
    if (this.room.phase === PHASE.LOBBY || this.room.phase === PHASE.RESULTS) return;
    if (!this.seeded) { this.seedFromIntel(); this.seeded = true; }

    if (t >= this.nextPerceive) {
      this.nextPerceive = t + 0.12;
      this.perceive(t);
    }

    const fighting = this.room.phase !== PHASE.PREP;
    const target = fighting ? this.chooseTarget(t) : null;
    const visibleTarget = target && this.visible.includes(target) ? target : null;

    // The turn mode rations the trigger and nails the feet down. Everything
    // below this line assumes a bot may shoot whenever it likes and walk while
    // it does, and neither is ever true there, so it forks here.
    //
    // On the mode rather than on there being a turn in progress: the fork used
    // to wait for the bell, and until it rang every bot walked off the mark it
    // had been dealt using the other game's brain.
    if (this.room.duel) return this.duelUpdate(t, dt, visibleTarget);

    if (t >= this.nextThink) {
      this.nextThink = t + rnd(0.25, 0.6);
      this.think(t, target, visibleTarget);
    }

    this.aim(t, dt, visibleTarget);
    this.move(t, dt, visibleTarget);
    if (fighting) this.fight(t, visibleTarget);
    this.useAbility(t, visibleTarget);
    this.playCards(t, visibleTarget);
    this.tryLoot(t);
    this.social(t, dt);

    // Sheriff bots deciding to go public is the map's biggest event.
    if (me.role === 'sheriff' && !me.badge && this.room.phase === PHASE.COMBAT) {
      this.badgeTimer = (this.badgeTimer || 0) + dt;
      if (this.badgeTimer > this.wantBadgeAt) this.room.onBadge(me);
    }
  }

  // -------------------------------------------------------------------------
  // The turn mode
  //
  // Three states, and the round is nothing but these three going round: it is
  // your go, it is somebody else's go, or everybody is walking. A bot has one
  // decision in each - who to point at, whether to move when somebody points
  // at you, and where to stand so that the first two go your way.
  // -------------------------------------------------------------------------
  duelUpdate(t, dt, visibleTarget) {
    const me = this.self;
    const room = this.room;
    // Before the bell there is no floor to hold and nothing to do but stand at
    // your mark and look at the people who are going to try to kill you.
    const mine = room.turnHolder === me.id;
    const quarry = mine ? this.duelQuarry() : null;
    me.moving = false;
    me.sprint = false;
    me.vel = { x: 0, y: 0, z: 0 };

    // Only one man in town is pointing a gun at anybody. Everybody else is
    // watching him do it, which is also how they see it coming.
    // think() is where an outlaw decides who he is going to lean on, and this
    // fork does not call think(). So in the turn mode no outlaw had ever picked
    // anybody out, and the law won two rounds in three because the gang spent
    // every one of them shooting at whoever happened to be in front of them.
    if (me.role === 'outlaw' && !this.sheriffCertain && t >= this.nextProbeAt) this.pickPrimeSuspect(t);

    const holder = room.turnHolder ? room.players.get(room.turnHolder) : null;
    this.aim(t, dt, mine ? quarry : (holder && holder !== me ? holder : visibleTarget), mine);

    if (mine) this.duelTurn(t, quarry);
    else this.duelWatch(t);
    this.social(t, dt);

    // Pinning the star is the map's biggest event in either mode, and this
    // fork used to be above the line that does it - so in the turn mode no
    // Sheriff had ever pinned one on. Forty rounds of the harness and the
    // number sat at 0.00 the whole time.
    if (me.role === 'sheriff' && !me.badge && room.phase === PHASE.COMBAT) {
      this.badgeTimer = (this.badgeTimer || 0) + dt;
      if (this.badgeTimer > this.wantBadgeAt) room.onBadge(me);
    }
  }

  /** Whoever this bot would most like to see face down, at any distance. */
  duelMark() {
    let best = null, bestWant = 0.35;
    for (const o of this.room.players.values()) {
      if (o.id === this.self.id || !o.alive) continue;
      const want = this.wantsDead(o);
      if (want > bestWant) { bestWant = want; best = o; }
    }
    return best;
  }

  /** The same man, but only if the gun actually reaches him and can see him. */
  duelQuarry() {
    const me = this.self;
    let best = null, bestScore = DUEL_HOSTILITY;
    for (const o of this.room.players.values()) {
      if (o.id === me.id || !o.alive) continue;
      const want = this.wantsDead(o);
      if (want <= 0) continue;
      const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      // Seats, which at a table is the only measure that means anything. Asking
      // the ground instead had every bot believe it could reach every other man
      // - the table is eleven metres across and a belt gun is twenty-two - so
      // they spent their go and their card on shots the room then threw out as
      // out of range. Two hundred and sixty-five of them in sixty rounds.
      if (!inReach(me, o, d, this.room.seatsBetween(me, o))) continue;
      if (!lineOfSight(eyeOf(me), chestOf(o), MAP.solids)) continue;
      // How weak he LOOKS, which is not the same as how weak he is. This used
      // to read o.health straight off the server, and nothing puts another
      // man's health in a snapshot - so every bot at the table knew exactly
      // who was one hit from going down while the human across from them
      // could only count cards. The public tell is the hand: a short one
      // means fewer answers and, since the limit is the health, usually a man
      // in trouble. Same instinct, read off the table like everybody else.
      const held = (o.duelHand || []).length;
      const looksWeak = 1 - Math.min(1, held / Math.max(1, DUEL.health));
      const score = want * (0.7 + this.aggression * 0.6) * (1 + looksWeak * 0.6);
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  /** Your go: a card on the table, then the gun. In that order, and once each. */
  duelTurn(t, quarry) {
    // A go is a go, and some of what happens in one happens once. This runs
    // every tick of it, so without a mark for which go this is, "once" means
    // "once and then never again for the rest of the round" - which is what a
    // gamble that parked nextDuelActAt a million seconds out actually did.
    const key = this.room.turn?.endsAt;
    if (key !== this.duelTurnKey) {
      this.duelTurnKey = key;
      this.gambled = false;
      this.nextDuelActAt = 0;
    }
    if (t < this.nextDuelActAt) return;
    if (this.duelPlayCard(t, quarry)) { this.nextDuelActAt = t + rnd(0.3, 0.9); return; }
    if (!quarry && !this.gambled) {
      this.gambled = true;
      if (this.duelGamble(t)) { this.nextDuelActAt = t + 0.8; return; }
    }
    this.duelShoot(t, quarry);
  }

  /**
   * The barrel turned round. A go with nobody in reach is a go worth nothing,
   * and the gamble is the one thing that can still be done with it: a click
   * buys another, and a live round costs a hit but does not stop at you.
   *
   * So the sum is a real one. Take it when the go is dead anyway, when the
   * chamber has been counted down to mostly blanks, and when whoever chose to
   * stand in the line behind you is somebody you would not mind finding.
   */
  duelGamble(t) {
    const me = this.self;
    const room = this.room;
    if (!room.canBang(me)) return false;
    const left = (room.chamber || []).length;
    if (!left) return false;
    // What is left in it, from what the town was told and has been counting.
    const blanks = room.chamber.filter((live) => !live).length;
    const odds = blanks / left;
    const behind = room.linedUpBehind(me);
    // A man behind you is a reason to do it or a reason not to, and which one
    // is the whole of what standing in that line means.
    const wants = behind ? this.wantsDead(behind) : 0;
    if (behind && wants <= 0) return false;
    let want = odds * (0.35 + this.aggression * 0.5);
    if (behind && wants > 1) want += 0.45;
    if (me.health <= 1 && !behind) want *= 0.15;      // one hit left and no upside
    if (Math.random() > want) return false;
    room.onSelfShot(me);
    return true;
  }

  /**
   * What to play, in the order a man who wanted to live would play it. Every
   * one of these goes through Room.onDuelCard, so a bot cannot play a card a
   * player could not - and a refusal simply falls through to the next line.
   */
  duelPlayCard(t, quarry) {
    const me = this.self;
    const room = this.room;
    const hand = me.duelHand || [];
    if (!hand.length) return false;
    const has = (id) => hand.includes(id);
    const out = (id) => (me.gear || []).includes(id);
    const count = (id) => (me.duelHand || []).filter((c) => c === id).length;
    // Truth is whether the card left the hand, not whether we asked: the room
    // turns down plenty of these and the next line down is usually still good.
    const play = (id, target) => {
      const before = count(id);
      room.onDuelCard(me, { card: id, target: target ? target.id : undefined });
      return count(id) < before;
    };
    const alive = [...room.players.values()].filter((o) => o.alive).length;

    // The one of the sixteen with something to press: two cards for a hit
    // back, which is worth it while he can still spare two.
    if (me.gunhand === 'fieldsurgeon' && me.health < me.maxHealth && hand.length >= 4) {
      const before = me.health;
      room.onGunhandAbility(me);
      if (me.health > before) return true;
    }
    // Still being alive comes before anything you might do with the turn.
    if (has('beer') && me.health < me.maxHealth && alive > 2 && play('beer')) return true;
    // The lit stick only punishes the man still holding it, so it goes down.
    if (has('dynamite') && !me.hasDynamite && play('dynamite')) return true;
    // A gun that reaches further beats any single shot you could take with the
    // one you have, because it decides every shot for the rest of the round.
    const held = DUEL_CARDS[me.weaponCard]?.reach || 1;
    for (const id of ['winchester', 'carabine', 'remington', 'schofield', 'volcanic']) {
      if (has(id) && (DUEL_CARDS[id].reach || 1) > held && play(id)) return true;
    }
    // More cards is more of everything else on this list.
    if (has('wells') && play('wells')) return true;
    if (has('stagecoach') && play('stagecoach')) return true;
    if (has('store') && play('store')) return true;
    // Ground: something to stand behind, something to see with, and distance.
    if (has('barrel') && !out('barrel') && play('barrel')) return true;
    if (has('mustang') && !out('mustang') && play('mustang')) return true;
    if (has('scope') && !out('scope') && play('scope')) return true;

    const mark = quarry || this.duelMark();
    if (mark) {
      if (has('jail') && play('jail', mark)) return true;
      // Calling somebody out is only sensible if you brought more bullets.
      if (has('duel') && count('bang') >= 2 && play('duel', mark)) return true;
      if (has('catbalou') && play('catbalou', mark)) return true;
      if (has('panic') && play('panic', mark)) return true;
    }
    // The two that point at the whole street, worth it while the street is full.
    if (has('gatling') && alive > 2 && play('gatling')) return true;
    if (has('indians') && alive > 2 && play('indians')) return true;
    return false;
  }

  /**
   * The draw. The gun has to be on him and it has to have been on him long
   * enough for him to have done something about it - that wait is the mode,
   * and skipping it would take the only warning anybody gets away from them.
   */
  duelShoot(t, quarry) {
    const me = this.self;
    if (!quarry || !this.room.canBang(me)) return;
    if (me.aimAt !== quarry.id) return;
    if ((me.aimDwell || 0) < DUEL.drawTime + this.drawPatience) return;
    this.room.onShoot(me, { dir: this.forward() });
  }

  /**
   * Somebody else's go, and his barrel has stopped on you. You have the length
   * of his draw and a card that only works if you spend it before the shot.
   * A bot that always ducked would be unhittable, so this is a nerve check.
   */
  duelWatch(t) {
    const me = this.self;
    if (this.room.aimedAt !== me.id) { this.braceRolled = false; this.braceAt = 0; return; }
    if (!this.braceRolled) {
      this.braceRolled = true;
      // Whatever this man can spend to not be there, which for one of the
      // sixteen is a Bang! - asking the room rather than the hand means a
      // gunhand added later does not have to be added here as well.
      const answer = this.room.answerCard(me);
      // And the man shooting at him may be the one it takes two to get out of
      // the way of, in which case one is worth nothing and he keeps it.
      const need = trait(this.room.players.get(this.room.turnHolder), 'needsTwo') ? 2 : 1;
      const held = (me.duelHand || []).filter((c) => c === 'missed'
        || (trait(me, 'swap') && c === 'bang')).length;
      this.braceAt = answer && held >= need
        && Math.random() < 0.28 + this.skill * 0.55
        ? t + rnd(0.1, 0.4) : 0;
    }
    if (this.braceAt && t >= this.braceAt) { this.braceAt = 0; this.room.onBrace(me); }
  }

  think(t, target, visibleTarget) {
    const me = this.self;
    if (this.room.phase === PHASE.PREP) {
      this.state = 'loot';
      if (!this.goal || this.reached(this.goal, 3)) this.setGoal(this.pickLootGoal() || this.wanderGoal());
      return;
    }

    // Endgame storm: everything else is secondary to being inside the ring.
    if (this.room.phase === PHASE.ENDGAME) {
      const d = Math.hypot(me.pos.x, me.pos.z);
      const r = (this.room.ringRadius || 60) - 6;
      if (d > r) {
        this.state = 'ring';
        this.setGoal({ x: rnd(-8, 8), z: rnd(-8, 8) });
        return;
      }
    }

    if (me.role === 'outlaw' && !this.sheriffCertain && t >= this.nextProbeAt) this.pickPrimeSuspect(t);

    // Breaking off a losing fight is what keeps most engagements from ending in
    // a body, which is what keeps the round long enough to think in.
    const hurt = me.health / me.maxHealth;
    if (this.fleeUntil > t) {
      this.state = 'flee';
      if (!this.goal || this.reached(this.goal, 4)) this.setGoal(this.awayGoal(visibleTarget));
      return;
    }
    if (hurt < 0.45 && Math.random() < 0.8) {
      this.state = 'flee';
      this.fleeUntil = t + rnd(4, 9);
      this.target = null;
      this.setGoal(this.awayGoal(visibleTarget));
      return;
    }

    if (visibleTarget) {
      this.state = 'engage';
      this.path = [];
      return;
    }

    if (target && this.lastSeen.has(target.id) && t - this.lastSeen.get(target.id).t < 12) {
      this.state = 'hunt';
      const ls = this.lastSeen.get(target.id);
      this.setGoal({ x: ls.x + rnd(-3, 3), z: ls.z + rnd(-3, 3) });
      return;
    }

    // Deputies shadow whoever they think wears the star.
    if (me.role === 'deputy' && this.protectee) {
      const prot = this.room.players.get(this.protectee);
      if (prot && prot.alive) {
        const d = Math.hypot(prot.pos.x - me.pos.x, prot.pos.z - me.pos.z);
        if (d > 14) { this.state = 'escort'; this.setGoal({ x: prot.pos.x + rnd(-5, 5), z: prot.pos.z + rnd(-5, 5) }); return; }
      }
    }

    // Outlaws with a name to hunt go looking for it.
    if (me.role === 'outlaw') {
      const hunted = this.sheriffGuess ?? this.primeSuspect;
      const s = hunted != null ? this.room.players.get(hunted) : null;
      if (s && s.alive) {
        const ls = this.lastSeen.get(s.id);
        const seek = ls || (s.badge ? s.pos : null);
        if (seek) { this.state = 'hunt'; this.setGoal({ x: seek.x + rnd(-6, 6), z: seek.z + rnd(-6, 6) }); return; }
      }
    }

    // Gunfire is worth walking towards. Boots are worth wandering towards.
    const noiseAge = this.noise ? t - this.noise.t : Infinity;
    const noiseWindow = this.noise?.soft ? 5 : 8;
    const noiseOdds = this.noise?.soft ? 0.3 : 0.6;
    if (this.noise && noiseAge < noiseWindow && Math.random() < noiseOdds) {
      this.state = 'investigate';
      this.setGoal({ x: this.noise.x, z: this.noise.z });
      return;
    }

    const wantLoot = this.pickLootGoal();
    if (wantLoot && Math.random() < 0.5) { this.state = 'loot'; this.setGoal(wantLoot); return; }

    if (!this.goal || this.reached(this.goal, 3.5)) {
      this.state = 'patrol';
      this.setGoal(this.wanderGoal());
    }
  }

  wanderGoal() {
    const n = pick(NAV);
    return { x: n.x + rnd(-2, 2), z: n.z + rnd(-2, 2) };
  }

  awayGoal(from) {
    const me = this.self;
    let dx = rnd(-1, 1), dz = rnd(-1, 1);
    if (from) { dx = me.pos.x - from.pos.x; dz = me.pos.z - from.pos.z; }
    const len = Math.hypot(dx, dz) || 1;
    return { x: clamp(me.pos.x + (dx / len) * 22, -66, 66), z: clamp(me.pos.z + (dz / len) * 22, -66, 66) };
  }

  pickLootGoal() {
    const me = this.self;
    let best = null, bestScore = 0;
    for (const l of this.room.loot) {
      if (!l.active) continue;
      let want = 0;
      if (WEAPONS[l.type]) want = me.guns[l.type] ? 0.25 : 1.4;
      else if (l.type === 'ammo') {
        const g = me.guns[me.slot];
        want = g && g.reserve < WEAPONS[me.slot].magSize * 2 ? 1.1 : 0.2;
      } else if (l.type === 'whiskey') want = me.health < me.maxHealth * 0.72 ? 1.3 : 0;
      else if (l.type === 'dynamite') want = me.dynamite < 2 ? 0.7 : 0;
      if (want <= 0) continue;
      const d = Math.hypot(l.x - me.pos.x, l.z - me.pos.z);
      if (d > 55) continue;
      const score = want * clamp(1.4 - d / 45, 0.15, 1.4);
      if (score > bestScore) { bestScore = score; best = l; }
    }
    if (!best) return null;
    this.lootTarget = best.id;
    return { x: best.x, z: best.z };
  }

  tryLoot(t) {
    const me = this.self;
    for (const l of this.room.loot) {
      if (!l.active) continue;
      const d = Math.hypot(l.x - me.pos.x, l.z - me.pos.z);
      if (d < 2.0 && Math.abs(l.y - me.pos.y) < 3) this.room.onPickup(me, { id: l.id });
    }
  }

  setGoal(goal) {
    if (!goal) return;
    this.goal = goal;
    this.path = findPath(this.self.pos, goal);
    this.stuckSince = 0;
  }

  reached(goal, r = 2) {
    const me = this.self;
    return Math.hypot(goal.x - me.pos.x, goal.z - me.pos.z) < r;
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------
  move(t, dt, visibleTarget) {
    const me = this.self;
    let desired = null;
    let sprint = false;

    if (this.state === 'engage' && visibleTarget) {
      const d = Math.hypot(visibleTarget.pos.x - me.pos.x, visibleTarget.pos.z - me.pos.z);
      const w = WEAPONS[me.slot];
      const ideal = w.id === 'shotgun' ? 7 : w.id === 'rifle' ? 26 : 14;
      const toX = (visibleTarget.pos.x - me.pos.x) / (d || 1);
      const toZ = (visibleTarget.pos.z - me.pos.z) / (d || 1);
      // Close, back off, or strafe - always keep moving in a fight.
      const push = d > ideal * 1.25 ? 1 : d < ideal * 0.6 ? -1 : 0;
      const strafeDir = Math.sin(t * 0.9 + me.id) > 0 ? 1 : -1;
      desired = {
        x: toX * push + -toZ * strafeDir * 0.85,
        z: toZ * push + toX * strafeDir * 0.85,
      };
    } else if (this.state === 'engage' && !visibleTarget && this.target != null && this.lastSeen.has(this.target)) {
      // Lost sight mid-fight: push toward where they were rather than standing
      // in the open like a fencepost.
      const ls = this.lastSeen.get(this.target);
      desired = { x: ls.x - me.pos.x, z: ls.z - me.pos.z };
    } else if (this.path.length) {
      const node = this.path[0];
      if (Math.hypot(node.x - me.pos.x, node.z - me.pos.z) < 2.0) {
        this.path.shift();
      } else {
        desired = { x: node.x - me.pos.x, z: node.z - me.pos.z };
      }
    } else if (this.goal && !this.reached(this.goal, 1.6)) {
      desired = { x: this.goal.x - me.pos.x, z: this.goal.z - me.pos.z };
      sprint = true;
    }

    if (this.state === 'hunt' || this.state === 'ring' || this.state === 'flee' || this.state === 'escort') sprint = true;

    // Same sprint budget as a player. Without this a bot outruns anybody it is
    // chasing for the whole round, which is both unfair and unreadable.
    sprint = sprint && canSprint(me.stamina, me.sprint);
    me.stamina = stepStamina(me.stamina, sprint && !!desired, dt);

    let vx = 0, vz = 0;
    if (desired) {
      const len = Math.hypot(desired.x, desired.z) || 1;
      const speed = sprint ? PLAYER.sprintSpeed * 0.92 : PLAYER.walkSpeed;
      vx = (desired.x / len) * speed;
      vz = (desired.z / len) * speed;
      me.moving = true;
    } else {
      me.moving = false;
    }

    me.vel.y -= PLAYER.gravity * dt;
    const res = moveAndCollide(
      me.pos, { x: vx * dt, y: me.vel.y * dt, z: vz * dt },
      PLAYER.radius, PLAYER.height, MAP.solids, PLAYER.stepHeight,
    );
    me.pos.x = res.x; me.pos.y = res.y; me.pos.z = res.z;
    if (res.grounded) me.vel.y = 0;
    me.sprint = sprint && me.moving;
    me.crouch = false;

    // Stuck detection: shove a new destination in rather than grinding a wall.
    const moved = Math.hypot(me.pos.x - this.lastPos.x, me.pos.z - this.lastPos.z);
    if (me.moving && moved < 0.06) {
      this.stuckSince += dt;
      if (this.stuckSince > 0.9) {
        this.path = [];
        this.setGoal(this.wanderGoal());
        me.vel.y = PLAYER.jumpSpeed * 0.8;
        this.stuckSince = 0;
      }
    } else {
      this.stuckSince = 0;
    }
    this.lastPos.x = me.pos.x; this.lastPos.z = me.pos.z;
  }

  // -------------------------------------------------------------------------
  // Aim + fire
  // -------------------------------------------------------------------------
  aim(t, dt, target, steady = false) {
    const me = this.self;
    let wantYaw = me.yaw, wantPitch = me.pitch;

    if (target && steady) {
      // Levelling a gun and holding it is a deliberate act, not a snapshot. If
      // the crosshair wobbled off him the draw would keep restarting and the
      // shot would never come - and in this mode the wobble is not where the
      // uncertainty lives anyway. It lives in what he does about it.
      const eye = eyeOf(me);
      const c = chestOf(target);
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz) || 0.001);
      const turn = 4.4 * (0.5 + this.skill) * dt;
      me.yaw = angleTowards(me.yaw, wantYaw, turn);
      me.pitch = clamp(me.pitch + clamp(wantPitch - me.pitch, -turn, turn), -1.3, 1.3);
      return;
    }

    if (target) {
      const eye = eyeOf(me);
      const c = chestOf(target);
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const flat = Math.hypot(dx, dz) || 0.001;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, flat);

      if (t >= this.nextAimJitter) {
        // Error scales with distance, their movement, this bot's skill and how
        // long it has been tracking them. Freshly acquired targets are missed a
        // lot, which is what stops a bot clearing a room in three seconds.
        this.nextAimJitter = t + rnd(0.12, 0.32);
        const dist = Math.hypot(dx, dy, dz);
        const settle = clamp((t - (this.acquiredAt || t)) / 1.6, 0, 1);
        const base = (1 - this.skill) * 0.10 + 0.022;
        const moveErr = target.moving ? 0.05 * (1 - this.skill * 0.7) : 0;
        const spread = (base + moveErr + dist * 0.0016) * (1.9 - settle * 0.9);
        this.aimError.x = rnd(-spread, spread);
        this.aimError.y = rnd(-spread, spread) * 0.75;
      }
      wantYaw += this.aimError.x;
      wantPitch += this.aimError.y;
    } else if (this.state !== 'engage') {
      const dir = this.path.length ? this.path[0] : this.goal;
      if (dir) wantYaw = Math.atan2(-(dir.x - me.pos.x), -(dir.z - me.pos.z));
      wantPitch = 0;
    }

    // Turn speed is bounded: bots cannot snap 180 degrees onto a flanker.
    const turn = (target ? 5.2 : 2.6) * (0.5 + this.skill) * dt;
    me.yaw = angleTowards(me.yaw, wantYaw, turn);
    me.pitch = clamp(me.pitch + clamp(wantPitch - me.pitch, -turn, turn), -1.3, 1.3);
  }

  fight(t, target) {
    const me = this.self;
    if (!target) return;
    if (t < this.reactionUntil) return;
    // Running away and shooting back is a movie thing; these bots commit.
    if (this.state === 'flee' && Math.random() < 0.7) return;

    const g = me.guns[me.slot];
    if (!g) return;
    if (g.mag === 0) { this.room.startReload(me); return; }
    // Swap to something appropriate for the range if we are carrying it.
    const d = Math.hypot(target.pos.x - me.pos.x, target.pos.z - me.pos.z);
    const want = d < 9 && me.guns.shotgun ? 'shotgun' : d > 30 && me.guns.rifle ? 'rifle' : null;
    if (want && me.slot !== want && Math.random() < 0.02) this.room.onSwap(me, { slot: want });

    const w = WEAPONS[me.slot];
    if (d > w.range * 0.85) return;

    // Only shoot when actually pointed at them - the aim error above is the
    // whole point, so we must not bypass it by firing regardless.
    const eye = eyeOf(me);
    const c = chestOf(target);
    const to = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
    const len = Math.hypot(to.x, to.y, to.z) || 1;
    to.x /= len; to.y /= len; to.z /= len;
    const fwd = this.forward();
    const dot = to.x * fwd.x + to.y * fwd.y + to.z * fwd.z;
    const tolerance = Math.cos(clamp(0.05 + (1 - this.skill) * 0.05, 0.02, 0.16));
    if (dot < tolerance) return;

    // Dynamite when they are dug in and we are not.
    if (me.dynamite > 0 && d > 9 && d < 24 && Math.random() < 0.006 * this.aggression) {
      this.room.onThrow(me, { dir: { x: fwd.x, y: fwd.y + 0.14, z: fwd.z } });
      return;
    }

    // Burst discipline: fire a few, then break to reassess. Without this a bot
    // holds the trigger down forever and every fight is decided in one second.
    if (t < (this.burstRestUntil || 0)) return;
    const before = me.guns[me.slot].mag;
    this.room.onShoot(me, { dir: fwd, ads: me.slot === 'rifle' && d > 22 });
    if (me.guns[me.slot].mag < before) {
      this.burst = (this.burst || 0) + 1;
      this.nextAimJitter = 0;                       // re-roll the error every shot
      const maxBurst = me.slot === 'revolver' ? 2 + ((Math.random() * 3) | 0) : 1 + ((Math.random() * 2) | 0);
      if (this.burst >= maxBurst) {
        this.burst = 0;
        this.burstRestUntil = t + rnd(0.45, 1.5) * (1.4 - this.skill);
      }
    }
  }

  useAbility(t, target) {
    const me = this.self;
    if (t < me.abilityReadyAt) return;
    const c = CHARACTERS[me.character];
    let want = false;
    switch (c.id) {
      case 'gunslinger':
      case 'duelist':
        want = !!target && Math.random() < 0.25;
        break;
      case 'medic': {
        if (me.health < me.maxHealth * 0.55 && !target) { want = true; break; }
        // Healing someone is a costly, public statement of trust. Bots make it.
        // Whoever this bot watched take one, recently enough to still be
        // hurt. Reading o.health here would be the same cheat as picking off
        // the wounded on a number nobody is sent - and it is the wrong
        // instinct anyway: a medic goes to the man he SAW get shot.
        const now = Date.now() / 1000;
        const friend = this.visible.find((o) => (o.lastHitAt || 0) > now - 12
          && this.canSee(o) && this.susOf(o.id) < 0.3);
        if (friend) {
          const aimed = this.room.playerInCrosshair(me, c.healRange);
          want = aimed === friend;
          if (!want && Math.random() < 0.2) this.setGoal({ x: friend.pos.x, z: friend.pos.z });
        }
        break;
      }
      case 'scout':
        want = !target && (this.state === 'hunt' || this.state === 'investigate') && Math.random() < 0.12;
        break;
      case 'gambler':
        want = (!!target && Math.random() < 0.2) || Math.random() < 0.01;
        break;
      case 'tracker':
        want = !target && Math.random() < 0.04;
        break;
    }
    if (want) this.room.onAbility(me);
  }

  /**
   * Bots hold two cards like everyone else, and play them for reasons a human
   * could read off their behaviour afterwards: the one who vanished from the
   * dust had swept it, the one who swore they hit you was shooting at a barrel.
   * They go through Room.onCard, so every rule is enforced in exactly one place.
   */
  playCards(t, target) {
    const me = this.self;
    if (!me.hand || !me.hand.length) return;
    if (t < this.nextCardAt) return;
    this.nextCardAt = t + rnd(2.5, 6);
    const has = (id) => me.hand.includes(id);
    const play = (id) => { this.room.onCard(me, { card: id }); return true; };

    if (has('barrel') && me.health < me.maxHealth * 0.5) return play('barrel');
    if (has('witness') && target && this.wantsDead(target) > 0.9 && this.canSee(target)) return play('witness');
    if (has('tracks') && (this.state === 'flee' || me.kills > 0) && Math.random() < 0.3) return play('tracks');
    if (has('spyglass') && (this.state === 'investigate' || this.state === 'hunt') && Math.random() < 0.25) return play('spyglass');
    if (has('ledger') && this.room.phase === PHASE.COMBAT && Math.random() < 0.08) return play('ledger');
    if (has('poster')) {
      // Nailing up a poster is a thing you do to somebody's face, so it needs
      // them in the crosshair - which for a bot means someone they are already
      // squaring up to and already do not trust.
      const aimed = this.room.playerInCrosshair(me, CARDS.poster.range);
      if (aimed && aimed.alive && this.susOf(aimed.id) > 0.45) return play('poster');
    }
    // Nobody should ride into the storm holding a card they never used.
    if (this.room.phase === PHASE.ENDGAME && Math.random() < 0.2) return play(pick(me.hand));
    return false;
  }

  social(t, dt) {
    const me = this.self;
    this.nextChatAt -= dt;
    if (this.nextChatAt > 0) return;
    this.nextChatAt = rnd(30, 95) / clamp(this.chattiness, 0.25, 1);

    const ranked = [...this.suspicion.entries()]
      .filter(([id]) => this.room.players.get(id)?.alive)
      .sort((a, b) => this.susOf(b[0]) - this.susOf(a[0]));
    const top = ranked[0];

    if (top && this.susOf(top[0]) > 0.6 && Math.random() < 0.6) {
      const target = this.room.players.get(top[0]);
      this.room.onAccuse(me, { target: target.id });
      if (Math.random() < 0.6) this.say(pick(CHATTER.accuse), { name: target.name });
      return;
    }
    if (me.faction === 'law' && me.role !== 'sheriff' && Math.random() < 0.25) {
      this.say(pick(CHATTER.lawful), {});
      return;
    }
    const friend = this.visible.find((o) => this.susOf(o.id) < 0.25);
    if (friend && Math.random() < 0.5) {
      this.say(pick(CHATTER.friendly), { name: friend.name });
      this.allies.add(friend.id);
      return;
    }
    const someone = pick([...this.room.players.values()].filter((p) => p.alive && p.id !== me.id));
    if (someone) this.say(pick(CHATTER.suspicious), { name: someone.name, place: zoneAt(me.pos.x, me.pos.z) });
  }
}

function angleTowards(cur, want, maxStep) {
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return cur + clamp(diff, -maxStep, maxStep);
}
