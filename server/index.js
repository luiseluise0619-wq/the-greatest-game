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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = process.env.HOST || '0.0.0.0';

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
  // three.js is served straight out of node_modules so there is no build step.
  if (urlPath === '/vendor/three.module.js') {
    return path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
  }
  // The addon tree (GLTFLoader, SkeletonUtils, ...) is served under one prefix so
  // its own relative imports keep resolving.
  if (urlPath.startsWith('/vendor/jsm/')) {
    const rel = path.normalize(urlPath.slice('/vendor/jsm/'.length)).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', rel);
    return full.startsWith(path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')) ? full : null;
  }
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
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
for (const key of ['prep', 'combat', 'endgame', 'results']) {
  const env = process.env[`HNH_${key.toUpperCase()}`];
  if (env && Number.isFinite(Number(env))) TIMING[key] = Number(env);
}

const manager = new RoomManager();

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  // Deploy platforms poll this; it doubles as a live population readout.
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), ...manager.stats() }));
    return;
  }

  // What the playtest actually produced. Read it with: curl -s host/stats | jq
  if (urlPath === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...manager.stats(), ...telemetry.summary() }, null, 2));
    return;
  }

  const file = resolveRequest(urlPath);
  if (!file) { res.writeHead(404); res.end('not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// Nothing this protocol sends is large: chat is capped at 140 characters and
// the biggest message is a movement packet. 8KB is generous and stops a socket
// from making the process hold a megabyte of nonsense.
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  // A socket is roomless until its join message says which town it wants.
  const client = { ws, room: null, playerId: null };
  const allow = tokenBucket(MSG_RATE, MSG_BURST);
  let dropped = 0;
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
    try {
      manager.handleMessage(client, msg);
    } catch (err) {
      console.error('[room] message error', msg.t, err);
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

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    telemetry.flush();        // do not lose the last few minutes of a playtest
    console.log('\n  ...adios.');
    process.exit(0);
  });
}
