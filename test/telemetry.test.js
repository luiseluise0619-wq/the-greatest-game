// The playtest log. Its whole justification is answering "is this a deduction
// game or a western deathmatch" with evidence, and its whole risk is quietly
// becoming a record of who played what and said what. Both are checked here.
//
// The module reads its settings once, at import, so this file sets them before
// anything pulls it in. `node --test` gives every file its own process, which
// is what makes that safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hnh-telemetry-'));
process.env.HNH_TELEMETRY_DIR = DIR;
delete process.env.HNH_TELEMETRY;          // on by default
delete process.env.HNH_TELEMETRY_NAMES;    // names off by default

const { TIMING, PHASE } = await import('../shared/constants.js');
const { Room } = await import('../server/room.js');
const { telemetry } = await import('../server/telemetry.js');

const FILE = path.join(DIR, 'telemetry.jsonl');

/** Play a whole round with something happening in it, and read the log back. */
async function roundAndLog() {
  TIMING.prep = 1; TIMING.combat = 300; TIMING.endgame = 20; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'TELE', isPublic: false });
  room.botFillTarget = 6;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Rosalind Marchetti' });

  room.beginMatch();
  tick(clock, room, 40);
  freezeBots(room);
  const me = [...room.players.values()].find((p) => !p.bot);

  room.onChat(me, { text: 'the sheriff is definitely Dutch and here is my password hunter2' });
  const target = [...room.players.values()].find((p) => p.bot && p.alive);
  room.onAccuse(me, { target: target.id });
  me.hand = ['ledger']; me.lastCardAt = 0;
  room.onCard(me, { card: 'ledger' });
  const killer = [...room.players.values()].find((p) => p.bot && p.alive && p !== target);
  room.applyDamage(target, killer, 999, 'revolver', null);
  if (room.phase !== PHASE.RESULTS) room.endMatch('law', 'test');

  clock.restore();
  telemetry.flush();
  await new Promise((r) => setTimeout(r, 60));
  const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
  return { room, raw, lines: raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

test('a playtest log never becomes a record of what anybody said', async () => {
  const { raw, lines } = await roundAndLog();
  assert.ok(lines.length > 3, 'the round wrote almost nothing down');

  // Not one word of chat, ever - that is the entire promise.
  assert.equal(raw.includes('hunter2'), false, 'chat text was written to the playtest log');
  assert.equal(raw.includes('sheriff is definitely'), false, 'chat text was written to the playtest log');
  assert.equal(/"text"/.test(raw), false, 'something wrote a text field into the log');

  // And no names, unless somebody asked for them with HNH_TELEMETRY_NAMES=1.
  assert.equal(raw.includes('Rosalind Marchetti'), false, 'a player name was written without being asked for');
  for (const line of lines) {
    for (const key of ['victimName', 'killerName', 'name']) {
      assert.equal(key in line && line[key] !== undefined, false,
        `${line.type} carried a ${key} with names turned off`);
    }
  }
});

test('the log answers the question it exists to answer', async () => {
  const { lines } = await roundAndLog();
  const types = new Set(lines.map((l) => l.type));
  for (const want of ['match_start', 'death', 'card', 'match_end']) {
    assert.ok(types.has(want), `nothing in the log records a ${want}`);
  }

  const death = lines.find((l) => l.type === 'death');
  // Roles, factions and places are the whole point: they are what tells you
  // whether people are killing on evidence or at random.
  assert.ok(death.victimRole, 'a death was recorded without the role that died');
  assert.equal(typeof death.witnessed, 'boolean');
  assert.equal(typeof death.witnesses, 'number');
  assert.ok(death.witnesses >= 0, 'a death claimed a negative number of witnesses');
  assert.ok(death.place && death.place.length > 3, 'a death happened nowhere in particular');
  assert.equal(typeof death.sameFaction, 'boolean');

  const end = lines.find((l) => l.type === 'match_end');
  assert.ok(['law', 'outlaw', 'renegade', 'none'].includes(end.winner));
  assert.ok(end.seconds >= 0);
});

test('the readout is arithmetic anybody can check', async () => {
  await roundAndLog();
  const s = telemetry.summary();

  assert.equal(s.enabled, true);
  assert.ok(s.matches >= 1);
  assert.ok(s.avgKillsPerMatch >= 0);
  // The headline: a share, so it has to be one.
  assert.ok(s.witnessedKillShare >= 0 && s.witnessedKillShare <= 1,
    `witnessedKillShare is ${s.witnessedKillShare}, which is not a share of anything`);
  assert.ok(s.cardPlayRate >= 0 && s.cardPlayRate <= 1,
    `cardPlayRate is ${s.cardPlayRate}`);
  assert.ok(s.cardsPerMatch > 0, 'a card was played and the readout says none were');
  assert.equal(typeof s.wins, 'object');
  assert.ok(s.deadliestPlaces && Object.keys(s.deadliestPlaces).length >= 1);
  // Never a name, in the aggregate either.
  assert.equal(JSON.stringify(s).includes('Rosalind'), false, 'the readout leaked a player name');
});

test('turning it off writes nothing at all', async () => {
  const before = fs.existsSync(FILE) ? fs.statSync(FILE).size : 0;
  telemetry.enabled = false;
  try {
    telemetry.event('death', { room: 'OFF', victimRole: 'sheriff' });
    telemetry.flush();
    await new Promise((r) => setTimeout(r, 60));
    const after = fs.existsSync(FILE) ? fs.statSync(FILE).size : 0;
    assert.equal(after, before, 'the log grew while telemetry was switched off');
  } finally {
    telemetry.enabled = true;
  }
});

test.after(() => { fs.rmSync(DIR, { recursive: true, force: true }); });
