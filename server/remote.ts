// Optional remote access for a phone, over Tailscale only. cc-control is effectively a remote
// shell, so this is opt-in (`--remote` or CC_CONTROL_REMOTE=1), binds only to the Tailscale
// address (never 0.0.0.0), and every request needs the install's secret token.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Store } from './store.ts';

const TOKEN_KEY = 'remote_token';
export const COOKIE = 'cc_token';

/** Tailscale hands out CGNAT addresses: 100.64.0.0/10. */
function isTailscaleIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * The address to bind for remote access. CC_CONTROL_REMOTE_IP may override it, but only with another
 * Tailscale address or a loopback alias (for testing), so it can never be pointed at a LAN or 0.0.0.0.
 */
export function findRemoteIp(): string {
  const override = process.env.CC_CONTROL_REMOTE_IP;
  if (override) {
    const loopbackAlias = /^127\.\d+\.\d+\.\d+$/.test(override) && override !== '127.0.0.1';
    if (!isTailscaleIp(override) && !loopbackAlias) {
      throw new Error(`CC_CONTROL_REMOTE_IP=${override} refused: only Tailscale (100.64.0.0/10) or loopback-alias addresses are allowed.`);
    }
    return override;
  }
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && isTailscaleIp(a.address)) return a.address;
  }
  throw new Error('Remote mode needs Tailscale: no 100.64.0.0/10 address found. Install and log in to Tailscale, then retry.');
}

/** The install's token, created on first use. `rotate` replaces it, which signs out every phone. */
export function remoteToken(store: Store, rotate: boolean): string {
  let token = store.getMeta(TOKEN_KEY);
  if (!token || rotate) {
    token = randomBytes(32).toString('base64url');
    store.setMeta(TOKEN_KEY, token);
  }
  return token;
}

export function tokenMatches(candidate: string | undefined, token: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieToken(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return undefined;
}

/** Hosts a remote browser may use: the Tailscale IP, or a MagicDNS name (*.ts.net). */
export function remoteHostAllowed(host: string | undefined, ip: string, port: number): boolean {
  if (!host) return false;
  return host === `${ip}:${port}` || new RegExp(`^[a-z0-9-]+(\\.[a-z0-9-]+)*\\.ts\\.net:${port}$`, 'i').test(host);
}

/** WebSocket upgrades over the remote listener: right host, same-origin page, valid token cookie. */
export function remoteUpgradeAllowed(req: IncomingMessage, ip: string, port: number, token: string): boolean {
  const host = req.headers.host;
  return remoteHostAllowed(host, ip, port)
    && req.headers.origin === `http://${host}`
    && tokenMatches(cookieToken(req.headers.cookie), token);
}
