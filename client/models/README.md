# Dropping in your own character models

By default every gunhand is built procedurally at runtime (`client/js/players.js`),
because this repo ships no art assets. If you have rigged `.glb` / `.gltf`
characters, put them in this folder and describe them here — no code changes.

1. Copy your models into `client/models/`.
2. Copy `characters.example.json` to `characters.json` and edit it.
3. Restart the page. The console logs what loaded and what fell back.

`characters.json` is optional. Any character it does not name, or any model that
fails to load, silently keeps the procedural gunhand — so you can convert one
character at a time.

## Schema

```jsonc
{
  "gunslinger": {
    "url": "/client/models/gunslinger.glb",

    "scale": 1.0,          // model units -> metres; the game expects a 1.8m human
    "offset": [0, 0, 0],   // nudge so the FEET sit at y = 0
    "rotationY": 0,        // degrees; the game faces -Z, rotate until yours does

    // OPTION A - the model carries animation clips. Name them here.
    // Missing entries just fall back to "idle".
    "clips": {
      "idle":  "Idle",
      "walk":  "Walk",
      "run":   "Run",
      "aim":   "Aim",      // held while his gun is up - which in the turn mode
                           // is the whole of his go, not the moment he fires
      "death": "Death",    // played once, then held

      // Both optional, both played once and handed back. In the turn mode
      // nobody walks, so these two and "aim" are most of what anybody sees.
      "hit":   "HitReact", // a hit landed on him
      "play":  "Interact"  // a card left his hand
    },

    // OPTION B - no clips, but the rig has named bones. The game will drive
    // these with the same pose it uses for the procedural gunhand.
    // Names below are the Mixamo convention; use whatever yours are called.
    "bones": {
      "root":      "mixamorigHips",
      "spine":     "mixamorigSpine",
      "neck":      "mixamorigNeck",
      "hipL":      "mixamorigLeftUpLeg",
      "kneeL":     "mixamorigLeftLeg",
      "ankleL":    "mixamorigLeftFoot",
      "hipR":      "mixamorigRightUpLeg",
      "kneeR":     "mixamorigRightLeg",
      "ankleR":    "mixamorigRightFoot",
      "shoulderL": "mixamorigLeftArm",
      "elbowL":    "mixamorigLeftForeArm",
      "shoulderR": "mixamorigRightArm",
      "elbowR":    "mixamorigRightForeArm"
    },

    // Optional attachment points.
    "gunBone":  "mixamorigRightHand",   // the game parents a revolver here
    "starBone": "mixamorigSpine2"       // where the Sheriff's star is pinned
  }
}
```

Provide `clips` **or** `bones` — clips win if both are present. A model with
neither still renders; it simply will not animate.

A clip can be named **or numbered**: `"idle": 0` picks the first clip in the
file. That is the only way to address a clip with no name, and plenty of real
exports have one — Khronos's own `CesiumMan` has exactly one animation and it is
unnamed. If nothing you named matches, the console prints **every clip the file
actually has, with its index**, so you can fix the config without opening a glTF
inspector. And if the file has exactly one clip and nothing matched, the game
uses it as `idle` rather than standing the man rigid.

## When it comes out wrong

The console measures each model once and says so. The two things that go wrong
almost every time are scale and where the feet are, and neither looks like a
number being wrong on screen — it looks like your character is a dot on the
floor, or a wall. So:

```
[models] gunslinger: 0.31m tall, and this town is built for a man about 1.8m.
                     Try "scale": 5.77 in characters.json.
[models] gunslinger: his feet sit at y=-0.42 rather than 0 -
                     "offset": [0, 0.42, 0] puts them on the ground.
```

Type what it says. A model between 1.2m and 2.6m is left alone and its height is
just printed, because that is the one measurement anybody configuring a model
wants to see.

`idle` matters more here than in most games. The mode this is played in by
default has **nobody walking**: everyone stands on a dealt mark for the whole
round, so `walk` and `run` never play there and `idle`, `aim`, `hit` and `play`
are the entire performance. A stiff idle reads as a diorama. The procedural rig
answers this with breath and a weight change from one foot to the other every
few seconds; if your `idle` clip is a T-pose with a sway on it, prefer `bones`
and let the procedural pose drive your rig instead.

## What the game still controls

Whatever rig you use, the game keeps ownership of the things that carry
information, so a custom model can never quietly break the deduction layer:

- the name tag above the head, and its distance fade,
- the Sheriff's star (only visible once pinned on),
- the Lookout's reveal outline,
- muzzle flash lighting,
- the dust-cloud fade (materials are cloned per player, so one player's Gambler
  boon does not fade everyone else using the same model).

## Keeping silhouettes readable

Eight strangers have to be distinguishable at 40 metres or the social layer
collapses. If you swap in models, keep hat profiles, coat lengths and colours as
different from each other as the procedural set is — that is a gameplay
requirement here, not an art preference.

## Where to get models that fit

Nothing is committed here and nothing is downloaded at build time. What you drop
in is yours to have the right to. That said, this pipeline was written against
what is actually out there:

- **[Quaternius](https://quaternius.com)** (CC0) — the straightest fit. Rigged
  low-poly humans plus a Western set of buildings, barrels and wagons. CC0 means
  no attribution and no licence file to carry. Download from the site; his
  GitHub account is not where the packs live.
- **[Kenney](https://kenney.nl/assets)** (CC0) — blocky characters and a big
  Western kit. Simple silhouettes, which is a virtue here. Same caveat: the
  packs are on the site, and the GitHub account is Godot starter kits.
- **[Mixamo](https://www.mixamo.com)** (free with an Adobe account) — not models
  so much as *animation*. Upload any humanoid, download `idle`, `walk`, `run`,
  `aim`, `hit`, `death` as clips. The `bones` map above is already written in
  Mixamo's naming convention.
- **[Poly Pizza](https://poly.pizza)** — the old Google Poly library. CC0 and
  CC-BY are mixed together, so check each item.
- **[glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)** —
  not a western, but the right place to *test the pipeline*: `CesiumMan` under
  `Models/` is rigged with clips and will prove your config before you spend
  time on art. (The older `glTF-Sample-Models` repo is archived — this is the
  one that is still maintained.)

## Licensing

Only use models you have the right to redistribute. Nothing in this folder is
committed by default beyond this file and the example config.
