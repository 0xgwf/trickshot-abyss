// SPDX-License-Identifier: AGPL-3.0-or-later
// Serves the built game (dist/) to everyone on the LAN, plus a tiny shared leaderboard.
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinCoop } from './server/coop.mjs';
import { joinVersus } from './server/versus.mjs';
import { acceptWebSocket } from './server/ws.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, 'dist');
const DATA_DIR = process.env.DATA_DIR ?? join(HERE, 'data');
const SCORES = join(DATA_DIR, 'scores.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

let scores = [];
try {
  scores = JSON.parse(await readFile(SCORES, 'utf8'));
} catch {
  scores = [];
}

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);

async function saveScores() {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SCORES}.tmp`;
  await writeFile(tmp, JSON.stringify(scores));
  await rename(tmp, SCORES);
}

/** Deeper layers first; within a layer clears (fastest) beat failed runs (furthest). */
const ranked = () =>
  [...scores].sort(
    (a, b) =>
      (b.layer ?? 1) - (a.layer ?? 1) ||
      (a.won !== b.won ? (a.won ? -1 : 1) : a.won ? a.time - b.time : b.progress - a.progress || b.kills - a.kills),
  );

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4096) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);

  if (urlPath === '/api/scores') {
    if (req.method === 'GET') return json(res, 200, { top: ranked().slice(0, 20), total: scores.length });
    if (req.method === 'POST') {
      try {
        const b = JSON.parse(await readBody(req));
        const entry = {
          name: clean(b.name, 12) || '无名氏',
          char: clean(b.char, 12),
          won: !!b.won,
          time: Math.max(0, Math.min(7200, Number(b.time) || 0)),
          kills: Math.max(0, Math.min(1e6, Math.floor(Number(b.kills) || 0))),
          level: Math.max(0, Math.min(999, Math.floor(Number(b.level) || 0))),
          progress: Math.max(0, Math.min(1, Number(b.progress) || 0)),
          stage: clean(b.stage, 8),
          layer: Math.max(1, Math.min(8, Math.floor(Number(b.layer) || 1))),
          at: Date.now(),
        };
        scores.push(entry);
        if (scores.length > 2000) scores = ranked().slice(0, 1500);
        await saveScores();
        const r = ranked();
        return json(res, 200, { rank: r.indexOf(entry) + 1, top: r.slice(0, 20), total: scores.length });
      } catch {
        return json(res, 400, { error: 'bad request' });
      }
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  let file = normalize(join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const hashed = file.startsWith(join(ROOT, 'assets'));
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

// Multiplayer: the first message on /ws picks the mode.
server.on('upgrade', (req, socket) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
  const conn = acceptWebSocket(req, socket);
  if (!conn) return;
  conn.onMessage = (msg) => {
    if (msg?.t === 'join' && msg.mode === 'versus') joinVersus(conn, msg);
    else if (msg?.t === 'join' && msg.mode === 'coop') joinCoop(conn, msg);
  };
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('Trickshot Abyss is up:');
  for (const ip of ips) console.log(`  http://${ip}:${PORT}`);
});
