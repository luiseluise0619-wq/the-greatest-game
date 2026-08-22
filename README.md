# HIGH NOON HOLLOW

A playable prototype of a **Wild West hidden-role FPS**: 6–8 gunhands, one small
desert town, secret factions, and a round that is won by working out who is who —
not by having the fastest trigger finger.

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
npm test               # 63 checks: map, collision, match rules, information rules, cards, anti-cheat
npm run test:browser   # optional: real Chromium, needs playwright installed
```

## Playing with other people

Opening the page drops you into a **public town** with a four-letter code. Share
the URL — it carries the code as `#ABCD` — and whoever opens it lands in your
lobby. **NEW** opens a private town only the code can reach, **JOIN** takes you
to somebody else's, and quick play always fills the busiest waiting lobby rather
than scattering four people across four empty towns.

Bots fill whatever seats are left, so a round works with one human or eight.

To put it in front of people who are not on your network, see **[DEPLOY.md](DEPLOY.md)**
— one container, one command, and `GET /healthz` reports live room and player
counts.

---

## The round

| Phase | Length | What happens |
|---|---|---|
| Lobby | — | Pick a character, set the table size, deal |
| Preparation | 45s | Roles and two cards dealt, guns holstered, everybody loots and sizes each other up |
| The Round | 11 min | Live fire. Factions try to complete their objective |
| Dust Storm | 90s | A storm closes on the town square and forces the last fight |
| Aftermath | 22s | Every role revealed, then back to the lobby |

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

**You are only told about players you can actually see.** The server runs a
line-of-sight check per viewer per tick and simply does not send the positions of
anyone behind a wall — with a short memory so corner-peeking does not strobe, and
a proximity floor so somebody pressed against you is never invisible. A gunshot
from an unseen shooter arrives with its tracer and its noise but **no name
attached**. Without this the entire information design would be decoration: any
modified client could read every position out of the network tab.

**The dead talk only to the dead.** Dying does not turn you into a spotter for
whoever is still alive.

**When somebody kills you, you see how they did it.** A four-second killcam
replays the last moments from behind the shooter. It carries *only* the killer's
and your own tracks — replaying what the killer could see would leak every
bystander they walked past, which is exactly what the visibility cull exists to
prevent. You already learn who shot you; the killcam only makes it legible.

**Every round ends with its own account.** The results screen lists what happened
and when — each death with both roles, every star pinned on, every accusation —
next to the table of who everyone really was.

**The Sheriff may pin on the star** (`B`). It is public and permanent: +45 max
health and 15% damage resistance, but every Outlaw in town now has a name and a
face. Going loud is usually the Sheriff's strongest and most dangerous play.

**Sprint is five seconds long.** It refills at about a fifth of the rate it
drains and you need a second of it banked before you can start running again, so
you cannot outrun the man behind you indefinitely and you cannot cross town
without arriving winded. The same budget is shared by the client's own
integration, the bots, and the server validating your movement — one rule, in
`stepStamina`, so no two of them can disagree about how long anybody can run.

**You can call somebody out** (`F` while looking at them). It broadcasts to
everyone, and the bots weigh it by how much they already trust you.

Other channels: all-chat (`T`), a quick shout wheel (`V`, then a number), and the
Tracker's footprints — which are deliberately colourless, so you can see that
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

There are no image files here either. `client/js/cardart.js` is a small printing
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

Each face is about 30ms of canvas work and is printed once, in idle time while
you are still in the lobby, then kept as a WebP data URL (~120KB, against 1.4MB
for the same face as a PNG). Open **`/proof/`** while the server is running to
see the whole sheet at full size — that page is how the deck was tuned, and
`/proof/?c=witness` prints a single card.

---

## Characters

Six, one active ability each. All original.

| Character | Ability | Effect |
|---|---|---|
| **Gunslinger** — Cassidy "Quickhand" Vane | Hair Trigger | Passive: double-speed weapon swaps. Active: 5s of rapid fire and near-instant reloads |
| **Sawbones** — Doc Marisol Vega | Field Dressing | Heal the player in your sights for 45 (or yourself for 30). A public, costly statement of trust |
| **Lookout** — Wren Ashcroft | Bird Call | 4s: anyone *moving* within 38m glows through walls. Hold still and you stay hidden |
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
keeps sprinting from being free.

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
  **Renegade bots** hold back early and turn on everyone when the crowd thins.
