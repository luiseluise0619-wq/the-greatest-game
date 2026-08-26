// Bot-only balance harness.
//
//   node tools/balance.mjs [rounds]
//   HNH_MODE=duel node tools/balance.mjs 60
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
import { PHASE, TIMING, MODES, WEAPONS, DUEL } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

const ROUNDS = Number(process.argv[2] || 40);
const TABLE = Number(process.env.HNH_TABLE || 7);
const RUNOUT = (TIMING.prep + TIMING.combat + TIMING.endgame) - 5;

const MODE = process.env.HNH_MODE === 'duel' ? MODES.DUEL : MODES.FREE;

// The two numbers the turn mode actually turns on, overridable so they can be
// swept rather than argued about. The walk is the interesting one: it is how
// much the ground you chose last lap constrains the ground you can choose now.
for (const key of ['reposition', 'turn', 'health', 'sheriffHealth', 'liveShare', 'drawTime']) {
  const env = process.env[`HNH_${key.toUpperCase()}`];
  if (env && Number.isFinite(Number(env))) DUEL[key] = Number(env);
}

const stat = {
  wins: {}, durations: [], deaths: 0, shot: 0, storm: 0, left: 0, friendly: 0,
  accusations: 0, badges: 0, cards: 0, gambles: 0, gamblesLost: 0,
  sheriffDeaths: 0, sheriffByOutlaw: 0, sheriffTargeted: 0, sheriffAt: [],
  // The turn mode's own numbers. A round of it is a number of goes rather than
  // a number of minutes, and the thing worth arguing about is how many of those
  // goes ended in somebody pulling a trigger.
  turns: 0, shotsTaken: 0, shotsLanded: 0, blanks: 0, outOfRange: 0,
  barrels: 0, braced: 0, duelCards: 0, selfShots: 0, idleTurns: 0,
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

// The turn mode's counters hang off the two places every shot in it goes
// through, so they cost nothing when it is not the mode being run.
const realSpend = Room.prototype.spendBang;
Room.prototype.spendBang = function countedSpend(p) {
  const ok = realSpend.call(this, p);
  if (ok) stat.shotsTaken += 1;
  return ok;
};
const realLands = Room.prototype.duelShotLands;
Room.prototype.duelShotLands = function countedLands(victim, attacker, cause) {
  const before = { live: attacker.roundIsLive, hand: (victim.duelHand || []).length };
  const landed = realLands.call(this, victim, attacker, cause);
  if (cause !== 'shot' && !WEAPONS[cause]) return landed;
  if (landed) stat.shotsLanded += 1;
  else if (before.live === false) stat.blanks += 1;
  else if ((victim.duelHand || []).length < before.hand) stat.braced += 1;
  else stat.outOfRange += 1;
  return landed;
};
const realCard = Room.prototype.onDuelCard;
Room.prototype.onDuelCard = function countedCard(p, msg) {
  const before = (p.duelHand || []).length;
  const out = realCard.call(this, p, msg);
  if ((p.duelHand || []).length !== before) stat.duelCards += 1;
  return out;
};
// A self shot spends a card the same way a shot at somebody does, so it is
// taken back off the count of shots at other people or the landed share reads
// like a collapse in accuracy.
const realSelf = Room.prototype.onSelfShot;
Room.prototype.onSelfShot = function countedSelf(p) {
  stat.selfShots += 1;
  const before = stat.shotsTaken;
  const out = realSelf.call(this, p);
  if (stat.shotsTaken > before) stat.shotsTaken -= 1;
  return out;
};

for (let run = 0; run < ROUNDS; run++) {
  const clock = fakeClock();
  const room = new Room({ code: `BAL${run}`, isPublic: false, mode: MODE });
  room.botFillTarget = TABLE;
  room.resetClock();
  room.beginMatch();

  let ticks = 0;
  let holder = null;
  let firedThisTurn = 0;
  const cap = 20 * 60 * 20;
  while (room.phase !== PHASE.RESULTS && ticks < cap) {
    clock.advance(50); room.step(); ticks += 1;
    if (room.duel && room.turnHolder !== holder) {
      if (holder !== null && stat.shotsTaken === firedThisTurn) stat.idleTurns += 1;
      if (room.turnHolder) { stat.turns += 1; firedThisTurn = stat.shotsTaken; }
      holder = room.turnHolder;
    }
  }

  for (const e of room.timeline) {
    if (e.type === 'accuse') stat.accusations += 1;
    if (e.type === 'badge') stat.badges += 1;
    if (e.type === 'roulette') { stat.gambles += 1; if (e.live) stat.gamblesLost += 1; }
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

console.log(`\n  ${ROUNDS} rounds of the ${MODE === MODES.DUEL ? 'turn mode' : 'free-for-all'},`
  + ` ${TABLE} at the table\n`);
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
// The six-card deck is the free-for-all's. In the turn mode it is never dealt,
// so printing "0.0 cards played" beside the line that says fifty-five of them
// were is just a wrong number in a readout somebody is reading for numbers.
console.log('  per round      ', `${(stat.accusations / ROUNDS).toFixed(1)} accusations`,
  `· ${(stat.badges / ROUNDS).toFixed(2)} stars pinned on`,
  ...(MODE === MODES.DUEL ? [] : [`· ${(stat.cards / ROUNDS).toFixed(1)} cards played`]));
// The free-for-all's one expensive sentence. If nobody ever says it, it is not
// a mechanic, it is a key nobody presses.
if (MODE !== MODES.DUEL) {
  console.log('  the gamble     ',
    `${(stat.gambles / ROUNDS).toFixed(2)} a round`,
    `· ${stat.gamblesLost} of ${stat.gambles} came up loaded`);
}

if (MODE === MODES.DUEL) {
  // The one number the whole mode turns on: what share of the goes anybody
  // takes actually end in a shot. Too low and the round is six people watching
  // a clock; too high and the walk in between stops mattering.
  const fired = stat.turns - stat.idleTurns;
  console.log('');
  console.log('  goes           ', `${(stat.turns / ROUNDS).toFixed(1)} a round`,
    `· ${pct(fired, stat.turns)} of them ended in a shot`);
  console.log('  shots          ', `${stat.shotsTaken} taken, ${pct(stat.shotsLanded, stat.shotsTaken)} found somebody`);
  console.log('  and the rest   ', `${stat.blanks} blanks · ${stat.outOfRange} out of range`,
    `· ${stat.braced} answered by a card`);
  console.log('  the eighty     ', `${(stat.duelCards / ROUNDS).toFixed(1)} cards played a round`,
    `· ${(stat.selfShots / ROUNDS).toFixed(2)} men put it to their own head`);
}
console.log('');
