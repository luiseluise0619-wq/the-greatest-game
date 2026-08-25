// The eighty cards.
//
// This is the deck of the card game the turn mode is modelled on, counts and
// all, translated into a game where the shooting is real. Two things are worth
// saying out loud before the table:
//
//   The rules text here is ours. Every effect is the original's - that is a
//   game system, and a game system is not somebody's property - but not one
//   sentence of it is copied. The same goes for the faces: cardart.js prints
//   them, as it prints everything else in this project, and no image file has
//   ever been in this repository.
//
//   Distance is metres. The original seats everybody round a table and counts
//   chairs; here there are no chairs, so a "distance" is DISTANCE_UNIT metres
//   of actual ground. A weapon that reaches two seats reaches forty-four
//   metres, and whether you are inside that is decided by where you chose to
//   stand during the walk.
//
// The one thing that carries the whole deck: you cannot fire without a Bang!
// in your hand, and you may only play one on your go. Ammunition is cards.
// Everything else on this list exists to bend that rule or to survive it.

import { trait } from './gunhands.js';

export const DISTANCE_UNIT = 22;        // metres per "seat" of the original

/** Kinds, which decide when a card may be played and what happens to it. */
export const KIND = {
  SHOT: 'shot',          // needs a target in range, and is the only way to fire
  REACTION: 'reaction',  // spent when something happens to you, not on your go
  PLAY: 'play',          // resolves at once on your own turn
  TARGET: 'target',      // resolves at once, on somebody you name
  GEAR: 'gear',          // stays in front of you until it is removed
  WEAPON: 'weapon',      // gear, but only one at a time, and it sets your range
  CURSE: 'curse',        // gear you put in front of somebody else
};

/**
 * A "draw!" in the original is a card flipped off the deck, and what happens
 * depends on its suit. These are those odds, exactly, without needing a suit
 * printed on all eighty faces: dynamite goes off on spades two through nine,
 * and you talk your way out of a cell on a heart.
 */
export const DRAW_ODDS = {
  dynamite: 8 / 52,      // it goes off
  jail: 13 / 52,         // you are out
  barrel: 13 / 52,       // it counts as a miss
};

