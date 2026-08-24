// The draw pile, the discard pile, and what happens when a card is played.
//
// Kept out of room.js because that file is long enough, and because everything
// here is about eighty pieces of card rather than about a town: the room hands
// this a player and a card id and gets told what became of it.

import {
  DUEL_CARDS, KIND, DRAW_ODDS, buildDeck, inReach, reachOf,
} from '../shared/deck.js';

/**
 * Eighty cards, drawn from the top, and the discards shuffled back under when
 * the pile runs dry - which in a long round it will.
 */
export class Pile {
  constructor(random = Math.random) {
    this.random = random;
    this.draw = shuffle(buildDeck(), random);
    this.discard = [];
  }

  /** One card, or null only if every card in the game is in somebody's hand. */
  take() {
    if (!this.draw.length) this.recycle();
    return this.draw.pop() || null;
  }

  takeMany(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = this.take();
      if (c) out.push(c);
    }
    return out;
  }

  put(id) { if (id) this.discard.push(id); }

  putMany(ids) { for (const id of ids || []) this.put(id); }

  /** Everything thrown away goes back under, shuffled. */
  recycle() {
    if (!this.discard.length) return;
    this.draw = shuffle(this.discard, this.random);
    this.discard = [];
  }

  get remaining() { return this.draw.length; }
}

function shuffle(list, random = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A "draw!": the original flips a card and reads its suit. These are the odds. */
export function drawCheck(which, random = Math.random) {
  return random() < (DRAW_ODDS[which] ?? 0);
}

/**
 * How many cards this player may still be holding when their turn ends. The
 * original ties it to health, which is the quiet cruelty of the whole game: the
 * closer you are to dying the less you can do about it.
 */
export function handLimit(player) {
  return Math.max(0, player.health);
}

/** Is this a card that can simply be played on your own turn, at nobody? */
export function isSelfPlay(card) {
  return card && (card.kind === KIND.PLAY || card.kind === KIND.GEAR || card.kind === KIND.WEAPON);
}

export { DUEL_CARDS, KIND, inReach, reachOf };
