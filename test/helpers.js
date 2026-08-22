// Shared test scaffolding: a fake clock so a 13 minute round runs in
// milliseconds, and a socket stub that records what a client would be sent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the playtest log somewhere disposable before anything imports it.
// Every test file pulls this in first, and a static import is evaluated before
// the module body that dynamically imports the server - so this lands in time.
// Without it, running the suite dribbles fake rounds into a real data/ file.
if (!process.env.HNH_TELEMETRY_DIR) {
  process.env.HNH_TELEMETRY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hnh-test-'));
}

export function fakeClock() {
  const real = Date.now;
  let t = 1_700_000_000_000;
  Date.now = () => t;
  return {
    advance(ms) { t += ms; },
    restore() { Date.now = real; },
  };
}

/** A client whose "socket" just collects the JSON it is handed. */
export function stubClient() {
  const sent = [];
  return {
    sent,
    of(type) { return sent.filter((m) => m.t === type); },
    last(type) { return [...sent].reverse().find((m) => m.t === type); },
    reset() { sent.length = 0; },
    client: {
      room: null,
      playerId: null,
      ws: { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) },
    },
  };
}

/**
 * Stop bot AI so anybody the test positions by hand stays there. Without this,
 * tests that place players and then tick are flaky - the bots simply walk off.
 * Also takes their cards away: a bot quietly playing Buy a Witness mid-test
 * changes what the rest of the room is told, which is exactly what these tests
 * are trying to measure.
 */
export function freezeBots(room) {
  for (const p of room.players.values()) {
    if (!p.bot) continue;
    p.brain = null;
    p.moving = false;
    p.vel = { x: 0, y: 0, z: 0 };
    p.hand = [];
    if (p.armed) p.armed.clear();
  }
}

/** Step a room forward n server ticks against the fake clock. */
export function tick(clock, room, n) {
  for (let i = 0; i < n; i++) { clock.advance(50); room.step(); }
}