- They **break off losing fights**, fire in bursts with real reaction times and
  aim error that decays as they track you, take a beat after a kill, accuse people,
  chat, and get things wrong. Skill, paranoia, aggression and chattiness are rolled
  per bot so a lobby does not feel like one machine.

---

## Settings

`Esc` (or **SETTINGS** in the lobby) opens mouse sensitivity, invert-Y, field of
view, volume, mute and a frame-rate readout. It is kept in `localStorage` and
nothing goes on the wire — the server has no opinion about anybody's
sensitivity. Every read and write is guarded, so a private window or a browser
with site data blocked falls back to the defaults instead of failing to start.

---

## Controls

| | |
|---|---|
| `WASD` move · `Shift` sprint (5s of it) · `Ctrl` crouch · `Space` jump | `LMB` fire · `RMB` aim (rifle) · `R` reload |
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
            js/settings.js local preferences, guarded against blocked storage
            proof/        /proof/ - the deck at full size, for tuning cardart.js
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

`npm test` runs 63 checks on plain Node, no browser and no extra dependencies.
They are grouped by what they protect:

- **`test/world.test.js`** — the map is well formed, nobody spawns inside rock,
  no loot is buried in furniture, walls stop movement and doorways do not, the
  nav graph is one connected town with no orphan nodes, weapons are internally
  consistent, and every role table adds up.
- **`test/match.test.js`** — roles are dealt correctly, guns are inert during
  preparation, each faction's win condition fires (including at the bell, for a
  Sheriff who walked out during prep), the dust storm hurts outside the ring and
  not inside it, and the information rules hold: an unwitnessed kill names
  nobody, the victim always learns their killer, a death replay carries only two
  people, and the dead cannot talk to the living.
- **`test/cards.test.js`** — the deck. Mostly assertions about *absent*
  information: a Rain Barrel that must swallow the shooter's hitmarker as well as
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
- **`test/settings.test.js`** — everything the settings panel stores comes back
  out of `localStorage`, which anybody can edit by hand, so the part that decides
  what a stored value is *allowed* to be is pure and tested: no value can push a
  slider past its own limits, garbage in one field does not take the others with
  it, and every default is reachable with its own control.
- **`test/security.test.js`** — what a lying client cannot do: teleport, walk
  through a wall, end up inside geometry, buy speed by flooding input packets,
  sprint past the end of its own tank,
  be told about players it cannot see, or learn the name of a shooter it could
  not have seen. One check runs the other way and makes sure an honest sprint at
  30Hz is never clamped.
- **`test/ratelimit.test.js`** — the socket token bucket: a burst gets through,
  a flood does not, an idle socket cannot save up more than one burst, and a
  stream at exactly the limit is never refused.

`npm run test:browser` drives a real Chromium through a whole round with two
players — lobby, room codes, the deck printed face up, the role card, the hand
dealt and a card played, and on to the aftermath screen where the round's cards
are finally named — checking for console errors and server noise the whole way.
It needs `playwright` installed and skips cleanly if it is not there.

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
- `TIMING` — phase lengths (or the `HNH_*` env overrides).

Balance across 20 headless bot-only rounds currently sits at 10 Law / 9 Outlaw /
1 Renegade, with the first death about a minute in, and roughly one death in six
now belongs to the dust storm. Round length is strongly **bimodal** — either
somebody finds the Sheriff inside two minutes or nothing is resolved and the
storm decides it — so the mean (around 360s) says much less than that shape does,
and anything under about twenty rounds is noise.

Bots play roughly a third of the cards they are dealt. Running the same sim with
every hand emptied moves neither the win split (16/6/2) nor the pace (first death
61s) outside that noise, which is exactly what you want from a layer that adds
information rather than firepower.

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
- **Bots do not use rooftops or the water tower** — the nav graph is ground-level
  only. Deliberate for now, and it makes verticality a human edge.
- **No voice chat.** Text chat and the shout wheel stand in for it.
- Match length with bots only runs shorter than the 10–15 minute target because
  bots find each other faster than people do; the phase timers support the full
  length and human rounds fill it.
