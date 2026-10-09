// The page's line to the v2 server: one live snapshot over server-sent events, and JSON posts.

import { useSyncExternalStore } from 'react';
import type { Snapshot } from '../shared/types.ts';

let snap: Snapshot | null = null;
let connected = false;
const subs = new Set<() => void>();
const tell = () => { for (const f of subs) f(); };

export function connect(): void {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => { snap = JSON.parse((e as MessageEvent).data) as Snapshot; connected = true; tell(); });
  es.onerror = () => { connected = false; tell(); };
}

export function useSnapshot(): { snap: Snapshot | null; connected: boolean } {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);
  return { snap: s, connected };
}

export async function post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return json;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return json;
}

// ---- Routes: /, /new, /ship/<id>, /hud ----------------------------------------------------------

let path = location.pathname;
const routeSubs = new Set<() => void>();
window.addEventListener('popstate', () => { path = location.pathname; for (const f of routeSubs) f(); });

export function go(to: string): void {
  if (to === path) return;
  history.pushState(null, '', to);
  path = to;
  for (const f of routeSubs) f();
  window.scrollTo(0, 0);
}

export function useRoute(): string {
  return useSyncExternalStore((f) => { routeSubs.add(f); return () => routeSubs.delete(f); }, () => path);
}

/** The HUD in a small window of its own, beside the terminals. */
export function openHud(): void {
  window.open('/hud', 'cc-hud', 'popup,width=440,height=680');
}

/** "4 min", "2 h": how long since. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}
