// A card for tests (PLAN §80): the isolated server accepts `cards.seed` and writes a card that looks
// started without opening a terminal tab or a Claude session, so the open card can be walked through
// and screenshotted in every state it draws. Only off the default port: the owner's server at
// :7777 never has it. Pure here (tested); index.ts wires it.

import type { Card, CardLive, CardTodo, LaterItem } from '../shared/cards.ts';
import type { TranscriptItem } from '../shared/protocol.ts';

/** The default port: a server on it refuses to seed. */
export const DEFAULT_PORT = 7777;

export function seedAllowed(port: number): boolean {
  return port !== DEFAULT_PORT;
}

/** What a walkthrough asks for: where the card lives and which state it is in. */
export interface SeedOptions {
  /** The repos' folders (absolute). The first is home; each gets a folders entry so Changes groups by repo. */
  repos: string[];
  /** Worktree folders in the same order, when the card is meant to work in worktrees (else the repos' own folders). */
  worktrees?: string[];
  workspaceId?: string | null;
  key?: string;
  title?: string;
  /** plan: a plan waiting for approval · tool: a tool asking to run · working: Claude is on it · idle: it finished its turn · done: shipped and merged. */
  state?: 'plan' | 'tool' | 'working' | 'idle' | 'done';
  /** The channel is up, so y / n and the message box work. Default true. */
  channel?: boolean;
  /** Files the card wrote (absolute), for the dock's badge and What changed. */
  files?: string[];
  /** A token for the card (test servers only): a launcher or hook started by hand can prove itself to it (§87). */
  token?: string;
  /** A real session's id (test servers only): the card then resumes that session when it is sent to (§85), so the way in can be tried for real. */
  sessionId?: string;
}

const PLAN = ['1. Persist the guest cart to localStorage with a 30-day stamp.', '2. On sign-in, merge it into the account cart without duplicating lines (key on sku + options).', '3. Keep gift cards attached through the merge; a test for each path.'].join('\n');

function live(state: NonNullable<SeedOptions['state']>, at: number): CardLive {
  switch (state) {
    case 'plan': return { phase: 'needs', text: 'Plan ready: approve it in the tab', at, mode: 'plan', ask: { kind: 'plan', tool: 'ExitPlanMode', plan: PLAN }, turnSince: at - 4 * 60_000, lastMessage: 'I read the cart store and the sign-in flow. Here is the plan.' };
    case 'tool': return { phase: 'needs', text: 'Wants to run pnpm vitest run src/cart', at, mode: 'default', ask: { kind: 'tool', tool: 'Bash', detail: 'pnpm vitest run src/cart' }, turnSince: at - 2 * 60_000 };
    case 'working': return { phase: 'working', text: 'editing sign-in.ts', at, mode: 'default', turnSince: at - 11 * 60_000 };
    case 'idle': return { phase: 'waiting', text: 'Finished its turn', at, mode: 'default', lastMessage: 'Done. The guest cart persists for 30 days and merges on sign-in with gift cards attached. Both apps are up on this card’s ports if you want to try it.' };
    case 'done': return { phase: 'ended', text: 'The session closed', at, mode: 'default' };
  }
}

