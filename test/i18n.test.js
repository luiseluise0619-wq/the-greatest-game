// The Korean overlay.
//
// The design here is that there is only ever one English copy of any string -
// the one in the HTML, in constants.js, or in the sentence the server built -
// and the translation is keyed to it. That makes one kind of mistake
// impossible (two English copies drifting apart) and one kind easy: a key in
// the page that nobody translated, or a translation for a key that no longer
// exists. Both of those are what this file is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { t, has, keys, pickLang, closed, LANGS, DEFAULT_LANG } = await import('../shared/i18n.js');

const HTML = await readFile(new URL('../client/index.html', import.meta.url), 'utf8');
// The client asks for most of these; the server asks for the rest. A sentence
// the server composed travels with its key, so room.js names keys too, and a
// key it stopped sending is exactly as dead as one the HUD stopped sending.
const SRC = await Promise.all([
  ...['js/main.js', 'js/hud.js', 'js/settings.js']
    .map((f) => readFile(new URL(`../client/${f}`, import.meta.url), 'utf8')),
  readFile(new URL('../server/room.js', import.meta.url), 'utf8'),
  readFile(new URL('../server/bots.js', import.meta.url), 'utf8'),
  // A key can also be built where the thing it names is defined rather than
  // where it is asked for: voiceLine() in constants.js picks between a shout's
  // two versions and hands back the key with it, so the eight shouts are named
  // nowhere else and read as dead the moment this file stopped being scanned.
  readFile(new URL('../shared/constants.js', import.meta.url), 'utf8'),
  // And the room manager, which owns the three sentences a player reads when
  // their code is wrong or the town is full - the first words the game ever
  // says to some people, and for a long time the only ones that came out in
  // English whatever language they had asked for.
  readFile(new URL('../server/rooms.js', import.meta.url), 'utf8'),
]).then((all) => all.join('\n'));

/** Every key the page asks for by attribute. */
function htmlKeys() {
  return [...HTML.matchAll(/data-i18n(?:-html|-ph|-title)?="([^"]+)"/g)].map((m) => m[1]);
}

// The namespaces this file owns. Anything in the client that looks like one of
// these is a key, wherever it appears - t('x'), this.t('x'), t(lang, 'x'), or
// sitting in the ['key', 'English'] pair a refusal is written as. Matching the
// call shapes instead was how this test came to report a dozen keys as unused
// while the game was quite happily using all of them.
const NAMESPACES = ['ui', 'rules', 'key', 'set', 'hud', 'phase', 'role', 'faction',
  'char', 'card', 'sb', 'res', 'deny', 'boot', 'voice', 'loot', 'turn',
  'cham', 'aim', 'duel', 'man', 'feed', 'kill', 'place', 'intel', 'tl', 'bot', 'gun', 'end', 'chip', 'boon',
  // The three sentences a player reads when their code is wrong or the town is
  // full. A namespace that is not on this list is invisible to the scanner, so
  // its keys read as "translated but never asked for" - which is what happened
  // when these were added, and is exactly the alarm this list is for.
  'err'];
const KEYISH = new RegExp(`^(?:${NAMESPACES.join('|')})\\.[\\w.]+$`);

/** Every key the client asks for in code, literal or built from an id. */
function codeKeys() {
  const out = [];
  for (const m of SRC.matchAll(/'([\w.]+)'/g)) if (KEYISH.test(m[1])) out.push(m[1]);
  // `card.${id}.name` and friends: a family rather than one key.
  for (const m of SRC.matchAll(/`([\w.]+)\$\{[^}]+\}([\w.]*)`/g)) {
    if (NAMESPACES.some((n) => m[1].startsWith(`${n}.`))) out.push(`${m[1]}*${m[2]}`);
  }
  return out;
}

test('every string the page asks for has been translated', () => {
  const missing = [...new Set(htmlKeys())].filter((k) => !has('ko', k));
  assert.deepEqual(missing, [], `the page asks for these and Korean has never heard of them:\n  ${missing.join('\n  ')}`);
});

