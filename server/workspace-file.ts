import type { CommandPack, RepoInfo, Workspace, WorkspaceFile } from '../shared/protocol.ts';
import type { RunRecipe } from '../shared/recipes.ts';
import { homeRepo, repoName, samePath, WORKSPACE_COLORS } from '../shared/workspaces.ts';
import { validatePack } from './packs.ts';

// A workspace as a file to share: repos by folder name (paths differ between machines),
// plus its workflows. Importing matches the names against the repo library.

export function workspaceToFile(w: Workspace, workflows: CommandPack | null, recipe?: RunRecipe): WorkspaceFile {
  const home = homeRepo(w);
  return {
    kind: 'cc-control.workspace',
    version: 1,
    name: w.name,
    color: w.color,
    repos: w.repos.map((p) => ({ name: repoName(p), ...(home && samePath(home, p) ? { home: true } : {}) })),
    workflows: workflows ?? { version: 1, groups: [] },
    ...(recipe ? { recipe: { steps: recipe.steps, ...(recipe.url ? { url: recipe.url } : {}) } } : {}),
    ...(w.notes ? { notes: w.notes } : {}),
    ...(w.testing ? { testing: w.testing } : {}),
  };
}

export interface ImportResult {
  workspace: Omit<Workspace, 'id'>;
  workflows: CommandPack;
  /** Repo names the file lists that the library doesn't have. */
  missing: string[];
  /** Its run recipe, if it carries one (steps are text; nothing runs until someone presses t). */
  recipe?: { steps: string[]; url?: string };
}

/** Parse an untrusted workspace file. Repos are matched by folder name, case-insensitively. */
export function workspaceFromFile(raw: unknown, library: RepoInfo[]): ImportResult {
  const f = (raw ?? {}) as Partial<WorkspaceFile>;
  if (f.kind !== 'cc-control.workspace') throw new Error('Not a workspace file (expected "kind": "cc-control.workspace").');
  const name = typeof f.name === 'string' ? f.name.trim().slice(0, 60) : '';
  if (!name) throw new Error('The workspace file has no name.');
  const color = (WORKSPACE_COLORS as readonly string[]).includes(f.color ?? '') ? f.color! : 'blue';
  const repos: string[] = [];
  const missing: string[] = [];
  let home: string | undefined;
  for (const r of Array.isArray(f.repos) ? f.repos.slice(0, 50) : []) {
    const want = typeof r?.name === 'string' ? r.name.trim() : '';
    if (!want) continue;
    const match = library.find((x) => x.name.toLowerCase() === want.toLowerCase());
    if (!match) { missing.push(want); continue; }
    if (!repos.some((p) => samePath(p, match.path))) repos.push(match.path);
    if (r.home) home = match.path;
  }
  const workflows = f.workflows ? validatePack(f.workflows) : { version: 1 as const, groups: [] };
  const rawRecipe = (f.recipe ?? {}) as { steps?: unknown; url?: unknown };
  const steps = Array.isArray(rawRecipe.steps) ? rawRecipe.steps.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 500)).slice(0, 20) : [];
  const recipe = steps.length ? { steps, ...(typeof rawRecipe.url === 'string' && /^https?:\/\/\S+$/.test(rawRecipe.url) ? { url: rawRecipe.url } : {}) } : undefined;
  // Notes are text for Claude, bounded like the rest; cleanWorkspace trims them again on save.
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8000) : undefined);
  const notes = text(f.notes);
  const testing = text(f.testing);
  return { workspace: { name, color, repos, home, ...(notes ? { notes } : {}), ...(testing ? { testing } : {}) }, workflows, missing, ...(recipe ? { recipe } : {}) };
}
