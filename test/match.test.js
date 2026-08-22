// The round itself: roles, win conditions, and the information rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { PHASE, TIMING, ROLES, PLAYER, ENDGAME, SOCIAL } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

function makeRoom({ bots = 6, prep = 3, combat = 400 } = {}) {
  TIMING.prep = prep; TIMING.combat = combat; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'TEST', isPublic: false });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  return { room, clock, stub, me: () => [...room.players.values()].find((p) => !p.bot) };
}

test('a match deals exactly one of each required role and starts everyone alive', () => {
  const { room, clock } = makeRoom({ bots: 8 });
  try {
    room.beginMatch();
    const players = [...room.players.values()];
    assert.equal(players.length, 8);
    assert.equal(players.filter((p) => p.role === 'sheriff').length, 1);
    assert.ok(players.every((p) => p.alive && p.health > 0));
    assert.ok(players.every((p) => ROLES[p.role]), 'every player has a real role');
    // The Sheriff carries a quiet extra margin nobody else can see.
    const sheriff = players.find((p) => p.role === 'sheriff');
    assert.ok(sheriff.maxHealth > PLAYER.maxHealth);
  } finally { clock.restore(); }
});

test('nobody is told anybody else\'s role at the start', () => {
  const { room, clock, stub } = makeRoom();
  try {
    room.beginMatch();
    const role = stub.last('role');
    assert.ok(role, 'the player must be told their own role');
    assert.ok(ROLES[role.role]);
    // Their own card is the only role in anything they were sent.
    const others = [...room.players.values()].filter((p) => p.bot);
    const wire = JSON.stringify(stub.sent);
    for (const o of others) {
      assert.equal(
        wire.includes(`"${o.name}","role"`), false,
        `${o.name}'s role leaked to the client`,
      );
    }
  } finally { clock.restore(); }
});

test('guns do nothing during preparation', () => {
  const { room, clock } = makeRoom({ prep: 60 });
  try {
    room.beginMatch();
    const [a, b] = [...room.players.values()];
    const before = b.health;
    room.applyDamage(b, a, 50, 'revolver', null);
    assert.equal(b.health, before, 'somebody took damage before the bell');
    assert.equal(room.phase, PHASE.PREP);
  } finally { clock.restore(); }
});

test('killing the Sheriff ends the round for the gang', () => {
  const { room, clock } = makeRoom({ bots: 8, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    assert.equal(room.phase, PHASE.COMBAT);
    const sheriff = [...room.players.values()].find((p) => p.role === 'sheriff');
    const outlaw = [...room.players.values()].find((p) => p.role === 'outlaw');
    room.applyDamage(sheriff, outlaw, 999, 'revolver', null);
    assert.equal(room.phase, PHASE.RESULTS);
    assert.equal(room.results.winner, 'outlaw');
  } finally { clock.restore(); }
});

test('burying every outlaw and the renegade wins it for the law', () => {
  const { room, clock } = makeRoom({ bots: 8, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const sheriff = [...room.players.values()].find((p) => p.role === 'sheriff');
    for (const p of [...room.players.values()]) {
      if (p.faction !== 'law') room.applyDamage(p, sheriff, 999, 'revolver', null);
    }
    assert.equal(room.results.winner, 'law');
    assert.ok(sheriff.alive);
  } finally { clock.restore(); }
});

test('a kill only names the killer to somebody who watched it', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const player = me();
    const victim = [...room.players.values()].find((p) => p.bot && p.alive);
    const killer = [...room.players.values()].find((p) => p.bot && p.alive && p !== victim);

    freezeBots(room);
    // Put our player inside the mine, far from a killing in the church.
    player.pos = { x: 58, y: 0, z: -18 };
    victim.pos = { x: 0, y: 0, z: 20 };
    killer.pos = { x: 2, y: 0, z: 22 };
    tick(clock, room, 2);
    stub.reset();
    room.applyDamage(victim, killer, 999, 'revolver', null);

    const kill = stub.last('kill');
    assert.ok(kill, 'the death should still be announced');
    assert.equal(kill.victimName, victim.name);
    assert.equal(kill.victimRole, victim.role, 'the dead always reveal their role');
    assert.equal(kill.witnessed, false);
    assert.equal(kill.killerName, null, 'named a killer nobody could see');
  } finally { clock.restore(); }
});

