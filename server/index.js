// Entry point: a tiny static file server + the websocket game server.
// `npm start` and open http://localhost:8080

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';
import { TIMING } from '../shared/constants.js';
import { telemetry } from './telemetry.js';
import { tokenBucket, MSG_RATE, MSG_BURST, MAX_DROPPED } from './ratelimit.js';
import { MODES, DEFAULT_MODE } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = process.env.HOST || '0.0.0.0';
const STATS_TOKEN = process.env.HNH_STATS_TOKEN || '';

const MIME = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Only these prefixes are reachable; everything else 404s.
const ALLOW = ['client', 'shared', 'vendor'];

function resolveRequest(urlPath) {
  if (urlPath === '/' || urlPath === '') return path.join(ROOT, 'client', 'index.html');
  // A directory is served by its index.html, the way every static server does.
  // Without this the proof sheet the README hands people - /proof/ - is a read
  // of a directory, which fails with EISDIR and comes back looking like a 404.
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  // three.js is served straight out of node_modules so there is no build step.
  if (urlPath === '/vendor/three.module.js') {
    return path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
  }
  // The addon tree (GLTFLoader, SkeletonUtils, ...) is served under one prefix so
  // its own relative imports keep resolving.
  if (urlPath.startsWith('/vendor/jsm/')) {
    const rel = path.normalize(urlPath.slice('/vendor/jsm/'.length)).replace(/^(\.\.[/\\])+/, '');
    if (rel.includes('\0')) return null;
    const full = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', rel);
    return full.startsWith(path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')) ? full : null;
  }
  // A path the browser never sends but anybody with curl can: "/%" is not a
  // valid escape and decodeURIComponent throws a URIError on it. Nothing here
  // caught it, so one malformed request took the process down and every round
  // on it with it. A path that cannot be decoded is a path that does not
  // resolve to a file, which is a 404 like any other.
  let clean;
  try {
    clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  } catch { return null; }
  // "/%00" decodes to a real NUL, and fs.readFile does not return an error for
  // a path containing one - it throws, synchronously, out of the request
  // handler and off the top of the process. One curl took the server down and
  // every match running on it with it. A path that cannot name a file is a 404.
  if (clean.includes('\0')) return null;
  const rel = clean.replace(/^[/\\]+/, '');
  const top = rel.split(/[/\\]/)[0];
  if (ALLOW.includes(top)) {
    const full = path.join(ROOT, rel);
    if (full.startsWith(ROOT)) return full;
    return null;
  }
  // Bare paths fall through to /client (so /js/main.js works too).
  const inClient = path.join(ROOT, 'client', rel);
  if (inClient.startsWith(path.join(ROOT, 'client'))) return inClient;
  return null;
}

// Short rounds for testing and for showing the loop off quickly:
//   HNH_FAST=1 npm start      (or set the individual phase lengths in seconds)
if (process.env.HNH_FAST) {
  TIMING.prep = 10; TIMING.combat = 75; TIMING.endgame = 30; TIMING.results = 12;
}
for (const key of ['prep', 'combat', 'endgame', 'results', 'lobbyCountdown']) {
  const env = process.env[`HNH_${key.toUpperCase()}`];
  if (env && Number.isFinite(Number(env))) TIMING[key] = Number(env);
}

// Which game the rooms on this server play. The turn mode is the default; the
// free-for-all is still here and the suite that grew up around it still runs
// against it.
const MODE = process.env.HNH_MODE === 'free' ? MODES.FREE : DEFAULT_MODE;

const manager = new RoomManager({ mode: MODE });

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  // Deploy platforms poll this; it doubles as a live population readout.
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), ...manager.stats() }));
    return;
  }

  // What the playtest actually produced. Read it with: curl -s host/stats | jq
  //
  // It is aggregate only - no names, no room codes, nothing about one person -
  // so it is open by default, which is what a playtest on a laptop wants. Set
  // HNH_STATS_TOKEN on a public deployment and it wants ?token= to match.
  if (urlPath === '/stats') {
    if (STATS_TOKEN) {
      const asked = new URL(req.url || '/', 'http://x').searchParams.get('token');
      if (asked !== STATS_TOKEN) { res.writeHead(404); res.end('not found'); return; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...manager.stats(), ...telemetry.summary() }, null, 2));
    return;
  }

  // And a belt to go with those braces. A static file server is the one part
  // of this that anything on the network can reach without saying hello first,
  // and a throw in here is not a bad response - it is the end of every round
  // running on the process.
  let file = null;
  try { file = resolveRequest(urlPath); } catch (err) {
    console.error('[http] bad path', err);
    res.writeHead(400); res.end('bad request'); return;
  }
  if (!file) { res.writeHead(404); res.end('not found'); return; }
  serve(file, res, true);
});

