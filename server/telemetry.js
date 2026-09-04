// Playtest telemetry.
//
// The point of phase one is answering one question with evidence rather than
// impressions: *is this a deduction game, or a western deathmatch?* The metric
// that answers it is the share of kills anybody witnessed, next to how often
// people accuse, talk, and reveal the star.
//
// Off with HNH_TELEMETRY=0. Names are never written unless you ask for them
// with HNH_TELEMETRY_NAMES=1 - a playtest log should not become a list of who
// played what and when.

import fs from 'node:fs';
import path from 'node:path';

const ENABLED = process.env.HNH_TELEMETRY !== '0';
const WITH_NAMES = process.env.HNH_TELEMETRY_NAMES === '1';
const DIR = process.env.HNH_TELEMETRY_DIR || 'data';
const FILE = path.join(DIR, 'telemetry.jsonl');
const FLUSH_MS = 5000;
// Dead this soon into a round and you were shot before there was anything to
// work out. Against bots the free-for-all does this to a quarter of the table.
const EARLY_DEATH = 45;

const now = () => Date.now() / 1000;

class Telemetry {
  constructor() {
    this.enabled = ENABLED;
    this.buffer = [];
    this.startedAt = now();
    this.agg = {
      matches: 0,
      matchSeconds: 0,
      kills: 0,
      witnessedKills: 0,
      firstKillSeconds: 0,
      matchesWithAKill: 0,
      accusations: 0,
      chats: 0,
      abilities: 0,
      badgeReveals: 0,
      gambles: 0,
      cardsDealt: 0,
      cardsPlayed: 0,
      // The turn mode is the default one, and until these existed /stats knew
      // nothing about it: cardsPerMatch and cardPlayRate are free-mode numbers
      // and read as zero for every round actually being played. A go that ends
      // without a shot is the one that tells you the mode is stalling.
      duelMatches: 0,
      goes: 0,
      goesWithShot: 0,
      goesWithCard: 0,
      byGunhand: {},
      gunhandWins: {},
      byCard: {},
      wins: { law: 0, outlaw: 0, renegade: 0, none: 0 },
      deathsByZone: {},
      deathsByWeapon: {},
      humanSessions: 0,
      humanSessionSeconds: 0,
      // When people go out, and how long they then sit there watching.
      humanDeaths: 0,
      humanDeathSeconds: 0,
      earlyHumanDeaths: 0,
      spectatorSeconds: 0,
      spectatorCount: 0,
    };
    if (this.enabled) {
      try {
        fs.mkdirSync(DIR, { recursive: true });
      } catch (err) {
        console.warn('[telemetry] cannot create', DIR, '- disabling', err.message);
        this.enabled = false;
      }
    }
    if (this.enabled) {
      this.timer = setInterval(() => this.flush(), FLUSH_MS);
      this.timer.unref?.();
    }
  }

  event(type, data = {}) {
    if (!this.enabled) return;
    this.buffer.push(JSON.stringify({ t: Math.round(Date.now() / 1000), type, ...data }));
    if (this.buffer.length > 200) this.flush();
  }

  flush() {
    // Switched off means switched off. This read the buffer without asking,
    // so anything already queued when telemetry was turned off still reached
    // the disk - either on the next flush call or on the interval, which keeps
    // running because disabling does not stop it. That is the one thing the
    // switch is for, and it also made "turning it off writes nothing at all"
    // a test that passed on timing rather than on behaviour.
    if (!this.enabled) { this.buffer.length = 0; return; }
    if (!this.buffer.length) return;
    const chunk = this.buffer.join('\n') + '\n';
    this.buffer.length = 0;
    fs.appendFile(FILE, chunk, (err) => {
      if (err) console.warn('[telemetry] write failed', err.message);
    });
  }

  name(player) {
    return WITH_NAMES ? player.name : undefined;
  }

  // ------------------------------------------------------------- recorders
  matchStart(room) {
    const players = [...room.players.values()];
    this.event('match_start', {
      room: room.code,
      players: players.length,
      humans: players.filter((p) => !p.bot).length,
      roles: players.reduce((a, p) => { a[p.role] = (a[p.role] || 0) + 1; return a; }, {}),
      characters: players.reduce((a, p) => { a[p.character] = (a[p.character] || 0) + 1; return a; }, {}),
    });
    room.stats = { started: now(), kills: 0, firstKill: null, accusations: 0, chats: 0, abilities: 0 };
  }

