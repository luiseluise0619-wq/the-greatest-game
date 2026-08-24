# HIGH NOON HOLLOW

[![tests](https://github.com/luiseluise0619-wq/the-greatest-game/actions/workflows/test.yml/badge.svg)](https://github.com/luiseluise0619-wq/the-greatest-game/actions/workflows/test.yml)

A playable prototype of a **Wild West hidden-role FPS**: a table of 4 through 8
gunhands (six by default), one small desert town, secret factions, and a round
that is won by working out who is who — not by having the fastest trigger finger.

Inspired by the *shape* of Western hidden-role board games (a hidden sheriff, a
gang hunting them, a renegade playing everyone). All characters, names, abilities,
art, text and rules here are original to this project; no artwork, card designs,
character names or assets from any existing game are used or reproduced.

```
npm install
npm start          # then open http://localhost:8080
```

No build step, no engine install, no art assets to download. The server is Node +
`ws`; the client is three.js loaded straight out of `node_modules`. Every texture,
model and sound in the game is generated procedurally at runtime.

Want to see a whole round quickly? `HNH_FAST=1 npm start` runs ~2 minute rounds.

```
npm test               # 181 checks: map, collision, match rules, information rules, cards, anti-cheat
npm run test:browser   # optional: real Chromium, needs playwright installed
npm run balance        # 40 headless bot rounds, and the numbers worth arguing about
```

## Playing with other people

Opening the page drops you into a **public town** with a four-letter code. Share
the URL — it carries the code as `#ABCD` — and whoever opens it lands in your
lobby. **NEW** opens a private town only the code can reach, **JOIN** takes you
to somebody else's, and quick play always fills the busiest waiting lobby rather
than scattering four people across four empty towns.

A public town also **deals itself in**: the moment a second person turns up the
button starts counting down and the round begins on its own, so nobody has to
work out that somebody has to press it. A private room never does — you made it
to wait for the people you invited.

Bots fill whatever seats are left, so a round works with one human or eight.

To put it in front of people who are not on your network, see **[DEPLOY.md](DEPLOY.md)**
— one container, one command, and `GET /healthz` reports live room and player
counts.

---

## The round

The topbar carries the one number the whole genre turns on: **how many are still
standing**, updated every tick, flashing when it drops.

| Phase | Length | What happens |
|---|---|---|
| Lobby | — | Pick a character, set the table size, deal |
| Preparation | 45s | Roles and two cards dealt, guns holstered, everybody loots and sizes each other up |
| The Round | 11 min | Live fire. Factions try to complete their objective |
| Dust Storm | 90s | A storm closes on the town square and forces the last fight |
| Aftermath | 22s | Every role revealed. **RIDE AGAIN** deals the moment everyone has pressed it; otherwise back to the lobby |

### Factions

| Role | Faction | Wins by |
|---|---|---|
| **Sheriff** (1) | The Law | Every Outlaw and the Renegade dead |
| **Deputies** (1–3) | The Law | Same — and the Sheriff still breathing |
| **Outlaws** (2–4) | The Gang | Killing the Sheriff. Nothing else counts |
| **Renegade** (1) | Nobody | Being the last soul standing |

The Sheriff dying ends the round immediately — the gang wins, unless the Renegade
is the only one left, in which case the Renegade takes it.

---

## The turn mode

There are two games in this repository. **The turn mode is the one a town plays
by default**; the free-for-all everything above describes is still here and still
tested, and `HNH_MODE=free npm start` runs it.

The turn mode is the card game this project has always been shaped like, played
from inside a first-person town. A card game rations who may act by going round
a table. There is no table in a first-person game and eight people are moving at
once, so what gets rationed is **the trigger**, not the feet — and a round
alternates between everybody walking at once and nobody walking at all.

Everything in the manual is on screen too: **HOW THIS IS PLAYED** in the lobby,
**F1** once the round has started, in English or Korean.

### A lap

| | Length | What happens |
|---|---|---|
| **The walk** | 15s | Nobody can shoot. Everybody picks their ground. The chamber is loaded and announced |
| **A go** | 6s each | One man at a time, in an order the whole town was shown. Nobody walks — you can still look about |

### What it takes to fire

Three things at once, and every one of them is a decision somebody else can see:

- **It has to be your go.** One gun is live at a time. A shot fired out of turn
  does nothing at all and does not even cost ammunition.
- **You have to be holding a `Bang!`** — one a turn, spent whether or not it
  hits. Ammunition is cards.
- **He has to be inside what your gun reaches**, and that is the card lying in
  front of you rather than the sights. The belt gun everyone starts with reaches
  22 metres; a Winchester reaches five times that.

Then the barrel has to **stay on him for most of a second** before it will go
off. That is the draw, and it is the only warning he gets — which is what makes
the card in his hand a decision rather than a deduction. It only saves him if he
saw it coming and pressed **Space**, and it spends a `Missed!` out of his hand to
do it. Nobody spends it for him. It is the only move anybody makes on somebody
else's go.

### The chamber

There is **one chamber for the whole town**. It is loaded at the start of every
lap and announced in the open — so many live, so many blank, never the order —
and **every shot anybody fires draws the next round**. Six people spend the lap
counting the same six rounds. A blank is smoke and noise and it still costs the
card.

On your own go you may put the barrel against your own head with **Q**. A blank
buys you another go on the spot. A live round costs you a hit and **carries on
out of your back** into whoever chose to stand in line behind you. Which is why
where everybody stood during the walk is worth looking at.

### The eighty

The deck is `shared/deck.js`: eighty cards in the same proportions the game this
is modelled on prints them in — twenty-five `Bang!`, twelve `Missed!`, six
`Beer`, one `Gatling`, and so on down to the single `Dynamite`. Your hand is the
size of your health and you draw two at the start of every go, so **the closer
you are to dying the less you can do about it**. Play one with the number key
printed on it; the ones that need somebody in mind take whoever is in your
crosshair.

Every effect is the original's, because a game system is not anybody's property.
Not one sentence of the rules text is: everything on those cards was written for
this project, and all twenty-two faces are cut in `client/js/duelart.js` and
printed at runtime on the same press as the other six — same paper, same picture
window, same two-colour drift, same trimmed corners. No image file has ever been
in this repository. `/proof/?deck=duel` prints the sheet while the server is
running, which is how the blocks were cut.

Distances are the one thing that had to be reinvented rather than copied. The
original seats everybody round a table and counts chairs; here there are no
chairs, so a "distance" is 22 metres of actual ground, and whether you are inside
it is decided by where you chose to stand during the walk.

---

## The information rules

This is the part that makes it a deduction game rather than a deathmatch. All of
it is enforced server-side; a client is never sent information it has not earned.

**Nobody starts knowing anybody.** Not even teammates. Instead everyone gets one
thread to pull:

- **Deputy** — *"The Sheriff is one of these two: A or B."*
- **Outlaw** — the name of exactly **one** accomplice (there may be three).
- **Renegade** — the name of one player who wears *a* badge — Sheriff or Deputy,
  and you are not told which.
- **Sheriff** — nothing at all. The star is lonely.

**Kills only name the killer if somebody watched it happen.** When you die, the
server checks who had genuine line of sight to the shooter, inside their view cone
and within 55m. Those players — and the victim — see *"Dutch Kessler killed Mae
Rowan."* Everyone else sees *"A shot in the Saloon. Mae Rowan is dead — the
Deputy. Nobody saw who."*

**The dead reveal their role.** Every body is evidence. Three Outlaw corpses and a
dead Deputy tells the whole town where it stands — and killing the wrong person
tells everyone what you are not.

**Bodies stay where they fell**, so a corpse in the mine means something happened
in the mine.

**Nothing physical is announced with a name on it unless somebody watched it.**
Shots, footsteps, abilities and pickups all follow the same rule: the world tells
you what happened and where — the coach gun is gone from the store, somebody just
used something, boots in the alley — and attaches a name only for the people who
had eyes on it. The Gambler's boon is more private still: which card they drew
never leaves them until it does something you can see.

**You are only told about players you can actually see.** The server runs a
line-of-sight check per viewer per tick and simply does not send the positions of
anyone behind a wall — with a short memory so corner-peeking does not strobe, and
a proximity floor so somebody pressed against you is never invisible. A gunshot
from an unseen shooter arrives with its tracer and its noise but **no name
attached**. Without this the entire information design would be decoration: any
modified client could read every position out of the network tab.

**You can hear boots.** Everyone within earshot gets a step sound with a place
and a gait attached and **no name on it** — the same deal as a gunshot. The
position carries a little slop, so it is a direction rather than a pin. Running
carries about 30m, walking 22m, and crouching drops it to 9m, which is the
counterplay. The Lookout's boots carry barely half as far as anybody's, which is
that character's whole passive.

**Leaving is not free, and a refresh is not leaving.** Disconnect mid-round and
your body stays standing in the street — silent, unmoving and every bit as
shootable as it was. Come back in the same tab within 25 seconds and it is yours
again, with your role, your hand, your health and your position intact. Nobody
comes back for it and it falls over where it stands, because a player who simply
vanished would take the round's evidence with them.

A dropped socket **reconnects on its own**, backing off across that window, and
lands you back in your own boots without putting the role card in front of you
mid-fight — and without forgetting the bodies you had already identified.

**The dead talk only to the dead.** Dying does not turn you into a spotter for
whoever is still alive.

**When somebody kills you, you see how they did it.** A four-second killcam
replays the last moments from behind the shooter. It carries *only* the killer's
and your own tracks — replaying what the killer could see would leak every
bystander they walked past, which is exactly what the visibility cull exists to
prevent. You already learn who shot you; the killcam only makes it legible.

**Every round ends with its own account.** The results screen lists what happened
and when — each death with both roles, every star pinned on, every accusation,
and every card that was played — next to the table of who everyone really was.
Cards and stars are never trimmed out of it however busy the round got: they are
the payoff for a whole round of not being able to see them.

**The Sheriff may pin on the star** (`B`). It is public and permanent: +45 max
health and 15% damage resistance, but every Outlaw in town now has a name and a
face. Going loud is usually the Sheriff's strongest and most dangerous play.

**Sprint is five seconds long.** It drains at one second per second and comes
back at 0.9, and you need 1.2s of it banked before you can start running again —
so a long chase is about a fifth walking, and you cannot cross town without
arriving winded. The same budget is shared by the client's own
integration, the bots, and the server validating your movement — one rule, in
`stepStamina`, so no two of them can disagree about how long anybody can run.

**You can call somebody out** (`F` while looking at them). It broadcasts to
everyone, and the bots weigh it by how much they already trust you.

Other channels: all-chat (`T`) reaches the whole town; the **shout wheel** (`V`,
then a number) reaches about 38m and arrives with a voice and a direction, so you
hear somebody call out from the alley before you read what they said. And the
Tracker's footprints, which are deliberately colourless — you can see that
*somebody* walked through the alley but not who.

---

## The Deck

Two cards are dealt to you at the start of every round, face down, and nobody is
ever told what anybody else is holding. They turn over once the role card is out
of the way, and sit fanned into the bottom edge of the screen. Press `Z` or `X`
to play one — it comes up into the middle of the screen, big enough to read,
before it is flicked away.

**None of them shoot.** That is the whole design rule: shooting, healing and
blowing a hole in a wall are FPS verbs and they stay on the mouse. A card that
dealt damage would just be a worse gun. Every card in this deck bends the
*information rules* above instead — who witnessed what, whose name gets attached
to a shot, whose boots left prints, who wears the star.

| Card | What it does |
|---|---|
| **Rain Barrel** | The next bullet that finds you does nothing — and the shooter gets **no hitmarker and no damage number**. They will swear to the town that they hit you. |
| **Wanted Poster** | Nail the name of whoever is in your sights to the church door. The whole town is told *you* did it. In return you alone learn whether they wear the star. |
| **Cover Your Tracks** | Sweeps away every footprint you have left in this town and leaves none for 75s. A Tracker who reads the dust finds an empty street where you were standing. |
| **Buy a Witness** | Your next kill names nobody: no witnesses, no name in anyone's feed, no killcam — and **not even the body** finds out who did it. |
| **Dead Man's Ledger** | The next death anywhere in town, you privately learn who pulled the trigger. Beaten by Buy a Witness: an erased kill leaves nothing to read. |
| **Long Glass** | For 12s, anyone who fires a shot anywhere in town is outlined for you for three seconds. Gunfire stops being a noise and starts being a name. |

Five of the six are **completely silent** — no feed line, no animation anybody
else can see, nothing on the wire for another client to sniff. The Wanted Poster
is the exception, and its broadcast is its cost: pointing the finger in public is
supposed to hurt.

The payoff comes at sundown. The results screen names every card that was played
and by whom, which is where the round's real story usually turns up — *that* is
why nobody saw who shot you in the stable.

Implementation notes worth knowing:

- Buy a Witness resolves inside `killPlayer()` by leaving the witness set empty
  rather than by adding a second code path, so there is nothing extra that could
  leak.
- Dead Man's Ledger pays out by adding its holder to that same witness set — the
  name reaches them through the exact channel a real sighting would.
- Bots hold and play cards too, on readable motives: the one who vanished from
  the dust swept it, the one who swears they hit you was shooting at a barrel.

These six cards, their names and their effects are original to this project.
Hidden-role structure is a mechanic; a card set is expression, so this expression
is ours.

### The cards are printed, not drawn

There are no image files here either — twenty-eight card faces and not one of
them is a file. `client/js/cardart.js` is a small printing
press: it lays down rag paper (pulp blotches, fibres, foxing, a glass ring,
handled edges), engraves a wood cut for each card in the hatching vocabulary an
1880s job printer had, sets the type, and then presses the whole ink layer onto
the paper. Three details do most of the work:

- the ink is drawn on **its own layer**, eroded with a thousand tiny holes, and
  then composited with `multiply` — so the paper grain shows *through* the ink
  rather than sitting on top of it,
- a faint **mis-registered red plate** sits under the black one, the way a
  two-colour press drifts,
- every card is **seeded from its own id**, so a given card is always the same
  physical object and never shimmers between redraws.

`client/js/duelart.js` cuts the other twenty-two blocks — the turn mode's deck —
and runs them off on that same press, so the two decks are the same object: same
paper, same picture window, same drift, same trimmed corners. Nothing in either
is anybody's artwork. What is drawn is what the card *does*, worked out from
scratch: the one that makes a man throw something away is a card torn in half,
which is not a design anybody owns, it is what the words say. Six of the
twenty-two are the same gun with a different barrel on it, and are one function.

Each face is about 30ms of canvas work and is printed once, in idle time while
you are still in the lobby, then kept as a WebP data URL (~120KB, against 1.4MB
for the same face as a PNG). Open **`/proof/`** while the server is running to
see the whole sheet at full size — that page is how both decks were cut.
`/proof/?c=witness` prints a single card and `/proof/?deck=duel` prints the
eighty.

---

## Characters

Six, one active ability each. All original.

| Character | Ability | Effect |
|---|---|---|
| **Gunslinger** — Cassidy "Quickhand" Vane | Hair Trigger | Passive: double-speed weapon swaps. Active: 5s of rapid fire and near-instant reloads |
| **Sawbones** — Doc Marisol Vega | Field Dressing | Heal the player in your sights for 45 (or yourself for 30). A public, costly statement of trust |
| **Lookout** — Wren Ashcroft | Bird Call | Passive: boots that carry barely half as far as anybody's. Active: 4s where anyone *moving* within 38m glows through walls — hold still and you stay hidden |
| **Duelist** — Silas Redgrave | Called Shot | 6s of near-perfect accuracy and +20% damage |
| **Gambler** — Odette "Aces" Fontaine | Draw a Card | One random boon: speed, armour, full ammo, a damage streak, a dust cloud — or a bust |
| **Tracker** — Nahele Cross | Read the Dust | Reveals the last 12s of *everyone's* footprints for 8s |

### How the characters are built

There are no model files in this repo, so the gunhands are assembled at runtime
from capsules and surfaces of revolution — but they are properly **jointed**:
hip, knee, ankle, shoulder, elbow and neck each pivot, so limbs bend through a
walk cycle instead of swinging as rigid blocks. Coats are flared lathes that sway,
hat brims curve and lift at the rim, boots have heels and spurs.

Each character then gets its own costume, which is the identification system
rather than decoration: the Gunslinger's long duster and bandolier, the Sawbones'
bowler, apron and spectacles, the Lookout's short jacket and feathered flat cap,
the Duelist's tall-crowned hat and frock coat, the Gambler's crimson coat and
flat brim, the Tracker's wide low hat and fur collar. Build, coat length and hat
profile all differ, because the whole social layer collapses if you cannot tell
eight strangers apart at 40 metres.

Poses read at distance too: gunhands stand at **low ready** and only bring the
gun up when they are actually shooting — so someone who has raised their piece
across the street is worth noticing.

### Using your own glTF models

If you have rigged `.glb` characters, you do not need to touch any code. Drop
them in `client/models/`, name them in `client/models/characters.json`, reload.
Full schema in `client/models/README.md`.

Two levels of support, so almost any rigged model works:

- **The model carries animation clips** — name them (`idle`, `walk`, `run`,
  `aim`, `death`) and an `AnimationMixer` drives them with crossfades.
- **It has no clips but has named bones** — map the bone names and the game
  drives that skeleton with the *same pose it computes for the procedural
  gunhand*, so you get the walk cycle, crouch, low-ready and death collapse for
  free.

Per-character, per-model, and failure-tolerant: anything not listed, or that
fails to load, silently keeps the procedural gunhand, so you can convert one
character at a time. Optional `gunBone` / `starBone` attach the revolver and the
Sheriff's star to your rig.

Whatever rig you use, the game keeps ownership of everything that carries
information — name tags, the Sheriff's star, the Lookout's reveal outline, the
dust-cloud fade — so a custom model can never quietly break the deduction
layer.

---

## Guns

Three, plus dynamite. Limited ammo, real reloads, hit reactions, no modern gear.

| | Damage | Mag | Reload | Best at |
|---|---|---|---|---|
| **Peacemaker Revolver** | 32 (×2 head) | 6 | 2.1s | Everything, badly |
| **Coach Gun** | 9 × 12 pellets | 2 | 2.5s | Doorways and saloons |
| **Lever Rifle** | 58 (×2 head) | 5 | 2.9s | Main Street and rooftops, aimed (RMB) |
| **Dynamite** | 115 centre, 6.2m | — | — | Flushing out cover |

Everybody spawns with a revolver. Everything else is found in the world and drops
when you die. **You cannot fire while sprinting**, which is the movement cost that
keeps sprinting from being free — and the trigger stays locked while a gun is
coming up after a swap, on the client as well as the server, so the two never
disagree about whether a shot happened.

Every one of them is worked by hand — a hammer thumbed back, a lever thrown, a
breech broken open — so **the trigger is not a button you hold down**: one press
is one shot, however long you lean on it. The single exception is the five
seconds of the Gunslinger's Hair Trigger, which is most of what that ability is.

---

## The map — Perdition Flats

One compact town: **saloon** (two rooms, bar, balcony over the street),
**sheriff's office** (jail cells you can be seen through but not shot through),
**general store** (deep aisles, best loot, worst exits), **stable**, **church**
(walkable roof and steeple), **cemetery** (low cover, long lines),
**mine** (dark tunnel with two mouths — the ambush spot), **main street**,
**back alleys**, **rooftops** linked by plank bridges, a **water tower** perch and
**desert outskirts**.

Every rooftop is reachable on foot. Rooftops give sightlines down Main Street and
cost you every escape route — and bots do not path onto them, so they are a human
advantage worth taking.

The map is a single shared module (`shared/map.js`) of axis-aligned boxes, used by
the client for rendering *and* collision and by the server for collision, line of
sight, witness checks and bot navigation. One source of truth, no drift.

---

## Bots

If you do not have eight friends, the empty seats fill with bots. They are not
built to be good shots — they are built to be *legible*, to look like people with
agendas:

- Each keeps a **suspicion table** and a **trust table**, moved by being shot at,
  by witnessing kills, by accusations weighed by the accuser's credibility, and by
  seeing somebody get healed (the loudest tell in the game).
- **They do not shoot strangers on sight.** A stranger scores well under the
  draw-your-gun threshold; violence has to be *caused*. This one constant is the
  difference between a deduction game and a deathmatch.
- **Outlaws take initiative**: with a deadline and no information, one periodically
  decides a particular stranger smells like the law and leans on them — weighted by
  who has been healed, defended, or seen loitering in the sheriff's office. That is
  where most rounds' first shot comes from, and it is often wrong.
- **Deputies shadow** whoever they believe wears the star and answer anyone who
  goes for them. **Sheriff bots** sometimes pin on the badge and go loud.
  **Renegade bots** are the least trigger-happy men in town — every fight they
  are not in is one they do not have to win — and they will not go near whoever
  they think wears the star until the crowd has thinned, because keeping the
  round alive is the whole of their plan.
- **They have ears.** Boots carry to a bot on the same ranges they carry to a
  player, so crouching past one is worth something — and a bot treats a footstep
  as a rough area to wander towards rather than a name to walk at, which is what
  separates it from a gunshot.
- They **break off losing fights**, fire in bursts with real reaction times and
  aim error that decays as they track you, take a beat after a kill, accuse people,
  chat, and get things wrong. Skill, paranoia, aggression and chattiness are rolled
  per bot so a lobby does not feel like one machine.

---

## Settings

Every key that can do nothing says why. Pressing `Q` on cooldown, `G` with no
dynamite, `2` with no coach gun on your hip, `B` when the star is not yours, or
the trigger at a dead run all put one line in the feed naming the rule, rather
than a beep that reads as a dropped keypress. None of it goes on the wire and
none of it says anything about anybody else.

`Esc` (or **SETTINGS** in the lobby) opens mouse sensitivity, invert-Y, field of
view, volume, mute and a frame-rate readout. It is kept in `localStorage` and
nothing goes on the wire — the server has no opinion about anybody's
sensitivity. Every read and write is guarded, so a private window or a browser
with site data blocked falls back to the defaults instead of failing to start.

One preference is not in that panel, because the browser already knows it. If
the machine is set to **reduce motion**, the gun stops bobbing, the view stops
kicking when you fire, and everything that animates for effect rather than to
say something stops animating. Somebody who has told their operating system
that moving pictures make them ill has said it once already. The field of view
slider is the other half of that: it goes down to 65 for anybody who finds a
wide one uncomfortable.

---

## Language

The whole game is in **English and Korean**, switched in the settings panel, and
a browser that asks for Korean gets Korean without being asked twice.

It is an **overlay rather than a second copy**. There is only ever one English
copy of any string — the one in the HTML, the one in `constants.js`, or the
sentence the server actually composed — and `shared/i18n.js` is keyed to it. So
there is no pair of English strings anywhere that can drift apart, and an
untranslated key falls through to the English it was handed rather than to a
hole. `npm test` fails on a key the page asks for that nobody translated, and on
a translation for a key that no longer exists.

Sentences the **server** composes travel as three things: the English line, the
key, and the holes as data. Korean puts the verb at the end and the preposition
on the back of the noun, so it cannot reuse English word order — "a shot in the
Saloon" is "살룬에서 총성 한 발", and the place, the count and the card name have
to be free to move. Two things fall out of that:

- **Places are ids on the wire, not prose.** `zoneAt` still returns "just outside
  the Church" because that is what a place is called and what the playtest log
  wants; `placeParts` takes it back apart so another language can put it
  together its own way.
- **Korean picks half its particles on the word in front of them** — 이 or 가, 은
  or 는, 을 or 를 — so a sentence with somebody's name in it does not know its own
  grammar until the name arrives. For Hangul that is arithmetic and `{card:을/를}`
  does it. For a Latin name it is not answerable: Vane is 베인 and closes,
  Kessler is 케슬러 and does not, and they end in the same two letters. So no
  player's name is ever standing in front of a particle — the Korean is written
  round the problem rather than into it.

What is deliberately **not** translated: the characters' personal names, and the
printed card faces, which are 1880s letterpress and are the same object in any
language.

---

## Controls

| | |
|---|---|
| `WASD` move · `Shift` sprint (5s of it) · `Ctrl` crouch · `Space` jump | `LMB` fire — one press, one shot · `RMB` aim (rifle) · `R` reload |
| `1` `2` `3` weapons · `G` dynamite · `E` pick up | `Q` ability · `F` call somebody out · `B` pin on the star |
| `T` chat · `V` shout wheel · `Tab` the table | `Z` `X` play a card · `H` peek at your role |
| `Esc` frees the mouse; press it again for settings | |

---

## Architecture

```
shared/     constants.js  all tuning in one place, imported by both sides
            map.js        the town: boxes, spawns, loot, zones, nav nodes
            collision.js  AABB movement + raycasting used by client and server
            protocol.js   message names
server/     index.js      static files + websockets
            room.js       match state machine, authoritative combat, information rules
            bots.js       perception, suspicion, faction goals, navigation
            ratelimit.js  per-socket token bucket, so one client cannot flood
client/     js/main.js    networking, local movement, input, render loop
            js/world.js   builds the town in three.js, procedural textures
            js/players.js remote avatars, interpolation, silhouettes
            js/viewmodel.js  first-person guns and their animations
            js/effects.js tracers, impacts, dynamite, footprints, pickups
            js/audio.js   every sound synthesised in WebAudio, no files
            js/hud.js     HUD, feed, role card, your hand, scoreboard, results
            js/cardart.js the printing press: every card face drawn onto a canvas
            js/duelart.js the blocks for the eighty, run off on the same press
            js/settings.js local preferences, guarded against blocked storage
            proof/        /proof/ - either deck at full size, for cutting blocks
tools/      balance.mjs   headless bot rounds -> win split, pace, crossfire share
```

**Authority split.** Movement is simulated on the client and speed-clamped by the
server, which keeps aiming crisp over a real network. Everything that decides the
round — hit resolution, damage, deaths, roles, and *who is told what* — is resolved
on the server and never trusted to a client.

Bots run inside the server and go through the exact same `onShoot` / `onSwap` /
`onPickup` / `onCard` entry points as human players, so there is one combat
implementation, one rule set for the deck, and bots cannot do anything a player
could not.

---

## Watching a playtest

The server keeps score of the thing that actually matters. `GET /stats` returns
live aggregates, and every event is appended to `data/telemetry.jsonl`:

```
curl -s localhost:8080/stats | jq
```

The headline number is **`witnessedKillShare`** — the share of kills a third
party actually saw. Near 1 and the town has no secrets; near 0 and nobody can
ever learn anything and the round decays into a shooting gallery. Next to it sit
accusations, chat volume, badge reveals and ability use per match, the faction
win split, average human session length, and which parts of the map people
actually die in.

Next to it sit the deck numbers — `cardsPerMatch`, `cardPlayRate` (played over
dealt) and a per-card count. A card nobody ever plays is either too weak or too
hard to find a moment for, and this is the only way to tell those two apart from
outside the game.

No chat text is ever written, and player names are omitted unless you set
`HNH_TELEMETRY_NAMES=1`. Turn the whole thing off with `HNH_TELEMETRY=0`.

## Tests

`npm test` runs 181 checks on plain Node, no browser and no extra dependencies.
They are grouped by what they protect:

- **`test/world.test.js`** — the map is well formed, nobody spawns inside rock,
  no loot is buried in furniture, walls stop movement and doorways do not, the
  nav graph is one connected town with no orphan nodes, weapons are internally
  consistent, every role table adds up, the sprint budget always recovers, the
  swap lockout is one rule rather than two, every place the brief asked the town
  to have exists, can be stood in and reports its own name in a sentence that
  reads (you are *in* the Saloon, *on* Main Street and *at* the water tower, and
  the feed used to announce that somebody had died *in just outside* the
  Church), and nothing in
  `shared/` reaches for Node — the browser imports those four files directly, so
  one `process.env` in there breaks the whole game rather than one test.
- **`test/match.test.js`** — roles are dealt correctly, guns are inert during
  preparation, each faction's win condition fires (including at the bell, for a
  Sheriff who walked out during prep), the dust storm hurts outside the ring and
  not inside it, and the information rules hold: an unwitnessed kill names
  nobody, the victim always learns their killer, a death replay carries only two
  people, the dead cannot talk to the living, a whole round runs to an end at
  every table size the lobby allows without anybody spawning on top of anybody,
  riding again waits for the room rather than one player, and a refresh reclaims
  the same body — including when the reload's new socket beats the old one's close, which
  is what actually happens about half the time.
- **`test/cards.test.js`** — the deck, and the footstep channel it sits next to:
  a step is heard nearby, never carries a name, lands a little off where the
  walker really is, does not carry across town, dies when they crouch, and comes
  at the pace of a gait rather than of the tick rate. Plus the Tracker's dust:
  the trail goes to the Tracker alone, carries a place and a group and never a
  name, and the groups are reshuffled every round so nobody learns somebody's
  trail once and reads it all evening. The rest is assertions about *absent*
  information — a Rain Barrel that must swallow the shooter's hitmarker as well as
  the bullet, a bought kill that reaches neither the town, the victim nor the
  killcam, a ledger that stays armed because there was nothing to read, a Wanted
  Poster whose answer never leaves the player who nailed it up, and a Long Glass
  mark that punches through the visibility cull and then fades. Plus a guard rail
  on the design rule itself: no card description may mention damage or healing,
  and every card in the deck must have a block cut for it in the press (add one
  without art and the suite says so instead of the game shipping a blank face).
  Bots are held to the same rules: one check confirms a bot holding the Long
  Glass really does get a name off a shot fired across town, and gets nothing
  from the same shot once the glass runs out.
- **`test/render.test.js`** — the handful of rendering decisions that are really
  game rules in a costume: how far a name tag is readable from, and that the
  Gambler's dust cloud takes the name with it rather than leaving a legible
  label floating over a body you cannot see. Plus a check that every material
  the map is built out of is one the town knows how to draw — the renderer falls
  back to plain wood for an unknown tag, silently, so a missing look would not
  show up until somebody noticed the church was made of planks. Plus a check
  that nothing the HUD writes over the world - the phase, the head count, the
  killcam's caption - is left as pale letters on a pale wall with neither a
  shadow under it nor something opaque behind it.
- **`test/rooms.test.js`** — how a socket finds a town, which is the first
  thing that happens to every player who ever arrives: codes that can be read
  aloud without being misheard and never collide, quick play filling the busiest
  lobby instead of scattering four people across four empty towns, preferring a
  lobby to a fight already in progress, private towns that quick play cannot
  walk into, refusals that name the code that failed, empty towns reaped only
  after their grace, and one broken town not taking the rest of the server down
  with it.
- **`test/telemetry.test.js`** — the playtest log, which has one justification
  and one risk. It answers what it exists to answer (roles, factions, places,
  witness counts, and a headline share that is actually between 0 and 1), and it
  never becomes a record of who played and what they said: not one word of chat
  reaches the file, and no name does either unless somebody asked for names.
- **`test/readme.test.js`** — this file is load-bearing: it is where the design
  rules are argued for, and people read it instead of the constants. It had
  already drifted four separate times, so the numbers it quotes are pinned to the
  constants they came from, every card, character and role has to be written up,
  and the two places that quote a test count have to agree with each other.
- **`test/settings.test.js`** — everything the settings panel stores comes back
  out of `localStorage`, which anybody can edit by hand, so the part that decides
  what a stored value is *allowed* to be is pure and tested: no value can push a
  slider past its own limits, garbage in one field does not take the others with
  it, and every default is reachable with its own control.
- **`test/security.test.js`** — what a lying client cannot do: teleport, walk
  through a wall, end up inside geometry, buy speed by flooding input packets,
  sprint past the end of its own tank, learn who used an ability or picked
  something up across town, hear a shout from the far side of the map,
  be told about players it cannot see, or learn the name of a shooter it could
  not have seen. One check runs the other way and makes sure an honest sprint at
  30Hz is never clamped.
- **`test/ratelimit.test.js`** — the socket token bucket: a burst gets through,
  a flood does not, an idle socket cannot save up more than one burst, and a
  stream at exactly the limit is never refused.
- **`test/duel.test.js`** — the turn mode, which is three rules wearing a lot of
  scaffolding: one gun is live at a time and the town can see whose, feet are
  nailed down while it is, and a landed shot is worth a hit whatever fired it.
  All three are checked from the server's side, including a shot fired out of
  turn doing nothing and not even costing ammunition, a corpse being passed
  over rather than waited six seconds for, and the free-for-all still being the
  free-for-all when a room asks for it.
- **`test/roulette.test.js`** — the chamber, the draw and the barrel turned
  round: that the chamber is the town's rather than yours and is loaded in the
  open so everybody spends the lap counting the same rounds, that a gun will
  not fire until it has been steady long enough for the man on the other end
  to have seen it, that the card in his hand only saves him if he saw it and
  moved, and that pointing it at your own head buys another go on a click and
  costs two men a hit on a live round — you, and whoever chose to stand in the
  line behind you. Two of these were passing against a game that was not
  applying them: nothing that comes out of a gun says "shot" — it says
  "revolver" — so the chamber, the range, the barrel and the card in his hand
  applied to the tests and to nothing else; and a coach gun's nine pellets took
  nine hits off one man for the single Bang! that paid for them.
- **`test/deck.test.js`** — the eighty cards: that the deck is printed in the
  right proportions, that a hand is dealt the size of your health and shrinks
  with it, that ammunition is cards and one of them is a turn, that a gun
  reaches exactly as far as the card in front of you says and a scope and a
  horse move that line in opposite directions, that a shot can be answered by
  the card you were holding for it, and every effect on the rest of the deck -
  including the beer that will not pour once there are two men left and the
  cell that the man wearing the star is above.
- **`test/botduel.test.js`** — the five men at the table who are not people.
  Five of every six gunhands is a bot, so whether the turn mode is a game or a
  screensaver is a question of what they do with a go: that their feet obey the
  same rule everybody else's do rather than walking circles round a town
  standing at its marks, that they play the eighty rather than sitting on them,
  that they level the gun and hold it long enough for the man on the other end
  to have seen it coming, and that when it is pointed at them they take that
  warning often enough to be worth giving — but not so often that they cannot
  be shot.
- **`test/feedlines.test.js`** — every line the town says, said in Korean. The
  strings are checked next door: that they exist, that nothing is orphaned, that
  no Korean entry is secretly English. What that cannot catch is a sentence
  whose holes do not match the holes the server filled — the key says `{a}` and
  the server sent `{name}`, so a Korean player reads the word "{a}". So this
  plays a whole round of each mode, catches every keyed line on its way out, and
  says all of them in both languages; then it reaches by hand for the dozen a
  round of bots never gets to, which is most of the refusals. It found two on
  the way in.
- **`test/i18n.test.js`** — the Korean overlay. There is only ever one English
  copy of any string — the one in the HTML, in `constants.js`, or in the
  sentence the server built — and Korean is keyed to it, so two English copies
  cannot drift apart. What can happen instead is a key the page asks for that
  nobody translated, or a translation for a key that no longer exists, and both
  of those fail here — the client and the server both name keys, so a key either
  of them stopped sending is exactly as dead as the other's. Plus: an
  untranslated key falls through to the English it was handed rather than to a
  hole, a Korean browser gets Korean without being asked, no Korean entry is
  secretly still in English, and a name in a Korean sentence takes the particle
  that name takes — which for Hangul is arithmetic and for a Latin name is not
  answerable at all, so the strings are written round it rather than into it.
- **`test/fuzz.test.js`** — every shape of message a socket can send that a real
  client never would: numbers where objects go, `NaN` and `Infinity` where
  coordinates go, five-thousand-character strings, `__proto__` as a card name.
  None of it may throw — the process would survive, but a message that throws
  halfway through a kill leaves the round in a state nobody designed — and none
  of it may leave a player somewhere that is not a place or holding something
  that is not a card. The room then runs another twenty seconds to prove it. A
  socket that never joined can do nothing at all, and one that joins twenty
  times collects one body.
- **`test/http.test.js`** — the front door, and the only test that asks the real
  server for anything. There is no build step, so a module served with the wrong
  content type is a black screen rather than a warning; and the handler that
  serves `client/index.html` is the one that must refuse `server/room.js`, which
  sits on the same disk and holds every answer the game is about. That refusal,
  six ways of climbing out of the served directories, the proof sheet answering
  at the address this file gives for it, and the two readouts DEPLOY.md tells
  people to curl.

Both suites run in CI on every push (`.github/workflows/test.yml`) across Node
18, 20 and 22, with the browser check on its own runner and the screenshots kept
as artifacts. A third job prints the bot balance and is allowed to fail — it is
there to be read when a bot change lands, not to gate anything, because win
shares under fifty rounds say whatever they like.

`npm run test:browser` drives a real Chromium through a whole round with two
players — lobby, room codes, the manual, both decks printed face up, the role card,
the hand dealt and a card played, and on to the aftermath screen where the
round's cards are finally named — seventy-two checks, watching for console errors and
server noise the whole way.
It also measures the HUD rather than trusting it: nothing may run off the edge
of the window, no word may be written over the town without a shadow under it
or something opaque behind it, and no two tiles of the shout wheel may sit on
each other. It finishes in a second browser with WebGL switched off, because a
machine that cannot draw the town has to be told so rather than left on a
loading screen. It needs `playwright` installed and skips cleanly if it is not
there.

They found real bugs while being written, which is the point: a spawn buried in
the mine hillside, a porch post planted dead-centre in the saloon's front
doorway, six loot items rendered inside the furniture they sat on, six nav nodes
no bot could ever reach — and a cemetery fenced on all four sides with no gate,
which no player could enter at all.

## Design target

The brief was 40% gunplay / 30% deduction / 20% abilities / 10% luck, and the
tuning follows it: time-to-kill is short enough that aim matters, but the round is
won by information. The knobs that control that balance, if you want to move it:

- `HOSTILITY_THRESHOLD` in `server/bots.js` — how much evidence a bot needs before
  it draws. **Lower it and the prototype becomes a deathmatch.**
- `SOCIAL.witnessRange` / `witnessFov` in `shared/constants.js` — how much the kill
  feed gives away.
- `ROLE_TABLE` — faction counts per table size.
- `TIMING` — phase lengths, including the public-lobby auto-start countdown
  (or the `HNH_*` env overrides: `HNH_PREP`, `HNH_COMBAT`, `HNH_ENDGAME`,
  `HNH_RESULTS`, `HNH_LOBBYCOUNTDOWN`).

Balance over **120 headless bot-only rounds** (`npm run balance -- 120`) sits at:

| | Outlaws | The Law | Renegade |
|---|---|---|---|
| win share | **59%** | 34% | 7% |

with 98% of rounds resolving on a kill rather than running out on the storm, and
those averaging about **five minutes**. The Sheriff dies in about two rounds in
three, and a little over half of the players who killed one had actually picked
them out first — the rest is crossfire, which is the number to watch: if it goes
much higher the round is being decided by chaos rather than by anybody working
anything out.

Three things about those numbers, all learned by getting them wrong first:

- **Round length is bimodal**, not short. A round either resolves in a couple of
  minutes or nobody finds anybody and the dust storm decides it. Quoting a median
  is meaningless — it flips between the two clusters depending on which side of
  half the sample lands. The share that resolve is the stable statistic.
- **Anything under about fifty rounds is noise.** Twenty rounds produced outlaw
  win shares from 45% to 80% at *identical* settings while this was being
  measured. Two separate runs of sixty gave 52% and 63%.
- **These are bots playing bots.** They find each other faster than people do and
  they never lie to each other, so the split above is a regression check on the
  simulation, not a claim about the game. The outlaw lean is real and it is the
  first thing worth attacking with human data — deliberately *not* tuned against
  bot data, because tuning a game to beat its own robots is how a game ends up
  only fun for robots.

Two bot knobs are overridable so a real playtest can sweep them:
`HNH_HOSTILITY` (the draw-your-gun line, default 1.25) and `HNH_BADGE_ODDS` (how
often a Sheriff bot pins the star on at all, default 0.6). Sweeping the second
one is instructive: at 0.95 the Sheriff dies *sooner* and the Law wins *less*,
which is the star doing exactly what it is supposed to do.

---

## Known limitations

Prototype, deliberately scoped to a vertical slice:

- **One map**, three guns, six characters, six cards, one game mode.
- **Movement is client-simulated and server-validated.** The client integrates
  its own movement for a crisp feel; the server treats the position it reports as
  a *target* and walks it through the real geometry, so no client gets through a
  wall, off the map, or across town in one packet. The jitter slack in that clamp
  is a budget that refills over time rather than an allowance per packet, so
  flooding inputs buys nothing — that one was a real hole, and it is tested from
  both sides. What is *not* solved is the fine grain: a modified client can still
  shade its speed inside the clamp, or aim more precisely than a hand can.
  Closing that needs full input-replay reconciliation, which is a rewrite of the
  movement path and worth doing only once the game has proven it deserves it.
- **Bots do not use rooftops or the water tower**, and they only notice anybody
  inside 72m (`VISION.botSight`) where a player can see across the whole town.
  Both are deliberate: verticality and the long lines down Main Street are what
  a human has over them, and a test keeps that gap from closing by accident.
- **No voice chat.** Text chat and the shout wheel stand in for it — the wheel
  has a range and a voice, but the words are still canned.
- Match length with bots only runs shorter than the 10–15 minute target because
  bots find each other faster than people do; the phase timers support the full
  length and human rounds fill it. Round length is bimodal rather than short —
  see **Design target**.
- **Desktop only.** Pointer lock and a keyboard; there is no touch control
  scheme and no attempt at one. The overlays do fit and scroll in a short
  window — the browser suite runs at 800x480 in CI, which is how that got
  found.
- **One process, all rooms in memory.** Restarting the server ends every round
  in progress, and it does not scale past one machine. See
  **[DEPLOY.md](DEPLOY.md)** — this is the caveat that will bite you.
