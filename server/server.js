// Skyward multiplayer + static file server.
// Serves the built game from ./dist and relays aircraft state and chat between
// players in the same room over WebSockets (path /ws).
//
//   npm run build && npm run server      ->  http://localhost:8080
//   PORT=9000 node server/server.js

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS_PER_ROOM = 32;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const rooms = new Map(); // room -> Map(id -> client)
let nextId = 1;

function clean(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId = null) {
  const r = rooms.get(room);
  if (!r) return;
  const data = JSON.stringify(msg);
  for (const c of r.values()) if (c.id !== exceptId && c.ws.readyState === 1) c.ws.send(data);
}

function publicInfo(c) {
  return { id: c.id, name: c.name, callsign: c.callsign, aircraft: c.aircraft, livery: c.livery };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (url.pathname === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify([...rooms.entries()].map(([name, r]) => ({ name, players: r.size }))));
    return;
  }
  // Static files from dist (no directory traversal)
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!fs.existsSync(path.join(DIST, 'index.html'))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Game not built yet. Run "npm run build" first (multiplayer relay is running).');
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const client = { id: nextId++, ws, room: null, name: 'Pilot', callsign: '', aircraft: 'k172', livery: '', alive: true, stateCount: 0, chatCount: 0, window: Date.now() };
  ws.on('pong', () => (client.alive = true));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    if (now - client.window > 1000) {
      client.window = now;
      client.stateCount = 0;
      client.chatCount = 0;
    }
    switch (msg.t) {
      case 'hello': {
        if (client.room) return;
        const room = clean(msg.room, 24) || 'public';
        if (!rooms.has(room)) rooms.set(room, new Map());
        const r = rooms.get(room);
        if (r.size >= MAX_PLAYERS_PER_ROOM) {
          send(ws, { t: 'error', text: 'Room is full' });
          ws.close();
          return;
        }
        client.room = room;
        client.name = clean(msg.name, 20) || 'Pilot';
        client.callsign = clean(msg.callsign, 14) || `SKY${client.id}`;
        client.aircraft = clean(msg.aircraft, 12) || 'k172';
        client.livery = clean(msg.livery, 32);
        r.set(client.id, client);
        send(ws, { t: 'welcome', id: client.id, room, players: [...r.values()].filter((c) => c.id !== client.id).map(publicInfo) });
        broadcast(room, { t: 'join', player: publicInfo(client) }, client.id);
        console.log(`[${room}] ${client.name} (${client.callsign}) joined — ${r.size} pilot(s)`);
        break;
      }
      case 'state': {
        if (!client.room || ++client.stateCount > 30) return;
        const s = msg.s;
        if (!s || !Array.isArray(s.p) || !Array.isArray(s.q)) return;
        broadcast(client.room, { t: 'state', id: client.id, s }, client.id);
        break;
      }
      case 'info': {
        if (!client.room) return;
        client.aircraft = clean(msg.aircraft, 12) || client.aircraft;
        client.livery = clean(msg.livery, 32);
        broadcast(client.room, { t: 'info', player: publicInfo(client) }, client.id);
        break;
      }
      case 'chat': {
        if (!client.room || ++client.chatCount > 3) return;
        const text = clean(msg.text, 240);
        if (!text) return;
        broadcast(client.room, { t: 'chat', id: client.id, name: client.callsign || client.name, text, ts: now });
        break;
      }
      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts });
        break;
    }
  });
  ws.on('close', () => {
    if (!client.room) return;
    const r = rooms.get(client.room);
    if (r) {
      r.delete(client.id);
      broadcast(client.room, { t: 'leave', id: client.id });
      if (r.size === 0) rooms.delete(client.room);
      console.log(`[${client.room}] ${client.name} left`);
    }
  });
});

// Drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    const c = [...rooms.values()].flatMap((r) => [...r.values()]).find((x) => x.ws === ws);
    if (c && !c.alive) {
      ws.terminate();
      continue;
    }
    if (c) c.alive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Skyward server running on http://localhost:${PORT}  (WebSocket: ws://localhost:${PORT}/ws)`);
});