test('the victim always learns who shot them', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    freezeBots(room);
    const player = me();
    const killer = [...room.players.values()].find((p) => p.bot && p.alive);
    stub.reset();
    room.applyDamage(player, killer, 999, 'revolver', null);
    const kill = stub.last('kill');
    assert.equal(kill.youDied, true);
    assert.equal(kill.killerName, killer.name);
  } finally { clock.restore(); }
});

test('a death replay carries only the killer and the victim', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);              // into live combat
    // Freeze the town BEFORE filling the history buffer: a bot that shoots our
    // player, gets shot itself, or quietly buys a witness during those seconds
    // leaves nothing to build a killcam out of.
    freezeBots(room);
    const player = me();
    const killer = [...room.players.values()].find((p) => p.bot && p.alive);
    tick(clock, room, 20 * 6);
    stub.reset();
    room.applyDamage(player, killer, 999, 'revolver', null);

    const replay = stub.last('replay');
    assert.ok(replay, 'no killcam was sent');
    assert.ok(replay.frames.length > 5);
    const ids = new Set(replay.frames.flatMap((f) => f.ps.map((e) => e.id)));
    assert.deepEqual(
      [...ids].sort(), [player.id, killer.id].sort(),
      'the replay leaked a bystander',
    );
  } finally { clock.restore(); }
});

test('the dead cannot talk to the living', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const player = me();
    const ghostHeard = [];
    // A second, living client to check what it receives.
    const other = stubClient();
    room.addConnection(other.client);
    room.handleMessage(other.client, { t: 'join', name: 'Alive' });
    const alive = [...room.players.values()].find((p) => p.name === 'Alive');
    alive.alive = true;

    player.alive = false;
    other.reset();
    room.onChat(player, { text: 'the sheriff is Dutch' });
    assert.equal(other.of('chat').length, 0, 'a ghost coached a living player');

    player.alive = true;
    player.lastChatAt = 0;
    other.reset();
    room.onChat(player, { text: 'still breathing' });
    assert.equal(other.of('chat').length, 1, 'living chat should reach everyone');
  } finally { clock.restore(); }
});

test('the dust storm actually hurts, a fraction of a point at a time', () => {
  const { room, clock, me } = makeRoom({ bots: 6, prep: 1, combat: 2 });
  try {
    room.beginMatch();
    tick(clock, room, 80);                       // through prep and combat
    assert.equal(room.phase, PHASE.ENDGAME);
    freezeBots(room);
    const player = me();
    player.alive = true;
    player.health = player.maxHealth;
    // Well outside the ring at its widest, and kept there.
    const far = ENDGAME.startRadius + 40;
    const hold = () => { player.pos = { x: far, y: 0, z: 0 }; };
    hold();
    const before = player.health;
    for (let i = 0; i < 40; i++) { hold(); tick(clock, room, 1); }   // two seconds

    const lost = before - player.health;
    // 9 dps for 2s. Rounding each 0.45 tick to zero used to make this exactly 0.
    assert.ok(lost >= 14, `the storm did almost nothing (${lost} damage in 2s)`);
    assert.ok(lost <= 24, `the storm hit far too hard (${lost} damage in 2s)`);
  } finally { clock.restore(); }
});

test('standing inside the ring costs nothing', () => {
  const { room, clock, me } = makeRoom({ bots: 6, prep: 1, combat: 2 });
  try {
    room.beginMatch();
    tick(clock, room, 80);
    freezeBots(room);
    const player = me();
    player.alive = true;
    player.health = player.maxHealth;
    const hold = () => { player.pos = { x: 0, y: 0, z: 0 }; };
    hold();
    for (let i = 0; i < 40; i++) { hold(); tick(clock, room, 1); }
    assert.equal(player.health, player.maxHealth, 'the storm reached inside the ring');
  } finally { clock.restore(); }
});

