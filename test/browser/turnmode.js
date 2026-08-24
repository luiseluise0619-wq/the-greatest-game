// The turn mode, in a real browser.
//
//   npm run test:browser:duel
//
// playthrough.js covers the free-for-all, which is the game every check in it
// was written against: walk when you like, fire when you like. This is the
// other one, and it is the one a town plays by default - so until this existed
// the default mode had no browser coverage at all.
//
// What only a browser can prove here: that the hand arrives before the bell and
// is readable, that a number key spends a card and the table sees the result,
// that the feet really are nailed to the mark you were dealt for the whole
// round, that the warning arrives when a barrel stops on you and goes away when
// it moves off, and that a refresh in the middle of a lap hands the whole game
// back rather than an empty screen.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { DUEL } from '../../shared/constants.js';
import { DUEL_CARDS } from '../../shared/deck.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('playwright is not installed - skipping the browser check.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const PORT = 8500 + Math.floor(Math.random() * 400);
const [VW, VH] = (process.env.HNH_VIEWPORT || '1280x760').split('x').map(Number);
const SHOTS = process.env.HNH_SHOTS || 'test/browser/screenshots';
mkdirSync(SHOTS, { recursive: true });

// A lap is one go each plus a beat to load the chamber, so with six at the
// table the round has to be long enough for this player's own go to come round
// at least twice.
const PREP = 8, COMBAT = 400, ENDGAME = 20;
const server = spawn('node', ['server/index.js'], {
  env: {
    ...process.env, PORT: String(PORT), HNH_TELEMETRY: '0',
    HNH_MODE: 'duel',
    HNH_PREP: String(PREP), HNH_COMBAT: String(COMBAT), HNH_ENDGAME: String(ENDGAME),
    HNH_RESULTS: '240', HNH_LOBBYCOUNTDOWN: '600',
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

/** Wait for this player's own go, which comes round once a lap. */
const myGo = (page, timeout = 180000) => page.waitForFunction(
  () => window.game?.turn?.kind === 'turn' && window.game.turn.holder === window.game.selfId,
  null, { timeout },
);

try {
  const A = await open(`http://localhost:${PORT}/`, 'A');
  const code = (await A.textContent('#roomCode')).trim();

  // The lobby offers the right game. There is no gunhand to pick in a mode that
  // deals you one, and no six-card deck to look at in a mode with eighty.
  const lobby = await A.evaluate(() => {
    const up = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null).length;
    return {
      duel: window.game.duelMode,
      grid: up('#charGrid'),
      strip: document.querySelectorAll('#deckStrip .deckCard').length,
      duelBits: up('#lobbyRules .duelOnly'),
      freeBits: up('#lobbyRules .freeOnly'),
    };
  });
  check(lobby.duel, 'the server says which game this town plays');
  check(lobby.grid === 0, 'and stops offering a gunhand to pick in a mode that deals you one');
  check(lobby.strip === 22, `the lobby lays out the eighty (${lobby.strip} kinds)`);
  check(lobby.duelBits > 0 && lobby.freeBits === 0, 'and the rules under it are this mode\'s rules');

  const B = await open(`http://localhost:${PORT}/#${code}`, 'B');
  await A.bringToFront();
  await A.waitForTimeout(300);
  await A.click('#startBtn');
  await A.waitForFunction(() => window.game?.selfRole, null, { timeout: 25000 });

  // The role card, which is the only quiet moment there is to read four cards
  // you have never seen - and the one place the gunhand you were dealt is said.
  const role = await A.evaluate(() => ({
    gunhand: window.game.selfRole.gunhand,
    hands: document.getElementById('roleCharacter').textContent,
    what: document.getElementById('roleAbility').textContent,
    label: document.getElementById('charLabel').textContent,
    cards: [...document.querySelectorAll('#roleCards .handCard h5 span')].map((n) => n.textContent),
    faces: [...document.querySelectorAll('#roleCards img')]
      .map((i) => (/^data:image\/(webp|png)/.test(i.src) ? i.src.length : 0)),
    keys: [...document.querySelectorAll('#roleCards .handCard h5 em')].map((n) => n.textContent),
  }));
  check(!!role.gunhand, 'a gunhand is dealt with the role');
  check(role.hands.length > 2 && role.what.length > 20, `and it says what your hands do (${role.hands})`);
  check(!/YOU ARE PLAYING/.test(role.label), 'under a label that is not somebody else\'s name card');
  check(role.cards.length >= 3, `the opening hand is on the role card (${role.cards.length} cards)`);
  check(role.faces.length === role.cards.length && role.faces.every((n) => n > 20000),
    `every one of them is printed (${role.faces.map((n) => `${Math.round(n / 1024)}k`).join(', ')})`);
  check(role.keys.join('') === role.cards.map((_, i) => String(i + 1)).join(''),
    'and numbered with the key that plays it');
  await A.screenshot({ path: `${SHOTS}/d1-role-card.png` });
  await A.click('#roleCard');
  await A.waitForTimeout(400);

  // The bell, the chamber, and the running order.
  await A.waitForFunction(() => window.game?.turn?.kind, null, { timeout: 60000 });
  const table = await A.evaluate(() => ({
    order: [...document.querySelectorAll('#turnOrder li')].map((n) => n.textContent),
    chamber: document.getElementById('chamberLeft').textContent,
    mix: document.getElementById('chamberMix').textContent,
    hand: window.game.duel?.hand?.length || 0,
    reach: window.game.duel?.reach,
    corner: document.getElementById('mag').textContent,
    cornerLabel: document.getElementById('reserve').textContent,
  }));
  check(table.order.length >= 2, `the whole running order is on screen (${table.order.length})`);
  check(/\d/.test(table.chamber) && /\d/.test(table.mix),
    `the chamber is counted in the open (${table.chamber} ${table.mix})`);
  check(table.hand > 0, `and the hand arrived before the bell (${table.hand} cards)`);
  check(Number(table.corner) === Math.round(table.reach) && /reach|사거리/.test(table.cornerLabel),
    `the corner counts reach rather than a magazine (${table.corner} ${table.cornerLabel})`);

  // Feet. This game is played standing at a table: the mark you were dealt is
  // the mark you keep, all round, and heads are the only thing that moves.
  await A.click('#gameCanvas').catch(() => {});
  await A.waitForFunction(() => window.game?.turn?.kind, null, { timeout: 60000 });
  const seated = await A.evaluate(() => {
    const g = window.game;
    return {
      rooted: g.rooted(),
      seat: g.self?.seat,
      atTable: Math.hypot(g.self.pos.x - (-4), g.self.pos.z - 0),
    };
  });
  check(seated.rooted, 'the client knows the feet are nailed down');
  check(seated.atTable > 4 && seated.atTable < 8,
    `and it put you at the table (${seated.atTable.toFixed(1)}m from the middle of it)`);

  for (const kind of ['turn', 'reposition']) {
    await A.waitForFunction(
      (k) => window.game?.turn?.kind === k, kind, { timeout: 90000 },
    ).catch(() => {});
    const was = await A.evaluate(() => {
      window.game.keys.add('KeyW');
      return { x: window.game.self.pos.x, z: window.game.self.pos.z };
    });
    await A.waitForTimeout(1100);
    const now = await A.evaluate(() => {
      window.game.keys.delete('KeyW');
      return { x: window.game.self.pos.x, z: window.game.self.pos.z };
    });
    const walked = Math.hypot(now.x - was.x, now.z - was.z);
    check(walked < 0.6, `holding W for a second during a ${kind} moved ${walked.toFixed(1)}m`);
  }
  await A.screenshot({ path: `${SHOTS}/d2-the-table.png` });

  // A card, played with the number printed on it, and the table seeing it.
  await myGo(A);
  const play = await A.evaluate(async () => {
    const g = window.game;
    // Something that can be played at nobody: gear, a weapon, or more cards.
    const want = ['barrel', 'scope', 'mustang', 'volcanic', 'schofield', 'remington',
      'carabine', 'winchester', 'stagecoach', 'wells', 'store'];
    const at = g.duel.hand.findIndex((id) => want.includes(id));
    if (at < 0) return { skipped: true };
    const card = g.duel.hand[at];
    const before = g.duel.hand.filter((c) => c === card).length;
    g.playDuelCard(at);
    await new Promise((r) => setTimeout(r, 900));
    return {
      card,
      left: g.duel.hand.filter((c) => c === card).length,
      before,
      gear: [...(g.duel.gear || [])],
      weapon: g.duel.weapon,
      reach: g.duel.reach,
      table: g.duel.table?.length || 0,
    };
  });
  if (play.skipped) {
    check(true, 'no card in hand this go could be played at nobody (skipped)');
  } else {
    check(play.left < play.before, `a number key spends the card it is printed on (${play.card})`);
    const landed = play.gear.includes(play.card) || play.weapon === play.card
      || DUEL_CARDS[play.card]?.draw;
    check(!!landed, 'and it ends up where the card says it goes');
    check(play.table >= 2, `what is in front of everybody is public (${play.table} men on the table)`);
  }
  await A.screenshot({ path: `${SHOTS}/d3-your-go.png` });

  // A refresh in the middle of a lap. The hand IS the ammunition, so coming
  // back without it is coming back to a game you cannot play.
  const held = await A.evaluate(() => ({
    hand: [...window.game.duel.hand],
    name: document.getElementById('nameInput')?.value || 'Stranger',
  }));
  await A.reload({ waitUntil: 'domcontentloaded' });
  const resumed = await A.waitForFunction(
    () => window.game?.duel?.hand?.length > 0 && window.game?.turn?.kind,
    null, { timeout: 30000 },
  ).then(() => true).catch(() => false);
  check(resumed, 'a refresh mid-lap hands the game back rather than an empty screen');
  if (resumed) {
    const back = await A.evaluate(() => ({
      hand: window.game.duel.hand,
      order: [...document.querySelectorAll('#turnOrder li')].length,
      chamber: document.getElementById('chamberLeft').textContent,
      cham: !document.getElementById('chamberBar').classList.contains('hidden'),
    }));
    // Not the same count, necessarily - a go may have started while the page
    // was reloading, and a go starts with two cards. But something to play.
    check(back.hand.length >= 1, `and a hand to play with (${back.hand.length} cards)`);
    check(back.order >= 2 && back.cham, 'and the running order and the chamber with it');
  }
  await A.click('#roleCard').catch(() => {});

  // The warning. A barrel stops on you and you have the length of his draw -
  // and when it moves off, it has to say so.
  const warned = await A.evaluate(async () => {
    const el = document.getElementById('aimedWarn');
    window.game.hud.setAimed({ on: true, by: null });
    const up = !el.classList.contains('hidden');
    const said = el.textContent;
    window.game.hud.setAimed({ on: false });
    return { up, said, down: el.classList.contains('hidden') };
  });
  check(warned.up && warned.said.length > 5, `the warning says something (${warned.said.slice(0, 40)})`);
  check(warned.down, 'and it goes away again when the barrel moves off');

  // Nobody can be reading HE HAS YOU under the words YOUR GO.
  await myGo(A);
  const mine = await A.evaluate(() => ({
    warn: !document.getElementById('aimedWarn').classList.contains('hidden'),
    what: document.getElementById('turnWhat').textContent,
  }));
  check(!mine.warn, `no gun is on you while you hold the floor (${mine.what})`);

  // The manual, in the mode it is describing.
  await A.evaluate(() => window.game.showManual(true));
  await A.waitForTimeout(300);
  const man = await A.evaluate(() => {
    const up = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null).length;
    return {
      duel: up('#manual .duelOnly'), free: up('#manual .freeOnly'),
      keys: [...document.querySelectorAll('#manKeys span')].map((n) => n.textContent),
    };
  });
  check(man.duel > 0 && man.free === 0, `F1 describes this game and not the other (${man.duel} sections)`);
  check(man.keys.some((k) => k.startsWith('1…9')) && !man.keys.some((k) => k.startsWith('Z X')),
    'and lists this mode\'s keys');
  await A.screenshot({ path: `${SHOTS}/d4-manual.png`, fullPage: true });
  await A.evaluate(() => window.game.showManual(false));

  check(DUEL.drawTime > 0 && !!B, 'two players, one town');
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
