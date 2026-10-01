// The channels into cards' terminal sessions (hooks/cc-control-channel.mjs is the other end,
// started by Claude Code with the card's `claude`). Each connects here over a WebSocket on
// loopback, proves which card it is with the card's token, and from then on: a message from the
// page goes into the session as if typed at the terminal, and the terminal's permission prompts
// come here to be answered from the page. One channel per card; a newer one replaces an older.

import type { WebSocket } from 'ws';

/** What the terminal is asking, as Claude Code relays it. */
export interface PermissionRequest {
  request_id: string;
  tool_name: string;
  description?: string;
  input_preview?: string;
}

/** A socket as this service needs it: ws's, or a stand-in in tests. */
export interface ChannelSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'message', fn: (data: unknown) => void): unknown;
  on(event: 'close', fn: () => void): unknown;
}

export interface ChannelHooks {
  /** Is this the card's token? */
  tokenOk(cardId: string, token: string): boolean;
  /** The channel connected (and which session it sits in) or went away. */
  state(cardId: string, on: boolean, sessionId?: string): void;
  /** The terminal asks to allow a tool. */
  ask(cardId: string, req: PermissionRequest): void;
}

const OPEN = 1;

export class ChannelService {
  private live = new Map<string, ChannelSocket>();
  private hooks: ChannelHooks;

  constructor(hooks: ChannelHooks) {
    this.hooks = hooks;
  }

  /** A new socket: nothing is believed until its hello carries a card's token. */
  accept(sock: ChannelSocket | WebSocket): void {
    const s = sock as ChannelSocket;
    let cardId: string | undefined;
    const timer = setTimeout(() => { if (!cardId) s.close(); }, 10_000);
    s.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(data)) as Record<string, unknown>; } catch { return; }
      if (!cardId) {
        if (msg.type !== 'hello' || typeof msg.card !== 'string' || typeof msg.token !== 'string' || !this.hooks.tokenOk(msg.card, msg.token)) { s.close(); return; }
        clearTimeout(timer);
        cardId = msg.card;
        const old = this.live.get(cardId);
        if (old && old !== s) old.close();
        this.live.set(cardId, s);
        this.hooks.state(cardId, true, typeof msg.sessionId === 'string' ? msg.sessionId : undefined);
        return;
      }
      if (msg.type === 'permission_request' && typeof msg.request_id === 'string' && typeof msg.tool_name === 'string') {
        this.hooks.ask(cardId, {
          request_id: msg.request_id.slice(0, 80), tool_name: msg.tool_name.slice(0, 80),
          ...(typeof msg.description === 'string' ? { description: msg.description.slice(0, 500) } : {}),
          ...(typeof msg.input_preview === 'string' ? { input_preview: msg.input_preview.slice(0, 2000) } : {}),
        });
      }
    });
    s.on('close', () => {
      clearTimeout(timer);
      if (cardId && this.live.get(cardId) === s) { this.live.delete(cardId); this.hooks.state(cardId, false); }
    });
  }

  /** Is the card's terminal reachable right now? */
  has(cardId: string): boolean {
    const s = this.live.get(cardId);
    return Boolean(s && s.readyState === OPEN);
  }

  /** Type into the card's terminal session. Throws when there is no channel to it. */
  send(cardId: string, text: string): void {
    const s = this.live.get(cardId);
    if (!s || s.readyState !== OPEN) throw new Error('This card’s terminal can’t be reached from here (it started without a channel, or the tab is gone): type in its tab.');
    s.send(JSON.stringify({ type: 'send', text }));
  }

  /** Answer a permission prompt the terminal relayed. */
  answer(cardId: string, requestId: string, behavior: 'allow' | 'deny'): void {
    const s = this.live.get(cardId);
    if (!s || s.readyState !== OPEN) throw new Error('This card’s terminal can’t be reached from here: answer in its tab.');
    s.send(JSON.stringify({ type: 'permission', request_id: requestId, behavior }));
  }

  /** The server is going away. */
  closeAll(): void {
    for (const s of this.live.values()) s.close();
    this.live.clear();
  }
}
