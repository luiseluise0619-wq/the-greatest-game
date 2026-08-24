// The sixteen gunhands of the turn mode.
//
// The card game this mode is modelled on deals every player a character as well
// as a role, and the character is half of what makes a hand interesting: the
// same four cards are a different game in front of a man who draws one back
// every time he is hit than in front of a man who only needs one Missed! to
// stop you. All sixteen effects are here, exactly as they work in the original,
// because a game system is not anybody's property.
//
// The rules text is ours, and so is the decision not to give these people
// names. The card game's characters ARE the person you are playing; here you
// already are somebody - the name you typed, or one of the town's - so a second
// personal name on top of it is one name too many. The first cut of this file
// gave all sixteen names out of the same pool the bots draw from, and the very
// first round dealt a man an ability called Calla Vance and then told him he
// recognised Calla Vance. So a gunhand is a thing about you rather than a
// person: what your hands do, and one sentence on what that means.
//
// The free-for-all keeps its own six - they are abilities for a game where you
// can shoot whenever you like, and they mean nothing in a game where the whole
// question is whose go it is.

/** How the ability hooks in, which is what the server switches on. */
export const WHEN = {
  PASSIVE: 'passive',    // true all round, read where it matters
  DRAW: 'draw',          // changes the two cards at the top of your go
  HIT: 'hit',            // fires when you take one
  ACTIVE: 'active',      // you press a key for it
  EMPTY: 'empty',        // fires the moment your hand runs out
  DEATH: 'death',        // fires when somebody else goes down
};

export const GUNHANDS = {
  // ------------------------------------------------------------------ draw
  ironhide: {
    id: 'ironhide', when: WHEN.HIT, health: 4,
    ability: 'Bleeds Slow',
    desc: 'Every hit that lands on him puts another card in his hand. Shooting him arms him.',
  },
  scavenger: {
    id: 'scavenger', when: WHEN.HIT, health: 3,
    ability: 'Takes It Back',
    desc: 'Whoever puts a hit on him loses a card to him for it. Three hits is all he has.',
  },
  cutpurse: {
    id: 'cutpurse', when: WHEN.DRAW, health: 4,
    ability: 'Light Fingers',
    desc: 'The first of her two cards can come out of somebody else\'s hand instead of the pile.',
  },
  ragpicker: {
    id: 'ragpicker', when: WHEN.DRAW, health: 4,
    ability: 'Off the Floor',
    desc: 'The first of his two cards can come off the top of the discard pile, face up.',
  },
  cardsharp: {
    id: 'cardsharp', when: WHEN.DRAW, health: 4,
    ability: 'Shows the Second',
    desc: 'Turns her second card face up. If it is a red one she takes another, also face up.',
  },
  surveyor: {
    id: 'surveyor', when: WHEN.DRAW, health: 4,
    ability: 'Three for Two',
    desc: 'Sees three cards at the top of her go and keeps two. The third goes back on the pile.',
  },

  // --------------------------------------------------------------- passive
  cooper: {
    id: 'cooper', when: WHEN.PASSIVE, health: 4, barrel: true,
    ability: 'Born Behind One',
    desc: 'Stands behind a barrel he did not have to find. Every shot at him may find wood.',
  },
  drifter: {
    id: 'drifter', when: WHEN.PASSIVE, health: 3, cover: 1,
    ability: 'Never Quite There',
    desc: 'Everyone reaches one step short of her. Three hits, and nobody can take them easily.',
  },
  spotter: {
    id: 'spotter', when: WHEN.PASSIVE, health: 4, reach: 1,
    ability: 'Reads the Ground',
    desc: 'Everything is one step nearer than it is. Her gun reaches further for it.',
  },
  ambidexter: {
    id: 'ambidexter', when: WHEN.PASSIVE, health: 4, swap: true,
    ability: 'Either Hand',
    desc: 'A Bang! can be spent as a Missed! and a Missed! can be fired. Nothing in his hand is dead.',
  },
  butcher: {
    id: 'butcher', when: WHEN.PASSIVE, health: 4, needsTwo: true,
    ability: 'Puts Two In',
    desc: 'It takes two Missed! to get out of the way of his. One is not enough.',
  },
  emptyhand: {
    id: 'emptyhand', when: WHEN.EMPTY, health: 4,
    ability: 'Never Empty',
    desc: 'The moment her hand runs out she draws another card. She is never holding nothing.',
  },
  quickdraw: {
    id: 'quickdraw', when: WHEN.PASSIVE, health: 4, unlimited: true,
    ability: 'As Many As He Has',
    desc: 'No limit of one shot a turn. He fires every Bang! he is holding, if he wants to.',
  },
  fortunate: {
    id: 'fortunate', when: WHEN.PASSIVE, health: 4, lucky: true,
    ability: 'Twice the Odds',
    desc: 'Every time the game asks him to draw for something, it asks twice and he picks.',
  },

  // ---------------------------------------------------- active, and vulture
  fieldsurgeon: {
    id: 'fieldsurgeon', when: WHEN.ACTIVE, health: 4,
    ability: 'Two for One',
    desc: 'Throws two cards away to take a hit back. Any two, any time on his own go.',
  },
  undertaker: {
    id: 'undertaker', when: WHEN.DEATH, health: 4,
    ability: 'Goes Through Pockets',
    desc: 'Everything in a dead man\'s hands ends up in his. Every body in town pays him.',
  },
};

export const GUNHAND_ORDER = Object.keys(GUNHANDS);

/** The health a gunhand starts on, before the star adds its one. */
export function healthOf(id, fallback) {
  return GUNHANDS[id]?.health ?? fallback;
}

/** Does this gunhand do the thing named? Reads the table, never a name. */
export function trait(player, name) {
  const g = player?.gunhand ? GUNHANDS[player.gunhand] : null;
  return g ? g[name] : undefined;
}
