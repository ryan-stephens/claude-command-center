// Setting up how the app starts the test-data tool (§141), from the page instead of by hand in
// verify.json. You point at the folder it is installed in (or pick one the app found by the tool's
// name); the app reads that folder and proposes how to start it: its web API project (`dotnet run`),
// its web UI (`npm run dev`), or a start script the folder has, and the API's address from its
// launchSettings.json. You tick what to run and it is written to verify.json's builder.launch,
// builder.cwd and builder.url, the rest of the file kept as it was.
//
// The page never sends a command: it sends a folder and the ids of what the server found there, and
// the server builds the commands from the folder's own files. So the page still only asks (§135).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { cleanUrl, isAbsolutePath, isLoopback, LAUNCH_MAX } from '../../shared/verify.ts';

export interface StartOption {
  /** Stable for the folder: what the page sends back. */
  id: string;
  kind: 'api' | 'ui' | 'script';
  /** What it is, in words: the project or folder. */
  label: string;
  command: string;
  /** The address it listens on, when its files say. */
  url?: string;
  /** Ticked to begin with. */
  on: boolean;
}

export interface FolderLook {
  folder: string;
  options: StartOption[];
  /** The API's address, from the first API's launch settings. */
  url?: string;
  problem?: string;
}

const SKIP = new Set(['node_modules', 'bin', 'obj', '.git', '.vs', '.idea', 'dist', 'build', 'packages', 'TestResults', 'coverage']);
const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;

/** Every file under `dir` to `depth`, skipping build output and package folders. */
function walk(dir: string, depth: number, out: string[] = []): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (depth > 0 && !SKIP.has(n) && !n.startsWith('.')) walk(p, depth - 1, out); } else out.push(p);
    if (out.length > 4000) break;
  }
  return out;
}

/** The http address a project's launchSettings.json gives (its first project profile; http before https). */
export function launchUrl(json: string): string | undefined {
  try {
    const profiles = (JSON.parse(json.replace(/^\uFEFF/, '')) as { profiles?: Record<string, { commandName?: string; applicationUrl?: string }> }).profiles ?? {};
    const all = Object.values(profiles);
    const p = all.find((x) => x.commandName === 'Project' && x.applicationUrl) ?? all.find((x) => x.applicationUrl);
    const urls = (p?.applicationUrl ?? '').split(';').map((u) => u.trim()).filter(Boolean);
    return cleanUrl(urls.find((u) => u.startsWith('http://')) ?? urls[0]) || undefined;
  } catch { return undefined; }
}

