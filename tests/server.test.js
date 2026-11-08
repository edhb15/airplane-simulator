// Multiplayer relay server: protocol, validation, limits and HTTP endpoints.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer, sanitizeState, clean } from '../server/server.js';

const ORIGIN = 'https://pilot.github.io';

function connect(port, { origin = ORIGIN, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers });
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('unexpected-response', (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
};

const hello = (c, room, callsign) => c.ws.send(JSON.stringify({ t: 'hello', room, name: 'Test', callsign, aircraft: 'mj320', livery: 'aurelia' }));
const pose = { p: [1, 2, 3], q: [0, 0, 0, 1], v: [0, 0, -60], g: 1, f: 15, sp: 0, e: [0.8, 0.8], ab: [0, 0], l: 13, c: [0, 0, 0], ias: 140 };

describe('relay server', () => {
  let relay, port;
  beforeAll(async () => {
    relay = createRelayServer({ allowedOrigins: [ORIGIN], maxPerIp: 4, maxPerRoom: 3, dist: '/nonexistent', log: () => {} });
    port = await relay.listen(0, '127.0.0.1');
  });
  afterAll(() => relay.close());
  // Each test closes its sockets; wait until the server has released them all
  afterEach(async () => {
    await until(() => relay.wss.clients.size === 0);
  });

  it('joins a room, announces pilots and relays state and chat', async () => {
    const a = await connect(port);
    hello(a, 'r1', 'ALPHA');
    expect(await until(() => a.msgs.some((m) => m.t === 'welcome'))).toBe(true);
    const b = await connect(port);
    hello(b, 'r1', 'BRAVO');
    expect(await until(() => b.msgs.some((m) => m.t === 'welcome'))).toBe(true);
    expect(b.msgs.find((m) => m.t === 'welcome').players.map((p) => p.callsign)).toEqual(['ALPHA']);
    expect(await until(() => a.msgs.some((m) => m.t === 'join' && m.player.callsign === 'BRAVO'))).toBe(true);

    a.ws.send(JSON.stringify({ t: 'state', s: { ...pose, extra: 'x'.repeat(100) } }));
    expect(await until(() => b.msgs.some((m) => m.t === 'state'))).toBe(true);
    const st = b.msgs.find((m) => m.t === 'state');
    expect(st.s.p).toEqual([1, 2, 3]);
    expect(st.s.extra).toBeUndefined();
    expect(a.msgs.some((m) => m.t === 'state')).toBe(false); // not echoed to the sender

    b.ws.send(JSON.stringify({ t: 'chat', text: 'hello <b>all</b>' }));
    expect(await until(() => a.msgs.some((m) => m.t === 'chat'))).toBe(true);
    expect(a.msgs.find((m) => m.t === 'chat')).toMatchObject({ name: 'BRAVO', text: 'hello ball/b' });

    b.ws.close();
    expect(await until(() => a.msgs.some((m) => m.t === 'leave'))).toBe(true);
    a.ws.close();
  });

  it('drops malformed state updates', async () => {
    const a = await connect(port);
    const b = await connect(port);
    hello(a, 'r2', 'A');
    hello(b, 'r2', 'B');
    await until(() => b.msgs.some((m) => m.t === 'welcome'));
    a.ws.send(JSON.stringify({ t: 'state', s: { p: [1, 2], q: [0, 0, 0, 1], v: [0, 0, 0] } }));
    a.ws.send(JSON.stringify({ t: 'state', s: { p: [1, 'x', 3], q: [0, 0, 0, 1], v: [0, 0, 0] } }));
    a.ws.send('not json');
    a.ws.send(JSON.stringify({ t: 'state', s: pose }));
    await until(() => b.msgs.some((m) => m.t === 'state'));
    expect(b.msgs.filter((m) => m.t === 'state')).toHaveLength(1);
    a.ws.close();
    b.ws.close();
  });

  it('rejects other origins, full rooms and too many connections per address', async () => {
    await expect(connect(port, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');

    const members = [];
    for (let i = 0; i < 3; i++) {
      const c = await connect(port);
      hello(c, 'small', `P${i}`);
      await until(() => c.msgs.some((m) => m.t === 'welcome'));
      members.push(c);
    }
    // maxPerIp is 4: one more connection is allowed, the room is full though
    const extra = await connect(port);
    hello(extra, 'small', 'LATE');
    expect(await until(() => extra.msgs.some((m) => m.t === 'error' && m.text === 'Room is full'))).toBe(true);
    await until(() => extra.ws.readyState === WebSocket.CLOSED);
    const fifth = await connect(port);
    await expect(connect(port)).rejects.toThrow('HTTP 429');
    for (const c of [...members, fifth]) c.ws.close();
  });

  it('serves health, room list with CORS and a status page', async () => {
    const a = await connect(port);
    hello(a, 'lobby', 'HEALTH');
    await until(() => a.msgs.some((m) => m.t === 'welcome'));
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    expect(h.headers.get('access-control-allow-origin')).toBe('*');
    expect(await h.json()).toMatchObject({ ok: true, pilots: 1 });
    const rooms = await (await fetch(`http://127.0.0.1:${port}/rooms`)).json();
    expect(rooms).toContainEqual({ name: 'lobby', players: 1 });
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(page).toContain('Multiplayer server is online');
    const traversal = await fetch(`http://127.0.0.1:${port}/..%2Fpackage.json`);
    expect(traversal.status).toBeGreaterThanOrEqual(400);
    a.ws.close();
  });
});

describe('dogfight messages', () => {
  let relay, port;
  beforeAll(async () => {
    relay = createRelayServer({ allowedOrigins: [], log: () => {} });
    port = await relay.listen(0, '127.0.0.1');
  });
  afterAll(() => relay.close());

  it('delivers hits only to the target, clamps damage and announces shoot-downs', async () => {
    const a = await connect(port);
    const b = await connect(port);
    const c = await connect(port);
    const other = await connect(port);
    hello(a, 'arena', 'VIPER');
    hello(b, 'arena', 'EAGLE');
    hello(c, 'arena', 'HAWK');
    hello(other, 'elsewhere', 'GHOST');
    for (const x of [a, b, c, other]) await until(() => x.msgs.some((m) => m.t === 'welcome'));
    const id = (x) => x.msgs.find((m) => m.t === 'welcome').id;

    a.ws.send(JSON.stringify({ t: 'hit', target: id(b), dmg: 500 }));
    a.ws.send(JSON.stringify({ t: 'hit', target: id(other), dmg: 30 })); // different room: dropped
    a.ws.send(JSON.stringify({ t: 'hit', target: id(a), dmg: 30 })); // self: dropped
    expect(await until(() => b.msgs.some((m) => m.t === 'hit'))).toBe(true);
    expect(b.msgs.find((m) => m.t === 'hit')).toMatchObject({ from: id(a), name: 'VIPER', dmg: 50 });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.msgs.some((m) => m.t === 'hit')).toBe(false);
    expect(other.msgs.some((m) => m.t === 'hit')).toBe(false);
    expect(a.msgs.some((m) => m.t === 'hit')).toBe(false);

    b.ws.send(JSON.stringify({ t: 'down', by: id(a) }));
    for (const x of [a, b, c]) expect(await until(() => x.msgs.some((m) => m.t === 'down'))).toBe(true);
    expect(c.msgs.find((m) => m.t === 'down')).toMatchObject({ id: id(b), name: 'EAGLE', by: id(a), byName: 'VIPER' });
    expect(other.msgs.some((m) => m.t === 'down')).toBe(false);

    // gunfire flag survives state sanitising
    a.ws.send(JSON.stringify({ t: 'state', s: { ...pose, gf: 1 } }));
    expect(await until(() => c.msgs.some((m) => m.t === 'state' && m.s.gf === 1))).toBe(true);
    for (const x of [a, b, c, other]) x.ws.close();
    await until(() => relay.wss.clients.size === 0);
  });
});

describe('message sanitising', () => {
  it('keeps only known state fields with finite numbers', () => {
    expect(sanitizeState({ ...pose, l: 999, e: [1, 2, 'x'], hack: 1 })).toEqual({ ...pose, l: 999 & 0xff, e: [1, 2, 0], gf: 0 });
    expect(sanitizeState({ p: [1, 2, 3], q: [0, 0, 0, 1], v: [0, Infinity, 0] })).toBeNull();
    expect(sanitizeState(null)).toBeNull();
  });
  it('strips control characters and markup from text', () => {
    expect(clean(' a<script>\u0007b ', 20)).toBe('ascriptb');
    expect(clean('x'.repeat(50), 10)).toHaveLength(10);
  });
});
