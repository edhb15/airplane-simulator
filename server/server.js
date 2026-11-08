// Skyward multiplayer relay (and optional static file server).
// Relays aircraft state and chat between players in the same room over
// WebSockets (path /ws). If ./dist exists (npm run build) it also serves the
// game; otherwise "/" shows a small status page, which is the normal setup when
// the game itself is hosted elsewhere (e.g. GitHub Pages).
//
//   npm run server                       ->  http://localhost:8080, ws://localhost:8080/ws
//   PORT=9000 node server/server.js
//
// Environment variables (all optional):
//   PORT                     listening port (default 8080; set by most hosts)
//   HOST                     bind address (default 0.0.0.0)
//   ALLOWED_ORIGINS          comma-separated page origins allowed to connect,
//                            e.g. "https://user.github.io". Empty = allow any
//   TRUST_PROXY              "1" behind a reverse proxy (Render, Fly, ...) so the
//                            per-IP limit uses X-Forwarded-For
//   MAX_CLIENTS              total connections (default 256)
//   MAX_CONNECTIONS_PER_IP   connections from one address (default 8)
//   MAX_PLAYERS_PER_ROOM     pilots per room (default 32)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(__dirname, '..', 'dist');

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

export function clean(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
}

// Rebuild a state update from the known fields only, so the relay never forwards
// arbitrary payloads. Returns null if the required pose data is malformed.
export function sanitizeState(s) {
  if (!s || typeof s !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const vec = (a, n) => (Array.isArray(a) && a.length === n && a.every((v) => num(v) !== null) ? a.slice() : null);
  const list = (a, max) => (Array.isArray(a) ? a.slice(0, max).map((v) => num(v) ?? 0) : []);
  const p = vec(s.p, 3),
    q = vec(s.q, 4),
    v = vec(s.v, 3);
  if (!p || !q || !v) return null;
  return {
    p,
    q,
    v,
    g: num(s.g) ?? 0,
    f: num(s.f) ?? 0,
    sp: num(s.sp) ?? 0,
    e: list(s.e, 8),
    ab: list(s.ab, 8),
    l: (num(s.l) ?? 0) & 0xff,
    c: list(s.c, 3),
    ias: num(s.ias) ?? 0,
    gf: s.gf ? 1 : 0, // cannon firing (drawn as tracers by the other pilots)
  };
}

function originList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}