test('a Sheriff who walks out during preparation settles it at the bell', () => {
  const { room, clock } = makeRoom({ bots: 8, prep: 1 });
  try {
    room.beginMatch();
    const sheriff = [...room.players.values()].find((p) => p.role === 'sheriff');
    // Leaving mid-round leaves a corpse; during prep nothing checks it.
    room.killPlayer(sheriff, null, 'left', null);
    assert.equal(room.phase, PHASE.PREP, 'prep should not end on a death');
    assert.equal(room.results, null);

    tick(clock, room, 40);              // ring the bell
    assert.equal(room.phase, PHASE.RESULTS, 'the round ran on with a dead Sheriff');
    assert.equal(room.results.winner, 'outlaw');
  } finally { clock.restore(); }
});

test('a public town deals itself in once a second person turns up', () => {
  TIMING.prep = 3; TIMING.combat = 400; TIMING.endgame = 30; TIMING.results = 5;
  TIMING.lobbyCountdown = 4;
  const clock = fakeClock();
  const room = new Room({ code: 'PUB', isPublic: true });
  room.botFillTarget = 6;
  room.resetClock();
  try {
    const a = stubClient();
    room.addConnection(a.client);
    room.handleMessage(a.client, { t: 'join', name: 'First' });

    // One person is not a round. They may be waiting for friends.
    tick(clock, room, 200);
    assert.equal(room.phase, PHASE.LOBBY, 'a lone player got dealt in against their will');
    assert.equal(room.lobbyStartAt, 0);

    const b = stubClient();
    room.addConnection(b.client);
    room.handleMessage(b.client, { t: 'join', name: 'Second' });
    tick(clock, room, 1);
    assert.ok(room.lobbyStartAt > 0, 'a second arrival should start the clock');
    const told = b.last('lobby');
    assert.ok(told.startsIn > 0 && told.startsIn <= 4, `the client was told ${told.startsIn}s`);

    tick(clock, room, 40);                    // two seconds: not yet
    assert.equal(room.phase, PHASE.LOBBY);

    // Second player leaves: the clock stops rather than dealing one human in.
    room.removeConnection(b.client);
    tick(clock, room, 1);
    assert.equal(room.lobbyStartAt, 0, 'the countdown outlived the player who started it');

    const c = stubClient();
    room.addConnection(c.client);
    room.handleMessage(c.client, { t: 'join', name: 'Third' });
    tick(clock, room, 120);                   // six seconds, past the four
    assert.equal(room.phase, PHASE.PREP, 'the town never dealt itself in');
  } finally { clock.restore(); }
});

test('a private town waits for whoever you invited', () => {
  TIMING.prep = 3; TIMING.lobbyCountdown = 2;
  const clock = fakeClock();
  const room = new Room({ code: 'PRIV', isPublic: false });
  room.botFillTarget = 6;
  room.resetClock();
  try {
    for (const name of ['A', 'B', 'C']) {
      const s = stubClient();
      room.addConnection(s.client);
      room.handleMessage(s.client, { t: 'join', name });
    }
    tick(clock, room, 200);
    assert.equal(room.phase, PHASE.LOBBY, 'a private room started without being asked');
    assert.equal(room.lobbyStartAt, 0);
  } finally { clock.restore(); }
});

