import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { get, set } from './store.ts';

let socket: WebSocket | null = null;
const pendingCreates = new Map<string, { resolve: (id: string) => void; reject: (e: Error) => void }>();

export function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    set({ connected: true, lastError: null });
    const { openId } = get();
    if (openId) send({ type: 'session.open', id: openId });
  };
  socket.onclose = () => {
    set({ connected: false });
    setTimeout(connect, 1000);
  };
  socket.onmessage = (e) => receive(JSON.parse(e.data) as ServerMsg);
}

export function send(msg: ClientMsg): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  else set({ lastError: 'Not connected to the cc-control server.' });
}

export function createSession(cwd: string, prompt?: string): Promise<string> {
  const reqId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingCreates.set(reqId, { resolve, reject });
    send({ type: 'session.create', reqId, cwd, prompt });
  });
}

function receive(msg: ServerMsg): void {
  switch (msg.type) {
    case 'sessions': {
      const { selectedId } = get();
      const stillThere = msg.sessions.some((s) => s.id === selectedId);
      set({ sessions: msg.sessions, repos: msg.repos, selectedId: stillThere ? selectedId : (msg.sessions[0]?.id ?? null) });
      return;
    }
    case 'session.upsert': {
      const sessions = get().sessions.filter((s) => s.id !== msg.session.id);
      sessions.push(msg.session);
      sessions.sort((a, b) => b.lastModified - a.lastModified);
      set({ sessions });
      return;
    }
    case 'session.created':
      pendingCreates.get(msg.reqId)?.resolve(msg.id);
      pendingCreates.delete(msg.reqId);
      return;
    case 'session.forked': {
      const s = get();
      set({
        transcripts: { ...s.transcripts, [msg.newId]: s.transcripts[msg.newId] ?? s.transcripts[msg.oldId] ?? [] },
        openId: s.openId === msg.oldId ? msg.newId : s.openId,
        selectedId: s.selectedId === msg.oldId ? msg.newId : s.selectedId,
      });
      return;
    }
    case 'session.transcript':
      set({ transcripts: { ...get().transcripts, [msg.id]: msg.items } });
      return;
    case 'session.items': {
      const t = get().transcripts;
      set({ transcripts: { ...t, [msg.id]: [...(t[msg.id] ?? []), ...msg.items] } });
      return;
    }
    case 'session.partial':
      set({ partials: { ...get().partials, [msg.id]: msg.text } });
      return;
    case 'permission.request': {
      set({ permissions: { ...get().permissions, [msg.request.reqId]: msg.request } });
      // The approval card takes focus in the open session so Y / A / N work straight away.
      const s = get();
      if (s.screen === 'session' && s.openId === msg.request.sessionId) set({ zone: 'transcript' });
      return;
    }
    case 'permission.resolved': {
      const { [msg.reqId]: _, ...rest } = get().permissions;
      set({ permissions: rest });
      return;
    }
    case 'error':
      if (msg.reqId && pendingCreates.has(msg.reqId)) {
        pendingCreates.get(msg.reqId)!.reject(new Error(msg.message));
        pendingCreates.delete(msg.reqId);
      }
      set({ lastError: msg.message });
      return;
  }
}
