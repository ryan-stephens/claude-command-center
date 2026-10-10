import '../../server/boot.ts'; // first: ~/.cc-control/config.env and certificates, before anything reads CC_CONTROL_*
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card } from '../../shared/cards.ts';
import { repoName, samePath } from '../../shared/workspaces.ts';
import type { Ticket } from '../../shared/tickets.ts';
import type { HookInput } from '../../server/card-events.ts';
import { removeWorktrees } from '../../server/cards.ts';
import { FrontDoors } from '../../server/front-door.ts';
import { parsePortList, parseRange, PortPool } from '../../server/ports.ts';
import { stackOf } from '../../server/stack.ts';
import { DB_PATH, Store } from '../../server/store.ts';
import { demoTickets, jiraConfig, TicketService } from '../../server/tickets.ts';
import { LookupTool, readFieldLists, Requester, VERIFY_FILE, VerifyFileWatch } from '../../server/verify.ts';
import { findInstalls, lookInFolder, saveStart } from './tool-setup.ts';
import { cleanPicks, FieldPicks, mergePicks } from './field-picks.ts';
import { updatesOn } from '../../shared/verify.ts';
import { BuilderTool } from '../../server/verify-builder.ts';
import { branchOf, contextPack, firstMessageFor, keyFor, suggestApis, suggestRepos, titleFor, workText } from '../shared/context.ts';
import { OPENERS, type ClaudeStatus, type Opener, type Preflight, type Session, type Snapshot, type TicketInfo } from '../shared/types.ts';
import { DataDesk, forClaude, waitOf } from './data.ts';
import { applyHook, V2_EVENTS } from './hook-state.ts';
import { focusOrOpen, linkDeps, makeSessionWorktrees, openTerminal, openVsCode, trust, writeLocalFiles } from './launch.ts';
import { MyTickets } from './my-tickets.ts';
import { SessionStore, V2_DIR } from './sessions.ts';
import { refreshPr, ship, shipPlan, slackConfig } from './ship.ts';
import { StackManager } from './stacks.ts';
import { join } from 'node:path';

const PORT = Number(process.env.CCV2_PORT || 7878);
const URL_SELF = `http://127.0.0.1:${PORT}`;
const WEB_DIST = process.env.CCV2_WEB_DIST || fileURLToPath(new URL('../../dist/v2', import.meta.url));
/** Tests: launch makes worktrees and files but opens no terminal or editor. */
const NO_OPEN = process.env.CCV2_NO_OPEN === '1';

const store = new Store(DB_PATH);
const tickets = new TicketService(store, () => {});
const myTickets = new MyTickets(process.env);
const sessions = new SessionStore(V2_DIR, () => soon());
const pool = new PortPool(parseRange(process.env.CC_CONTROL_PORTS), parsePortList(process.env.CC_CONTROL_UI_PORTS));
const doors = process.env.CC_CONTROL_FRONT_DOOR === '0' ? undefined : new FrontDoors(() => soon());
const stacks = new StackManager({ dir: join(V2_DIR, 'runs'), pool, doors, env: process.env, changed: () => soon(), keyOf: (id) => sessions.get(id)?.key });
let leftovers = stacks.leftovers();

const verifyFile = new VerifyFileWatch();
const verifyConfig = () => verifyFile.now().config;
const requests = new Requester(verifyConfig);
const lookup = new LookupTool(verifyConfig, requests);
const builder = new BuilderTool(verifyConfig);

// ---- The page's live view -----------------------------------------------------------------------

function workspaces(): Snapshot['workspaces'] {
  return store.loadWorkspaces().map((w) => {
    const st = stackOf(store, w.id);
    return { id: w.id, name: w.name, repos: w.repos.map((path) => ({ path, name: repoName(path) })), apis: st?.apis.map((a) => a.repo) ?? [], ...(st?.ui ? { ui: st.ui.repo } : {}), choose: st?.choose ?? {} };
  });
}

