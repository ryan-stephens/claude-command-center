// New test-data scenarios made for a session (§143). How the tool wants a scenario isn't known ahead of
// time (and differs by version), so Claude learns it from the tool itself: its OpenAPI description
// (the create operation and the schemas it uses), an existing scenario as a template, and, when that
// isn't enough, the tool's source in its installed folder. The app hands Claude that and the session's
// context (the ticket, what changed, the fields to check, the folder you chose), posts the scenario
// Claude writes to exactly the create address, and shows it on the Data panel.

import { run as sh } from '../../server/hosts.ts';
import { DEFAULT_CREATE_PATH } from '../../shared/verify.ts';
import type { FieldPick, LoanMade, Session } from '../shared/types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export interface CreateOp {
  method: 'post';
  path: string;
  summary?: string;
  request?: unknown;
  response?: unknown;
  /** Every schema the request and response refer to, by name. */
  schemas: Record<string, unknown>;
  /** The tool's other scenario, step and folder operations, to know what it has (not called from here). */
  related: string[];
}

const SCHEMA_MAX = 40;

/**
 * The create operation in an OpenAPI (3) or Swagger (2) description, for `path`, with the schemas it
 * refers to (followed through $ref, at most 40). Undefined when the description has no POST there.
 */
export function createOperation(doc: unknown, path = DEFAULT_CREATE_PATH): CreateOp | undefined {
  if (!isObj(doc) || !isObj(doc.paths)) return undefined;
  const paths = doc.paths as Record<string, Obj>;
  const want = `/${path.replace(/^\/+/, '')}`.toLowerCase();
  const key = Object.keys(paths).find((k) => k.toLowerCase() === want);
  const post = key && isObj(paths[key]?.post) ? paths[key].post as Obj : undefined;
  if (!post) return undefined;
  const components = (isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : isObj(doc.definitions) ? doc.definitions : {}) as Obj;
  const jsonOf = (content: unknown) => (isObj(content) ? (content['application/json'] ?? content['text/json'] ?? Object.values(content)[0]) : undefined) as Obj | undefined;
  const request = isObj(post.requestBody)
    ? jsonOf(post.requestBody.content)?.schema
    : (Array.isArray(post.parameters) ? (post.parameters as Obj[]).find((p) => p.in === 'body')?.schema : undefined);
  const responses = isObj(post.responses) ? post.responses : {};
  const ok = (responses['201'] ?? responses['200']) as Obj | undefined;
  const response = ok ? (isObj(ok.content) ? jsonOf(ok.content)?.schema : ok.schema) : undefined;
  const schemas: Record<string, unknown> = {};
  const follow = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(follow); return; }
    if (!isObj(v)) return;
    const ref = typeof v.$ref === 'string' ? v.$ref : undefined;
    if (ref) {
      const name = ref.split('/').pop()!;
      if (!(name in schemas) && Object.keys(schemas).length < SCHEMA_MAX && name in components) { schemas[name] = components[name]; follow(components[name]); }
      return;
    }
    Object.values(v).forEach(follow);
  };
  follow(request);
  follow(response);
  const related = Object.entries(paths).flatMap(([p, ops]) => (/scenario|step|folder|tag/i.test(p) && isObj(ops)
    ? Object.keys(ops).filter((m) => /^(get|post|put|patch|delete)$/i.test(m)).map((m) => `${m.toUpperCase()} ${p}${isObj(ops[m]) && typeof (ops[m] as Obj).summary === 'string' ? `: ${(ops[m] as Obj).summary}` : ''}`)
    : [])).slice(0, 60);
  return { method: 'post', path: key!, ...(typeof post.summary === 'string' ? { summary: post.summary } : {}), ...(request ? { request } : {}), ...(response ? { response } : {}), schemas, related };
}

/** A value cut to fit: JSON longer than `max` characters comes back as its first `max` characters, marked. */
export function fit(v: unknown, max: number): unknown {
  const s = JSON.stringify(v, null, 1);
  if (!s || s.length <= max) return v;
  return `${s.slice(0, max)}\n… (cut at ${max} characters of ${s.length})`;
}

/** The files the session's worktrees changed since they branched (committed or not), per repo. */
export async function changedFiles(s: Session): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const r of s.repos) {
    let base = '';
    for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
      const m = await sh('git', ['merge-base', 'HEAD', ref], r.dir, undefined, 10_000);
      if (m.code === 0 && m.out.trim()) { base = m.out.trim(); break; }
    }
    const d = await sh('git', ['diff', '--name-only', base || 'HEAD'], r.dir, undefined, 15_000);
    const n = await sh('git', ['ls-files', '--others', '--exclude-standard'], r.dir, undefined, 10_000);
    const files = [...new Set([...(d.code === 0 ? d.out.split('\n') : []), ...(n.code === 0 ? n.out.split('\n') : [])].map((x) => x.trim()).filter(Boolean))].slice(0, 80);
    if (files.length) out[r.name] = files;
  }
  return out;
}

/** The session's side of the guide: what the scenario is for. */
export function sessionContext(s: Session, changed: Record<string, string[]>, fields: FieldPick[], loans: LoanMade[]) {
  return {
    ticket: s.ticket ? { key: s.ticket.key, title: s.ticket.title, description: s.ticket.description.slice(0, 3000), acceptance: s.ticket.acceptance } : { key: s.key, title: s.title },
    branch: s.branch,
    changed,
    fieldsToCheck: fields,
    loansMadeSoFar: loans.slice(0, 5),
    folder: s.scenarioFolder ?? s.key,
  };
}

/** What Claude is asked to do, from the panel or in its own words: the steps, in order. */
export const HOW_TO = [
  'Read createOperation (the request schema and the schemas it uses) and the template (an existing scenario as the tool keeps it). If they leave the shape unclear, read the tool\'s source in toolFolder: its scenario and step models and the create endpoint.',
  'Design the steps so the loan they make is the one this ticket needs tested as implemented so far: the acceptance criteria, what the changed files do, and the fields to check (set what the change reads; leave what it should compute).',
  'File it under `folder`: put it in the field the tool uses for folders (or groups); if the tool has none, add the folder as a tag. Name it after the ticket and what it sets up.',
  'Call make_scenario with the body; with run_env it makes a loan from it right away. Then pick the fields that prove the change (set_fields_to_check) and look them up on the new loan (lookup_fields).',
];

