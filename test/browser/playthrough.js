// Optional end-to-end check in a real browser.
//
//   npm i -D playwright && npx playwright install chromium
//   npm run test:browser
//
// The suite in test/*.test.js is the one that runs everywhere and gates the
// build; this covers the parts only a browser can prove - that the page boots,
// renders the town, and that two people sharing one link land in one lobby.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { WEAPONS, CHARACTERS } from '../../shared/constants.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('playwright is not installed - skipping the browser check.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const PORT = 8100 + Math.floor(Math.random() * 400);
// Every pixel of this page is drawn on the CPU by swiftshader, so on a small
// CI runner the window size is the single biggest thing between this finishing
// in two minutes and ten.
const [VW, VH] = (process.env.HNH_VIEWPORT || '1280x760').split('x').map(Number);
const SHOTS = process.env.HNH_SHOTS || 'test/browser/screenshots';
mkdirSync(SHOTS, { recursive: true });

const REVOLVER_INTERVAL = WEAPONS.revolver.fireInterval;
const HAIR_TRIGGER_MULT = CHARACTERS.gunslinger.fireMult;

const CARD_NAMES = {
  barrel: 'rain barrel', poster: 'wanted poster', tracks: 'cover your tracks',
  witness: 'buy a witness', ledger: "dead man's ledger", spyglass: 'long glass',
};

// The round the server is told to run, and that the checks below budget for.
// Nobody can be shot during the preparation phase, and every check that needs
// the round to still have this player in it - playing a card, refreshing the
// page, dropping the socket - has to finish inside it. A round can otherwise
// be over in half a minute of combat, and there is nothing to reconnect to
// after that. So: a long wind-up and a short round.
const PREP = 105, COMBAT = 20, ENDGAME = 8;
const server = spawn('node', ['server/index.js'], {
  env: {
    ...process.env, PORT: String(PORT), HNH_TELEMETRY: '0',
    HNH_PREP: String(PREP), HNH_COMBAT: String(COMBAT), HNH_ENDGAME: String(ENDGAME),
    // The aftermath phase has to outlast the checks that run on it. On a
    // two-core runner drawing every pixel on the CPU, a screenshot alone can
    // take seconds, and a results screen that timed out mid-check took its own
    // buttons off the page.
    HNH_RESULTS: '240',
    // A public town deals itself in twelve seconds after a second player
    // arrives, which this suite takes longer than to get through the lobby.
    HNH_LOBBYCOUNTDOWN: '600',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const serverErrors = [];
server.stderr.on('data', (d) => serverErrors.push(d.toString()));
await new Promise((r) => setTimeout(r, 1200));

const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);

const problems = [];
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) problems.push(label);
};

