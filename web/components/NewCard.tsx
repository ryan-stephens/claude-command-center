// The new-card screen: 1 add context (the repo library), 2 what Claude will know (three layers and
// your note, or the exact text with p), 3 how it starts (terminal tab, workspace, home repo,
// branch, mode, opening message, and the commands it will run). Ctrl+Enter starts work.

import { useEffect, type ReactNode } from 'react';
import { fmtK, HOOK_CONTEXT_LIMIT, homeOf, itemTokens, launchLines, memoryPct, modelFor, modelName, packetText, tokens } from '../../shared/cards.ts';
import { samePath } from '../../shared/workspaces.ts';
import { goRows, packetRows, pickOption, repoOrigin, sources, toggleSource, togglePacketRow, type Composer, type Pane } from '../line-model.ts';
import { keepRepo, startWork, updateComposer } from '../line-keys.ts';
import { set, useStore } from '../store.ts';
import { Key, WsBadge } from './ui.tsx';

export function NewCard() {
  const c = useStore((s) => s.composer)!;
  const workspaces = useStore((s) => s.workspaces);
  const key = useStore((s) => s.nextKey);
  const pinned = useStore((s) => s.cardModel);
  const user = useStore((s) => s.userModel);
  const ws = workspaces.find((w) => w.id === c.workspaceId) ?? null;
  const text = packetText(c, key);
  const model = modelFor(c.launch, pinned ?? undefined, user ?? undefined);
  const size = tokens(text);
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg" role="region" aria-label="New card">
      <div className="flex items-center gap-4 border-b border-line bg-surface px-4 py-3">
        <WsBadge ws={ws} size={30} />
        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="flex items-center gap-1.5 text-sm text-faint">
            New card · {key} · {ws?.name ?? 'no workspace'} · no ticket yet ·
            <button className="flex items-center gap-1.5 rounded-md border border-line bg-raise px-1.5 font-semibold text-ink hover:border-ring" onClick={() => updateComposer((x) => ({ ...x, pane: 'go' }))}
              title="The model Claude runs in this card. m changes it; so does Model under How it starts.">
              {modelName(model)}{!c.launch.model && <span className="font-normal text-faint">default</span>}<Key k="m" size="sm" />
            </button>
          </div>
          <input
            id="cp-title" type="text" autoComplete="off" value={c.title}
            placeholder="What should this card do? e.g. Add a size guide to product pages"
            onChange={(e) => updateComposer((x) => ({ ...x, title: e.target.value }))}
            className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[19px] font-bold outline-none focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--c-ring)_20%,transparent)]"
          />
        </div>
        <div className="hidden items-center gap-2 whitespace-nowrap text-[13px] lg:flex" title="About 4 characters per token">
          <span className="text-faint">Claude will start knowing</span>
          <b className="font-mono text-[15px] tabular-nums">{fmtK(size)}</b>
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-raise"><i className="block h-full bg-busy" style={{ width: `${memoryPct(size)}%` }} /></span>
          <span className="text-faint">{memoryPct(size)}% of its memory</span>
        </div>
        <button className="btn whitespace-nowrap py-1" onClick={() => updateComposer((x) => ({ ...x, preview: !x.preview }))}><Key k="p" size="sm" />{c.preview ? 'Back to the list' : 'Preview what Claude gets'}</button>
        <button className="flex items-center gap-1.5 whitespace-nowrap text-sm text-faint hover:text-ink" onClick={() => set({ composer: null })}>Cancel <Key k="Esc" size="sm" /></button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[360px_minmax(0,1fr)_420px] lg:overflow-hidden">
        <Sources c={c} />
        <PacketPane c={c} text={text} />
        <GoPane c={c} keyName={key} />
      </div>
    </div>
  );
}

