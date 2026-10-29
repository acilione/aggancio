// Run on Linux after portable:build. No browser is opened: a temporary xdg-open
// stand-in records the launch URL while exercising the real native executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'linux') throw new Error('Run this lifecycle test on Linux; browser-portable.mjs also supports Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const executable = path.join(root, 'releases', `Commons-${version}-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`);
const staging = path.join(root, 'test-results', 'portable-lifecycle');
await mkdir(staging, { recursive: true });
await writeFile(path.join(staging, 'xdg-open'), '#!/bin/sh\nprintf "%s" "$1" > "$COMMONS_TEST_URL_FILE"\n', { mode: 0o755 });
const urlFile = path.join(staging, 'browser-url.txt');
await writeFile(urlFile, '');
const running = spawn(executable, ['--port', '0'], { env: { ...process.env, PATH: `${staging}:${process.env.PATH}`, COMMONS_TEST_URL_FILE: urlFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; running.stdout.on('data', data => output += data); running.stderr.on('data', data => output += data);
let origin;
try {
  for (let i = 0; i < 100; i++) {
    const value = await readFile(urlFile, 'utf8');
    if (value) { origin = value; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(output.includes(origin), 'Browser URL matches the listening address');
  const status = await (await fetch(origin + '/_commons/status')).json();
  assert.equal(status.version, version);
  const script = await (await fetch(origin + '/_commons/client.js')).text();
  const token = script.match(/const token = "([a-f0-9]+)"/)[1];
  const exit = once(running, 'exit');
  assert.equal((await fetch(origin + '/_commons/quit', { method: 'POST', headers: { 'X-Commons-Token': token } })).status, 204);
  assert.equal((await exit)[0], 0);
} finally { if (running.exitCode === null) running.kill('SIGINT'); }

const blocker = createServer(socket => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nunrelated'));
blocker.listen(0, '127.0.0.1'); await once(blocker, 'listening');
try {
  const conflict = spawn(executable, ['--no-browser', '--port', String(blocker.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let message = ''; conflict.stderr.on('data', data => message += data);
  assert.equal((await once(conflict, 'exit'))[0], 1);
  assert.ok(message.includes('Close the application using that port'), message);
} finally { blocker.close(); }
console.log('PASS: native browser-launch URL, loopback binding, shutdown, and occupied-port failure without silently changing storage origin.');