function snapshot(): Snapshot {
  const cfg = verifyConfig();
  const slack = slackConfig();
  const doorViews = new Map<number, Snapshot['doors'][number]>();
  for (const s of sessions.list()) {
    const v = stacks.view(s.id);
    if (!v?.door) continue;
    const ui = v.services.find((x) => x.kind === 'ui');
    const d = doorViews.get(v.door.home) ?? { home: v.door.home, members: [] };
    d.members.push({ sessionId: s.id, key: s.key, port: ui?.port ?? 0 });
    if (v.door.shown) d.shown = s.id;
    doorViews.set(v.door.home, d);
  }
  return {
    sessions: sessions.list(),
    stacks: stacks.views(),
    doors: [...doorViews.values()],
    leftovers,
    workspaces: workspaces(),
    config: {
      jira: Boolean(jiraConfig(process.env)),
      ...(slack ? { slack: { channel: slack.channel } } : {}),
      loans: Boolean(cfg.builder?.url),
      fields: Boolean(cfg.lookup?.url && cfg.lookup?.recordField),
      updates: updatesOn(cfg),
      testData: desk.toolView(),
      fieldLists: readFieldLists().lists.map((l) => l.name),
      port: PORT,
    },
  };
}

const streams = new Set<SSEStreamingApi>();
let timer: NodeJS.Timeout | null = null;
function soon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const data = JSON.stringify(snapshot());
    for (const s of streams) void s.writeSSE({ event: 'snapshot', data }).catch(() => streams.delete(s));
  }, 120);
}

// ---- Tickets and the preflight ------------------------------------------------------------------

function infoOf(t: Ticket): TicketInfo {
  return { key: t.key, title: t.title, ...(t.url ? { url: t.url } : {}), description: t.description, acceptance: t.acceptance, links: t.links.map((l) => `${l.relation} ${l.key}: ${l.title}`) };
}

async function findTicket(key: string): Promise<{ ticket?: TicketInfo; problem?: string }> {
  const k = key.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(k)) return {};
  const ids = store.loadWorkspaces().map((w) => w.id);
  const r = await tickets.search(k, ids).catch((e: Error) => ({ tickets: [] as Ticket[], problem: e.message }));
  const t = r.tickets.find((x) => x.key.toUpperCase() === k) ?? (!jiraConfig(process.env) ? demoTickets().find((x) => x.key.toUpperCase() === k) : undefined);
  return t ? { ticket: infoOf(t) } : { problem: r.problem ?? `No ticket ${k} found.` };
}

function toolsNow() {
  const cfg = verifyConfig();
  return { loans: Boolean(cfg.builder?.url), fields: Boolean(cfg.lookup?.url && cfg.lookup?.recordField), updates: updatesOn(cfg), fieldLists: readFieldLists().lists.map((l) => l.name) };
}

async function preflight(workspaceId: string, input: string): Promise<Preflight> {
  const w = store.loadWorkspaces().find((x) => x.id === workspaceId);
  if (!w) throw new Error('Pick a workspace.');
  const looksLikeKey = /^\s*[A-Za-z][A-Za-z0-9_]*-\d+\s*$/.test(input);
  const found = looksLikeKey ? await findTicket(input) : {};
  const ticket = found.ticket;
  const text = looksLikeKey ? '' : input;
  const key = ticket?.key ?? (looksLikeKey ? input.trim().toUpperCase() : keyFor(input));
  const title = titleFor(ticket, text) || key;
  const st = stackOf(store, w.id);
  const repos = suggestRepos(w.repos, w.home, st, workText(ticket, text));
  const apis = suggestApis(st, repos.filter((r) => r.on).map((r) => r.name));
  const branch = branchOf(key, title);
  const pack = contextPack({ key, title, ...(ticket ? { ticket } : {}), repos: repos.filter((r) => r.on).map((r) => ({ name: r.name, dir: `${r.path}-${key.toLowerCase()}` })), branch, logsDir: stacks.logsDir(key), ...(w.notes ? { notes: w.notes } : {}), apis: apis.filter((a) => a.on).map((a) => a.name), tools: toolsNow() });
  return { key, title, branch, ...(ticket ? { ticket } : {}), repos, apis, firstMessage: firstMessageFor(ticket, text), contextPreview: pack, ...(found.problem ? { problem: found.problem } : {}) };
}

// ---- Sessions -----------------------------------------------------------------------------------

