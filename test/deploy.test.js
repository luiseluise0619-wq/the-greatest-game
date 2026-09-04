// The container, checked without a Docker daemon.
//
// Every deployment of this game is the image, so "it works on my machine" is
// not allowed to mean anything - and the CI job that builds and runs it is the
// real answer. This file is the cheap half of that: the mistakes you can find
// by reading the Dockerfile against .dockerignore and the repository, which
// are the ones that otherwise cost a whole CI round trip to discover.
//
// It exists because of exactly one such mistake. `.dockerignore` excludes
// `*.md`, the Dockerfile was given `COPY NOTICE.md`, and a COPY of a path the
// build context does not contain does not quietly skip it - it fails the build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = (p) => new URL(`../${p}`, import.meta.url);
const DOCKERFILE = await readFile(root('Dockerfile'), 'utf8');
const IGNORE = await readFile(root('.dockerignore'), 'utf8');
const FLY = await readFile(root('fly.toml'), 'utf8');
const PKG = JSON.parse(await readFile(root('package.json'), 'utf8'));

/** The lines of .dockerignore that mean anything, in order. */
const rules = IGNORE.split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

/** Would this path survive into the build context? Last matching rule wins. */
function included(path) {
  let keep = true;
  for (const rule of rules) {
    const negate = rule.startsWith('!');
    const body = negate ? rule.slice(1) : rule;
    // Enough of the glob language for the rules this project uses.
    const re = new RegExp(`^${body
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')}(/.*)?$`);
    if (re.test(path)) keep = negate;
  }
  return keep;
}

test('every path the Dockerfile copies is in the repository', async () => {
  for (const m of DOCKERFILE.matchAll(/^COPY\s+(.+)$/gm)) {
    const parts = m[1].trim().split(/\s+/);
    for (const src of parts.slice(0, -1)) {      // the last one is the destination
      if (src.startsWith('--')) continue;
      await assert.doesNotReject(access(root(src)),
        `the Dockerfile copies "${src}" and there is no such path`);
    }
  }
});

test('and survives .dockerignore, which is not the same question', () => {
  // A COPY of a path the build context does not contain fails the build. It
  // does not skip it, and it does not warn - so a file that is in the repo and
  // ignored by the context is a broken image, found on the next deploy.
  for (const m of DOCKERFILE.matchAll(/^COPY\s+(.+)$/gm)) {
    const parts = m[1].trim().split(/\s+/);
    for (const src of parts.slice(0, -1)) {
      if (src.startsWith('--')) continue;
      assert.equal(included(src), true,
        `the Dockerfile copies "${src}" and .dockerignore keeps it out of the context`);
    }
  }
});

test('nothing that is not ours to ship can reach the image', () => {
  // client/models/ can hold a glTF character to swap in for the built-in
  // geometry, and the one used while that path was written is CC-BY-4.0. It is
  // kept out of git by .gitignore and has to be kept out of the image too -
  // those are two separate files and the second was once forgotten.
  for (const p of ['client/models/CesiumMan.glb', 'client/models/anything.glb',
    'client/models/scene.gltf']) {
    assert.equal(included(p), false, `${p} would be built into the image`);
  }
  // And the source of the server is not the client, whatever the context holds.
  assert.match(DOCKERFILE, /COPY client \.\/client/, 'the page stopped being copied');
  assert.equal(/^COPY test/m.test(DOCKERFILE), false, 'the suite is being shipped to production');
});

test('the container runs what package.json says to run', () => {
  const cmd = /^CMD \["node", "([^"]+)"\]/m.exec(DOCKERFILE);
  assert.ok(cmd, 'the Dockerfile stopped saying what to run');
  assert.equal(cmd[1], PKG.main.replace(/^\.\//, ''),
    'the image runs a different entry point from `npm start`');
  assert.match(DOCKERFILE, /npm ci --omit=dev/,
    'the image installs development dependencies into production');
});

test('fly.toml and the Dockerfile agree about the port', () => {
  const exposed = /^EXPOSE (\d+)/m.exec(DOCKERFILE);
  const envPort = /^ENV PORT=(\d+)/m.exec(DOCKERFILE);
  const flyInternal = /internal_port = (\d+)/.exec(FLY);
  const flyEnv = /PORT = "(\d+)"/.exec(FLY);
  assert.ok(exposed && envPort && flyInternal && flyEnv, 'a port declaration has gone missing');
  const all = new Set([exposed[1], envPort[1], flyInternal[1], flyEnv[1]]);
  assert.equal(all.size, 1,
    `four places name the port and they say ${[...all].join(', ')}`);
});

test('the health check the platform polls is one the server answers', () => {
  const flyPath = /path = "([^"]+)"/.exec(FLY);
  assert.ok(flyPath, 'fly.toml stopped checking anything');
  assert.match(DOCKERFILE, new RegExp(flyPath[1].replace('/', '\\/')),
    'fly.io polls a path the container healthcheck does not');
});

test('a single instance, because rooms live in one process', () => {
  // A room is a JavaScript object in one process's memory. Two machines behind
  // a load balancer is two separate sets of towns, and a code created on one is
  // "not found" on the other - so scaling this out silently breaks the only
  // way anybody joins their friends.
  assert.match(FLY, /auto_stop_machines = false/,
    'a cold lobby that takes ten seconds to answer reads as a broken game');
  assert.match(FLY, /min_machines_running = 1/);
});
