// The front door (PLAN §123): a UI's sign-in provider only sends you back to the address registered
// for it (its own port and path), so a second card's UI on a port of its own can't sign in. cc-control
// holds that port itself while any card's UI of that app runs, and forwards everything on it (pages,
// API calls through the dev server's proxy, live reload's WebSocket) to one card's UI at a time,
// on the port that card's run picked. o on a card points the door at it. Loopback only.

import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';

/** A card behind a door: its key (to name it) and the port its UI serves on. */
interface Member {
  key: string;
  port: number;
}

interface Door {
  home: number;
  servers: Server[];
  members: Map<string, Member>;
  /** The card the door shows. */
  shown?: string;
  /** WebSockets forwarded to the shown card's UI: closed when the door turns to another. */
  sockets: Set<Socket>;
}

/** What a card's UI run says about its door. */
export interface DoorState {
  port: number;
  shown: boolean;
}

/** Listen on one loopback address; resolve false when it isn't there (no IPv6), reject when it's taken. */
function listenOn(server: Server, port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT' ? resolve(false) : reject(e)));
    server.listen(port, host, () => resolve(true));
  });
}

const page = (res: ServerResponse, status: number, text: string) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>cc-control front door</title><body style="font:15px system-ui;margin:3rem;max-width:40rem;color:#333">${text}</body>`);
};

export class FrontDoors {
  private doors = new Map<number, Door>();
  private opening = new Map<number, Promise<Door>>();
  private changed: () => void;

  constructor(changed: () => void = () => {}) {
    this.changed = changed;
  }

  /**
   * Put a card's UI (serving on `port`) behind the door on `home`, opening the door if it isn't yet.
   * The first card in is shown. Throws when `home` is taken by something else (the door can't open).
   */
  async join(home: number, cardId: string, key: string, port: number): Promise<void> {
    const door = this.doors.get(home) ?? await this.open(home);
    door.members.set(cardId, { key, port });
    if (!door.shown || !door.members.has(door.shown)) door.shown = cardId;
    this.changed();
  }

  /** The card's UI is gone: off its door; the door shows another card's, or closes when none is left. */
  leave(cardId: string): void {
    for (const door of this.doors.values()) {
      if (!door.members.delete(cardId)) continue;
      if (door.shown === cardId) this.turn(door, [...door.members.keys()].pop());
      if (!door.members.size) this.close(door);
    }
    this.changed();
  }

  /** o on a card: its door shows its UI. Returns the door's port, or undefined when it has none. */
  show(cardId: string): number | undefined {
    const door = [...this.doors.values()].find((d) => d.members.has(cardId));
    if (!door) return undefined;
    if (door.shown !== cardId) { this.turn(door, cardId); this.changed(); }
    return door.home;
  }

  /** The card's door, if its UI is behind one. */
  stateOf(cardId: string): DoorState | undefined {
    const door = [...this.doors.values()].find((d) => d.members.has(cardId));
    return door ? { port: door.home, shown: door.shown === cardId } : undefined;
  }

  /** Is a door open on this port? */
  isOpen(home: number): boolean {
    return this.doors.has(home);
  }

  closeAll(): void {
    for (const door of [...this.doors.values()]) this.close(door);
  }

  private turn(door: Door, cardId: string | undefined): void {
    door.shown = cardId;
    // Live reload's socket stays on the card it was opened to: closed, the page's dev client notices.
    for (const s of door.sockets) s.destroy();
    door.sockets.clear();
  }

  private close(door: Door): void {
    this.turn(door, undefined);
    for (const s of door.servers) { s.close(); s.closeAllConnections(); }
    this.doors.delete(door.home);
  }

  /** One open per port, however many cards ask at once. */
  private open(home: number): Promise<Door> {
    let p = this.opening.get(home);
    if (!p) {
      p = this.listen(home).finally(() => this.opening.delete(home));
      this.opening.set(home, p);
    }
    return p;
  }

  private async listen(home: number): Promise<Door> {
    const door: Door = { home, servers: [], members: new Map(), sockets: new Set() };
    // Both loopback addresses: a browser may try localhost as ::1 first. One already taken there
    // (a dev server of its own on the port) means the door can't stand in for it.
    for (const host of ['127.0.0.1', '::1']) {
      const server = createServer((req, res) => this.forward(door, req, res));
      server.on('upgrade', (req, socket, head) => this.upgrade(door, req, socket as Socket, head));
      try {
        if (await listenOn(server, home, host)) door.servers.push(server);
      } catch (e) {
        for (const s of door.servers) s.close();
        throw new Error(`The front door couldn’t open on ${home}: ${(e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'something else listens there' : (e as Error).message}.`);
      }
    }
    this.doors.set(home, door);
    return door;
  }

  private target(door: Door): Member | undefined {
    return door.shown ? door.members.get(door.shown) : undefined;
  }

  private forward(door: Door, req: IncomingMessage, res: ServerResponse): void {
    const to = this.target(door);
    if (!to) {
      page(res, 503, `<h2>No card’s UI is shown here</h2><p>In cc-control, press <b>o</b> on a card whose UI runs to show it on this port.</p>`);
      return;
    }
    // The Host header is kept (localhost:<door>), so what the app builds from it stays on the door.
    const up = request({ host: 'localhost', port: to.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.statusMessage, r.rawHeaders);
      r.pipe(res);
    });
    res.on('close', () => up.destroy());
    up.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      page(res, 502, `<h2>${to.key}’s UI isn’t answering</h2><p>It may still be compiling, or it was stopped. Its Try it panel says which; press <b>o</b> on another card to show that one here.</p>`);
    });
    req.pipe(up);
  }

  /** A WebSocket (live reload): the request as it came, then bytes both ways. */
  private upgrade(door: Door, req: IncomingMessage, socket: Socket, head: Buffer): void {
    const to = this.target(door);
    if (!to) { socket.destroy(); return; }
    const up = connect({ host: 'localhost', port: to.port });
    const done = () => { socket.destroy(); up.destroy(); door.sockets.delete(socket); };
    up.on('error', done);
    socket.on('error', done);
    socket.on('close', done);
    up.on('close', done);
    up.on('connect', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    door.sockets.add(socket);
  }
}