/** Where a session's stack runs each repo from: its worktree, else the workspace's checkout. */
function placesOf(s: Session) {
  const w = store.loadWorkspaces().find((x) => x.id === s.workspaceId);
  const repos: Record<string, string> = {};
  for (const p of w?.repos ?? []) repos[repoName(p).toLowerCase()] = p;
  for (const r of s.repos) repos[r.name.toLowerCase()] = r.dir;
  return { id: s.id, key: s.key, places: { cwd: s.home, repos } };
}

const mcpConfigs = new Map<string, string>();

async function launch(body: Record<string, unknown>): Promise<Session> {
  const w = store.loadWorkspaces().find((x) => x.id === body.workspaceId);
  if (!w) throw new Error('Pick a workspace.');
  const pf = await preflight(w.id, String(body.input ?? ''));
  const picked = (Array.isArray(body.repos) ? body.repos.map(String) : pf.repos.filter((r) => r.on).map((r) => r.path)).filter((p) => w.repos.some((x) => samePath(x, p)));
  if (!picked.length) throw new Error('Tick at least one repo.');
  if (sessions.byKey(pf.key)) throw new Error(`There is already a session for ${pf.key}. Open it from the Switchboard.`);
  const opener: Opener = OPENERS.includes(body.opener as Opener) ? body.opener as Opener : 'terminal';
  const firstMessage = typeof body.firstMessage === 'string' && body.firstMessage.trim() ? body.firstMessage.trim().slice(0, 4000) : pf.firstMessage;
  const repos = await makeSessionWorktrees(picked, pf.key, pf.branch);
  linkDeps(repos, (line) => console.log(`v2 ${pf.key}: ${line}`));
  const apis = (Array.isArray(body.apis) ? body.apis.map(String) : pf.apis.filter((a) => a.on).map((a) => a.name));
  const claude: ClaudeStatus = { state: 'starting', text: NO_OPEN ? 'not opened (test server)' : `opening in ${opener === 'terminal' ? 'a terminal' : opener === 'vscode' ? 'VS Code' : 'Claude Desktop'}`, at: Date.now() };
  const { session, token } = sessions.add({
    key: pf.key, title: pf.title, ...(pf.ticket ? { ticket: pf.ticket } : {}), workspaceId: w.id, repos, home: repos[0].dir, branch: pf.branch,
    createdAt: Date.now(), opener, firstMessage, claude, loans: [], fields: [], evidence: [], prs: [],
  });
  const pack = contextPack({ key: session.key, title: session.title, ...(session.ticket ? { ticket: session.ticket } : {}), repos: repos.map((r) => ({ name: r.name, dir: r.dir })), branch: session.branch, logsDir: stacks.logsDir(session.key), ...(w.notes ? { notes: w.notes } : {}), apis, tools: toolsNow() });
  const files = writeLocalFiles({ dir: session.home, pack, sessionId: session.id, token, url: URL_SELF }, join(V2_DIR, 'runs'));
  if (files.mcpConfig) mcpConfigs.set(session.id, files.mcpConfig);
  trust(repos.map((r) => r.dir));
  if (body.startStack === true && stackOf(store, w.id)) {
    void stacks.up(placesOf(session), stackOf(store, w.id)!, apis).catch((e: Error) => console.error(`v2 ${session.key}: stack didn't start: ${e.message}`));
  }
  if (!NO_OPEN) {
    try {
      if (opener === 'terminal') await openTerminal(session, files.mcpConfig);
      else if (opener === 'vscode') await openVsCode(session.home);
    } catch (e) {
      sessions.update(session.id, (s) => ({ ...s, claude: { ...s.claude, text: (e as Error).message } }));
    }
  }
  return sessions.get(session.id)!;
}

// ---- The data tools (§140): loans, lookups and changes, for Claude and for you --------------------

const desk = new DataDesk({ sessions, builder, lookup, cfg: verifyConfig, changed: () => soon() });
const picks = new FieldPicks();

/** What a lookup for this session starts with: the fields worth checking, and the loans made, newest first. */
async function forLookup(s: Session) {
  return { fields: await picks.list(s), loans: [...s.loans].reverse() };
}