function PaneBox({ pane, n, title, right, children, c }: { pane: Pane; n: number; title: string; right?: ReactNode; children: ReactNode; c: Composer }) {
  const on = c.pane === pane;
  return (
    <section
      onMouseDown={() => { if (!on) updateComposer((x) => ({ ...x, pane })); }}
      className={`flex min-h-0 min-w-0 flex-col border-r border-line last:border-r-0 ${on ? 'bg-surface shadow-[inset_0_3px_0_var(--c-acc)]' : 'bg-col'}`}
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <span className={`grid h-5 w-5 place-items-center rounded-full border font-mono text-xs font-bold ${on ? 'border-acc bg-acc text-acc-ink' : 'border-line bg-raise text-sub'}`}>{n}</span>
        <h4 className="grow text-sm font-bold">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

function Sources({ c }: { c: Composer }) {
  const repos = useStore((s) => s.library.repos);
  const list = sources(c, repos);
  const si = Math.min(c.si, list.length - 1);
  const focused = c.pane === 'src';
  useEffect(() => {
    if (focused && list[si]) document.getElementById(`src-${si}`)?.scrollIntoView({ block: 'nearest' });
  }, [focused, si, list]);
  return (
    <PaneBox pane="src" n={1} title="Add context" c={c} right={<><span className="text-xs text-faint">click, or</span><Key k="Space" size="sm" /></>}>
      <div className="flex items-center gap-1 px-3 pb-2">
        <span className="rounded-md border border-line bg-raise px-1.5 py-0.5 text-[12.5px] font-semibold">Repos</span>
        <span className="ml-1 text-xs text-faint">Tickets, files, notes and findings come with later milestones.</span>
      </div>
      <label className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface py-1 pl-2.5 pr-1.5">
        <Key k="/" size="sm" />
        <input id="cp-q" type="text" autoComplete="off" value={c.q} placeholder="Search the repo library"
          onChange={(e) => updateComposer((x) => ({ ...x, q: e.target.value, si: 0 }))}
          className="w-full bg-transparent text-sm outline-none placeholder:text-faint" />
      </label>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {list.length ? list.map((r, i) => {
          const where = repoOrigin(c, r.path);
          const inPacket = where === 'workspace' ? c.packet.workspace.find((x) => samePath(x.id, r.path))?.on : where === 'card';
          return (
            <button key={r.path} id={`src-${i}`} onClick={() => updateComposer((x) => ({ ...toggleSource(x, r.path), pane: 'src', si: i }))}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] ${focused && i === si ? 'is-focus bg-raise' : 'hover:bg-raise'} ${inPacket ? 'opacity-70' : ''}`}>
              <span className="rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">repo</span>
              <span className="min-w-0 grow">
                <span className="block truncate">{r.name}</span>
                <span className="block truncate text-xs text-faint">{where === 'workspace' ? 'in this workspace' : 'from the library'}{r.branch ? ` · ${r.branch}` : ''}</span>
              </span>
              {inPacket ? <span className="rounded-full bg-ok-bg px-2 text-[11px] font-semibold text-ok">added</span> : <span className="w-4 text-center font-mono text-[17px] font-bold text-faint">+</span>}
            </button>
          );
        }) : <div className="rounded-xl border border-dashed border-line px-2 py-3 text-center text-[12.5px] text-faint">{repos.length ? `Nothing matches “${c.q}”` : 'The repo library is empty. F on the board picks the folders it scans.'}</div>}
      </div>
      <div className="border-t border-line px-4 pb-3 pt-2 text-[12.5px] leading-snug text-faint">The repo library. Extra repos start with --add-dir, so Claude can read and edit them.</div>
    </PaneBox>
  );
}

function PacketPane({ c, text }: { c: Composer; text: string }) {
  const rows = packetRows(c);
  const focused = c.pane === 'pkt';
  const pi = Math.min(c.pi, rows.length - 1);
  const home = homeOf(c.packet, c.launch);
  const over = text.length > HOOK_CONTEXT_LIMIT;
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === c.workspaceId)?.name);
  let idx = -1;
  const row = (layer: 'workspace' | 'ticket' | 'card', item: (typeof c.packet.card)[number]) => {
    idx += 1;
    const at = idx;
    const isHome = item.kind === 'repo' && item.on && home !== undefined && samePath(item.id, home);
    return (
      <div key={layer + item.id} onClick={() => updateComposer((x) => { const r = togglePacketRow({ ...x, pi: at }, at); return typeof r === 'string' ? r : { ...r, pi: at }; })}
        className={`flex min-w-0 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13.5px] [&+&]:border-t [&+&]:border-line/60 ${item.on ? '' : 'text-faint'} ${focused && at === pi ? 'is-focus' : ''}`}>
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-[11px] font-bold text-ok">{item.on ? '✓' : ''}</span>
        <span className="rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">{item.kind}</span>
        <span className="min-w-0 grow truncate">{item.label}</span>
        {isHome && <span className="rounded-full bg-busy-bg px-2 text-[11px] font-semibold text-busy">starts here</span>}
        {item.kind === 'repo' && item.on && !isHome && <span className="text-xs text-faint">--add-dir</span>}
        <span className={`font-mono text-[11.5px] font-semibold tabular-nums text-faint ${item.on ? '' : 'line-through'}`}>{fmtK(itemTokens(item))}</span>
        {layer === 'card' && item.kind === 'repo' && c.workspaceId && (
          <button className="flex items-center gap-1 whitespace-nowrap text-xs text-faint hover:text-ink" title="Keep this repo for the whole workspace: every card there gets it"
            onClick={(e) => { e.stopPropagation(); keepRepo(at); }}>Keep for {wsName ?? 'workspace'}<Key k="w" size="sm" /></button>
        )}
        {layer === 'card' && <Key k="x" size="sm" />}
      </div>
    );
  };
  const layer = (name: string, note: string, layerId: 'workspace' | 'ticket' | 'card', empty: ReactNode, extra?: ReactNode) => {
    const items = c.packet[layerId];
    return (
      <div className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line bg-raise px-3 py-1.5 text-[12.5px]">
          <span className="text-[13.5px] font-bold">{name}</span>
          <span className="grow text-faint">{note}</span>
          <span className="font-mono text-[11.5px] font-semibold tabular-nums text-faint">{fmtK(items.filter((i) => i.on).reduce((n, i) => n + itemTokens(i), 0))}</span>
        </div>
        {items.length ? items.map((i) => row(layerId, i)) : <div className="px-3 py-2.5 text-[13px] text-faint">{empty}</div>}
        {extra}
      </div>
    );
  };
  const noteFocused = focused && pi === rows.length - 1;
  return (
    <PaneBox pane="pkt" n={2} c={c} title={c.preview ? 'Exactly what Claude receives' : 'What Claude will know'}
      right={c.preview ? <span className="text-xs text-faint">returned by the SessionStart hook as additionalContext</span> : <><Key k="Space" size="sm" /><span className="text-xs text-faint">include or leave out</span></>}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 pb-3.5 pt-0.5">
        {over && <div className="rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">Over {HOOK_CONTEXT_LIMIT.toLocaleString()} characters: Claude Code will hand Claude a file with a preview instead of the whole text. Leave something out.</div>}
        {c.preview
          ? <pre className="m-0 whitespace-pre-wrap break-words rounded-xl border border-line bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">{text}</pre>
          : <>
            {layer('Workspace', wsName ? `shared by every ${wsName} card · set once` : 'no workspace', 'workspace', 'Pick a workspace under How it starts, or add repos from the library.')}
            {layer('Ticket', 'none yet', 'ticket', 'No ticket. Describe the work in the title. Jira and Trello import comes next.')}
            {layer('This card', 'only this card gets these', 'card', <>Add repos from the library with <Key k="Space" size="sm" />. <Key k="w" size="sm" /> on one keeps it for the whole workspace.</>,
              <div className={`flex items-start gap-2.5 border-t border-line/60 px-3 py-1.5 ${noteFocused ? 'is-focus' : ''}`}>
                <span className="mt-1.5 rounded border border-line px-1 font-mono text-[10px] font-bold uppercase text-faint">you</span>
                <textarea id="cp-note" value={c.packet.note} placeholder="Anything else Claude should know? e.g. Keep it behind the size_guide flag."
                  onFocus={() => updateComposer((x) => ({ ...x, pane: 'pkt', pi: rows.length - 1 }))}
                  onChange={(e) => updateComposer((x) => ({ ...x, packet: { ...x.packet, note: e.target.value } }))}
                  className="min-h-[56px] flex-1 resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13.5px] leading-snug outline-none focus:border-ring" />
                <Key k="e" size="sm" className="mt-1.5" />
              </div>)}
          </>}
      </div>
    </PaneBox>
  );
}

function GoPane({ c, keyName }: { c: Composer; keyName: string }) {
  const workspaces = useStore((s) => s.workspaces);
  const model = useStore((s) => s.cardModel);
  const user = useStore((s) => s.userModel);
  const rows = goRows(c, workspaces, keyName, { pinned: model, user });
  const gi = Math.min(c.gi, rows.length - 1);
  const focused = c.pane === 'go';
  return (
    <PaneBox pane="go" n={3} c={c} title="How it starts" right={<><Key k="↑" size="sm" /><Key k="↓" size="sm" /><span className="text-xs text-faint">then</span><Key k="←" size="sm" /><Key k="→" size="sm" /></>}>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3.5 pb-3.5 pt-0.5">
        {rows.map((r, i) => (
          <div key={r.id} onMouseDown={() => updateComposer((x) => ({ ...x, gi: i }))}
            className={`grid gap-1.5 rounded-xl border border-transparent px-2.5 py-2 ${focused && i === gi ? 'is-focus' : ''}`}>
            <div className="eyebrow">{r.label}</div>
            {r.id === 'msg'
              ? <input id="cp-msg" type="text" autoComplete="off" value={c.launch.message}
                  onChange={(e) => updateComposer((x) => ({ ...x, msgTouched: true, launch: { ...x.launch, message: e.target.value } }))}
                  className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13.5px] outline-none focus:border-ring" />
              : <div className="flex flex-wrap gap-1.5">
                  {r.opts.map((o, j) => (
                    <button key={o + j} disabled={r.off?.includes(j)}
                      onClick={() => updateComposer((x) => ({ ...pickOption(x, r.id, j, workspaces, keyName), gi: i }))}
                      className={`rounded-lg border px-2.5 py-1 text-[13px] ${j === r.at ? 'border-ring bg-surface font-semibold text-ink shadow-[0_0_0_2px_color-mix(in_srgb,var(--c-ring)_22%,transparent)]' : 'border-line bg-raise text-sub'} disabled:cursor-default disabled:opacity-50`}>{o}</button>
                  ))}
                </div>}
            {r.id === 'where' && <div className="text-[12.5px] text-faint">A new Windows Terminal tab runs claude. A SessionStart hook hands it the packet and links the session to the card. Running cards in the app comes later.</div>}
            {r.id === 'mode' && c.launch.mode === 'auto' && <div className="text-[12.5px] text-faint">Auto isn’t offered on every model{c.launch.model === 'haiku' ? ' (Haiku refuses it)' : ''}.</div>}
            {r.id === 'model' && <div className="text-[12.5px] text-faint">{c.launch.model ? `Starts with --model ${c.launch.model}.` : model ? `The default is ${model}, pinned by this server (CC_CONTROL_MODEL).` : user ? `The default is ${user}, from your Claude Code settings.` : 'Claude Code picks, as in a plain terminal.'} <Key k="m" size="sm" /> changes it from anywhere on this screen.</div>}
          </div>
        ))}
        <div className="grid gap-1.5 px-2.5 py-2">
          <div className="eyebrow">What happens</div>
          <pre className="m-0 whitespace-pre-wrap break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed">{launchLines(c, keyName, model ?? undefined).join('\n')}</pre>
          <div className="text-[12.5px] text-faint">The hook comes from cc-control’s own settings file, passed with --settings. Nothing is added to your Claude Code settings.</div>
        </div>
      </div>
      <div className="grid gap-2 border-t border-line px-4 py-3">
        {c.error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{c.error}</div>}
        <button className="btn btn-primary justify-center py-2 text-[15px]" disabled={c.starting} onClick={startWork}>
          <Key k="Ctrl Enter" size="sm" tone="ghost" />{c.starting ? 'Starting…' : 'Start work'}
        </button>
        <span className="text-[12.5px] text-faint">{c.launch.mode === 'plan' ? 'The card goes to Plan. Nothing changes until you approve the plan.' : 'The card goes straight to Build.'}</span>
      </div>
    </PaneBox>
  );
}