async function open(url, name) {
  const ctx = await browser.newContext({ viewport: { width: VW || 1280, height: VH || 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) problems.push(`${name} console: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.getElementById('roomCode').textContent !== '····',
    null, { timeout: 25000 },
  );
  return page;
}

try {
  const started = Date.now();
  const A = await open(`http://localhost:${PORT}/`, 'A');
  const toLobby = Date.now() - started;
  check(toLobby < 5000, `lobby answers quickly (${toLobby}ms)`);

  // The whole deck is printed face up in the lobby; if cardart.js is broken
  // this is the first place it shows.
  // Printed one per idle slice, so this is generous: on a loaded machine with
  // software rendering the six faces can take a while to come off the press.
  const deck = await A.waitForFunction(() => document.querySelectorAll('#deckStrip img').length === 6,
    null, { timeout: 40000 }).then(() => 6).catch(() => -1);
  check(deck === 6, `the deck is on show in the lobby (${deck} faces)`);

  // Settings: a change has to reach the running game and survive a reload.
  await A.click('#openSettings');
  const settingsOpen = await A.evaluate(() => !document.getElementById('settings').classList.contains('hidden'));
  check(settingsOpen, 'the settings panel opens');
  await A.evaluate(() => {
    const el = document.getElementById('setFov');
    el.value = '99';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const applied = await A.evaluate(() => ({ fov: window.game.camera.fov, label: document.getElementById('setFovVal').textContent }));
  check(applied.fov === 99 && applied.label === '99', `settings reach the camera live (fov ${applied.fov})`);
  await A.click('#setClose');
  await A.evaluate(() => { window.game.settings.reset(); window.game.syncSettingsPanel(); });
  const afterReset = await A.evaluate(() => window.game.camera.fov);
  check(afterReset === 76, `reset puts the view back (fov ${afterReset})`);

  const code = (await A.textContent('#roomCode')).trim();
  check(/^[A-Z0-9]{4}$/.test(code), `room code issued (${code})`);
  await A.screenshot({ path: `${SHOTS}/01-lobby.png` });

  // A second player follows the shared link into the same town.
  const B = await open(`http://localhost:${PORT}/#${code}`, 'B');
  check((await B.textContent('#roomCode')).trim() === code, 'shared link joins the same town');
  const lobby = await A.evaluate(() => [...document.querySelectorAll('#lobbyList li b')].length);
  check(lobby === 2, `both players show in the lobby (${lobby})`);

  // Deal, and confirm the round actually starts for both of them.
  await A.click('#startBtn');
  await A.waitForFunction(() => window.game?.selfRole, null, { timeout: 20000 });
  check(await A.isVisible('#roleCard'), 'the role card is dealt');
  const intel = (await A.textContent('#roleIntel')).trim();
  check(intel.length > 10, 'the role card carries a lead to pull');
  const dealt = await A.evaluate(() => [...document.querySelectorAll('#roleCards .handCard h5')].length);
  check(dealt === 2, `two cards are dealt and readable on the role card (${dealt})`);
  // The faces are printed at runtime; if cardart.js throws, these are blank.
  const faces = await A.evaluate(() => [...document.querySelectorAll('#roleCards .handCard img')]
    .map((i) => (/^data:image\/(webp|png)/.test(i.src) ? i.src.length : 0)));
  check(faces.length === 2 && faces.every((n) => n > 20000), `both faces printed (${faces.map((n) => Math.round(n / 1024) + 'k').join(', ')})`);
  await A.screenshot({ path: `${SHOTS}/01b-role-card.png` });

  await A.click('#roleCard');
  await A.waitForTimeout(1500);
  check(!(await A.isVisible('#roleCard')), 'the role card dismisses');

  // Loot respawns for the whole session and every body drops more of it, so
  // churning it must not cost GPU memory each time.
  const churn = await A.evaluate(() => {
    const fx = window.game.effects;
    const items = (window.game.lastSelfMsg?.loot || []).slice();
    if (!items.length) return null;
    const cycle = () => { for (let i = 0; i < 20; i++) { fx.syncLoot([]); fx.syncLoot(items); } };
    cycle();                                    // first pass builds the prototypes
    const warm = window.game.renderer.info.memory.geometries;
    cycle();
    return { grew: window.game.renderer.info.memory.geometries - warm, protos: fx.lootProtos.size };
  });
  check(churn && churn.grew === 0, `loot churn allocates nothing (${churn ? `+${churn.grew} geometries` : 'no loot'})`);

  // Every key that can do nothing has to say so. A silent no-op reads as a
  // dropped input rather than a rule the player has not learned yet.
  const denials = await A.evaluate(async () => {
    const g = window.game;
    let denied = 0;
    const realDeny = g.audio.deny.bind(g.audio);
    g.audio.deny = () => { denied += 1; realDeny(); };
    const sent = [];
    const realSend = g.send.bind(g);
    g.send = (m) => { sent.push(m.t); realSend(m); };

    g.self.cd = 9;              // ability on cooldown
    g.tryAbility();
    const abilityQuiet = !sent.includes('ability');

    g.self.dyn = 0;             // no dynamite to throw
    g.tryThrow();
    const throwQuiet = !sent.includes('throw');

    g.lastCardAt = performance.now() / 1000;   // a card a moment ago
    const before = g.hud.hand.length;
    g.playCard(0);
    const cardQuiet = !sent.includes('card') && g.hud.hand.length === before;

    g.audio.deny = realDeny;
    g.send = realSend;
    g.self.cd = 0;
    g.lastCardAt = 0;
    return { denied, abilityQuiet, throwQuiet, cardQuiet };
  });
  check(denials.abilityQuiet && denials.throwQuiet && denials.cardQuiet && denials.denied === 3,
    `keys that cannot fire say so instead of nothing (${denials.denied}/3 refused out loud)`);

  // A browser that has been told to reduce motion is telling us something
  // about the person in front of it. The gun still fires; the view just stops
  // being thrown around to celebrate it.
  const kickOf = async () => A.evaluate(() => {
    const g = window.game;
    g.self.guns = ['revolver'];
    g.self.weapon = 'revolver';
    g.self.mag = 6;
    g.self.nextFireAt = 0;
    g.self.swapUntil = 0;
    g.self.buffs = [];
    g.recoilKick = 0;
    g.wantFire = true;
    g.tryFire();
    g.wantFire = false;
    return g.recoilKick;
  });
  const kickNormal = await kickOf();
  await A.emulateMedia({ reducedMotion: 'reduce' });
  const kickReduced = await kickOf();
  const quiet = await A.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'dmgArrow';
    document.getElementById('damageDirs').appendChild(probe);
    const arrow = getComputedStyle(probe).display;
    probe.remove();
    const strip = document.getElementById('handStrip');
    strip.classList.add('dealt');
    const chip = strip.querySelector('.cardChip');
    const anim = chip ? getComputedStyle(chip).animationName : 'none';
    strip.classList.remove('dealt');
    return { arrow, anim };
  });
  await A.emulateMedia({ reducedMotion: null });
  check(kickNormal > 0 && kickReduced > 0 && kickReduced < kickNormal * 0.5,
    `reducing motion quiets the recoil without removing it (${kickNormal.toFixed(4)} -> ${kickReduced.toFixed(4)})`);
  check(quiet.arrow === 'none' && quiet.anim === 'none',
    `and stops the decoration moving (arrow ${quiet.arrow}, deal ${quiet.anim})`);
  const faceUpStill = await A.evaluate(() => [...document.querySelectorAll('#handStrip .cardChip img')]
    .filter((i) => i.dataset.face && i.src !== i.dataset.face).length);
  check(faceUpStill === 0, 'the hand is still face up with the deal animation off');

  // And nothing in the HUD may be written straight onto the world with nothing
  // to lift it off it. Half of this town is sunlit adobe: pale letters on a
  // pale wall are not letters. Either a shadow under it or something opaque
  // behind it - this is the general form of a bug the topbar, the killcam
  // caption and the ability dial's key each had separately.
  const bare = await A.evaluate(() => {
    const alpha = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return 0;
      const parts = m[1].split(',').map(Number);
      return parts.length > 3 ? parts[3] : 1;
    };
    const backed = (el) => {
      for (let n = el; n && n.id !== 'hud'; n = n.parentElement) {
        if (alpha(getComputedStyle(n).backgroundColor) >= 0.5) return true;
      }
      return false;
    };
    const out = [];
    for (const el of document.querySelectorAll('#hud *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      // Only elements with words of their own; a wrapper inherits nothing.
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      if (cs.textShadow !== 'none' || backed(el)) continue;
      out.push(`${el.tagName}${el.id ? `#${el.id}` : ''}`);
    }
    return out;
  });
  check(bare.length === 0,
    `every word the HUD puts over the town is readable on a bright wall${bare.length ? `: ${bare.join(', ')}` : ''}`);

  // Nothing in the HUD may run off the edge of the window. The hand is the one
  // deliberate exception - the cards are tucked into the bottom edge like cards
  // held in a hand - and it says so in the stylesheet.
  const spill = await A.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#hud *')) {
      if (el.closest('#handStrip')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.x < -0.5 || r.y < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
        out.push(`${el.tagName}${el.id ? `#${el.id}` : ''}${el.className ? `.${el.className}` : ''}`);
      }
    }
    return out;
  });
  check(spill.length === 0, `the HUD stays inside the window${spill.length ? `: ${spill.join(', ')} spills out` : ''}`);

  // The shout wheel is eight tiles of prose laid out around a ring, and the
  // only way to say any of it is to read one and press its number. Tiles that
  // sit on each other, or run off the side of the window, are tiles nobody can
  // pick - so this measures them rather than trusting the arithmetic.
  await A.keyboard.down('KeyV');
  await A.waitForTimeout(350);
  const wheel = await A.evaluate(() => {
    const open = !document.getElementById('voiceWheel').classList.contains('hidden');
    const tiles = [...document.querySelectorAll('.voiceOpt')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent.trim() };
    });
    let overlaps = 0;
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i], b = tiles[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
      }
    }
    const off = tiles.filter((t) => t.x < 0 || t.y < 0
      || t.x + t.w > innerWidth || t.y + t.h > innerHeight).length;
    return { open, count: tiles.length, overlaps, off };
  });
  await A.keyboard.up('KeyV');
  check(wheel.open && wheel.count === 8, `the shout wheel opens with every line on it (${wheel.count})`);
  check(wheel.overlaps === 0, `no shout sits on top of another (${wheel.overlaps} overlapping)`);
  check(wheel.off === 0, `every shout is on the screen to be read (${wheel.off} off it)`);
  const wheelShut = await A.evaluate(
    () => document.getElementById('voiceWheel').classList.contains('hidden'));
  check(wheelShut, 'letting go of the key puts the wheel away');

  // Swapping a weapon has to lock the trigger on the client too, or the first
  // clicks after a swap flash and bang and the server drops every one of them.
  const swap = await A.evaluate(async () => {
    const g = window.game;
    g.self.guns = ['revolver', 'rifle'];
    g.self.weapon = 'revolver';
    g.self.mag = 6;
    g.self.nextFireAt = 0;
    g.self.swapUntil = 0;
    g.swapTo('rifle');
    const lockedRightAfter = !g.canFireLocally();
    const before = g.self.mag;
    g.tryFire();
    return { lockedRightAfter, spentARound: g.self.mag !== before };
  });
  check(swap.lockedRightAfter && !swap.spentARound, 'the trigger is locked while a gun comes up');

  // None of these guns is a button you hold down. Leaning on the trigger has
  // to cost one round and then stop, however long the frame loop runs on.
  const held = await A.evaluate(async () => {
    const g = window.game;
    g.self.guns = ['revolver'];
    g.self.weapon = 'revolver';
    g.self.mag = 6;
    g.self.nextFireAt = 0;
    g.self.swapUntil = 0;
    let shots = 0;
    const send = g.send.bind(g);
    g.send = (m) => { if (m.t === 'shoot') shots++; send(m); };
    g.wantFire = true;                       // the button goes down and stays down
    g.tryFire();
    const held = g.wantFire;
    await new Promise((r) => setTimeout(r, 1500));   // long enough for a dozen
    g.wantFire = false;
    g.send = send;
    return { shots, held, mag: g.self.mag };
  });
  check(held.shots === 1 && !held.held,
    `holding the trigger fires once and stops (${held.shots} shot(s), ${held.mag} left)`);

  // Hair Trigger is the exception, and it is the whole ability: five seconds
  // where the gun fires as fast as the server will allow. The client has to
  // lift its own cooldown by the same amount, or the ability is spent waiting
  // on a local timer nobody told about it.
  const hair = await A.evaluate(async ([interval, mult]) => {
    const g = window.game;
    g.character = 'gunslinger';
    g.self.guns = ['revolver'];
    g.self.weapon = 'revolver';
    g.self.mag = 6;
    g.self.nextFireAt = 0;
    g.self.swapUntil = 0;
    g.self.buffs = ['fireRateMult'];
    let shots = 0;
    const send = g.send.bind(g);
    g.send = (m) => { if (m.t === 'shoot') shots++; send(m); };
    const at = performance.now() / 1000;
    g.wantFire = true;
    g.tryFire();
    const gap = g.self.nextFireAt - at;
    const stillHeld = g.wantFire;
    await new Promise((r) => setTimeout(r, 1200));
    g.wantFire = false;
    g.send = send;
    g.self.buffs = [];
    return { shots, stillHeld, gap, want: interval * mult };
  }, [REVOLVER_INTERVAL, HAIR_TRIGGER_MULT]);
  check(hair.stillHeld && hair.shots > 1,
    `Hair Trigger is the one trigger you can lean on (${hair.shots} shots)`);
  check(Math.abs(hair.gap - hair.want) < 0.02,
    `Hair Trigger shortens the client's own cooldown too (${hair.gap.toFixed(3)}s of ${hair.want}s)`);

  const standing = await A.evaluate(() => document.getElementById('standing').textContent.trim());
  check(/^[1-9]\d* STILL STANDING/.test(standing), `the town knows how many are left ("${standing}")`);

  const state = await A.evaluate(() => ({
    inGame: window.game.inGame,
    calls: window.game.renderer.info.render.calls,
    programs: window.game.renderer.info.programs.length,
    others: window.game.views.size,
  }));
  check(state.inGame, 'the round is live');
  check(state.calls > 0, `the town renders (${state.calls} draw calls)`);
  check(state.programs < 45, `shader count stays sane (${state.programs})`);
  await A.screenshot({ path: `${SHOTS}/02-in-game.png` });

  // Play a card: the hand shrinks by one and the card moves into play, all
  // without a word of it reaching the other player's screen. This goes first,
  // while the prep phase is certainly still running and nobody has been shot:
  // a dead player's keypress is refused, and correctly so.
  const ready = await A.evaluate(() => ({ alive: window.game.self?.alive, hand: window.game.hud.hand.length }));
  check(ready.alive && ready.hand === 2, `the player is alive with a full hand to play from (${ready.hand})`);
  const handBefore = await A.evaluate(() => window.game.hud.hand.slice());
  // The Wanted Poster is refused with nobody in the crosshair, and that is a
  // correct outcome - so play the other card if the poster came up first,
  // rather than spending the whole budget on a press that is meant to fail.
  const slot = handBefore[0] === 'poster' && handBefore[1] && handBefore[1] !== 'poster' ? 1 : 0;
  const played = handBefore[slot];
  // Wait for the server's answer rather than a fixed pause. Three attempts,
  // because a keypress can land while the page is mid-frame and this browser
  // renders in software.
  let spent = false;
  for (let attempt = 0; attempt < 3 && !spent; attempt++) {
    // A background window quietly drops key events, and the other page has had
    // the focus at some point before this.
    await A.bringToFront();
    await A.keyboard.press(slot === 0 ? 'KeyZ' : 'KeyX');
    spent = await A.waitForFunction(() => window.game.hud.hand.length < 2, null, { timeout: 9000 })
      .then(() => true).catch(() => false);
  }
  const handAfter = await A.evaluate(() => ({ hand: window.game.hud.hand.slice(), armed: window.game.hud.armed.slice() }));
  check(spent || played === 'poster',
    `playing a card spends it (${handAfter.hand.length} left, ${played})`);
  const chips = await A.evaluate(() => document.querySelectorAll('#handStrip .cardChip').length);
  check(chips === handAfter.hand.length + handAfter.armed.length, `the hand strip matches the hand (${chips} chips)`);
  // The flourish is a 1.7s animation, which this browser cannot be relied on to
  // still be showing by the time the next round trip lands - so ask the HUD what
  // it held up rather than racing its own animation.
  const flourish = await A.evaluate(() => ({
    played: window.game.hud.lastFlourish || null,
    img: !!document.querySelector('#cardPlay img'),
  }));
  check(!spent || (flourish.played === played && flourish.img),
    `the played card is held up on screen (${flourish.played})`);
  await A.screenshot({ path: `${SHOTS}/03-card-played.png` });
  const bFeedAfter = await B.evaluate(() => document.getElementById('feed').textContent.toLowerCase());
  const aName = await A.evaluate(() => document.getElementById('nameInput').value || 'Stranger');
  if (played === 'poster') {
    // The one card that is public by design: pointing the finger has to cost you.
    check(bFeedAfter.includes(aName.toLowerCase()) || handAfter.hand.length === 2,
      'the Wanted Poster is announced to the town');
  } else {
    const name = CARD_NAMES[played].toLowerCase();
    check(!bFeedAfter.includes(name), `a silent card stays silent for everyone else (${played})`);
  }

  // Nothing in the hand may still be face down once the deal is over - the
  // strip is re-rendered on every change and it must never re-deal the backs.
  const faceDown = await A.evaluate(() => [...document.querySelectorAll('#handStrip .cardChip img')]
    .filter((i) => i.dataset.face && i.src !== i.dataset.face).length);
  check(faceDown === 0, `no card is left face down (${faceDown})`);

  // Reconnection, before anything slow: the round can be over inside a minute
  // when the Sheriff goes down early, and there is nothing to reconnect to
  // after that.
  const bState = await B.evaluate(() => ({
    inGame: window.game.inGame, role: !!window.game.selfRole, phase: window.game.phase,
  }));
  check(bState.inGame && bState.role, 'the second player is in the same round');
  // If this has slipped out of the preparation phase the checks below are
  // racing a round that can end under them, so say so here rather than let
  // them fail one at a time somewhere further down.
  check(bState.phase === 'prep', `there is still a round to reconnect to (phase ${bState.phase})`);

  // A refresh mid-round must give the same body back, not a fresh stranger.
  const bBefore = await B.evaluate(() => ({
    id: window.game.selfId,
    role: window.game.selfRole?.role,
    hand: window.game.hud.hand.slice(),
  }));
  await B.reload({ waitUntil: 'domcontentloaded' });
  const bBack = await B.waitForFunction(() => window.game?.selfRole && window.game.inGame, null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  const bAfter = await B.evaluate(() => ({
    id: window.game.selfId,
    role: window.game.selfRole?.role,
    hand: window.game.hud.hand.slice(),
    phase: window.game.phase,
  }));
  check(bBack && bAfter.id === bBefore.id && bAfter.role === bBefore.role,
    `a refresh reclaims the same body (${bBefore.role} -> ${bAfter.role || 'lost'}, phase ${bAfter.phase || '?'})`);
  check(bBack && JSON.stringify(bAfter.hand) === JSON.stringify(bBefore.hand),
    'the hand comes back with it');

  // A socket that drops mid-round must come back on its own, into the same
  // seat, without shoving the role card back in the player's face.
  const netBefore = await A.evaluate(() => {
    window.game.hud.knownRoles.set(-1, 'outlaw');    // something learned, to check it survives
    return { id: window.game.selfId, role: window.game.selfRole.role, known: window.game.hud.knownRoles.size };
  });
  await A.evaluate(() => window.game.ws.close());
  const bannerSeen = await A.waitForFunction(
    () => !document.getElementById('netBanner').classList.contains('hidden'),
    null, { timeout: 10000 },
  ).then(() => true).catch(() => false);
  check(bannerSeen, 'a dropped socket says so on screen');
  // Wait for the seat to actually come back, not just for the socket to open:
  // the client still has to re-announce itself with its token and be handed
  // the same body, and on a loaded machine that round trip is not instant.
  const netBack = await A.waitForFunction(
    (id) => window.game.ws.readyState === 1 && window.game.inGame && window.game.selfId === id,
    netBefore.id, { timeout: 30000 },
  ).then(() => true).catch(() => false);
  await A.waitForTimeout(300);            // let the banner finish going away
  const netAfter = await A.evaluate(() => ({
    id: window.game.selfId, role: window.game.selfRole.role,
    known: window.game.hud.knownRoles.size, kept: window.game.hud.knownRoles.get(-1) || null,
    banner: !document.getElementById('netBanner').classList.contains('hidden'),
    cardUp: !document.getElementById('roleCard').classList.contains('hidden'),
    inGame: window.game.inGame,
  }));
  check(netBack && netAfter.inGame && netAfter.id === netBefore.id && netAfter.role === netBefore.role,
    `a dropped socket reconnects into the same seat (${netAfter.role})`);
  // Not a size comparison: the round is live underneath this, and a player who
  // works out one more role while the socket is down has learned something,
  // not lost something. What must survive is the entry that was already there.
  check(netAfter.kept === 'outlaw' && netAfter.known >= netBefore.known,
    `reconnecting keeps what the player had worked out (${netBefore.known} -> ${netAfter.known})`);
  check(!netAfter.cardUp, 'reconnecting does not shove the role card back on screen');
  check(!netAfter.banner, 'the reconnecting banner goes away again');


  // Ride the round out: the aftermath screen is where every silent card is
  // finally named, and nothing else in this suite ever reaches it.
  // Bring this window back in front first: the checks above worked the other
  // page, and a browser throttles the animation frames of a window nobody is
  // looking at - which is what this wait is polled on.
  await A.bringToFront();
  const reachedResults = await A.waitForFunction(
    () => !document.getElementById('results').classList.contains('hidden'),
    // A whole round is prep + combat + endgame, and the checks above have
    // already eaten some of it - but not reliably a known amount, so this
    // waits out a full round from here rather than the remainder of one.
    null, { timeout: (PREP + COMBAT + ENDGAME + 20) * 1000 },
  ).then(() => true).catch(() => false);
  const endPhase = await A.evaluate(() => window.game.phase || '?');
  check(reachedResults, `the round reaches the aftermath screen (phase ${endPhase})`);
  if (reachedResults) {
    // Wait for the fade rather than sleeping through it: this page renders in
    // software here, so a 250ms transition can take a couple of seconds of
    // wall clock to commit.
    const handAway = await A.waitForFunction(
      () => getComputedStyle(document.getElementById('handStrip')).opacity === '0',
      null, { timeout: 10000 },
    ).then(() => true).catch(() => false);
    const after = await A.evaluate(() => ({
      rows: [...document.querySelectorAll('#resultTable tbody tr')].length,
      roles: [...document.querySelectorAll('#resultTable tbody td.role')].map((t) => t.textContent.trim()).filter(Boolean).length,
      faces: document.querySelectorAll('#resultTable .crdMini').length,
      timelineCards: [...document.querySelectorAll('#timeline li.card')].length,
      hudClass: document.getElementById('hud').className,
    }));
    check(after.rows >= 6, `everyone is on the table (${after.rows} rows)`);
    check(after.roles === after.rows, `every role is revealed (${after.roles}/${after.rows})`);
    check(after.faces >= 1, `the cards played are shown face up (${after.faces})`);
    check(after.timelineCards >= 1, `the timeline names them (${after.timelineCards})`);
    check(handAway && after.hudClass.includes('resultsUp'), 'the hand is put away for the aftermath');
    await A.screenshot({ path: `${SHOTS}/04-aftermath.png` });

    // Riding again is a readiness call with two players in the room, so it must
    // hold the screen up rather than dumping this one player into a lobby.
    await A.bringToFront();
    const stillUp = await A.evaluate(() => !document.getElementById('results').classList.contains('hidden'));
    check(stillUp, 'the aftermath screen is still up to press a button on');
    if (stillUp) await A.click('#playAgain');
    // Wait for the server's answer, not for the button: the click disables it
    // on the spot, so waiting on that is waiting for nothing. The count in the
    // label is the part that had to come back from the room.
    if (stillUp) {
      await A.waitForFunction(
        () => /\d+\/\d+/.test(document.getElementById('playAgain').textContent),
        null, { timeout: 15000 },
      ).catch(() => {});
    }
    const afterReady = await A.evaluate(() => ({
      resultsUp: !document.getElementById('results').classList.contains('hidden'),
      label: document.getElementById('playAgain').textContent.trim(),
      disabled: document.getElementById('playAgain').disabled,
      phase: window.game.phase,
    }));
    check(!stillUp || (afterReady.resultsUp && afterReady.phase === 'results'),
      `one of two players cannot start the next round alone (phase ${afterReady.phase})`);
    check(!stillUp || (afterReady.disabled && /1\/2/.test(afterReady.label)),
      `the button says who is waiting ("${afterReady.label}")`);
  }

  check(serverErrors.length === 0, `server stayed quiet${serverErrors.length ? `: ${serverErrors[0]}` : ''}`);
  check(problems.length === 0 || problems.every((p) => !p.includes('console') && !p.includes(':')), 'no page errors');
} finally {
  await browser.close();
  server.kill();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log(`\nall good - screenshots in ${SHOTS}`);
process.exit(0);