function todos(state: NonNullable<SeedOptions['state']>): CardTodo[] {
  const done = state === 'plan' ? 1 : state === 'tool' || state === 'working' ? 2 : 4;
  const names = ['Read the cart store and the sign-in flow', 'Persist the guest cart', 'Merge on sign-in, with tests', 'Keep gift cards through the merge'];
  return names.map((content, i) => ({ id: `t${i + 1}`, content, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending', ...(i === done ? { activeForm: content.replace(/^(\w+)/, (w) => `${w}ing`.replace(/eing$/, 'ing')) } : {}) }));
}

/** The transcript the seeded session shows, as the page draws it. */
export function seedTranscript(key: string, state: NonNullable<SeedOptions['state']>): TranscriptItem[] {
  const u = (n: number) => `seed-${key}-${n}`;
  const items: TranscriptItem[] = [
    { kind: 'user', uuid: u(1), text: `Please review ${key} and take it into context. You’ll likely need web-app and payments-api. Start in web-app.` },
    { kind: 'tool', uuid: u(2), toolUseId: 'tu-1', name: 'Read', input: '{"file_path":"src/cart/store.ts"}' },
    { kind: 'tool_result', uuid: u(3), toolUseId: 'tu-1', text: 'export function createCartStore() { … }', isError: false },
    { kind: 'assistant', uuid: u(4), text: 'I read the cart store and the sign-in flow. The guest cart lives in memory only, so it is lost when the tab closes. Gift cards are attached to cart lines, so the merge has to carry them over.' },
  ];
  if (state === 'plan') return [...items, { kind: 'assistant', uuid: u(5), text: `Here is the plan:\n\n${PLAN}` }];
  items.push({ kind: 'assistant', uuid: u(5), text: 'Plan approved. Starting with the guest cart: I’ll persist it under a 30-day stamp and then do the merge.' });
  items.push({ kind: 'tool', uuid: u(6), toolUseId: 'tu-2', name: 'Edit', input: '{"file_path":"src/cart/store.ts"}' });
  items.push({ kind: 'tool_result', uuid: u(7), toolUseId: 'tu-2', text: 'ok', isError: false });
  items.push({ kind: 'assistant', uuid: u(8), text: 'The guest cart now survives a closed tab. I keyed lines on sku + options so the merge can’t double them up.' });
  if (state === 'tool') return [...items, { kind: 'assistant', uuid: u(9), text: 'Before I write the gift-card test I want to run the cart tests to make sure nothing broke.' }];
  if (state === 'working') return [...items, { kind: 'tool', uuid: u(9), toolUseId: 'tu-3', name: 'Edit', input: '{"file_path":"src/auth/sign-in.ts"}' }];
  items.push({ kind: 'tool', uuid: u(9), toolUseId: 'tu-3', name: 'Bash', input: '{"command":"pnpm vitest run src/cart"}' });
  items.push({ kind: 'tool_result', uuid: u(10), toolUseId: 'tu-3', text: 'Test Files  3 passed (3)\n     Tests  14 passed (14)', isError: false });
  items.push({ kind: 'assistant', uuid: u(11), text: 'Done. The guest cart persists for 30 days and merges on sign-in with gift cards attached. Both apps are up on this card’s ports if you want to try it.' });
  return items;
}

const name = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

/** The card as the store saves it. `id` and `createdAt` are the caller's so a walkthrough can find it again. */
export function seedCard(o: SeedOptions, id: string, now: number): Card {
  const state = o.state ?? 'plan';
  const key = o.key ?? 'SHOP-155';
  const repos = o.repos;
  const home = repos[0];
  const dirs = o.worktrees?.length === repos.length ? o.worktrees : repos;
  const branch = `${key.toLowerCase()}-save-cart-signed-out`;
  const started = now - 14 * 60_000;
  const later: LaterItem[] = state === 'plan' ? [{ kind: 'note', id: 'later-1', label: 'Round money down, never to nearest.', on: true, at: now - 60_000 }] : [];
  const files = o.files ?? [`${dirs[0]}/src/cart/store.ts`, `${dirs[0]}/src/auth/sign-in.ts`, ...(dirs[1] ? [`${dirs[1]}/src/giftcards/attach.ts`] : [])];
  const card: Card = {
    id, key, title: o.title ?? 'Save cart for signed-out users', workspaceId: o.workspaceId ?? null,
    packet: { workspace: repos.map((r) => ({ kind: 'repo', id: r, label: name(r), on: true })), ticket: [], card: [], note: '' },
    launch: { home, branch: dirs === repos ? 'current' : 'worktree', mode: 'plan', model: 'sonnet', message: `Plan ${key}.` },
    kind: 'build',
    stage: state === 'plan' || state === 'tool' ? 'needs' : state === 'working' ? 'build' : state === 'idle' ? 'try' : 'done',
    createdAt: started, branchName: branch, model: 'sonnet', cwd: dirs[0], sessionId: o.sessionId ?? `seed-${id}`, channel: o.channel ?? true,
    folders: repos.map((repo, i) => ({ repo, dir: dirs[i] })),
    boot: [
      { at: started, text: 'Saved the context packet (4.1k)', state: 'ok' },
      { at: started + 1000, text: dirs === repos ? `Stayed on ${branch} in ${name(home)}` : `Made worktrees on ${branch}: ${dirs.map(name).join(', ')}`, state: 'ok' },
      { at: started + 2000, text: `Opened a Windows Terminal tab in ${dirs[0]}`, state: 'ok' },
      { at: started + 9000, text: 'The session started and linked to this card (seeded: no real tab)', state: 'ok' },
    ],
    live: live(state, now - 60_000),
    // The relayed prompt is what makes y / n answerable on the page (askOf); a real channel would have sent it.
    ...(state === 'plan' || state === 'tool' ? { relayed: { requestId: `seed-req-${id}`, tool: state === 'plan' ? 'ExitPlanMode' : 'Bash', ...(state === 'tool' ? { description: 'pnpm vitest run src/cart' } : {}), at: now - 60_000 } } : {}),
    files: state === 'plan' ? [] : files,
    todos: todos(state),
    later,
    ...(state === 'done' ? { ship: { steps: [{ at: now - 30 * 60_000, text: 'Committed 3 files', state: 'ok' }, { at: now - 29 * 60_000, text: 'Pushed and opened PR #418', state: 'ok' }], prs: [{ host: 'github', number: 418, url: 'https://github.com/example/web-app/pull/418', state: 'MERGED', repo: name(home) }] } } : {}),
  };
  return card;
}

/** The message's options, checked: repos must be absolute paths that exist (the caller checks existence). */
export function cleanSeed(raw: unknown): SeedOptions {
  const r = (raw ?? {}) as Record<string, unknown>;
  const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
  const repos = strs(r.repos, 10);
  if (!repos.length) throw new Error('cards.seed needs at least one repo folder.');
  const worktrees = strs(r.worktrees, 10);
  const states = ['plan', 'tool', 'working', 'idle', 'done'] as const;
  const state = states.find((s) => s === r.state);
  return {
    repos, ...(worktrees.length ? { worktrees } : {}),
    workspaceId: typeof r.workspaceId === 'string' ? r.workspaceId : null,
    ...(typeof r.key === 'string' && /^[A-Z]+-\d+$/.test(r.key) ? { key: r.key } : {}),
    ...(typeof r.title === 'string' ? { title: r.title.slice(0, 200) } : {}),
    ...(state ? { state } : {}),
    ...(typeof r.channel === 'boolean' ? { channel: r.channel } : {}),
    ...(Array.isArray(r.files) ? { files: strs(r.files, 50) } : {}),
    ...(typeof r.token === 'string' && /^[\w-]{8,80}$/.test(r.token) ? { token: r.token } : {}),
    ...(typeof r.sessionId === 'string' && /^[0-9a-f-]{36}$/.test(r.sessionId) ? { sessionId: r.sessionId } : {}),
  };
}
