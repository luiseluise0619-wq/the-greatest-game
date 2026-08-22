// A token bucket, kept in its own file so it can be tested without a socket.
//
// The shape that matters: a burst is fine (a client that reconnects and catches
// up, a frame that batches two inputs), a sustained flood is not. Everything
// this server accepts is cheap except movement, which walks the claimed
// position through the whole map - so the ceiling is about CPU, not bandwidth.

/**
 * @param {number} rate   messages per second allowed on average
 * @param {number} burst  how many may arrive at once
 * @param {() => number} clock  seconds, injectable so tests do not sleep
 */
export function tokenBucket(rate, burst, clock = () => Date.now() / 1000) {
  // Refilling in floating point drifts a hair under a whole token over a long
  // stream, so a client sending at exactly the limit would start being refused
  // for no reason. A billionth of a token of tolerance costs nothing.
  const EPS = 1e-9;
  let tokens = burst;
  let last = clock();
  return function take() {
    const t = clock();
    tokens = Math.min(burst, tokens + (t - last) * rate);
    last = t;
    if (tokens < 1 - EPS) return false;
    tokens = Math.max(0, tokens - 1);
    return true;
  };
}

// Inputs go out at 30Hz and a busy frame can add a shot, a reload and a swap.
// 90/s sustained with a 200 burst is several times anything the real client
// produces, and still bounds what one socket can cost.
export const MSG_RATE = 90;
export const MSG_BURST = 200;
// Past this many refusals a socket is not lagging, it is hammering.
export const MAX_DROPPED = 400;
