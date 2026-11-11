#!/usr/bin/env node
/**
 * Run the browser test suite headlessly, with no dependency: a static server
 * from node:http, Chrome in headless mode, and the DevTools protocol over the
 * WebSocket that Node 22 ships with.
 *
 *   node dev/run-tests.mjs            run the suite once
 *   CHROME=/path/to/chrome node ...   use that browser
 *
 * It waits for the suite to say it is done, in real time, rather than giving
 * Chrome a virtual-time budget: the virtual clock jumped straight over the
 * page's timeouts while its animation frames waited for the real one, so a
 * loaded machine failed tests whose code was fine.
 *
 * The run fails on any failing test, on a suite that never finishes, and on
 * any uncaught exception or console error in the page or in the app frame —
 * a handler that throws on a click does not fail a check, and that is exactly
 * how a broken palette shipped unnoticed.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEADLINE = 3 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch { /* not this one */ }
  }
  // Where Playwright keeps its own build, as in the cloud development image.
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const bin = path.join(base, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(bin)) return bin;
    }
  }
  throw new Error('Chrome introuvable : précisez son chemin dans la variable CHROME');
}

function launch(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ihb-chrome-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    // Throttling is what made the app frame look broken under load: a frame
    // Chrome judges hidden gets no animation frames, and the app draws in one.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1400,1000', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = new Promise((resolve, reject) => {
    let log = '';
    proc.stderr.on('data', (chunk) => {
      log += chunk;
      const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', (code) => reject(new Error(`Chrome s'est arrêté (code ${code}) :\n${log}`)));
  });
  const stop = () => {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { ws, stop };
}

/** A minimal DevTools protocol client: commands by id, events by name. */
function connect(url) {
  const socket = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  socket.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of handlers.get(msg.method) || []) fn(msg.params, msg.sessionId);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, []);
    handlers.get(method).push(fn);
  };
  const open = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('connexion DevTools impossible')), { once: true });
  });
  return { open, send, on, close: () => socket.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeException(d) {
  const ex = d.exception;
  const text = ex?.description || ex?.value || d.text || 'exception';
  const where = d.url ? ` (${d.url.split('/').pop()}:${d.lineNumber + 1})` : '';
  return `${String(text).split('\n')[0]}${where}`;
}

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error(`Node ${process.versions.node} : il faut Node 22 ou plus (WebSocket global)`);
  }
  const server = await serve();
  const port = server.address().port;
  const chrome = launch(findChrome());
  const errors = [];
  let cdp = null;
  try {
    cdp = connect(await chrome.ws);
    await cdp.open;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => cdp.send(method, params, sessionId);

    cdp.on('Runtime.exceptionThrown', (p) => errors.push(`exception : ${describeException(p.exceptionDetails)}`));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'assert') return;
      errors.push(`console.error : ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry.level === 'error') errors.push(`journal : ${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`);
    });
    await s('Runtime.enable');
    await s('Log.enable');
    await s('Page.enable');
    await s('Page.navigate', { url: `http://127.0.0.1:${port}/tests/index.html` });

    const started = Date.now();
    let shown = 0;
    let state = null;
    while (Date.now() - started < DEADLINE) {
      await sleep(250);
      const { result } = await s('Runtime.evaluate', {
        expression: `(() => { const t = window.__tests; return t ? JSON.stringify({
          done: t.done, passed: t.passed, failed: t.failed, results: t.results.slice(${shown}) }) : null; })()`,
        returnByValue: true,
      });
      if (!result.value) continue;
      state = JSON.parse(result.value);
      for (const r of state.results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail}`);
      shown += state.results.length;
      if (state.done) break;
    }
    // A moment for an error raised by the last test's own aftermath.
    await sleep(300);

    let ok = true;
    console.log('');
    if (!state || !state.done) {
      console.log(`La suite ne s'est pas terminée en ${DEADLINE / 1000} s : ${shown} tests exécutés.`);
      ok = false;
    } else if (state.failed) {
      console.log(`${state.passed} réussis, ${state.failed} en échec.`);
      ok = false;
    } else if (!state.passed) {
      console.log('Aucun test exécuté.');
      ok = false;
    } else {
      console.log(`${state.passed} tests réussis.`);
    }
    if (errors.length) {
      console.log(`\n${errors.length} erreur(s) dans la page :`);
      for (const e of errors) console.log(`  ${e}`);
      ok = false;
    }
    return ok ? 0 : 1;
  } finally {
    cdp?.close();
    chrome.stop();
    server.close();
  }
}

main().then((code) => process.exit(code), (e) => {
  console.error(e.message);
  process.exit(2);
});
