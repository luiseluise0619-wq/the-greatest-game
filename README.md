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
| Preparation | 45s | Roles dealt, guns holstered, everybody loots and sizes each other up |
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

**The Sheriff may pin on the star** (`B`). It is public and permanent: +45 max
health and 15% damage resistance, but every Outlaw in town now has a name and a
face. Going loud is usually the Sheriff's strongest and most dangerous play.

**You can call somebody out** (`F` while looking at them). It broadcasts to
everyone, and the bots weigh it by how much they already trust you.

Other channels: all-chat (`T`), a quick shout wheel (`V`, then a number), and the
Tracker's footprints — which are deliberately colourless, so you can see that
*somebody* walked through the alley but not who.

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

## Controls

| | |
|---|---|
| `WASD` move · `Shift` sprint · `Ctrl` crouch · `Space` jump | `LMB` fire · `RMB` aim (rifle) · `R` reload |
| `1` `2` `3` weapons · `G` dynamite · `E` pick up | `Q` ability · `F` call somebody out · `B` pin on the star |
| `T` chat · `V` shout wheel · `Tab` the table | `H` peek at your hand · `Esc` free the mouse |

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
client/     js/main.js    networking, local movement, input, render loop
            js/world.js   builds the town in three.js, procedural textures
            js/players.js remote avatars, interpolation, silhouettes
            js/viewmodel.js  first-person guns and their animations
            js/effects.js tracers, impacts, dynamite, footprints, pickups
            js/audio.js   every sound synthesised in WebAudio, no files
            js/hud.js     HUD, feed, role card, scoreboard, results
```

**Authority split.** Movement is simulated on the client and speed-clamped by the
server, which keeps aiming crisp over a real network. Everything that decides the
round — hit resolution, damage, deaths, roles, and *who is told what* — is resolved
on the server and never trusted to a client.

Bots run inside the server and go through the exact same `onShoot` / `onSwap` /
`onPickup` entry points as human players, so there is one combat implementation and
bots cannot do anything a player could not.

---

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

Balance across 14 headless bot-only rounds currently sits at roughly 5 Law / 8
Outlaw / 1 Renegade wins, with the first death around a minute in.

---

## Known limitations

Prototype, deliberately scoped to a vertical slice:

- **One map**, three guns, six characters, one game mode.
- **Client-authoritative movement** with a speed clamp. Fine for friends on a LAN;
  not hardened against a determined cheater.
- **All player positions are broadcast** to every client for interpolation, so a
  modified client could see through walls. Hardening this needs server-side
  visibility culling, which is worth doing before this is ever public.
- **Bots do not use rooftops or the water tower** — the nav graph is ground-level
  only. Deliberate for now, and it makes verticality a human edge.
- **No voice chat.** Text chat and the shout wheel stand in for it.
- Match length with bots only runs shorter than the 10–15 minute target because
  bots find each other faster than people do; the phase timers support the full
  length and human rounds fill it.