  death(room, victim, killer, cause, witnessCount, place) {
    const s = room.stats;
    const at = s ? now() - s.started : 0;
    if (s) {
      s.kills += 1;
      if (s.firstKill === null) s.firstKill = at;
    }
    // killer + victim are always "witnesses"; anyone beyond that actually saw it.
    const witnessed = witnessCount > 2;
    this.agg.kills += 1;
    if (witnessed) this.agg.witnessedKills += 1;
    this.agg.deathsByZone[place] = (this.agg.deathsByZone[place] || 0) + 1;
    this.agg.deathsByWeapon[cause] = (this.agg.deathsByWeapon[cause] || 0) + 1;
    // When people go out, and how long they then sit there.
    //
    // This is the number the whole question of whether the game is any FUN
    // turns on, and it was the one thing the readout never collected. Measured
    // against bots the free-for-all puts a quarter of the table out inside
    // thirty seconds of a four-minute round, and those people then spectate for
    // four minutes having learned nothing and done nothing about it. Bots do
    // not mind. The point of collecting it is that people do, and nobody can
    // argue about it from a transcript afterwards.
    //
    // Only humans are counted. A round is eight seats and most of them are
    // filled by bots in a playtest, and the question is about the person.
    if (!victim.bot) {
      this.agg.humanDeaths += 1;
      this.agg.humanDeathSeconds += at;
      if (at < EARLY_DEATH) this.agg.earlyHumanDeaths += 1;
      // Banked at the end of the round, when the length of it is known.
      if (s) (s.humanDeathsAt || (s.humanDeathsAt = [])).push(at);
    }
    this.event('death', {
      room: room.code,
      at: Math.round(at),
      victimRole: victim.role,
      victimBot: victim.bot,
      victimName: this.name(victim),
      killerRole: killer ? killer.role : null,
      killerBot: killer ? killer.bot : null,
      sameFaction: killer ? killer.faction === victim.faction : null,
      cause,
      place,
      witnessed,
      witnesses: Math.max(0, witnessCount - 2),
    });
  }

  matchEnd(room, winner, blurb) {
    const s = room.stats || {};
    const duration = s.started ? now() - s.started : 0;
    this.agg.matches += 1;
    this.agg.matchSeconds += duration;
    this.agg.wins[winner] = (this.agg.wins[winner] || 0) + 1;
    if (s.firstKill != null) {
      this.agg.matchesWithAKill += 1;
      this.agg.firstKillSeconds += s.firstKill;
    }
    // The wait: how long each person who went out then spent watching. This is
    // knowable only now, because it is the rest of the round.
    for (const at of s.humanDeathsAt || []) {
      this.agg.spectatorSeconds += Math.max(0, duration - at);
      this.agg.spectatorCount += 1;
    }
    this.event('match_end', {
      room: room.code,
      winner,
      seconds: Math.round(duration),
      kills: s.kills || 0,
      firstKill: s.firstKill == null ? null : Math.round(s.firstKill),
      accusations: s.accusations || 0,
      chats: s.chats || 0,
      abilities: s.abilities || 0,
      survivors: [...room.players.values()].filter((p) => p.alive).length,
      humans: [...room.players.values()].filter((p) => !p.bot).length,
    });
  }

  /**
   * Which cards get played and which rot in hand. If a card is never played it
   * is either too weak or too hard to find a moment for, and this is the only
   * way to tell those apart from the outside.
   */
  card(room, player, id) {
    this.agg.cardsPlayed += 1;
    this.agg.byCard[id] = (this.agg.byCard[id] || 0) + 1;
    if (room.stats) room.stats.cards = (room.stats.cards || 0) + 1;
    this.event('card', {
      room: room.code, card: id, phase: room.phase,
      bot: !!player.bot, name: this.name(player),
    });
  }

  cardsDealt(n) { this.agg.cardsDealt += n; }

  // ------------------------------------------------------------- turn mode
  /**
   * A round of the turn mode was dealt. Only the gunhands are counted here:
   * they are a record of what went out, and a hand that was dealt went out
   * whether or not the round ever finished.
   *
   * The round itself is counted at the end, in duelEnd - because `matches` is,
   * and goesPerDuel would otherwise divide goes taken in finished rounds by a
   * count that includes the one still being played.
   */
  duelStart(room, players) {
    for (const p of players) {
      if (!p.gunhand) continue;
      this.agg.byGunhand[p.gunhand] = (this.agg.byGunhand[p.gunhand] || 0) + 1;
    }
  }

