// Shared test scaffolding: a fake clock so a 13 minute round runs in
// milliseconds, and a socket stub that records what a client would be sent.

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
 */
export function freezeBots(room) {
  for (const p of room.players.values()) {
    if (p.bot) { p.brain = null; p.moving = false; p.vel = { x: 0, y: 0, z: 0 }; }
  }
}

/** Step a room forward n server ticks against the fake clock. */
export function tick(clock, room, n) {
  for (let i = 0; i < n; i++) { clock.advance(50); room.step(); }
}
