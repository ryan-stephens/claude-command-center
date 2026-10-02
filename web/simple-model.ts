// The simple look of the new-card screen (PLAN §59): one column, read top to bottom. The ticket,
// what Claude can see as chips, your note, one sentence on how it starts (its options behind it),
// Start. It drives the same Composer as the full screen (NewCard.tsx), so switching looks loses
// nothing; what is here is the little state the column needs and the pure parts the keys and the
// page share. The full look stays as it was; Shift+L or the setting switches.

import { branchFor, CARD_KINDS, homeOf, includedRepos, kindName, LAUNCH_MODES, modelFor, modelName } from '../shared/cards.ts';
import type { RepoInfo, Workspace } from '../shared/protocol.ts';
import { promptsFor, renderPrompt, type PromptContext, type PromptTicket, type SavedPrompt } from '../shared/prompts.ts';
import { repoName, samePath } from '../shared/workspaces.ts';
import { cardFolders, goRows, packetRows, type Composer, type GoRow, type ModelDefaults } from './line-model.ts';

/** The column's stops, top to bottom (two columns at a wide window: ticket and context, then the message and settings). */
export type SimpleBlock = 'ticket' | 'context' | 'msg' | 'how' | 'start';
export const SIMPLE_BLOCKS: SimpleBlock[] = ['ticket', 'context', 'msg', 'how', 'start'];

/**
 * A picker open over the column: context (the repo library, folders on disk and tickets, by the
 * composer's `tab`), the ticket search a card with no ticket shows under its box, another ticket
 * in place of this one, or the list of saved prompts under the opening message.
 */
export type SimpleAdding = 'context' | 'ticket' | 'replace' | 'prompt';

export interface SimpleState {
  block: SimpleBlock;
  /** The highlighted chip in the context row. */
  ci: number;
  /** The How it starts options are open under the sentence. */
  more: boolean;
  /** Which picker is open, and its highlighted row. */
  adding: SimpleAdding | null;
  ai: number;
  /** Claude is writing the opening message from the rough text (§62). */
  writing?: boolean;
}

export const SIMPLE_DEFAULT: SimpleState = { block: 'ticket', ci: 0, more: false, adding: null, ai: 0 };

export function simpleOf(c: Composer): SimpleState {
  return c.simple ?? SIMPLE_DEFAULT;
}

export function withSimple(c: Composer, change: Partial<SimpleState>): Composer {
  return { ...c, simple: { ...simpleOf(c), ...change } };
}

/** ↑ ↓ between the blocks. */
export function stepBlock(c: Composer, delta: number): Composer {
  const at = SIMPLE_BLOCKS.indexOf(simpleOf(c).block);
  const next = Math.max(0, Math.min(SIMPLE_BLOCKS.length - 1, at + delta));
  return withSimple(c, { block: SIMPLE_BLOCKS[next] });
}

/** One chip in the context row. */
export interface Chip {
  id: string;
  label: string;
  sub?: string;
  kind: 'repo' | 'ticket' | 'add';
  /** Included in what Claude gets (a workspace repo can be left out; a card's own item is removed instead). */
  on: boolean;
  /** This card added it (x removes it; w keeps a repo for the workspace). */
  own: boolean;
  /** Its row in packetRows, for togglePacketRow / keepForWorkspace. */
  row: number;
}

/** What Claude can see, as chips: the workspace's repos, this card's repos and folders, its related tickets, then the add chips. */
export function chips(c: Composer, library: RepoInfo[]): Chip[] {
  const rows = packetRows(c);
  const out: Chip[] = [];
  rows.forEach((r, i) => {
    if (r.layer === 'note' || r.item.kind !== 'repo' && r.item.kind !== 'ticket') return;
    if (r.layer === 'ticket') return;
    const own = r.layer === 'card';
    if (r.item.kind === 'repo') {
      const isLib = library.some((x) => samePath(x.path, r.item.id)) || c.packet.workspace.some((w) => w.id === r.item.id);
      out.push({ id: `${r.layer}:${r.item.id}`, label: repoName(r.item.id), sub: own ? (isLib ? undefined : r.item.on ? 'folder' : 'folder · left out') : r.item.on ? 'lane' : 'lane · left out', kind: 'repo', on: r.item.on, own, row: i });
    } else {
      out.push({ id: `${r.layer}:${r.item.id}`, label: r.item.id.replace(/^ticket:/, ''), sub: 'related', kind: 'ticket', on: r.item.on, own, row: i });
    }
  });
  out.push({ id: 'add', label: '+ Context', sub: 'repos, folders, tickets', kind: 'add', on: true, own: false, row: -1 });
  return out;
}