export const DUEL_CARDS = {
  // ------------------------------------------------------------------ shots
  bang: {
    id: 'bang', name: 'Bang!', kind: KIND.SHOT, count: 25,
    rules: 'The only card that lets you pull a trigger. One a turn, unless what you are holding says otherwise.',
    flavour: 'Twenty-five of these in the deck and it is still never the one you want.',
  },
  missed: {
    id: 'missed', name: 'Missed!', kind: KIND.REACTION, count: 12,
    rules: 'Spent the moment a shot finds you. It finds nothing instead.',
    flavour: 'You were never standing quite where he thought you were.',
  },

  // ----------------------------------------------------------------- health
  beer: {
    id: 'beer', name: 'Beer', kind: KIND.PLAY, count: 6, heal: 1,
    rules: 'One hit back. Worth nothing at all once there are two of you left.',
    flavour: 'Warm, flat, and the best thing that has happened all day.',
  },
  saloon: {
    id: 'saloon', name: 'Saloon', kind: KIND.PLAY, count: 1, healAll: 1,
    rules: 'A hit back for everyone still standing, including the men trying to kill you.',
    flavour: 'The house is buying. Nobody trusts the house.',
  },

  // ------------------------------------------------------------------- draw
  stagecoach: {
    id: 'stagecoach', name: 'Stagecoach', kind: KIND.PLAY, count: 2, draw: 2,
    rules: 'Two more cards, right now.',
    flavour: 'It came in on time for once.',
  },
  wells: {
    id: 'wells', name: 'Wells Fargo', kind: KIND.PLAY, count: 1, draw: 3,
    rules: 'Three more cards, right now.',
    flavour: 'A strongbox nobody thought to guard.',
  },
  store: {
    id: 'store', name: 'General Store', kind: KIND.PLAY, count: 2,
    rules: 'Turn up one card for every man alive. Everybody takes one, you first, then round the order.',
    flavour: 'Everything on the shelf, and everyone watching what you reach for.',
  },

  // ----------------------------------------------------------------- taking
  panic: {
    id: 'panic', name: 'Panic!', kind: KIND.TARGET, count: 4, range: 1,
    rules: 'Take a card off somebody close enough to touch - out of their hand, or off the table in front of them.',
    flavour: 'Close enough to smell the whiskey on him.',
  },
  catbalou: {
    id: 'catbalou', name: 'Cat Balou', kind: KIND.TARGET, count: 4, range: Infinity,
    rules: 'Make anybody in this town throw a card away. Any distance. You do not get it.',
    flavour: 'Spite carries further than a bullet.',
  },

  // -------------------------------------------------------------- the crowd
  indians: {
    id: 'indians', name: 'Indians!', kind: KIND.PLAY, count: 2,
    rules: 'Every other man must spend a Bang! or take a hit. You are not touched.',
    flavour: 'Dust on the ridge, and everybody suddenly has somewhere to be.',
  },
  gatling: {
    id: 'gatling', name: 'Gatling', kind: KIND.PLAY, count: 1,
    rules: 'A shot at every other man alive, whatever the distance. Each may answer it with a Missed!',
    flavour: 'It does not aim. That is the point of it.',
  },
  duel: {
    id: 'duel', name: 'Duel', kind: KIND.TARGET, count: 3, range: Infinity,
    rules: 'Call anybody out. You each throw down a Bang! in turn, them first. Whoever runs out takes the hit.',
    flavour: 'Two men, and however many bullets they were carrying.',
  },

  // ------------------------------------------------------------------- gear
  barrel: {
    id: 'barrel', name: 'Barrel', kind: KIND.GEAR, count: 2,
    rules: 'Something to stand behind. Every shot at you has a chance of finding it instead.',
    flavour: 'Half a barrel of rainwater stops more lead than most men believe.',
  },
  scope: {
    id: 'scope', name: 'Scope', kind: KIND.GEAR, count: 1, rangeBonus: 1,
    rules: 'Everything is one step nearer than it is. Your gun reaches further for it.',
    flavour: 'Brass, cracked, and taken off a surveyor who had stopped needing it.',
  },
  mustang: {
    id: 'mustang', name: 'Mustang', kind: KIND.GEAR, count: 2, distanceBonus: 1,
    rules: 'You sit one step further out than you really are. Everyone else has to come to you.',
    flavour: 'Nervy, fast, and no friend of anybody.',
  },
  jail: {
    id: 'jail', name: 'Jail', kind: KIND.CURSE, count: 3, notOn: 'sheriff',
    rules: 'Put a man in a cell. He may not get a turn at all - and the star is above this.',
    flavour: 'One key, and the man holding it has other things on his mind.',
  },
  dynamite: {
    id: 'dynamite', name: 'Dynamite', kind: KIND.GEAR, count: 1, blast: 3,
    rules: 'Lit, and it goes round the table with the turn. Sooner or later it stops somewhere for three hits.',
    flavour: 'Nobody remembers who lit it.',
  },

  // ---------------------------------------------------------------- weapons
  // The number is how many of the original's seats the gun reaches. Multiply by
  // DISTANCE_UNIT for the metres it actually covers here.
  volcanic: {
    id: 'volcanic', name: 'Volcanic', kind: KIND.WEAPON, count: 2, reach: 1, unlimited: true,
    rules: 'Close work only - but you may fire as many Bang! as you are holding.',
    flavour: 'Ten shots and no patience.',
  },
  schofield: {
    id: 'schofield', name: 'Schofield', kind: KIND.WEAPON, count: 3, reach: 2,
    rules: 'Reaches twice as far as the iron you started with.',
    flavour: 'Breaks open, empties itself, and is loaded again before he has finished falling.',
  },
  remington: {
    id: 'remington', name: 'Remington', kind: KIND.WEAPON, count: 1, reach: 3,
    rules: 'Reaches three steps out.',
    flavour: 'Heavy enough to be a poor idea in a bar fight.',
  },
  carabine: {
    id: 'carabine', name: 'Rev. Carabine', kind: KIND.WEAPON, count: 1, reach: 4,
    rules: 'Reaches four steps out.',
    flavour: 'A cavalry gun, a long way from the cavalry.',
  },
  winchester: {
    id: 'winchester', name: 'Winchester', kind: KIND.WEAPON, count: 1, reach: 5,
    rules: 'Reaches the far end of the street.',
    flavour: 'You will hear it before you have worked out where it came from.',
  },
};

