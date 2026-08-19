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
      wins: { law: 0, outlaw: 0, renegade: 0, none: 0 },
      deathsByZone: {},
      deathsByWeapon: {},
      humanSessions: 0,
      humanSessionSeconds: 0,
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

  social(room, kind) {
    const s = room.stats;
    if (kind === 'accuse') { this.agg.accusations += 1; if (s) s.accusations += 1; }
    if (kind === 'chat') { this.agg.chats += 1; if (s) s.chats += 1; }
    if (kind === 'ability') { this.agg.abilities += 1; if (s) s.abilities += 1; }
    if (kind === 'badge') this.agg.badgeReveals += 1;
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
      wins: a.wins,
      avgHumanSessionMinutes: per(a.humanSessionSeconds / 60, a.humanSessions),
      humanSessions: a.humanSessions,
      deadliestPlaces: top(a.deathsByZone),
      deadliestWeapons: top(a.deathsByWeapon),
    };
  }
}

export const telemetry = new Telemetry();