/**
 * The option rows behind the How it starts sentence: the full screen's, without the kind (the
 * control at the top), where it runs (always a tab), and, for a Develop card, the branch: it
 * always works in a worktree of each repo, so cards on the same repos never touch each other
 * and Try it can run each one on its own ports. (The full look still offers the older choices.)
 */
export function howRows(c: Composer, workspaces: Workspace[], key: string, models: ModelDefaults = {}): GoRow[] {
  // The opening message has a block of its own on this screen (§62), so its row is not here either.
  return goRows(c, workspaces, key, models).filter((r) => r.id !== 'kind' && r.id !== 'where' && r.id !== 'msg' && !(r.id === 'branch' && c.kind === 'build'));
}

/** One settings row as the closed block shows it: the label the opened row has, its value, and what it means. */
export interface HowFact { id: GoRow['id'] | 'runs'; label: string; value: string; note?: string }

/** The session's settings, read-only, in the same order and words as the rows behind Change. */
export function howFacts(c: Composer, workspaces: Workspace[], key: string, models: ModelDefaults = {}): HowFact[] {
  const repos = includedRepos(c.packet);
  const home = homeOf(c.packet, c.launch);
  const homeName = home ? repoName(home) : 'no repo yet';
  const branch = branchFor(key, (c.ticket?.title ?? c.title) || 'new');
  const ws = workspaces.find((w) => w.id === c.workspaceId);
  const out: HowFact[] = [
    { id: 'ws', label: 'Lane', value: ws?.name ?? 'None', note: ws ? 'its repos and notes are part of the context' : undefined },
    { id: 'home', label: 'Starts in', value: homeName, note: repos.length > 1 ? `Claude’s working folder; the other ${repos.length - 1 === 1 ? 'repo is' : 'repos are'} added beside it` : undefined },
  ];
  if (c.kind === 'build') out.push({ id: 'branch', label: 'Branch', value: branch, note: `a new worktree of ${repos.length > 1 ? 'each repo' : 'the repo'}, so nothing else you have open is touched` });
  else out.push({ id: 'branch', label: 'Branch', value: c.launch.branch === 'pr' ? (c.pr ? `PR #${c.pr.number}’s branch, in a copy` : 'the PR’s branch') : 'the current checkout', note: c.launch.branch === 'pr' ? 'a detached worktree: your own checkout stays as it is' : 'works on whatever the repo’s folder is on' });
  const mode = c.launch.mode === 'plan' ? { v: 'Plan first', n: 'Claude writes a plan and waits for your approval before changing anything' }
    : c.launch.mode === 'auto' ? { v: 'Auto', n: 'Claude edits and runs tools without asking (not offered on every model)' }
    : { v: LAUNCH_MODES.find((m) => m.id === c.launch.mode)?.name ?? c.launch.mode, n: 'Claude asks before each edit' };
  out.push({ id: 'mode', label: 'First step', value: mode.v, note: mode.n });
  const def = modelFor(c.launch, models.pinned ?? undefined, models.user ?? undefined);
  out.push({ id: 'model', label: 'Model', value: c.launch.model ? modelName(c.launch.model) : `Default${def ? ` (${modelName(def)})` : ''}`, note: c.launch.model ? undefined : models.pinned ? 'pinned by this server' : models.user ? 'from your Claude Code settings' : 'whatever Claude Code picks' });
  out.push({ id: 'runs', label: 'Runs in', value: 'a Windows Terminal tab', note: 'a Claude Code session the card follows; the tab is where you answer it' });
  return out;
}