/** The gun everybody is holding before they find a better one. */
export const DEFAULT_REACH = 1;

export const DUEL_CARD_ORDER = Object.keys(DUEL_CARDS);

/** Eighty cards, in the counts the original prints them in. */
export function buildDeck() {
  const out = [];
  for (const c of Object.values(DUEL_CARDS)) {
    for (let i = 0; i < c.count; i++) out.push(c.id);
  }
  return out;
}

export const DECK_SIZE = buildDeck().length;

/**
 * What the gear in front of a man adds up to, in seats. The two cards that
 * move the tape - the glass that brings everything a step nearer and the horse
 * that puts him a step further out - both declare what they do in the card
 * table above. That was written down and then never read: the sums below named
 * the two of them by hand instead, so a third card carrying `rangeBonus` would
 * have printed a rule it did not have. Ask the card.
 */
function gearBonus(player, field) {
  let n = 0;
  for (const id of (player?.gear || [])) n += DUEL_CARDS[id]?.[field] || 0;
  return n;
}

/** How many seats this gun reaches, which is what the original counts. */
export function reachSeats(player) {
  const weapon = player?.weaponCard ? DUEL_CARDS[player.weaponCard] : null;
  return (weapon?.reach ?? DEFAULT_REACH)
    + gearBonus(player, 'rangeBonus')
    + (trait(player, 'reach') || 0);
}

/** And how many further out a man counts as sitting than he really is. */
export function coverSeats(player) {
  return gearBonus(player, 'distanceBonus') + (trait(player, 'cover') || 0);
}

/** How far this player's gun reaches, in metres. */
export function reachOf(player) {
  return reachSeats(player) * DISTANCE_UNIT;
}

/** How far away this player counts as, in metres, whatever the tape says. */
export function coverOf(player) {
  return coverSeats(player) * DISTANCE_UNIT;
}

/**
 * How far `target` counts as sitting from `viewer`, which is not always how
 * far he is. The glass in front of one man brings the whole table a step
 * nearer; the horse in front of another puts him a step further out. In the
 * original this is one number - "distance" - and every range in the game is
 * measured against it, not only the guns.
 *
 * A gun's reach is measured against this. So is the arm's length that Panic!
 * reaches, which was being compared against the raw count of seats instead -
 * so the horse, whose entire job is to make people reach further, did nothing
 * against the one card in the deck that reaches across the table and takes
 * something out of your hand.
 */
export function sightSeats(viewer, target, seats) {
  return seats + coverSeats(target)
    - gearBonus(viewer, 'rangeBonus') - (trait(viewer, 'reach') || 0);
}

/**
 * Can `shooter` reach `target`?
 *
 * The card game counts seats, and so does this: `seats` is how many places
 * apart the two of them are round the table, the short way. The metres are
 * still passed because the free-for-all has no table and no seats, and there
 * the same question is asked of the ground.
 */
export function inReach(shooter, target, metres, seats = null) {
  if (seats != null && Number.isFinite(seats)) {
    return seats <= reachSeats(shooter) - coverSeats(target);
  }
  return metres <= reachOf(shooter) + 1e-9 - coverOf(target);
}
