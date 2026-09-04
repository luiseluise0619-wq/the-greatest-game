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
const MAX_ROOMS = 200;

const now = () => Date.now() / 1000;

export class RoomManager {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.timer = null;
    this.ticks = 0;
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
      for (const room of this.rooms.values()) {
        try {
          room.step();
        } catch (err) {
          console.error(`[rooms] ${room.code} step error`, err);
        }
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
    return { rooms: this.rooms.size, inMatch: playing, humans };
  }
}