test('every string the client asks for by name has been translated', () => {
  // Template keys like `card.${id}.name` are checked as a pattern: at least one
  // Korean key has to match the shape, or the whole family is untranslated.
  const all = [...new Set(codeKeys())];
  const ko = keys('ko');
  const missing = all.filter((k) => {
    if (!k.includes('*')) return !has('ko', k);
    const [head, tail] = k.split('*');
    return !ko.some((real) => real.startsWith(head) && real.endsWith(tail));
  });
  assert.deepEqual(missing, [], `asked for in code, missing in Korean:\n  ${missing.join('\n  ')}`);
});

test('no Korean sentence puts a particle after a name the client wraps in a tag', () => {
  // Particle choice reads the last character of whatever went into the hole.
  // The server sends plain names, so a particle after one of those is right.
  // The client builds some of its own lines and wraps the names in <b> first -
  // and "<b>베인</b>" ends in ">", which is not Hangul, so `closed()` falls
  // through to "treat it as closed" and the sentence takes the same wrong
  // particle for every name in the game.
  //
  // The lines the client composes are the kill feed and the round's account.
  // They are written without a particle after the name, and this is what makes
  // that a rule instead of a habit somebody breaks next time.
  const clientComposed = (k) => /^(kill|tl)\./.test(k) || k === 'feed.watchPatch';
  const bad = [];
  for (const key of keys('ko')) {
    if (!clientComposed(key)) continue;
    for (const m of String(t('ko', key, '')).matchAll(/\{(\w+):([^{}/]+)\/([^{}]+)\}/g)) {
      bad.push(`${key}: {${m[1]}} takes a particle, and the client fills it with a tag`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n  '));
});

test('nothing in the Korean table is talking to itself', () => {
  // A key nobody asks for any more is either a rename that only got done on one
  // side, or a screen that was deleted. Both are worth knowing about.
  const asked = new Set(htmlKeys());
  const patterns = codeKeys().filter((k) => k.includes('*')).map((k) => k.split('*'));
  for (const k of codeKeys()) asked.add(k);
  const orphans = keys('ko').filter((k) => {
    if (asked.has(k)) return false;
    return !patterns.some(([head, tail]) => k.startsWith(head) && k.endsWith(tail));
  });
  assert.deepEqual(orphans, [], `translated but never asked for:\n  ${orphans.join('\n  ')}`);
});

test('an untranslated key falls through to the English it was handed', () => {
  assert.equal(t('ko', 'no.such.key', 'FALL BACK'), 'FALL BACK');
  assert.equal(t('en', 'ui.join', 'JOIN'), 'JOIN', 'English is never looked up, only passed through');
  assert.equal(t('zz', 'ui.join', 'JOIN'), 'JOIN', 'an unknown language is English');
  assert.equal(t('ko', 'ui.join', 'JOIN'), '입장');
  // A missing fallback is an empty string, never the word "undefined".
  assert.equal(t('en', 'no.such.key'), '');
});

test('the holes in a sentence get filled, and only the ones we have', () => {
  assert.equal(t('en', 'x', 'ready {ready}/{of}', { ready: 1, of: 2 }), 'ready 1/2');
  assert.equal(t('en', 'x', '{a} and {b}', { a: 'one' }), 'one and {b}',
    'a value nobody passed is left visible rather than printed as undefined');
  assert.equal(t('ko', 'hud.standing', '', { n: 4 }), '<b>4</b>명 생존');
});

test('a name in a Korean sentence takes the particle the name takes', () => {
  // Korean picks half its particles on whether the word before them ends in a
  // consonant, so a sentence with somebody's name in it cannot know its own
  // grammar until the name arrives. This is that, and it is why the fallback
  // English and the Korean cannot be the same string with the same holes.
  assert.equal(t('en', 'x', '{a:이/가} 쓰러졌다', { a: '보안관' }), '보안관이 쓰러졌다');
  assert.equal(t('en', 'x', '{a:이/가} 쓰러졌다', { a: '무법자' }), '무법자가 쓰러졌다');
  assert.equal(t('en', 'x', '{a:은/는} 안 움직였다', { a: '별' }), '별은 안 움직였다');
  assert.equal(t('en', 'x', '{a:을/를} 쐈다', { a: '가마' }), '가마를 쐈다');
  // A Latin name takes the particle its Korean *reading* takes, and the reading
  // is not in the spelling - Vane is 베인 and closes, Kessler is 케슬러 and does
  // not, and they end in the same two letters. So there is no guess: anything
  // that is not Hangul takes the closed form, and the Korean in this project is
  // written so that nobody's name ever stands in front of a particle.
  assert.equal(t('en', 'x', '{a:이/가}', { a: 'Vane' }), 'Vane이');
  assert.equal(closed('Vane'), true);
  assert.equal(closed('케슬러'), false, '러 is an open syllable and the arithmetic says so');
  // And a plain hole is still a plain hole, in either language.
  assert.equal(t('en', 'x', '{a} and {b}', { a: 'one', b: 'two' }), 'one and two');
  assert.equal(t('en', 'x', '{a:이/가}', {}), '{a:이/가}', 'a value nobody passed stays visible');
  assert.equal(closed(''), false, 'nothing at all ends in nothing at all');
});

test('a Korean browser gets Korean and everybody else gets English', () => {
  assert.equal(pickLang(['ko-KR', 'en-US']), 'ko');
  assert.equal(pickLang(['ko']), 'ko');
  assert.equal(pickLang(['en-GB', 'ko']), 'ko', 'second choice still counts');
  assert.equal(pickLang(['en-US']), DEFAULT_LANG);
  assert.equal(pickLang([]), DEFAULT_LANG);
  assert.equal(pickLang(undefined), DEFAULT_LANG);
  assert.equal(pickLang('ko-KR'), 'ko', 'a bare string, not just a list');
  for (const lang of LANGS) assert.equal(typeof lang, 'string');
});

test('no Korean string is left as English by accident', () => {
  // A value that is pure ASCII is almost always a copy-paste that never got
  // translated. The exceptions are the ones that are deliberately not language.
  const ALLOWED = /^[\s\d.:/%<>bBZXQEFGHRTV\-—·()]*$/;
  const suspects = keys('ko').filter((k) => {
    const v = t('ko', k, '');
    return !/[가-힣]/.test(v) && !ALLOWED.test(v);
  });
  assert.deepEqual(suspects, [], `these Korean entries have no Korean in them:\n  ${suspects.join('\n  ')}`);
});

test('no Korean sentence puts a particle after anybody\'s name', () => {
  // Half of Korean's particles are chosen by whether the word before them ends
  // in a consonant, and a Latin name's Korean *reading* is not in its spelling:
  // Kessler is 케슬러 and takes 가, Vane is 베인 and takes 이, and they end in
  // the same two letters. `closed()` says so in as many words and falls through
  // to the closed form for anything that is not Hangul — which is a decision
  // about the machinery, not a fix.
  //
  // Every name in this game is Latin. So a sentence with a particle after a
  // player's name is wrong for most of the roster, every time, and it reads
  // wrong: "Dutch Kessler이 별을 답니다". The file has always SAID it is
  // written round this. Nine strings were not, and nothing checked.
  //
  // A hole is only safe if what goes into it is a word this project chose and
  // wrote in Korean itself — a card, a role, a place. Those are listed. Every
  // other hole must be bare.
  const OURS = {
    card: 'a card name, translated before the sentence is filled',
    role: 'a role name, ours',
    where: 'a place phrase, already Korean',
    p: 'a place name, ours',
    n: 'a number', live: 'a number', blank: 'a number', limit: 'a number', of: 'a number',
  };
  // The one sentence whose a and b really are our own words: two place names.
  const EXCEPT = new Set(['place.between']);

  const bad = [];
  for (const key of keys('ko')) {
    if (EXCEPT.has(key)) continue;
    for (const m of String(t('ko', key, '')).matchAll(/\{(\w+):([^{}/]+)\/([^{}]+)\}/g)) {
      if (OURS[m[1]]) continue;
      bad.push(`${key}: {${m[1]}} is filled with somebody's name and takes ${m[2]}/${m[3]}`);
    }
  }
  assert.deepEqual(bad, [],
    `these read wrong for every Latin name in the game:\n  ${bad.join('\n  ')}`);
});