  /**
   * One player's go is over. `shot` is whether a live round left their gun and
   * `card` whether they played anything at all - a go with neither is a man
   * who could not do a thing with his turn, which is the failure mode of the
   * whole design and the reason this is counted.
   */
  goEnd(room, player, shot, card) {
    this.agg.goes += 1;
    if (shot) this.agg.goesWithShot += 1;
    if (card) this.agg.goesWithCard += 1;
  }

  /** Who was still standing at the end, so a gunhand's record can be read. */
  duelEnd(room, survivors) {
    this.agg.duelMatches += 1;
    for (const p of survivors) {
      if (!p.gunhand) continue;
      this.agg.gunhandWins[p.gunhand] = (this.agg.gunhandWins[p.gunhand] || 0) + 1;
    }
  }

  social(room, kind) {
    const s = room.stats;
    if (kind === 'accuse') { this.agg.accusations += 1; if (s) s.accusations += 1; }
    if (kind === 'chat') { this.agg.chats += 1; if (s) s.chats += 1; }
    if (kind === 'ability') { this.agg.abilities += 1; if (s) s.abilities += 1; }
    if (kind === 'badge') this.agg.badgeReveals += 1;
    // The free-for-all's one expensive sentence, so it can be seen whether
    // anybody actually says it.
    if (kind === 'roulette') this.agg.gambles += 1;
  }

  sessionEnd(player, seconds) {
    if (player.bot) return;
    this.agg.humanSessions += 1;
    this.agg.humanSessionSeconds += seconds;
    this.event('session_end', { seconds: Math.round(seconds), name: this.name(player) });
  }

  // ---------------------------------------------------------------- readout
  summary() {
    const a = this.agg;
    const per = (n, d) => (d ? +(n / d).toFixed(2) : 0);
    const top = (obj, n = 5) => Object.entries(obj).sort((x, y) => y[1] - x[1]).slice(0, n)
      .reduce((o, [k, v]) => { o[k] = v; return o; }, {});
    return {
      enabled: this.enabled,
      uptimeMinutes: Math.round((now() - this.startedAt) / 60),
      matches: a.matches,
      avgMatchSeconds: Math.round(per(a.matchSeconds, a.matches)),
      avgKillsPerMatch: per(a.kills, a.matches),
      avgFirstKillSeconds: Math.round(per(a.firstKillSeconds, a.matchesWithAKill)),
      // The headline number: if almost every kill is witnessed the map has no
      // secrets; if almost none are, nobody can ever learn anything.
      witnessedKillShare: per(a.witnessedKills, a.kills),
      accusationsPerMatch: per(a.accusations, a.matches),
      chatsPerMatch: per(a.chats, a.matches),
      abilitiesPerMatch: per(a.abilities, a.matches),
      badgeRevealRate: per(a.badgeReveals, a.matches),
      gamblesPerMatch: per(a.gambles, a.matches),
      cardsPerMatch: per(a.cardsPlayed, a.matches),
      // Below about half and the deck is decoration; at 1.0 nobody is ever
      // holding anything back, which is its own problem.
      cardPlayRate: per(a.cardsPlayed, a.cardsDealt),
      // Whether the game is any fun to be eliminated from, which is a different
      // question from whether it is balanced and a more important one. If a
      // large share of people are out before there was anything to deduce, and
      // then sit and watch for minutes, the round is over for them long before
      // it is over. These count humans only - a table is mostly bots in a
      // playtest and bots do not mind waiting.
      humanDeaths: a.humanDeaths,
      avgDeathSeconds: Math.round(per(a.humanDeathSeconds, a.humanDeaths)),
      earlyDeathShare: per(a.earlyHumanDeaths, a.humanDeaths),
      avgSpectatorSeconds: Math.round(per(a.spectatorSeconds, a.spectatorCount)),
      cardsPlayed: top(a.byCard, 6),
      // The turn mode's own readout. Below about half a go ending in a shot
      // and the table has gone quiet; a go with no card played at all is a
      // player who was handed six seconds and nothing to do with them.
      duelMatches: a.duelMatches,
      goesPerDuel: per(a.goes, a.duelMatches),
      shotPerGo: per(a.goesWithShot, a.goes),
      cardPerGo: per(a.goesWithCard, a.goes),
      gunhandsDealt: top(a.byGunhand, 6),
      gunhandsStanding: top(a.gunhandWins, 6),
      wins: a.wins,
      avgHumanSessionMinutes: per(a.humanSessionSeconds / 60, a.humanSessions),
      humanSessions: a.humanSessions,
      deadliestPlaces: top(a.deathsByZone),
      deadliestWeapons: top(a.deathsByWeapon),
    };
  }
}

export const telemetry = new Telemetry();