function serve(file, res, retryAsDirectory = false) {
  // fs.readFile throws rather than calling back for a handful of bad paths.
  // Nothing reachable from the network gets to end the process.
  try {
    fs.readFile(file, (err, data) => {
      // A bare directory name with no trailing slash: same answer, one hop later.
      if (err && err.code === 'EISDIR' && retryAsDirectory) {
        serve(path.join(file, 'index.html'), res);
        return;
      }
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  } catch (err) {
    console.error('[http] unreadable path', err && err.code);
    res.writeHead(404); res.end('not found');
  }
}

// Nothing this protocol sends is large: chat is capped at 140 characters and
// the biggest message is a movement packet. 8KB is generous and stops a socket
// from making the process hold a megabyte of nonsense.
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

// A room holds at most 8 and the manager holds at most 200 of them, so 2000
// sockets is already far more than a full server can be using. Without a
// ceiling, opening sockets is a free way to make one process hold state for
// somebody who never intends to play - and every one of them costs a token
// bucket, a client record and a slot in the server's map.
const MAX_SOCKETS = Number(process.env.HNH_MAX_SOCKETS || 2000);

wss.on('connection', (ws) => {
  if (wss.clients.size > MAX_SOCKETS) {
    try { ws.close(1013, 'server busy'); } catch { /* already gone */ }
    return;
  }
  // A socket is roomless until its join message says which town it wants.
  const client = { ws, room: null, playerId: null };
  const allow = tokenBucket(MSG_RATE, MSG_BURST);
  let dropped = 0;
  // Four letters out of a thirty-two letter alphabet is a million codes, and a
  // private room is private because nobody guesses which one it is. A socket
  // that is guessing is not playing: after this many wrong codes it is shown
  // the door, so finding a private room costs an attacker a new connection
  // every twenty tries rather than a tight loop on one.
  let badJoins = 0;
  ws.on('message', (raw) => {
    // Movement is the expensive message - the server walks the claimed position
    // through the whole map - so one socket must not be able to spend the
    // server's frame on its own.
    if (!allow()) {
      if (++dropped > MAX_DROPPED) ws.close(1008, 'too many messages');
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const guessing = msg.t === 'join' && !client.room && msg.room;
    try {
      manager.handleMessage(client, msg);
    } catch (err) {
      console.error('[room] message error', msg.t, err);
    }
    // It found a town if it is in one now. If it is not, that was a guess.
    if (guessing && !client.room && ++badJoins >= 20) {
      try { ws.close(1008, 'too many bad codes'); } catch { /* gone */ }
    }
  });
  ws.on('close', () => manager.dropClient(client));
  ws.on('error', () => manager.dropClient(client));
});

manager.start();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  HIGH NOON HOLLOW  -  hidden-role western FPS prototype');
  console.log('  ---------------------------------------------------');
  console.log(`  Play:      http://localhost:${PORT}`);
  console.log('  LAN play:  share your machine\'s IP on the same port');
  console.log('  Bots fill any empty slots - press START in the lobby.');
  console.log('  Rooms:     share the 4-letter code, or the link with #CODE');
  console.log('');
});

/**
 * Going down.
 *
 * A deploy platform sends SIGTERM and then waits; this used to call exit(0) on
 * the spot, which drops every socket with no close frame. The browser sees a
 * connection that simply stopped, and the reconnect loop it has treats that
 * the way it treats a tunnel - it waits, backs off, and tells eight people
 * their network is bad when what actually happened is that a new version
 * shipped.
 *
 * So: stop taking new connections, tell everybody still playing what happened
 * in a code their client can read, flush the playtest numbers, and go. With a
 * deadline, because a socket that will not close is not a reason to hang.
 */
let leaving = false;
function shutdown(sig) {
  if (leaving) return;
  leaving = true;
  console.log(`\n  ${sig} - closing the saloon.`);
  server.close();
  manager.stop();
  for (const ws of wss.clients) {
    // 1012 is "service restart", and it is the one thing that tells a client
    // to come back rather than to worry.
    try { ws.close(1012, 'server restarting'); } catch { /* already gone */ }
  }
  telemetry.flush();          // do not lose the last few minutes of a playtest
  const done = setTimeout(() => { console.log('  ...adios.'); process.exit(0); }, 1500);
  done.unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));

// A throw nobody caught used to be the end of every round on the process, and
// the last thing anybody saw was a stack trace in a log they could not read.
// It still ends the process - a server in an unknown state should not keep
// dealing hands - but it says goodbye on the way out, so the eight people in
// the room get "server restarting" and a reconnect instead of silence.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (err) => {
  console.error('[fatal] unhandled rejection', err);
});
