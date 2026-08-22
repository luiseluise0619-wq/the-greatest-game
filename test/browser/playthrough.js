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

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('playwright is not installed - skipping the browser check.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const PORT = 8100 + Math.floor(Math.random() * 400);
const SHOTS = process.env.HNH_SHOTS || 'test/browser/screenshots';
mkdirSync(SHOTS, { recursive: true });

const CARD_NAMES = {
  barrel: 'rain barrel', poster: 'wanted poster', tracks: 'cover your tracks',
  witness: 'buy a witness', ledger: "dead man's ledger", spyglass: 'long glass',
};

const server = spawn('node', ['server/index.js'], {
  env: {
    ...process.env, PORT: String(PORT), HNH_TELEMETRY: '0',
    // Short enough that one run reaches the aftermath screen, which is the
    // only place the round's cards are ever named.
    HNH_PREP: '6', HNH_COMBAT: '26', HNH_ENDGAME: '8', HNH_RESULTS: '45',
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
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
  // without a word of it reaching the other player's screen.
  const handBefore = await A.evaluate(() => window.game.hud.hand.slice());
  const bFeedBefore = await B.evaluate(() => document.getElementById('feed').textContent);
  // Wait for the server's answer rather than a fixed pause: the Wanted Poster
  // is refused with nobody in the crosshair, and that is a correct outcome too.
  // Two attempts, because a keypress can land while the page is mid-frame and
  // this browser renders in software.
  let spent = false;
  for (let attempt = 0; attempt < 3 && !spent; attempt++) {
    // Reading B's feed a moment ago left the other window in front, and a
    // background window quietly drops key events.
    await A.bringToFront();
    await A.keyboard.press('KeyZ');
    spent = await A.waitForFunction(() => window.game.hud.hand.length < 2, null, { timeout: 9000 })
      .then(() => true).catch(() => false);
  }
  const handAfter = await A.evaluate(() => ({ hand: window.game.hud.hand.slice(), armed: window.game.hud.armed.slice() }));
  check(handBefore.length === 2, `hand starts full (${handBefore.length})`);
  check(spent || handBefore[0] === 'poster',
    `playing a card spends it (${handAfter.hand.length} left, ${handBefore[0]})`);
  const chips = await A.evaluate(() => document.querySelectorAll('#handStrip .cardChip').length);
  check(chips === handAfter.hand.length + handAfter.armed.length, `the hand strip matches the hand (${chips} chips)`);
  // The flourish is a 1.7s animation, which this browser cannot be relied on to
  // still be showing by the time the next round trip lands - so ask the HUD what
  // it held up rather than racing its own animation.
  const flourish = await A.evaluate(() => ({
    played: window.game.hud.lastFlourish || null,
    img: !!document.querySelector('#cardPlay img'),
  }));
  check(!spent || (flourish.played === handBefore[0] && flourish.img),
    `the played card is held up on screen (${flourish.played})`);
  await A.screenshot({ path: `${SHOTS}/03-card-played.png` });
  const bFeedAfter = await B.evaluate(() => document.getElementById('feed').textContent.toLowerCase());
  const aName = await A.evaluate(() => document.getElementById('nameInput').value || 'Stranger');
  if (handBefore[0] === 'poster') {
    // The one card that is public by design: pointing the finger has to cost you.
    check(bFeedAfter.includes(aName.toLowerCase()) || handAfter.hand.length === 2,
      'the Wanted Poster is announced to the town');
  } else {
    const name = CARD_NAMES[handBefore[0]].toLowerCase();
    check(!bFeedAfter.includes(name), `a silent card stays silent for everyone else (${handBefore[0]})`);
  }

  // Nothing in the hand may still be face down once the deal is over - the
  // strip is re-rendered on every change and it must never re-deal the backs.
  const faceDown = await A.evaluate(() => [...document.querySelectorAll('#handStrip .cardChip img')]
    .filter((i) => i.dataset.face && i.src !== i.dataset.face).length);
  check(faceDown === 0, `no card is left face down (${faceDown})`);

  const bState = await B.evaluate(() => ({ inGame: window.game.inGame, role: !!window.game.selfRole }));
  check(bState.inGame && bState.role, 'the second player is in the same round');

  // Ride the round out: the aftermath screen is where every silent card is
  // finally named, and nothing else in this suite ever reaches it.
  const reachedResults = await A.waitForFunction(
    () => !document.getElementById('results').classList.contains('hidden'),
    null, { timeout: 90000 },
  ).then(() => true).catch(() => false);
  check(reachedResults, 'the round reaches the aftermath screen');
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
