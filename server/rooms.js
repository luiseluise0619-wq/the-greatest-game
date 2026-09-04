// Many towns, one server.
//
// Each Room is a self-contained match; this registry hands out shareable
// four-letter codes, routes new sockets to the right room, keeps public rooms
// filling up rather than scattering players across half-empty lobbies, and
// drives every room from a single tick loop.

import { Room } from './room.js';
import { TICK_MS, MAX_PLAYERS, PHASE } from '../shared/constants.js';
import { C, S } from '../shared/protocol.js';

// No I/O/0/1 - these codes get read aloud over voice chat.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;
const IDLE_GRACE = 90;      // seconds an empty room is kept before it is reaped

// How many towns one process will hold at once.
//
// Measured rather than picked: a full eight-player room costs about 0.39ms a
// tick in the free-for-all and 0.26ms at the table, on one core of the machine
// this was written on. A 20Hz loop has 50ms to spend, so that core runs out at
// about 130 full free-for-all rooms - and the ceiling here used to be 200, which
// is a number the server cannot actually serve. Past the budget nothing fails
// loudly; every room on the process just starts running slow at once, which is
// the worst way for a game server to be broken.
//
// So the default leaves room, a shared vCPU is slower than the box that
// measured it, and it is settable for anybody who has measured their own.
export const MAX_ROOMS = Number(process.env.HNH_MAX_ROOMS || 100);

// Overruns are counted in windows rather than one at a time. Ten seconds of
// ticks, and a tenth of them running over is a process that is genuinely short
// of core rather than a machine that hiccupped.
const OVERRUN_WINDOW = 200;
const OVERRUN_ALARM = 20;

const now = () => Date.now() / 1000;

export class RoomManager {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.timer = null;
    this.ticks = 0;
    // Load, so a server that has run out of core can be seen to have done so.
    this.tickMs = 0;
    this.peakTickMs = 0;
    this.overruns = 0;
    this.recentOverruns = 0;
    this.window = 0;
    // Every town this manager opens plays the same game.
    this.mode = opts.mode;
  }

  // ------------------------------------------------------------- lifecycle
  makeCode() {
    for (let attempt = 0; attempt < 80; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  create({ isPublic = true } = {}) {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const code = this.makeCode();
    if (!code) return null;
    const room = new Room({ code, isPublic, mode: this.mode });
    room.resetClock();
    this.rooms.set(code, room);
    console.log(`[rooms] + ${code} ${isPublic ? 'public ' : 'private'} · ${this.rooms.size} open`);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim()) || null;
  }

  hasSpace(room) { return room.humanCount() < MAX_PLAYERS; }

  /**
   * Quick play. Prefers a public room that is still in the lobby, and among
   * those the *fullest* one - filling a lobby beats scattering four people
   * across four empty towns, which is how this genre dies.
   */
  quickJoin() {
    const open = [...this.rooms.values()].filter((r) => r.isPublic && this.hasSpace(r));
    open.sort((a, b) => {
      const waitA = a.phase === PHASE.LOBBY ? 0 : 1;
      const waitB = b.phase === PHASE.LOBBY ? 0 : 1;
      if (waitA !== waitB) return waitA - waitB;
      return b.humanCount() - a.humanCount();
    });
    return open[0] || this.create({ isPublic: true });
  }

  /** Work out which room a fresh socket belongs in. */
  resolve(msg) {
    if (msg.room) {
      const room = this.get(msg.room);
      // Clipped: a code is four letters, and a socket that asks for a five
      // thousand character one should not get five thousand characters back.
      const asked = String(msg.room).toUpperCase().trim().slice(0, CODE_LEN + 4);
      if (!room) {
        return { error: `No town goes by "${asked}". Check the code.`,
          errorKey: 'err.noSuchTown', errorP: { code: asked } };
      }
      if (!this.hasSpace(room)) {
        return { error: 'That town is full - 8 guns is the limit.', errorKey: 'err.townFull' };
      }
      return { room };
    }
    const room = msg.create ? this.create({ isPublic: false }) : this.quickJoin();
    if (!room) return { error: 'Server is at capacity. Try again in a minute.', errorKey: 'err.atCapacity' };
    return { room };
  }

  // -------------------------------------------------------------- routing
  handleMessage(client, msg) {
    if (!client.room) {
      if (msg.t !== C.JOIN) return;
      const res = this.resolve(msg);
      if (res.error) {
        try {
          // Keyed like everything else the town says. This is the first thing
          // a player ever reads if their code is wrong, and it was the one
          // sentence in the game that only ever came out in English.
          client.ws.send(JSON.stringify({
            t: S.ERROR, msg: res.error, k: res.errorKey || null, p: res.errorP || null, fatal: true,
          }));
        } catch { /* gone */ }
        return;
      }
      res.room.addConnection(client);
    }
    client.room.handleMessage(client, msg);
  }

  dropClient(client) {
    if (client.room) client.room.removeConnection(client);
  }

  // ------------------------------------------------------------ the clock
  start() {
    this.timer = setInterval(() => {
      // What one pass over every room actually cost. A game server that has run
      // out of core does not fail, it goes slow everywhere at once, and the
      // only way anybody finds out is that the game feels wrong - so the number
      // goes on /healthz where a deployment can watch it, and says so in the
      // log when it is sustained rather than once.
      const began = performance.now();
      for (const room of this.rooms.values()) {
        try {
          room.step();
        } catch (err) {
          console.error(`[rooms] ${room.code} step error`, err);
        }
      }
      const spent = performance.now() - began;
      this.tickMs = this.tickMs * 0.95 + spent * 0.05;
      this.peakTickMs = Math.max(this.peakTickMs, spent);
      // One slow tick is not news. Any machine hiccups - a garbage collection,
      // another process, a laptop deciding to think about something else - and
      // a server that shouts about a single 62ms tick is a server whose warnings
      // nobody reads. What matters is a process that is PAST its budget, which
      // looks like overruns arriving steadily rather than once.
      if (spent > TICK_MS) {
        this.overruns += 1;
        this.recentOverruns += 1;
      }
      if (++this.window >= OVERRUN_WINDOW) {
        if (this.recentOverruns >= OVERRUN_ALARM) {
          console.warn(`[rooms] ${this.recentOverruns} of the last ${OVERRUN_WINDOW}`
            + ` ticks ran over ${TICK_MS}ms · ${this.rooms.size} towns`
            + ` · ${this.tickMs.toFixed(1)}ms average`);
        }
        this.window = 0;
        this.recentOverruns = 0;
      }
      if (++this.ticks % 40 === 0) this.reap();
    }, TICK_MS);
  }

  /** Put the clock down. Called on the way out so nothing ticks after goodbye. */
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  reap() {
    const t = now();
    for (const [code, room] of this.rooms) {
      if (room.clients.size) { room.emptySince = 0; continue; }
      if (!room.emptySince) { room.emptySince = t; continue; }
      if (t - room.emptySince > IDLE_GRACE) {
        this.rooms.delete(code);
        console.log(`[rooms] - ${code} (idle) · ${this.rooms.size} open`);
      }
    }
  }

  stats() {
    let humans = 0;
    let playing = 0;
    for (const room of this.rooms.values()) {
      humans += room.humanCount();
      if (room.phase !== PHASE.LOBBY) playing++;
    }
    return {
      rooms: this.rooms.size, inMatch: playing, humans,
      capacity: MAX_ROOMS,
      tickMs: +this.tickMs.toFixed(2),
      peakTickMs: +this.peakTickMs.toFixed(2),
      tickBudgetMs: TICK_MS,
      overruns: this.overruns,
    };
  }
}
