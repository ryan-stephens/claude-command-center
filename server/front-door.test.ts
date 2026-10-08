import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { FrontDoors } from './front-door.ts';
import { listening } from './ports.ts';

// A stand-in UI: answers with its name and the Host it was asked for, sets two cookies, and echoes
// on a WebSocket (live reload) with its name.
async function standIn(name: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    res.setHeader('set-cookie', [`a=${name}`, 'b=2']);
    res.end(`${name} ${req.headers.host} ${req.method} ${req.url}`);
  });
  new WebSocketServer({ server }).on('connection', (ws) => ws.on('message', (m) => ws.send(`${name}:${String(m)}`)));
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

const get = async (port: number, path = '/app/') => {
  const r = await fetch(`http://localhost:${port}${path}`);
  return { status: r.status, text: await r.text(), cookies: r.headers.getSetCookie() };
};

function echo(port: number): Promise<{ ws: WebSocket; said: string[]; closed: Promise<void> }> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const said: string[] = [];
  ws.onmessage = (e) => said.push(String(e.data));
  const closed = new Promise<void>((r) => { ws.onclose = () => r(); });
  return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, said, closed }); ws.onerror = () => reject(new Error('no socket')); });
}
const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
};

test('the front door shows one card’s UI at a time on its port, pages, cookies and WebSockets too, and closes with the last (§123)', async () => {
  const a = await standIn('A', 18781), b = await standIn('B', 18782);
  let changes = 0;
  const doors = new FrontDoors(() => { changes++; });
  try {
    await doors.join(18780, 'c1', 'CARD-1', 18781);
    await doors.join(18780, 'c2', 'CARD-2', 18782);
    assert.deepEqual(doors.stateOf('c1'), { port: 18780, shown: true }, 'the first card in is shown');
    assert.deepEqual(doors.stateOf('c2'), { port: 18780, shown: false });
    const one = await get(18780, '/app/x?y=1');
    assert.equal(one.text, 'A localhost:18780 GET /app/x?y=1', 'forwarded as asked, the Host kept as the door’s');
    assert.deepEqual(one.cookies, ['a=A', 'b=2'], 'both cookies come through');
    const sock = await echo(18780);
    sock.ws.send('hi');
    await until(() => sock.said.length > 0);
    assert.deepEqual(sock.said, ['A:hi'], 'live reload’s socket reaches the shown card');

    assert.equal(doors.show('c2'), 18780);
    assert.equal((await get(18780)).text.split(' ')[0], 'B', 'o on card 2: the door shows it');
    assert.deepEqual(doors.stateOf('c2'), { port: 18780, shown: true });
    await sock.closed;
    const sock2 = await echo(18780);
    sock2.ws.send('hi');
    await until(() => sock2.said.length > 0);
    assert.deepEqual(sock2.said, ['B:hi'], 'the old socket was closed; a new one reaches card 2');
    sock2.ws.close();

    b.close();
    await new Promise((r) => setTimeout(r, 100));
    const down = await get(18780);
    assert.equal(down.status, 502);
    assert.match(down.text, /CARD-2’s UI isn’t answering/);

    doors.leave('c2');
    assert.equal((await get(18780)).text.split(' ')[0], 'A', 'card 2 gone: the door shows the card left');
    assert.equal(doors.show('c9'), undefined, 'a card with no door');
    doors.leave('c1');
    assert.equal(doors.isOpen(18780), false);
    assert.equal(await listening(18780), false, 'the last card gone: the port is free again');
    assert.ok(changes >= 4, 'each change is told');
  } finally {
    doors.closeAll();
    a.close(); b.close();
  }
});

test('a door can’t open on a port something else listens on, and says so (§123)', async () => {
  const other = await standIn('other', 18785);
  const doors = new FrontDoors();
  try {
    await assert.rejects(doors.join(18785, 'c1', 'CARD-1', 18786), /The front door couldn’t open on 18785: something else listens there/);
    assert.equal(doors.isOpen(18785), false);
    assert.equal(doors.stateOf('c1'), undefined);
    // Two cards at once open one door.
    await Promise.all([doors.join(18787, 'c1', 'CARD-1', 18788), doors.join(18787, 'c2', 'CARD-2', 18789)]);
    assert.equal(doors.stateOf('c1')?.port, 18787);
    assert.equal(doors.stateOf('c2')?.port, 18787);
  } finally {
    doors.closeAll();
    other.close();
  }
});