/** Read a folder and propose how to start what is in it. Never throws. */
export function lookInFolder(folder: string): FolderLook {
  const given = folder.trim();
  if (!isAbsolutePath(given)) return { folder: given, options: [], problem: 'Give the full path of the folder (C:\\…).' };
  // One spelling of the path (C:/x and C:\x alike), so the files found under it compare with it.
  const dir = normalize(given).replace(/[\\/]+$/, '');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { folder: dir, options: [], problem: `There is no folder ${dir}.` };
  const files = walk(dir, 3);
  const options: StartOption[] = [];
  // Web API projects (not tests).
  for (const f of files.filter((x) => x.endsWith('.csproj'))) {
    const name = basename(f, '.csproj');
    if (/test/i.test(name)) continue;
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (!/Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/i.test(text)) continue;
    const settings = join(dirname(f), 'Properties', 'launchSettings.json');
    const url = existsSync(settings) ? launchUrl(readFileSync(settings, 'utf8')) : undefined;
    options.push({ id: `api:${relative(dir, f).replace(/\\/g, '/')}`, kind: 'api', label: `${name} (web API)`, command: `dotnet run --project ${q(relative(dir, f))}`, ...(url ? { url } : {}), on: false });
  }
  // Web UIs: a package.json with a dev or start script.
  for (const f of files.filter((x) => basename(x) === 'package.json')) {
    let pkg: { name?: string; scripts?: Record<string, string> };
    try { pkg = JSON.parse(readFileSync(f, 'utf8')) as typeof pkg; } catch { continue; }
    const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : undefined;
    if (!script) continue;
    const at = relative(dir, dirname(f)) || '.';
    const here = dirname(f);
    const pm = existsSync(join(here, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(here, 'yarn.lock')) ? 'yarn' : 'npm';
    const command = at === '.'
      ? `${pm} run ${script}`
      : pm === 'npm' ? `npm --prefix ${q(at)} run ${script}` : pm === 'pnpm' ? `pnpm --dir ${q(at)} run ${script}` : `yarn --cwd ${q(at)} run ${script}`;
    options.push({ id: `ui:${at.replace(/\\/g, '/')}`, kind: 'ui', label: `${pkg.name ?? (at === '.' ? basename(dir) : at)} (web UI, ${script})`, command, on: false });
  }
  // Start scripts at the top of the folder.
  for (const f of files.filter((x) => dirname(x) === dir && /^(start|run|launch)[\w.-]*\.(ps1|cmd|bat)$/i.test(basename(x)))) {
    const n = basename(f);
    // `.\name`, unquoted: cmd runs neither a quoted first word nor a bare name from the folder (checked);
    // the name pattern above has no spaces or quotes, so it needs none.
    options.push({ id: `script:${n}`, kind: 'script', label: `${n} (a start script)`, command: n.toLowerCase().endsWith('.ps1') ? `powershell -NoProfile -File .\\${n}` : `.\\${n}`, on: false });
  }
  // A start script, when there is one, does it all; else the first API and the first UI.
  const script = options.find((o) => o.kind === 'script');
  if (script) script.on = true;
  else { for (const k of ['api', 'ui'] as const) { const o = options.find((x) => x.kind === k); if (o) o.on = true; } }
  const url = options.find((o) => o.kind === 'api' && o.url)?.url;
  return { folder: dir, options, ...(url ? { url } : {}), ...(!options.length ? { problem: 'Nothing here looks like something to start: no web API project, no web UI with a dev or start script, no start script.' } : {}) };
}

/** Folders named like the tool, one or two levels under the usual places code lives and beside the workspaces' repos. */
export function findInstalls(name: string, repoPaths: string[], home = homedir()): string[] {
  const want = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (want.length < 3) return [];
  const roots = new Set<string>([
    ...repoPaths.map((p) => dirname(p)),
    join(home, 'source', 'repos'), join(home, 'repos'), join(home, 'src'), join(home, 'code'), join(home, 'Documents', 'GitHub'), home,
    'C:/repos', 'D:/repos', 'C:/src', 'D:/src', 'C:/dev', 'D:/dev', 'C:/code', 'D:/code', 'C:/tools', 'D:/tools',
  ].map((p) => p.replace(/\\/g, '/').replace(/\/+$/, '')));
  const found: string[] = [];
  const look = (dir: string, depth: number) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (SKIP.has(n) || n.startsWith('.')) continue;
      const p = `${dir}/${n}`;
      try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
      if (n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(want)) { if (!found.includes(p)) found.push(p); }
      else if (depth > 0) look(p, depth - 1);
      if (found.length >= 10) return;
    }
  };
  for (const r of roots) if (existsSync(r)) look(r, 1);
  return found;
}

/**
 * Write the chosen way to start it into verify.json: builder.cwd (the folder), builder.launch (the
 * commands of the options picked, built here from the folder again), builder.url (given, else the
 * one found, else as it was). Everything else in the file is kept.
 */
export function saveStart(file: string, folder: string, pick: string[], url: string | undefined, name?: string): { launch: string[]; cwd: string; url?: string } {
  const look = lookInFolder(folder);
  if (look.problem && !look.options.length) throw new Error(look.problem);
  const chosen = look.options.filter((o) => pick.includes(o.id));
  if (!chosen.length) throw new Error('Tick at least one thing to start.');
  if (chosen.length > LAUNCH_MAX) throw new Error(`At most ${LAUNCH_MAX} things to start.`);
  let raw: Record<string, unknown> = {};
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>; } catch (e) { throw new Error(`${file} isn’t JSON, so it wasn’t changed: ${(e as Error).message.slice(0, 120)}`); }
  }
  const builder = { ...((raw.builder as Record<string, unknown>) ?? {}) };
  const address = cleanUrl(url?.trim() || undefined) || look.url || (typeof builder.url === 'string' ? builder.url : undefined);
  if (!address) throw new Error('Say where its API answers (http://localhost:<port>): its files didn’t say.');
  if (!isLoopback(address)) throw new Error('The test-data tool has to answer on this machine (localhost).');
  builder.url = address;
  builder.cwd = look.folder;
  builder.launch = chosen.map((o) => o.command);
  if (name && !builder.name) builder.name = name;
  writeFileSync(file, `${JSON.stringify({ ...raw, builder }, null, 2)}\n`);
  return { launch: builder.launch as string[], cwd: look.folder, url: address };
}
