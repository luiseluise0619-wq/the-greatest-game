// The socket rate limiter. Its whole job is to tell a burst apart from a flood,
// so both halves of that are worth pinning down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenBucket, MSG_RATE, MSG_BURST } from '../server/ratelimit.js';

/** A bucket with a clock the test drives by hand. */
function bucket(rate, burst) {
  let t = 1000;
  const take = tokenBucket(rate, burst, () => t);
  return { take, advance(sec) { t += sec; } };
}

test('a burst is allowed, and then it is not', () => {
  const b = bucket(10, 5);
  for (let i = 0; i < 5; i++) assert.equal(b.take(), true, `burst message ${i} refused`);
  assert.equal(b.take(), false, 'the sixth message in the same instant got through');
});

test('the bucket refills at its rate and no faster', () => {
  const b = bucket(10, 5);
  for (let i = 0; i < 5; i++) b.take();
  b.advance(0.25);                       // 2.5 tokens
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false, 'a quarter second bought more than a quarter second');
  b.advance(60);                         // idle for a minute
  let got = 0;
  while (b.take()) got += 1;
  assert.equal(got, 5, 'an idle socket saved up more than one burst');
});

test('a steady stream at the limit never trips it', () => {
  const b = bucket(MSG_RATE, MSG_BURST);
  for (let i = 0; i < MSG_BURST; i++) b.take();      // spend the burst first
  for (let i = 0; i < 600; i++) {
    b.advance(1 / MSG_RATE);
    assert.equal(b.take(), true, `refused an in-budget message at ${i}`);
  }
});

test('the real settings leave the client plenty of room', () => {
  // The client sends input at 30Hz; everything else is a keypress.
  assert.ok(MSG_RATE > 30 * 2, 'the limit is inside what an honest client sends');
  assert.ok(MSG_BURST >= MSG_RATE, 'a burst smaller than a second of traffic will misfire');
});
