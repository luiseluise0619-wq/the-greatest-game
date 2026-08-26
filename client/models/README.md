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

## Licensing

Only use models you have the right to redistribute. Nothing in this folder is
committed by default beyond this file and the example config.
