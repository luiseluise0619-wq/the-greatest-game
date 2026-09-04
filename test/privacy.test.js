// PRIVACY.md is a promise about what the code does, so it is pinned to the
// code the way the README's numbers already are.
//
// A privacy document that has drifted from its software is worse than none: it
// is a claim somebody relied on that is no longer true. Every claim in that
// file that can be checked mechanically is checked here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const PRIVACY = await read('../PRIVACY.md');
const [ROOM, ROOMS, INDEX, TELEMETRY, MAIN, SETTINGS, HTML] = await Promise.all([
  read('../server/room.js'), read('../server/rooms.js'), read('../server/index.js'),
  read('../server/telemetry.js'), read('../client/js/main.js'),
  read('../client/js/settings.js'), read('../client/index.html'),
]);

test('the storage keys it names are the keys the client uses', () => {
  // Nothing is written into a browser that the document does not name.
  const written = new Set();
  for (const src of [MAIN, SETTINGS]) {
    for (const m of src.matchAll(/(?:local|session)Storage\.setItem\(\s*([A-Z_]+|'[^']+')/g)) {
      written.add(m[1].replace(/'/g, ''));
    }
  }
  // TOKEN_KEY and KEY are constants; resolve them.
  const resolve = (name) => {
    if (!/^[A-Z_]+$/.test(name)) return name;
    for (const src of [MAIN, SETTINGS]) {
      const m = new RegExp(`const ${name} = '([^']+)'`).exec(src);
      if (m) return m[1];
    }
    return name;
  };
  for (const raw of written) {
    const key = resolve(raw);
    assert.ok(PRIVACY.includes(key),
      `the client stores "${key}" in the browser and PRIVACY.md does not say so`);
  }
});

test('names really are off in the playtest log unless somebody asks for them', () => {
  assert.match(TELEMETRY, /const WITH_NAMES = process\.env\.HNH_TELEMETRY_NAMES === '1'/,
    'PRIVACY.md says names are opt-in and the switch that makes that true has moved');
  assert.match(TELEMETRY, /name\(player\) \{\s*return WITH_NAMES \? player\.name : undefined;/,
    'a name reaches the log by some route the document does not describe');
});

test('nothing anywhere records an address or a device', () => {
  // The document says no IP addresses, no browser or device details. The only
  // place either could be picked up is the socket, so nothing may read them.
  for (const [what, src] of [['room.js', ROOM], ['rooms.js', ROOMS],
    ['index.js', INDEX], ['telemetry.js', TELEMETRY]]) {
    assert.equal(/remoteAddress|x-forwarded-for|userAgent|user-agent/i.test(src), false,
      `${what} reads something about the person on the other end, and PRIVACY.md says nothing does`);
  }
});

test('the switches it offers exist', () => {
  for (const [env, src, where] of [
    ['HNH_TELEMETRY', TELEMETRY, 'telemetry.js'],
    ['HNH_TELEMETRY_NAMES', TELEMETRY, 'telemetry.js'],
    ['HNH_STATS_TOKEN', INDEX, 'index.js'],
  ]) {
    assert.ok(PRIVACY.includes(env), `PRIVACY.md stopped mentioning ${env}`);
    assert.ok(src.includes(env), `PRIVACY.md offers ${env} and ${where} does not read it`);
  }
});

test('an empty room really is swept, on the timer the document quotes', () => {
  const m = /const IDLE_GRACE = (\d+);/.exec(ROOMS);
  assert.ok(m, 'the idle grace is gone from rooms.js');
  assert.ok(PRIVACY.includes(`${m[1]} seconds`),
    `PRIVACY.md says a room is deleted on a timer that is no longer ${m[1]} seconds`);
});

test('chat is relayed and not written down', () => {
  const body = ROOM.slice(ROOM.indexOf('  onChat(p, msg)'));
  const fn = body.slice(0, body.indexOf('\n  }\n'));
  assert.equal(/this\.(history|timeline|shotLog|chatLog)\.push/.test(fn), false,
    'PRIVACY.md says chat is not written down and onChat now keeps it');
  assert.equal(/telemetry\.\w+\(.*text/.test(fn), false,
    'the text of a chat line reaches the playtest log');
});

test('the page asks nobody else for anything', () => {
  // "No analytics, no ads, no fonts or scripts from anybody else's server."
  const external = [...HTML.matchAll(/(?:src|href)="(https?:)?\/\/([^"]+)"/g)].map((x) => x[2]);
  assert.deepEqual(external, [],
    `the page loads from ${external.join(', ')} and PRIVACY.md says it loads from nowhere`);
});

test('guessing room codes still costs a connection', () => {
  assert.match(INDEX, /badJoins \+= 1|\+\+badJoins/,
    'PRIVACY.md says a socket guessing codes is cut off and nothing counts the guesses');
});
