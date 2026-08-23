// Bot-only balance harness.
//
//   node tools/balance.mjs [rounds]
//   HNH_HOSTILITY=1.5 node tools/balance.mjs 60
//
// Runs whole rounds headless against a fake clock - a 13 minute match takes
// milliseconds - and prints the handful of numbers worth arguing about.
//
// Two warnings, both learned the hard way:
//
//   1. Round length is BIMODAL. A round either resolves in a couple of minutes
//      or nobody finds anybody and the storm decides it. A median flips between
//      those two clusters depending on which side of half the sample lands, so
//      it is reported here as "share resolved by a kill" instead.
//   2. Anything under about fifty rounds is noise. Twenty rounds has produced
//      outlaw win shares anywhere from 45% to 75% at identical settings.
//
// And the standing caveat: this is bots playing bots. They find each other
// faster than people do and they never lie to each other.

import { fakeClock } from '../test/helpers.js';
import { PHASE, TIMING, MODES } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

const ROUNDS = Number(process.argv[2] || 40);
const TABLE = Number(process.env.HNH_TABLE || 7);
const RUNOUT = (TIMING.prep + TIMING.combat + TIMING.endgame) - 5;

const stat = {
  wins: {}, durations: [], deaths: 0, shot: 0, storm: 0, left: 0, friendly: 0,
  accusations: 0, badges: 0, cards: 0,
  sheriffDeaths: 0, sheriffByOutlaw: 0, sheriffTargeted: 0, sheriffAt: [],
};

// Wrap killPlayer rather than reading the timeline, so we see the killer's own
// state at the moment they pulled the trigger.
const realKill = Room.prototype.killPlayer;
Room.prototype.killPlayer = function instrumentedKill(victim, killer, cause, point) {
  const before = this.timeline.length;
  realKill.call(this, victim, killer, cause, point);
  if (this.timeline.length === before) return;

  stat.deaths += 1;
  if (cause === 'storm') stat.storm += 1;
  else if (cause === 'left') stat.left += 1;
  else stat.shot += 1;

  if (killer && killer !== victim && killer.faction === victim.faction && victim.faction !== 'renegade') {
    stat.friendly += 1;
  }
  if (victim.role === 'sheriff') {
    stat.sheriffDeaths += 1;
    stat.sheriffAt.push(Math.round(Date.now() / 1000 - (this.stats?.started || Date.now() / 1000)));
    if (killer?.role === 'outlaw') stat.sheriffByOutlaw += 1;
    // Did the killer actually have this person picked out, by any of the routes
    // a bot has to pick somebody out? Everything else is crossfire.
    const b = killer?.brain;
    const picked = b && (
      b.sheriffGuess === victim.id
      || b.primeSuspect === victim.id
      || (b.sheriffness?.get(victim.id) ?? 0) > 0.5
      || b.susOf(victim.id) > 0.75
    );
    if (picked) stat.sheriffTargeted += 1;
  }
};

for (let run = 0; run < ROUNDS; run++) {
  const clock = fakeClock();
  const room = new Room({ code: `BAL${run}`, isPublic: false, mode: MODES.FREE });
  room.botFillTarget = TABLE;
  room.resetClock();
  room.beginMatch();

  let ticks = 0;
  const cap = 20 * 60 * 20;
  while (room.phase !== PHASE.RESULTS && ticks < cap) { clock.advance(50); room.step(); ticks += 1; }

  for (const e of room.timeline) {
    if (e.type === 'accuse') stat.accusations += 1;
    if (e.type === 'badge') stat.badges += 1;
    if (e.type === 'card') stat.cards += 1;
  }
  const winner = room.results?.winner || 'none';
  stat.wins[winner] = (stat.wins[winner] || 0) + 1;
  stat.durations.push(Math.round(ticks / 20));
  clock.restore();
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '-');
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const resolved = stat.durations.filter((d) => d < RUNOUT);

console.log(`\n  ${ROUNDS} rounds, ${TABLE} at the table\n`);
console.log('  wins           ', Object.entries(stat.wins)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v} (${pct(v, ROUNDS)})`).join('   '));
console.log('  resolved       ', `${resolved.length}/${ROUNDS} by a kill, averaging ${avg(resolved)}s`,
  `· ${ROUNDS - resolved.length} ran out on the storm`);
console.log('  deaths         ', `${stat.deaths} = ${stat.shot} shot, ${stat.storm} storm, ${stat.left} walked out`);
console.log('  friendly fire  ', `${stat.friendly} (${pct(stat.friendly, stat.shot)} of shootings)`);
console.log('  the Sheriff    ', `died in ${stat.sheriffDeaths}/${ROUNDS} rounds`,
  `· ${stat.sheriffByOutlaw} to an outlaw`,
  `· ${pct(stat.sheriffTargeted, stat.sheriffDeaths)} of those killers had picked them out`);
console.log('  per round      ', `${(stat.accusations / ROUNDS).toFixed(1)} accusations`,
  `· ${(stat.badges / ROUNDS).toFixed(2)} stars pinned on`,
  `· ${(stat.cards / ROUNDS).toFixed(1)} cards played`);
console.log('');