/** The segmented control at the top: Develop, QA, Code review. */
export const KIND_OPTIONS = CARD_KINDS.map((k) => ({ id: k.id, name: k.name }));

// ---- The opening message and saved prompts (§62) ------------------------------------------

/** A related ticket's packet item, back to key and title ("Related ticket: SHOP-160 Size chart data"). */
function relatedTicket(label: string): PromptTicket {
  const m = /^Related ticket: (\S+)\s*(.*)$/.exec(label);
  return m ? { key: m[1], title: m[2] } : { key: label, title: '' };
}

/** What a prompt can name, from the card as it stands: the same facts the Session settings list reads. */
export function promptContext(c: Composer, workspaces: Workspace[], key: string, library: RepoInfo[]): PromptContext {
  const folders = cardFolders(c, library).filter((i) => i.on).map((i) => i.id);
  const home = homeOf(c.packet, c.launch);
  const repos = includedRepos(c.packet).filter((r) => !folders.some((f) => samePath(f, r)));
  const ordered = home ? [home, ...repos.filter((r) => !samePath(r, home))] : repos;
  const ticket = c.ticket ? { key: c.ticket.key, title: c.ticket.title } : null;
  const related = c.packet.card.filter((i) => i.kind === 'ticket' && i.on).map((i) => relatedTicket(i.label));
  const ws = workspaces.find((w) => w.id === c.workspaceId);
  const branch = c.kind === 'build' && c.launch.branch !== 'current' ? branchFor(key, (c.ticket?.title ?? c.title) || 'new')
    : c.launch.branch === 'pr' && c.pr ? c.pr.source : undefined;
  return {
    ticket,
    tickets: [...(ticket ? [ticket] : []), ...related],
    repos: ordered.map(repoName),
    ...(home ? { home: repoName(home) } : {}),
    folders,
    ...(ws ? { lane: ws.name } : {}),
    ...(branch ? { branch } : {}),
    kind: kindName(c.kind),
  };
}

/** The rows under the opening message: Write your own first, then the saved prompts for this kind of card first. */
export function promptRows(prompts: SavedPrompt[], c: Composer): { id: string | null; name: string; sub: string; prompt?: SavedPrompt }[] {
  return [
    { id: null, name: 'Write your own', sub: 'free text; the box is yours' },
    ...promptsFor(prompts, c.kind).map((p) => ({ id: p.id, name: p.name, sub: p.kind ? kindName(p.kind) : 'any kind', prompt: p })),
  ];
}

/** A prompt picked: the message is its text filled from the card, and follows the card until it is edited. */
export function usePrompt(c: Composer, p: SavedPrompt, ctx: PromptContext): Composer {
  return { ...c, promptId: p.id, msgTouched: false, launch: { ...c.launch, message: renderPrompt(p.body, ctx).text } };
}

/** Write your own: the text stays as it is, and nothing re-renders it. */
export function ownMessage(c: Composer): Composer {
  return { ...c, promptId: null, msgTouched: true };
}

/**
 * The context changed (a repo added, the ticket swapped): an unedited prompt is rendered again so
 * the message always matches what was picked. A prompt that was deleted leaves its text behind as
 * the card's own. The same composer comes back when nothing is to do.
 */
export function followPrompt(c: Composer, prompts: SavedPrompt[], ctx: PromptContext): Composer {
  if (!c.promptId || c.msgTouched) return c;
  const p = prompts.find((x) => x.id === c.promptId);
  if (!p) return ownMessage(c);
  const text = renderPrompt(p.body, ctx).text;
  return text === c.launch.message ? c : { ...c, launch: { ...c.launch, message: text } };
}

/** What the dropdown's button says: the prompt in use, that it was edited from one, or your own text. */
export function promptLabel(c: Composer, prompts: SavedPrompt[]): string {
  const p = c.promptId ? prompts.find((x) => x.id === c.promptId) : undefined;
  if (!p) return c.msgTouched ? 'Your own' : 'Default';
  return c.msgTouched ? `Edited from: ${p.name}` : p.name;
}