/** Claude or you pick fields to check: added to the picks (or replacing them), each id once. */
function pickFields(s: Session, a: Record<string, unknown>, from: 'claude' | 'you') {
  const given = cleanPicks(a.fields, from);
  const remove = Array.isArray(a.remove) ? a.remove.map((x) => String(x).toLowerCase()) : [];
  sessions.update(s.id, (x) => {
    const kept = a.replace === true ? [] : (x.fieldPicks ?? []).filter((p) => !remove.includes(p.id.toLowerCase()));
    // A newer pick of the same id wins over the older one.
    return { ...x, fieldPicks: mergePicks(given, kept) };
  });
  return sessions.get(s.id)!.fieldPicks ?? [];
}


function needSession(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error('No such session.');
  return s;
}

// ---- The HTTP app -------------------------------------------------------------------------------

const app = new Hono();
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, ...(process.env.CCV2_DEV === '1' ? ['http://127.0.0.1:5174', 'http://localhost:5174'] : [])]);

// Loopback only: the page's host, and for anything that changes state, the page's own origin.
app.use('/api/*', async (c, next) => {
  if (!allowedHosts.has(c.req.header('host') ?? '')) return c.text('Forbidden', 403);
  if (c.req.method !== 'GET' && !allowedOrigins.has(c.req.header('origin') ?? '')) return c.text('Forbidden', 403);
  await next();
});

const fail = (c: Context, e: unknown) => c.json({ error: (e as Error).message }, 400);
const body = async (c: Context): Promise<Record<string, unknown>> => { try { return (await c.req.json()) as Record<string, unknown>; } catch { return {}; } };

app.get('/api/state', (c) => c.json(snapshot()));
app.get('/api/events', (c) => streamSSE(c, async (s) => {
  streams.add(s);
  await s.writeSSE({ event: 'snapshot', data: JSON.stringify(snapshot()) });
  s.onAbort(() => { streams.delete(s); });
  while (!s.aborted) { await s.sleep(20_000); await s.writeSSE({ event: 'ping', data: '' }).catch(() => {}); }
}));