test('a refresh gets your body back, and a no-show falls over', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    freezeBots(room);
    const player = me();
    const token = player.token;
    const role = player.role;
    player.pos = { x: 6, y: 0, z: 12 };
    player.health = 61;
    const hand = player.hand.slice();
    assert.ok(token, 'a player should be issued a token to come back with');

    // The tab goes away. The body does not.
    room.removeConnection(stub.client);
    tick(clock, room, 20);
    assert.equal(player.alive, true, 'a disconnect killed the player outright');
    assert.equal(player.connected, false);
    assert.equal(player.moving, false, 'a body with nobody driving it kept walking');
    assert.ok(room.players.has(player.id));

    // ...and it is every bit as shootable while it stands there.
    const shooter = [...room.players.values()].find((p) => p.bot && p.alive);
    room.applyDamage(player, shooter, 10, 'revolver', null);
    assert.equal(player.health, 51, 'a disconnected body was invulnerable');

    // Same tab, same token, back inside the grace.
    const again = stubClient();
    room.addConnection(again.client);
    room.handleMessage(again.client, { t: 'join', name: 'Tester', token });
    assert.equal(again.client.playerId, player.id, 'the token did not find the body');
    assert.equal(player.connected, true);
    assert.equal(player.role, role, 'came back as somebody else');
    assert.deepEqual(again.last('cards').hand, hand, 'the hand did not come back');
    assert.equal(again.last('role').role, role);
    assert.equal(again.last('self').hp, 51, 'the health did not come back');
  } finally { clock.restore(); }
});

test('a body nobody comes back for falls over on its own', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    freezeBots(room);
    const player = me();
    room.removeConnection(stub.client);
    assert.equal(player.alive, true);

    clock.advance((SOCIAL.reconnectGrace + 1) * 1000);
    tick(clock, room, 2);
    assert.equal(player.alive, false, 'the grace never ran out');
  } finally { clock.restore(); }
});

test('a stranger cannot claim somebody else\'s body', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const player = me();
    room.removeConnection(stub.client);

    const thief = stubClient();
    room.addConnection(thief.client);
    room.handleMessage(thief.client, { t: 'join', name: 'Thief', token: 'not-the-token' });
    assert.notEqual(thief.client.playerId, player.id, 'a made up token took over a body');
    assert.equal(player.connected, false, 'the real player lost their seat');
  } finally { clock.restore(); }
});

test('reclaiming a seat wins the race against the old socket', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    freezeBots(room);
    const player = me();
    const token = player.token;
    const role = player.role;

    // The reload's new socket arrives BEFORE the browser's close for the old
    // one - which is what actually happens about half the time.
    const again = stubClient();
    room.addConnection(again.client);
    room.handleMessage(again.client, { t: 'join', name: 'Tester', token });
    assert.equal(again.client.playerId, player.id, 'the seat went to a stranger');
    assert.equal(player.role, role);
    assert.equal(player.client, again.client, 'the body is still pointed at the dead socket');

    // ...and the old socket closing afterwards must not take the body away.
    room.removeConnection(stub.client);
    assert.equal(player.alive, true, 'the stale close killed the reclaimed player');
    assert.equal(player.connected, true);
    assert.equal(player.client, again.client);
  } finally { clock.restore(); }
});

test('a dead spectator who reloads keeps their seat and their row', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    freezeBots(room);
    const player = me();
    const token = player.token;
    const role = player.role;
    // Straight to dead, without going through applyDamage: whether this
    // particular death would also end the round depends on the role they were
    // dealt, and that is not what this test is about.
    player.alive = false;
    player.health = 0;
    const before = room.players.size;

    // Spectating, and they reload the page.
    room.removeConnection(stub.client);
    assert.equal(room.players.size, before, 'a dead player vanished from the round');

    const again = stubClient();
    room.addConnection(again.client);
    room.handleMessage(again.client, { t: 'join', name: 'Tester', token });
    assert.equal(again.client.playerId, player.id, 'a dead player could not reclaim their seat');
    assert.equal(again.last('self').alive, false, 'they came back alive');

    // And they are still in the account of the round.
    room.endMatch('law', 'test');
    const rows = again.last('results').rows;
    assert.ok(rows.some((r) => r.name === player.name && r.role === role),
      'the aftermath screen forgot a player who died and reloaded');
  } finally { clock.restore(); }
});
