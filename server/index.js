// Entry point: a tiny static file server + the websocket game server.
// `npm start` and open http://localhost:8080

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { TIMING } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
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

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
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

const wss = new WebSocketServer({ server });
const room = new Room();

wss.on('connection', (ws, req) => {
  const client = room.addConnection(ws);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      room.handleMessage(client, msg);
    } catch (err) {
      console.error('[room] message error', msg.t, err);
    }
  });
  ws.on('close', () => room.removeConnection(client));
  ws.on('error', () => room.removeConnection(client));
});

room.start();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  HIGH NOON HOLLOW  -  hidden-role western FPS prototype');
  console.log('  ---------------------------------------------------');
  console.log(`  Play:      http://localhost:${PORT}`);
  console.log('  LAN play:  share your machine\'s IP on the same port');
  console.log('  Bots fill any empty slots - press START in the lobby.');
  console.log('');
});

process.on('SIGINT', () => { console.log('\n  ...adios.'); process.exit(0); });