app.get('/api/tickets', async (c) => c.json(await myTickets.picks(c.req.query('q') ?? '', c.req.query('fresh') === '1')));
app.post('/api/preflight', async (c) => {
  const b = await body(c);
  try { return c.json(await preflight(String(b.workspaceId ?? ''), String(b.input ?? ''))); } catch (e) { return fail(c, e); }
});
app.post('/api/launch', async (c) => {
  try { return c.json({ session: await launch(await body(c)) }); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/open', async (c) => {
  try {
    const s = needSession(c.req.param('id'));
    const b = await body(c);
    const opener = OPENERS.includes(b.opener as Opener) ? b.opener as Opener : s.opener;
    if (NO_OPEN) return c.json({ did: 'none (test server)' });
    const ours = join(V2_DIR, 'runs', `${s.id}.mcp.json`);
    return c.json({ did: await focusOrOpen(s, opener, mcpConfigs.get(s.id) ?? (existsSync(ours) ? ours : undefined)) });
  } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/stack/up', async (c) => {
  try {
    const s = needSession(c.req.param('id'));
    const st = stackOf(store, s.workspaceId);
    if (!st) throw new Error('This workspace has no stack yet: write one in v1 (e, then Alt+W) and it is used here too.');
    const b = await body(c);
    const apis = Array.isArray(b.apis) ? b.apis.map(String) : st.apis.filter((a) => s.repos.some((r) => r.name.toLowerCase() === a.repo.toLowerCase())).map((a) => a.repo);
    const values = (b.values && typeof b.values === 'object' ? b.values : s.stackValues ?? {}) as Record<string, string>;
    await stacks.up(placesOf(s), st, apis, values);
    sessions.update(s.id, (x) => ({ ...x, stackValues: values }));
    return c.json({ ok: true });
  } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/stack/add', async (c) => {
  try {
    const s = needSession(c.req.param('id'));
    const b = await body(c);
    const st = stackOf(store, s.workspaceId);
    if (!st) throw new Error('This workspace has no stack.');
    if (stacks.isRunning(s.id)) await stacks.add(s.id, [String(b.api ?? '')]);
    else await stacks.up(placesOf(s), st, [String(b.api ?? '')], s.stackValues ?? {});
    return c.json({ ok: true });
  } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/stack/remove', async (c) => {
  try { const b = await body(c); await stacks.remove(c.req.param('id'), String(b.api ?? '')); return c.json({ ok: true }); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/stack/restart', async (c) => {
  try {
    const b = await body(c);
    if (b.unhealthy) return c.json({ restarted: stacks.restartUnhealthy(c.req.param('id')) });
    stacks.restart(c.req.param('id'), String(b.service ?? ''));
    return c.json({ ok: true });
  } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/stack/down', async (c) => {
  try { await stacks.down(c.req.param('id')); return c.json({ ok: true }); } catch (e) { return fail(c, e); }
});
app.get('/api/sessions/:id/logs', (c) => c.json({ lines: stacks.log(c.req.param('id'), c.req.query('service') ?? 'ui').slice(-400) }));
app.post('/api/door', async (c) => {
  const b = await body(c);
  const port = stacks.show(String(b.sessionId ?? ''));
  return port ? c.json({ port }) : c.json({ error: 'That session’s UI isn’t behind the front door.' }, 400);
});
app.post('/api/sessions/:id/tried', (c) => {
  try {
    needSession(c.req.param('id'));
    sessions.update(c.req.param('id'), (s) => ({ ...s, evidence: [...s.evidence.filter((e) => e.kind !== 'tried'), { kind: 'tried', text: 'Smoke tested on the worktree’s stack by you', at: Date.now(), ok: true }] }));
    return c.json({ ok: true });
  } catch (e) { return fail(c, e); }
});
app.get('/api/scenarios', async (c) => {
  try { return c.json({ scenarios: await desk.scenarios() }); } catch (e) { return fail(c, e); }
});
app.get('/api/test-data/find', (c) => {
  const name = verifyConfig().builder?.name ?? '';
  return c.json({ name, found: name ? findInstalls(name, store.loadWorkspaces().flatMap((w) => w.repos)) : [] });
});
app.post('/api/test-data/look', async (c) => c.json(lookInFolder(String((await body(c)).folder ?? ''))));
app.post('/api/test-data/save', async (c) => {
  try {
    const b = await body(c);
    const r = saveStart(VERIFY_FILE, String(b.folder ?? ''), Array.isArray(b.pick) ? b.pick.map(String) : [], typeof b.url === 'string' ? b.url : undefined, typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : undefined);
    soon();
    return c.json(r);
  } catch (e) { return fail(c, e); }
});
app.post('/api/test-data/start', async (c) => {
  try { return c.json(await desk.startTool(0)); } catch (e) { return fail(c, e); }
});
app.post('/api/test-data/stop', (c) => {
  try { return c.json(desk.stopTool()); } catch (e) { return fail(c, e); }
});
app.get('/api/sessions/:id/fields', async (c) => {
  try { return c.json(await forLookup(needSession(c.req.param('id')))); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/fields', async (c) => {
  try { return c.json({ picked: pickFields(needSession(c.req.param('id')), await body(c), 'you') }); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/data/lookup', async (c) => {
  try { return c.json({ event: await desk.lookup(needSession(c.req.param('id')), await body(c), 'you') }); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/data/update', async (c) => {
  try { return c.json({ event: await desk.update(needSession(c.req.param('id')), await body(c), 'you') }); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/data/loan', async (c) => {
  try { return c.json({ event: desk.startLoan(needSession(c.req.param('id')), await body(c), 'you') }); } catch (e) { return fail(c, e); }
});
app.get('/api/sessions/:id/ship', async (c) => {
  try { return c.json(await shipPlan(needSession(c.req.param('id')), slackConfig())); } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/ship', async (c) => {
  try {
    const s = needSession(c.req.param('id'));
    const b = await body(c);
    const r = await ship(s, { title: String(b.title ?? '').trim() || s.title, summary: String(b.summary ?? ''), post: b.post !== false, mention: b.mention !== false }, slackConfig());
    const channel = slackConfig()?.channel;
    sessions.update(s.id, (x) => ({ ...x, prs: r.prs, ...(r.posted ? { posted: { at: Date.now(), ...(channel ? { channel } : {}) } } : {}) }));
    return c.json(r);
  } catch (e) { return fail(c, e); }
});
app.post('/api/sessions/:id/remove', async (c) => {
  try {
    const s = needSession(c.req.param('id'));
    const b = await body(c);
    await stacks.down(s.id);
    let note = '';
    if (b.worktrees) {
      const r = await removeWorktrees({ folders: s.repos.filter((x) => !samePath(x.dir, x.repo)).map((x) => ({ repo: x.repo, dir: x.dir })), branchName: s.branch, launch: { branch: 'worktree' } } as unknown as Pick<Card, 'folders' | 'branchName' | 'launch'>, false);
      note = r.kept.length ? `Kept ${r.kept.length} worktree(s) with changes: ${r.problems.join('; ')}` : '';
    }
    sessions.remove(s.id);
    return c.json({ ok: true, note });
  } catch (e) { return fail(c, e); }
});
app.post('/api/leftovers/clean', async (c) => {
  try {
    for (const l of leftovers) await stacks.cleanLeftover(l.id);
    leftovers = stacks.leftovers();
    soon();
    return c.json({ ok: true });
  } catch (e) { return fail(c, e); }
});

// ---- Hooks and the toolbelt: a session acting as itself, by its token ---------------------------

function asSession(c: Context): Session | undefined {
  const id = c.req.header('x-ccv2-session') ?? '';
  const token = c.req.header('x-ccv2-token') ?? '';
  return sessions.check(id, token) ? sessions.get(id) : undefined;
}

app.post('/hooks/:event', async (c) => {
  const s = asSession(c);
  const event = c.req.param('event');
  if (!s || !(V2_EVENTS as readonly string[]).includes(event)) return c.body(null, 204);
  const input = (await body(c)) as HookInput;
  sessions.update(s.id, (x) => ({ ...x, claude: applyHook(x.claude, event, input, Date.now()) }));
  return c.body(null, 204);
});

type Tool = (s: Session, args: Record<string, unknown>) => Promise<unknown>;
/** A data event that failed reaches Claude as a tool error (it is on the Data panel either way). */
const orFail = <T extends { state: string; error?: string } | undefined>(ev: T): T => { if (ev?.state === 'failed') throw new Error(ev.error ?? 'It failed.'); return ev; };
const TOOLS: Record<string, Tool> = {
  session_info: async (s) => ({ key: s.key, title: s.title, branch: s.branch, repos: s.repos.map((r) => ({ name: r.name, dir: r.dir })), logs: stacks.logsDir(s.key), ticket: s.ticket ?? null, stack: stacks.view(s.id) ?? 'not running' }),
  stack_status: async (s) => {
    const st = stackOf(store, s.workspaceId);
    return { running: stacks.view(s.id) ?? null, available: st?.apis.map((a) => a.repo) ?? [], ui: st?.ui?.repo ?? null, choose: st?.choose ?? {}, note: 'APIs not running here come from Dev through the UI’s proxy file.' };
  },
  stack_up: async (s, a) => {
    const st = stackOf(store, s.workspaceId);
    if (!st) throw new Error('This workspace has no stack.');
    const apis = Array.isArray(a.apis) ? a.apis.map(String) : st.apis.filter((x) => s.repos.some((r) => r.name.toLowerCase() === x.repo.toLowerCase())).map((x) => x.repo);
    const values = a.env ? { ...(s.stackValues ?? {}), env: String(a.env) } : (s.stackValues ?? {});
    await stacks.up(placesOf(s), st, apis, values);
    sessions.update(s.id, (x) => ({ ...x, stackValues: values }));
    return { started: apis, view: stacks.view(s.id), note: 'Services take a while to come up: call stack_status to see their health.' };
  },
  stack_add_api: async (s, a) => {
    const st = stackOf(store, s.workspaceId);
    if (!st) throw new Error('This workspace has no stack.');
    const api = String(a.api ?? '');
    if (stacks.isRunning(s.id)) await stacks.add(s.id, [api]); else await stacks.up(placesOf(s), st, [api], s.stackValues ?? {});
    return { added: api, note: 'The UI’s proxy file was rebuilt and the UI restarted.', view: stacks.view(s.id) };
  },
  stack_restart: async (s, a) => { stacks.restart(s.id, String(a.service ?? 'ui')); return { restarted: a.service ?? 'ui' }; },
  stack_logs: async (s, a) => ({ lines: stacks.log(s.id, String(a.service ?? 'ui')).slice(-Math.min(Number(a.lines ?? 80), 400)).map((l) => l.text) }),
  test_data_tool: async (_s, a) => {
    const action = String(a.action ?? 'status');
    if (action === 'start') return desk.startTool(waitOf(a.wait_seconds, 120_000));
    if (action === 'stop') return desk.stopTool();
    return desk.toolStatus();
  },
  list_loan_scenarios: async () => desk.scenarios(),
  make_test_loan: async (s, a) => {
    const ev = desk.startLoan(s, a, 'claude');
    return forClaude(orFail(await desk.wait(s.id, ev.id, waitOf(a.wait_seconds, 240_000))));
  },
  lookup_fields: async (s, a) => forClaude(orFail(await desk.lookup(s, a, 'claude'))),
  update_fields: async (s, a) => forClaude(orFail(await desk.update(s, a, 'claude'))),
  fields_to_check: async (s) => ({ ...(await forLookup(s)), note: 'picked: by you or the user; ticket: named in the ticket; changes: in the lines this session added. Pick the ones that prove the change with set_fields_to_check (with why and the value each should have); they show in the Data panel’s lookup.' }),
  set_fields_to_check: async (s, a) => ({ picked: pickFields(s, a, 'claude') }),
  data_status: async (s, a) => {
    const id = typeof a.id === 'string' && a.id ? a.id : s.data?.at(-1)?.id;
    if (!id) return 'Nothing has been looked up, changed or made in this session yet.';
    return forClaude(await desk.wait(s.id, id, waitOf(a.wait_seconds, 120_000)));
  },
  add_evidence: async (s, a) => {
    const kind = a.kind === 'tests' ? 'tests' : 'note';
    const text = String(a.text ?? '').trim().slice(0, 300);
    if (!text) throw new Error('Say what the evidence is.');
    sessions.update(s.id, (x) => ({ ...x, evidence: [...x.evidence, { kind, text, at: Date.now(), ok: a.ok !== false }] }));
    return { recorded: text };
  },
  ship: async (s, a) => {
    const r = await ship(s, { title: String(a.title ?? '').trim() || s.title, summary: String(a.summary ?? ''), post: a.post !== false, mention: true }, slackConfig());
    const channel = slackConfig()?.channel;
    sessions.update(s.id, (x) => ({ ...x, prs: r.prs, ...(r.posted ? { posted: { at: Date.now(), ...(channel ? { channel } : {}) } } : {}) }));
    return r;
  },
};

app.post('/tool/:name', async (c) => {
  const s = asSession(c);
  if (!s) return c.json({ error: 'This session isn’t known to Command Center (its token didn’t match).' }, 403);
  const tool = TOOLS[c.req.param('name')];
  if (!tool) return c.json({ error: `No tool ${c.req.param('name')}.` }, 404);
  try { return c.json({ result: await tool(s, await body(c)) }); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
});

// ---- The page -----------------------------------------------------------------------------------

if (existsSync(WEB_DIST)) {
  app.use('*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
} else {
  app.get('/', (c) => c.text(`Command Center v2: no page built yet. Run pnpm v2:build. (Looked in ${WEB_DIST}.)`));
}

// Shipped PRs: their review and checks, every two minutes.
setInterval(async () => {
  for (const s of sessions.list()) {
    const open = s.prs.filter((p) => p.state !== 'MERGED' && p.state !== 'CLOSED');
    if (!open.length) continue;
    const fresh = await Promise.all(s.prs.map((p) => (open.includes(p) ? refreshPr(s, p) : Promise.resolve(p))));
    if (JSON.stringify(fresh) !== JSON.stringify(s.prs)) sessions.update(s.id, (x) => ({ ...x, prs: fresh }));
  }
}, 120_000).unref();

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => console.log(`Command Center v2 on ${URL_SELF}`));

const bye = () => { stacks.stopAll(); desk.stopAll(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
