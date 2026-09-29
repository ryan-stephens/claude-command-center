import type { CommandPack, RepoInfo, Workspace, WorkspaceFile } from '../shared/protocol.ts';
import { homeRepo, repoName, samePath, WORKSPACE_COLORS } from '../shared/workspaces.ts';
import { validatePack } from './packs.ts';

// A workspace as a file to share: repos by folder name (paths differ between machines),
// plus its workflows. Importing matches the names against the repo library.

export function workspaceToFile(w: Workspace, workflows: CommandPack | null): WorkspaceFile {
  const home = homeRepo(w);
  return {
    kind: 'cc-control.workspace',
    version: 1,
    name: w.name,
    color: w.color,
    repos: w.repos.map((p) => ({ name: repoName(p), ...(home && samePath(home, p) ? { home: true } : {}) })),
    workflows: workflows ?? { version: 1, groups: [] },
  };
}

export interface ImportResult {
  workspace: Omit<Workspace, 'id'>;
  workflows: CommandPack;
  /** Repo names the file lists that the library doesn't have. */
  missing: string[];
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
  return { workspace: { name, color, repos, home }, workflows, missing };
}