export function createRelayServer(opts = {}) {
  const env = process.env;
  const cfg = {
    dist: opts.dist ?? DEFAULT_DIST,
    allowedOrigins: opts.allowedOrigins ?? originList(env.ALLOWED_ORIGINS),
    trustProxy: opts.trustProxy ?? env.TRUST_PROXY === '1',
    maxClients: opts.maxClients ?? (Number(env.MAX_CLIENTS) || 256),
    maxPerIp: opts.maxPerIp ?? (Number(env.MAX_CONNECTIONS_PER_IP) || 8),
    maxPerRoom: opts.maxPerRoom ?? (Number(env.MAX_PLAYERS_PER_ROOM) || 32),
    heartbeatMs: opts.heartbeatMs ?? 15000,
    log: opts.log ?? ((...a) => console.log(...a)),
  };
  const rooms = new Map(); // room -> Map(id -> client)
  const ipCounts = new Map();
  const clientOf = new WeakMap(); // ws -> client, for the heartbeat
  const started = Date.now();
  let nextId = 1;

  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const broadcast = (room, msg, exceptId = null) => {
    const r = rooms.get(room);
    if (!r) return;
    const data = JSON.stringify(msg);
    for (const c of r.values()) if (c.id !== exceptId && c.ws.readyState === 1) c.ws.send(data);
  };
  const publicInfo = (c) => ({ id: c.id, name: c.name, callsign: c.callsign, aircraft: c.aircraft, livery: c.livery });
  const pilots = () => [...rooms.values()].reduce((n, r) => n + r.size, 0);
  const originAllowed = (origin) => !cfg.allowedOrigins.length || (!!origin && cfg.allowedOrigins.includes(origin.replace(/\/+$/, '').toLowerCase()));
  const clientIp = (req) => {
    const fwd = cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    return fwd || req.socket.remoteAddress || 'unknown';
  };
  const hasGame = () => fs.existsSync(path.join(cfg.dist, 'index.html'));

  // ------------------------------------------------------------------ HTTP
  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size, pilots: pilots(), uptime: Math.round((Date.now() - started) / 1000) });
    if (url.pathname === '/rooms') return json(res, 200, [...rooms.entries()].map(([name, r]) => ({ name, players: r.size })));
    if (!hasGame() && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skyward multiplayer server</title>` +
          `<body style="font-family:system-ui,sans-serif;background:#050b14;color:#e6eef8;display:grid;place-items:center;min-height:100vh;margin:0">` +
          `<div style="text-align:center"><h1 style="letter-spacing:.15em">SKYWARD</h1><p>Multiplayer server is online.</p>` +
          `<p>${pilots()} pilot(s) in ${rooms.size} room(s).</p><p style="color:#8ea3bd">Connect from the game: Multiplayer → Online server → <code>wss://${clean(req.headers.host, 120)}/ws</code></p></div>`
      );
      return;
    }
    // Static files from dist (no directory traversal)
    let p;
    try {
      p = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(cfg.dist, p));
    if (!file.startsWith(cfg.dist + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000' : 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  });

  // ------------------------------------------------------------------ WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const reject = (socket, code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return reject(socket, 404, 'Not Found');
    if (!originAllowed(req.headers.origin)) return reject(socket, 403, 'Forbidden');
    if (wss.clients.size >= cfg.maxClients) return reject(socket, 503, 'Service Unavailable');
    const ip = clientIp(req);
    if ((ipCounts.get(ip) || 0) >= cfg.maxPerIp) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  wss.on('connection', (ws, req, ip) => {
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    const client = { id: nextId++, ws, ip, room: null, name: 'Pilot', callsign: '', aircraft: 'k172', livery: '', alive: true, stateCount: 0, chatCount: 0, hitCount: 0, window: Date.now() };
    clientOf.set(ws, client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const now = Date.now();
      if (now - client.window > 1000) {
        client.window = now;
        client.stateCount = 0;
        client.chatCount = 0;
        client.hitCount = 0;
      }
      switch (msg.t) {
        case 'hello': {
          if (client.room) return;
          const room = clean(msg.room, 24) || 'public';
          const r = rooms.get(room) || new Map();
          if (r.size >= cfg.maxPerRoom) {
            send(ws, { t: 'error', text: 'Room is full' });
            ws.close(1008, 'Room is full');
            return;
          }
          rooms.set(room, r);
          client.room = room;
          client.name = clean(msg.name, 20) || 'Pilot';
          client.callsign = clean(msg.callsign, 14) || `SKY${client.id}`;
          client.aircraft = clean(msg.aircraft, 12) || 'k172';
          client.livery = clean(msg.livery, 32);
          r.set(client.id, client);
          send(ws, { t: 'welcome', id: client.id, room, players: [...r.values()].filter((c) => c.id !== client.id).map(publicInfo) });
          broadcast(room, { t: 'join', player: publicInfo(client) }, client.id);
          cfg.log(`[${room}] ${client.callsign} joined — ${r.size} pilot(s)`);
          break;
        }
        case 'state': {
          if (!client.room || ++client.stateCount > 30) return;
          const s = sanitizeState(msg.s);
          if (s) broadcast(client.room, { t: 'state', id: client.id, s }, client.id);
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
        case 'hit': {
          // Cannon hits are scored by the shooter and delivered to the target only
          if (!client.room || ++client.hitCount > 20) return;
          const target = rooms.get(client.room)?.get(Number(msg.target));
          if (!target || target === client) return;
          const dmg = Math.max(0, Math.min(50, Number(msg.dmg) || 0));
          if (dmg > 0) send(target.ws, { t: 'hit', from: client.id, name: client.callsign || client.name, dmg });
          break;
        }
        case 'down': {
          // A pilot reports being shot down; everyone in the room hears about it
          if (!client.room || client.downAt > now - 5000) return;
          client.downAt = now;
          const shooter = rooms.get(client.room)?.get(Number(msg.by));
          broadcast(client.room, { t: 'down', id: client.id, name: client.callsign || client.name, by: shooter ? shooter.id : 0, byName: shooter ? shooter.callsign || shooter.name : '' });
          break;
        }
        case 'ping':
          send(ws, { t: 'pong', ts: Number(msg.ts) || 0 });
          break;
      }
    });
    ws.on('close', () => {
      const n = (ipCounts.get(ip) || 1) - 1;
      if (n > 0) ipCounts.set(ip, n);
      else ipCounts.delete(ip);
      if (!client.room) return;
      const r = rooms.get(client.room);
      if (r) {
        r.delete(client.id);
        broadcast(client.room, { t: 'leave', id: client.id });
        if (r.size === 0) rooms.delete(client.room);
        cfg.log(`[${client.room}] ${client.callsign} left`);
      }
    });
  });

  // Drop dead connections
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const c = clientOf.get(ws);
      if (c && !c.alive) {
        ws.terminate();
        continue;
      }
      if (c) c.alive = false;
      ws.ping();
    }
  }, cfg.heartbeatMs);
  heartbeat.unref();

  return {
    server,
    wss,
    rooms,
    config: cfg,
    listen(port, host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
    },
    // Tell pilots the server is going away, then stop accepting connections
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) {
        send(ws, { t: 'error', text: 'Server restarting' });
        ws.close(1012, 'Server restarting');
      }
      return new Promise((resolve) => {
        wss.close();
        server.close(() => resolve());
        setTimeout(() => {
          for (const ws of wss.clients) ws.terminate();
          resolve();
        }, 2000).unref();
      });
    },
  };
}

// Run directly: node server/server.js
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const relay = createRelayServer();
  const port = await relay.listen(Number(process.env.PORT) || 8080, process.env.HOST || '0.0.0.0');
  const c = relay.config;
  console.log(`Skyward server on port ${port} — WebSocket path /ws${fs.existsSync(path.join(c.dist, 'index.html')) ? ', serving the game from dist/' : ''}`);
  console.log(`Allowed origins: ${c.allowedOrigins.length ? c.allowedOrigins.join(', ') : 'any'}`);
  const stop = async (sig) => {
    console.log(`${sig} received, shutting down`);
    await relay.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
