// The README is load-bearing in this project: it is where the design rules and
// their numbers are argued for, and people read it instead of the constants.
// It has already drifted four separate times - a sprint recovery rate, a
// character's passive, a bot's whole strategy, a lock on the trigger - so the
// numbers it quotes are pinned to the constants they came from.
//
// If this fails because the prose was reworded rather than because a number
// moved, re-anchor the needle. That is the cost of the guarantee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const {
  SOCIAL, PLAYER, VISION, CARDS, CARD_DEAL, ROLES, CHARACTERS, MIN_PLAYERS, MAX_PLAYERS,
} = await import('../shared/constants.js');

const README = await readFile(new URL('../README.md', import.meta.url), 'utf8');

/** Each entry: what it is, and the exact text the constant should produce. */
const CLAIMS = [
  ['the witness range', `within ${SOCIAL.witnessRange}m`],
  ['the reconnect grace', `within ${SOCIAL.reconnectGrace} seconds`],
  ['how far a shout carries', `reaches about ${SOCIAL.shoutRange}m`],
  ['how far boots carry', `about ${SOCIAL.stepRange.sprint}m, walking ${SOCIAL.stepRange.walk}m, and crouching drops it to ${SOCIAL.stepRange.crouch}m`],
  ['how far a bot can see', `inside ${VISION.botSight}m`],
  ['the badge health bonus', `+${SOCIAL.badgeHealthBonus} max`],
  ['how long Cover Your Tracks lasts', `leaves none for ${CARDS.tracks.duration}s`],
  ['how long the Long Glass lasts', `For ${CARDS.spyglass.duration}s`],
  ['how long a sprint is', `sprint (${PLAYER.staminaMax}s of it)`],
  ['the sprint drain and recovery', `comes\nback at ${PLAYER.staminaRegen}, and you need ${PLAYER.staminaResume}s`],
  ['the size of a hand', CARD_DEAL === 2 ? 'Two cards are dealt' : `${CARD_DEAL} cards are dealt`],
  ["the Lookout's reveal radius", `within ${CHARACTERS.scout.radius}m glows through walls`],
  ["the Tracker's window", `last ${CHARACTERS.tracker.trailWindow}s of *everyone's* footprints for ${CHARACTERS.tracker.duration}s`],
  ['the table size', `${MIN_PLAYERS} through ${MAX_PLAYERS}`],
];

test('the README quotes the numbers the game actually uses', () => {
  const missing = CLAIMS.filter(([, needle]) => !README.includes(needle));
  assert.deepEqual(
    missing.map(([what]) => what), [],
    `the README no longer says what the constants do:\n${
      missing.map(([what, needle]) => `  - ${what}: expected to find ${JSON.stringify(needle)}`).join('\n')
    }`,
  );
});

test('every card and character the game has is written up', () => {
  for (const c of Object.values(CARDS)) {
    assert.ok(README.includes(`**${c.name}**`), `the README never mentions the ${c.name}`);
  }
  for (const c of Object.values(CHARACTERS)) {
    assert.ok(README.includes(c.name), `the README never mentions ${c.name}`);
    assert.ok(README.includes(c.ability), `the README never mentions ${c.ability}`);
  }
  for (const r of Object.values(ROLES)) {
    assert.ok(README.includes(`**${r.name}**`), `the README never mentions the ${r.name}`);
  }
});

test('the test count in the README is not a fossil', async () => {
  // Two places quote it, and they have to agree with each other at minimum.
  const counts = [...README.matchAll(/(\d+) checks|runs (\d+) checks/g)]
    .map((m) => Number(m[1] || m[2]));
  assert.ok(counts.length >= 2, 'the README stopped saying how many checks there are');
  assert.equal(new Set(counts).size, 1,
    `the README quotes different test counts in different places: ${counts.join(' and ')}`);
});
