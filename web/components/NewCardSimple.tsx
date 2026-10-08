// The simple look of the new-card screen (PLAN §59, §62): the ticket; what Claude can see as chips;
// the opening message, from a saved prompt filled in from the card or your own; the session
// settings with the options behind Change; Start. Two columns at a wide window (ticket and context
// on the left, message and settings on the right), one under about 1100px; ↑ ↓ follow the reading
// order either way. It edits the same Composer as NewCard.tsx (the full look), so Shift+L switches
// between them with nothing lost. Keys: web/simple-keys.ts. Only Esc, Ctrl+Enter and ? show as
// keycaps here; the legend has the rest.

import { Fragment, useEffect, useRef, useState } from 'react';
import { CARD_MODELS, packetText } from '../../shared/cards.ts';
import { renderPrompt } from '../../shared/prompts.ts';
import { SOURCE_NAME } from '../../shared/tickets.ts';
import { composerKey, modelOpts, pickOption, togglePacketRow, type Composer, type GoRow, type SourceTab } from '../line-model.ts';
import { leaveComposer, startWork, updateComposer } from '../line-keys.ts';
import { addTypedFolder, browseFolder, choosePromptAt, closePicker, develop, openPicker, openPromptList, openPromptsDialog, pickAt, pickerList, saveAsPrompt, singlePick, toggleTicketDetails, typeInPicker, writeWithClaude } from '../simple-keys.ts';
import type { Ticket } from '../../shared/tickets.ts';
import { chips, followPrompt, howFacts, howRows, KIND_OPTIONS, promptContext, promptLabel, promptRows, simpleOf, withSimple, type Chip, type SimpleBlock } from '../simple-model.ts';
import { get, useStore } from '../store.ts';
import { usePrLookup, useTicketSearch } from './NewCard.tsx';
import { CornerClose } from './Overlay.tsx';
import { Icon, Key, TicketKey } from './ui.tsx';

export function NewCardSimple() {
  const c = useStore((s) => s.composer)!;
  const key = useStore((s) => composerKey(s.composer!, s.nextKey));
  const pinned = useStore((s) => s.cardModel);
  const user = useStore((s) => s.userModel);
  const workspaces = useStore((s) => s.workspaces);
  const prompts = useStore((s) => s.prompts);
  const library = useStore((s) => s.library.repos);
  const sp = simpleOf(c);
  const text = packetText(c, key);
  useTicketSearch(c);
  usePrLookup(c);
  // A Develop card here always works in worktrees (a draft from the full look may say otherwise).
  useEffect(() => { updateComposer(develop); }, [c.kind]);
  // An unedited prompt follows the card: whenever the context it names changes, the message is rendered again.
  // (Or the prompt was deleted: the text stays as the card's own.)
  const stale = followPrompt(c, prompts, promptContext(c, workspaces, key, library)) !== c;
  useEffect(() => { if (stale) updateComposer((x) => followPrompt(x, get().prompts, promptContext(x, get().workspaces, composerKey(x, get().nextKey), get().library.repos))); }, [stale, c]);
  const ws = workspaces.find((w) => w.id === c.workspaceId) ?? null;
  const focus = (block: SimpleBlock) => sp.block === block && !sp.adding;
  const go = (block: SimpleBlock) => updateComposer((x) => withSimple(x, { block }));
  // + Context on an open card (§88): the picker alone, over the chat; a click outside goes back to it.
  if (c.addTo) {
    return (
      <div className="absolute inset-0 z-30 flex items-start justify-center bg-ink/30 px-6 pt-16" onMouseDown={(e) => { if (e.target === e.currentTarget) leaveComposer(); }}>
        <Picker c={c} />
      </div>
    );
  }
  return (
    // A popup over the board, nearly the whole page: the board stays behind it, a click outside keeps the card for c and closes.
    <div className="absolute inset-0 z-20 flex items-stretch justify-center bg-ink/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) leaveComposer(); }}>
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-[0_30px_80px_rgba(0,0,0,.35)]" role="region" aria-label="New card">
      <div className="flex items-center justify-between gap-4 border-b border-line bg-surface px-8 py-3.5">
        <div className="flex items-center gap-5">
          <div className="text-[15px] font-bold">New session</div>
          <div className="inline-flex overflow-hidden rounded-lg border border-line text-[13px]" role="radiogroup" aria-label="Kind of work">
            {KIND_OPTIONS.map((k, i) => (
              <button key={k.id} role="radio" aria-checked={c.kind === k.id}
                onClick={() => updateComposer((x) => develop(pickOption(x, 'kind', i, get().workspaces, key, get().recipes)))}
                className={`px-3.5 py-1.5 ${i ? 'border-l border-line' : ''} ${c.kind === k.id ? 'bg-ink font-semibold text-bg' : 'text-sub hover:bg-raise'}`}>{k.name}</button>
            ))}
          </div>
          {ws && <span className="text-[13px] text-faint">{ws.name} workspace</span>}
        </div>
        <div className="flex items-center gap-4 text-[13px] text-faint">
          <CornerClose onClick={leaveComposer} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto">
        <div className="w-full max-w-[1480px] px-8 py-7">
          {c.preview
            // One sequence, in the order Claude gets it (§66): the context the SessionStart hook returns, then the opening message as the first user turn.
            ? <section className="flex flex-col gap-2">
                <div className="eyebrow">1 · The context, first: returned by the SessionStart hook before your message</div>
                <pre className="m-0 whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[12.5px] leading-relaxed">{text}</pre>
                <div className="mt-3 flex items-baseline justify-between"><div className="eyebrow">2 · Then the opening message: your first message in the session</div><span className="text-xs text-faint">the prompt claude starts with</span></div>
                <pre className="m-0 whitespace-pre-wrap break-words rounded-xl border border-line bg-surface px-4 py-3 text-[13.5px] leading-relaxed">{c.launch.message.trim() || <span className="text-faint">(none)</span>}</pre>
              </section>
            : <div className="grid grid-cols-1 gap-x-10 gap-y-7 min-[1100px]:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-7">
                <TicketBlock c={c} focused={focus('ticket')} onFocus={() => go('ticket')} />
                <ContextBlock c={c} focused={focus('context')} onFocus={() => go('context')} />
              </div>
              <div className="flex min-w-0 flex-col gap-7">
                <MessageBlock c={c} focused={focus('msg')} onFocus={() => go('msg')} />
                <HowBlock c={c} keyName={key} focused={focus('how')} onFocus={() => go('how')} pinned={pinned} user={user} />
              </div>
            </div>}
        </div>
      </div>
      {sp.adding && sp.adding !== 'ticket' && sp.adding !== 'prompt' && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-ink/20 px-6 pt-20" onMouseDown={(e) => { if (e.target === e.currentTarget) closePicker(); }}>
          <Picker c={c} />
        </div>
      )}

      <div className="flex justify-center border-t border-line bg-surface px-8 py-4">
        <div className="flex w-full max-w-[1480px] items-center justify-between gap-4">
          <button className="btn" onClick={() => updateComposer((x) => ({ ...x, preview: !x.preview }))}>{c.preview ? 'Back to the card' : 'Preview what Claude gets'}</button>
          <div className="flex items-center gap-4">
            {c.error && <span className="rounded-lg bg-bad-bg px-3 py-1.5 text-[13px] text-bad" role="alert">{c.error}</span>}
            <ModelPick c={c} pinned={pinned} user={user} />
            <button onMouseDown={() => go('start')} onClick={startWork} disabled={c.starting}
              className={`btn btn-primary px-5 py-2.5 text-[15px] ${focus('start') ? 'blk-focus' : ''}`}>
              {c.starting ? 'Starting…' : 'Start work'} <Key k="Ctrl Enter" size="sm" tone="ghost" />
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

function TicketBlock({ c, focused, onFocus }: { c: Composer; focused: boolean; onFocus: () => void }) {
  const t = c.ticket;
  const sp = simpleOf(c);
  const found = useStore((s) => s.found);
  if (t) {
    const open = Boolean(sp.details);
    return (
      <section onMouseDown={onFocus} className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2"><div className="eyebrow">Ticket</div><button className="text-[12.5px] text-acc underline decoration-acc/50 underline-offset-2 hover:text-ink hover:decoration-ink" onClick={() => openPicker('replace')} title="Enter">(change)</button></div>
        <div className={`flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-5 py-4 ${focused ? 'blk-focus' : ''}`}>
          <div className="flex items-center gap-2.5 text-[13px] text-faint">
            {/* The key opens the ticket in the tracker (§70); o does the same from the keyboard. */}
            {t.url
              ? <a href={t.url} target="_blank" rel="noreferrer" title={`Open in ${SOURCE_NAME[t.source]} (o)`} className="rounded-md ring-acc/40 hover:ring-2"><TicketKey k={t.key} source={t.source} /></a>
              : <TicketKey k={t.key} source={t.source} />}
            <span>{t.status}</span><span>·</span><span>{SOURCE_NAME[t.source]}{t.demo ? ' (demo)' : ''}</span>
            <span className="grow" />
            {t.url && <a className="hover:text-ink" href={t.url} target="_blank" rel="noreferrer">Open in {SOURCE_NAME[t.source]} ↗</a>}
          </div>
          <h1 className="m-0 text-[21px] font-bold leading-snug">{t.title}</h1>
          {t.description.trim() && <p className={`m-0 text-[14px] leading-relaxed text-sub ${open ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}>{t.description.trim()}</p>}
          {/* The counts are a drawer (§70): Space, or a click, shows the criteria, comments and links under them. */}
          <button type="button" aria-expanded={open} aria-controls="ticket-details" onClick={toggleTicketDetails} title="Space"
            className="-mx-2 flex items-center gap-4 rounded-lg border-t border-line/60 px-2 pt-2 text-left text-[13px] text-sub hover:text-ink">
            {/* The counts stand in for the drawer; open, the drawer's own headings say it all, so the row is just the way to close it. */}
            {open
              ? <span className="text-faint">Details</span>
              : <><span>Acceptance criteria · {t.acceptance.length}</span><span>Comments · {t.comments.length}</span>{t.links.length > 0 && <span>Linked · {t.links.length}</span>}</>}
            <span className="grow" /><span className="text-xs text-faint">{open ? 'Hide ▴' : 'Show ▾'}</span>
          </button>
          {open && <TicketDetails t={t} />}
        </div>
      </section>
    );
  }
  return (
    <section onMouseDown={onFocus} className="flex flex-col gap-2">
      <div className="eyebrow">Ticket</div>
      {/* With no ticket, the block's own search box is the picker: its list opens under it while the box has been touched. */}
      <input id="cp-q" type="text" autoComplete="off" value={c.q} placeholder="Find a ticket: a key like SHOP-160, or words from its title (Jira is searched too)"
        onFocus={() => updateComposer((x) => withSimple({ ...x, tab: 'tickets' }, { adding: 'ticket', ai: 0 }))}
        onChange={(e) => updateComposer((x) => withSimple({ ...x, q: e.target.value }, { ai: 0 }))}
        className={`field text-[15px] ${focused && !sp.adding ? 'blk-focus' : ''}`} />
      {sp.adding === 'ticket' && <Picker c={c} embedded />}
      {found.problem && sp.adding !== 'ticket' && <div className="text-[12.5px] text-attn">{found.problem}</div>}
      <label htmlFor="cp-title" className="text-[13px] text-faint">No ticket? Say what the card should do instead.</label>
      <input id="cp-title" type="text" autoComplete="off" value={c.title} placeholder="e.g. Add a size guide to product pages"
        onChange={(e) => updateComposer((x) => ({ ...x, title: e.target.value }))}
        className="field text-[14px]" />
    </section>
  );
}

/**
 * The model, beside Start work (§73): a select-looking control like the prompt picker's, with the
 * default (named when known) and Opus, Sonnet, Haiku in a list above it. It edits the same field
 * as the Model row in the session settings, so the two always agree; m still cycles it from anywhere.
 */
function ModelPick({ c, pinned, user }: { c: Composer; pinned: string | null; user: string | null }) {
  const [open, setOpen] = useState(false);
  const opts = modelOpts({ pinned, user });
  const at = c.launch.model ? 1 + CARD_MODELS.findIndex((x) => x.id === c.launch.model) : 0;
  const def = pinned ?? user;
  // The default's full id goes under its row (and in the control's title), not beside it: it is long.
  const name = (i: number) => (i === 0 ? 'Default' : opts[i]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!(e.target as Element).closest?.('[data-model-pick]')) setOpen(false); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  return (
    <div className="relative" data-model-pick>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Model · ${name(at)}`} title={at === 0 && def ? `${def} · m` : 'm'}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border bg-surface py-1.5 pl-3 pr-2 text-[13px] hover:border-ring ${open ? 'border-ring ring-2 ring-ring/25' : 'border-line'}`}>
        <span className="text-faint">Model</span><span className="font-medium">{name(at)}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div role="listbox" aria-label="Model" className="absolute bottom-full right-0 z-20 mb-2 flex w-[320px] flex-col rounded-xl border border-ink/20 bg-surface p-1.5 shadow-[0_6px_14px_rgba(0,0,0,.12),0_28px_70px_rgba(0,0,0,.35)] ring-1 ring-black/5">
          <div className="px-2.5 pb-1.5 pt-1.5"><span className="eyebrow">Model</span></div>
          {opts.map((o, i) => (
            // The one in use is told by its tick and the accent colour, never by a raised ground: that is the hover's, and the two must not look alike.
            <button key={o} role="option" aria-selected={i === at} onClick={() => { updateComposer((x) => pickOption(x, 'model', i, get().workspaces, '', get().recipes)); setOpen(false); }}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] hover:bg-raise ${i === at ? 'font-semibold text-acc' : ''}`}>
              <span className="grid h-4 w-4 shrink-0 place-items-center">{i === at && <Icon name="check" size={14} className="text-acc" />}</span>
              <span className="flex min-w-0 grow flex-col"><span>{name(i)}</span>{i === 0 && def && <span className="truncate font-mono text-[11.5px] font-normal text-faint">{def}</span>}</span>
              {i === 0 && <span className="shrink-0 text-xs text-faint">{pinned ? 'pinned by this server' : user ? 'your Claude Code setting' : 'whatever Claude Code picks'}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The ticket's drawer: every acceptance criterion, each comment with who and when, the linked tickets. */
function TicketDetails({ t }: { t: Ticket }) {
  const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div id="ticket-details" className="flex flex-col gap-3 text-[13.5px]">
      <div>
        <div className="eyebrow mb-1">Acceptance criteria</div>
        {t.acceptance.length
          ? <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 leading-relaxed">{t.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>
          : <div className="text-faint">None on the ticket.</div>}
      </div>
      <div>
        <div className="eyebrow mb-1">Comments</div>
        {t.comments.length
          ? <div className="flex flex-col gap-2">{t.comments.map((cm, i) => (
              <div key={i} className="rounded-lg bg-raise px-3 py-2">
                <div className="mb-0.5 text-xs text-faint"><b className="font-semibold text-sub">{cm.author}</b> · {when(cm.at)}</div>
                <div className="whitespace-pre-wrap leading-relaxed">{cm.body}</div>
              </div>
            ))}</div>
          : <div className="text-faint">None yet.</div>}
      </div>
      {t.links.length > 0 && (
        <div>
          <div className="eyebrow mb-1">Linked</div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{t.links.map((l) => <li key={l.key} className="flex items-center gap-2"><span className="text-faint">{l.relation}</span><TicketKey k={l.key} source={t.source} /><span>{l.title}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function ContextBlock({ c, focused, onFocus }: { c: Composer; focused: boolean; onFocus: () => void }) {
  const library = useStore((s) => s.library.repos);
  const list = chips(c, library);
  const ci = Math.min(simpleOf(c).ci, list.length - 1);
  const act = (chip: Chip, i: number) => {
    updateComposer((x) => withSimple(x, { block: 'context', ci: i }));
    if (chip.kind === 'add') {
      openPicker('context');
    } else {
      // A click on a workspace chip includes or leaves it out; on one the card added, takes it out (as x does).
      updateComposer((x) => togglePacketRow(x, chip.row, chip.own));
    }
  };
  return (
    <section onMouseDown={onFocus} className="flex flex-col gap-2">
      <div className="eyebrow">What Claude can see</div>
      <div className="flex flex-wrap gap-2">
        {list.map((chip, i) => (
          <button key={chip.id} onClick={() => act(chip, i)} title={chip.kind === 'add' ? undefined : chip.own ? 'x takes it out' : chip.on ? 'Enter leaves it out' : 'Enter includes it'}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13.5px] ${chip.kind === 'add' ? 'border-dashed border-line text-sub hover:bg-raise' : chip.on ? 'border-line bg-surface text-ink' : 'border-line bg-raise text-faint line-through'} ${focused && i === ci ? 'blk-focus' : ''}`}>
            {chip.kind === 'ticket' && <TicketKey k={chip.label} />}
            {chip.kind !== 'ticket' && <span>{chip.label}</span>}
            {chip.sub && <span className="text-xs text-faint">{chip.sub}</span>}
            {chip.own && <span className="text-faint" aria-hidden="true">×</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The opening message (§62): the first thing Claude is told, after the context the hook hands
 * it. A dropdown of saved prompts above the box: a prompt picked is filled in from the card and
 * follows it until the text is edited (the button then says "Edited from"); Write your own leaves
 * the box alone. Save as a prompt turns the text into a new one; Edit prompts opens the list.
 */
function MessageBlock({ c, focused, onFocus }: { c: Composer; focused: boolean; onFocus: () => void }) {
  const sp = simpleOf(c);
  const prompts = useStore((s) => s.prompts);
  const workspaces = useStore((s) => s.workspaces);
  const nextKey = useStore((s) => s.nextKey);
  const library = useStore((s) => s.library.repos);
  const open = sp.adding === 'prompt';
  const rows = promptRows(prompts, c);
  const ai = Math.min(sp.ai, rows.length - 1);
  const label = promptLabel(c, prompts);
  const used = c.promptId ? prompts.find((p) => p.id === c.promptId) : undefined;
  const rendered = used && !c.msgTouched ? renderPrompt(used.body, promptContext(c, workspaces, composerKey(c, nextKey), library)) : null;
  useEffect(() => { if (open) document.getElementById(`prompt-${ai}`)?.scrollIntoView({ block: 'nearest' }); }, [open, ai]);
  // The box grows with its text (§69): never a scrollbar of its own; the popup's body scrolls instead, so the whole message is always in view while typing.
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [c.launch.message]);
  // A click anywhere outside the picker (its button or its list) closes the list, as a dropdown should.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!(e.target as Element).closest?.('[role="listbox"], [aria-haspopup="listbox"]')) closePicker(); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  const note = c.msgTouched && used ? 'Edited, so it no longer follows the card. Pick the prompt again to fill it in afresh.'
    : rendered ? `Filled in from the card${rendered.missing.length ? `; nothing yet for ${rendered.missing.map((n) => `{{${n}}}`).join(', ')}` : ''}. It follows the card as you add context.`
    : 'The first thing Claude is told. The context itself arrives through the SessionStart hook, so keep this to a prompt.';
  return (
    <section onMouseDown={onFocus} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="cp-msg" className="eyebrow">Opening message</label>
        <div className="flex items-center gap-4 text-[13px] text-faint">
          <button className={`hover:text-ink ${sp.writing ? 'text-busy' : ''}`} onClick={writeWithClaude} disabled={Boolean(sp.writing)} title="w: your rough words in the box plus the card’s context go to a cheap model for one turn; its answer replaces the text">{sp.writing ? 'Claude is writing…' : 'Have Claude write it'}</button>
          <button className="hover:text-ink" onClick={saveAsPrompt} title="s">Save as a prompt</button>
          <button className="hover:text-ink" onClick={openPromptsDialog} title="Shift+E">Edit prompts</button>
        </div>
      </div>
      <div className={`relative flex flex-col overflow-visible rounded-xl border border-line bg-surface ${focused ? 'blk-focus' : ''}`}>
        {/* The prompt picker (§71): a select-looking control, so it reads as a dropdown; the list under it marks the row the keys are on softly, the one in use with a tick. */}
        <div className="flex items-center gap-3 rounded-t-xl border-b border-line bg-raise/40 px-4 py-2">
          <span className="text-[12.5px] text-faint">Prompt</span>
          <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Prompt · ${label}`} title="Space"
            onClick={() => { if (open) closePicker(); else openPromptList(); }}
            className={`flex min-w-0 max-w-[420px] items-center gap-2 rounded-lg border bg-surface py-1 pl-3 pr-2 text-left text-[13.5px] font-medium hover:border-ring ${open ? 'border-ring ring-2 ring-ring/25' : 'border-line'}`}>
            <span className="min-w-0 truncate">{label}</span>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        {/* Open, the box behind the list is veiled and the list sits on it as a lifted panel with its own heading, so the two never read as one. */}
        {open && <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[44px] z-[5] rounded-b-xl bg-ink/15 backdrop-blur-[1.5px]" />}
        {open && (
          <div role="listbox" aria-label="Saved prompts" className="absolute left-3 right-3 top-[46px] z-10 flex max-h-[340px] flex-col overflow-y-auto rounded-xl border border-ink/20 bg-surface p-1.5 pt-1 shadow-[0_6px_14px_rgba(0,0,0,.12),0_28px_70px_rgba(0,0,0,.35)] ring-1 ring-black/5">
            <div className="px-2.5 pb-1.5 pt-1.5"><span className="eyebrow">Saved prompts</span></div>
            {rows.map((r, i) => {
              // The tick: the prompt in use, or Write your own once the text is yours (the default message is neither).
              const using = r.id === null ? !c.promptId && c.msgTouched : r.id === c.promptId;
              return (
                <button key={r.id ?? 'own'} id={`prompt-${i}`} role="option" aria-selected={i === ai} onClick={() => choosePromptAt(c, i)}
                  className={`flex items-center gap-2.5 rounded-lg border-l-[3px] px-2.5 py-2 text-left text-[13.5px] ${i === ai ? 'border-acc bg-raise' : 'border-transparent hover:bg-raise'} ${i === 1 ? 'mt-1 border-t border-t-line/60 pt-2.5' : ''}`}>
                  <span className="grid h-4 w-4 shrink-0 place-items-center">{using && <Icon name="check" size={14} className="text-ok" />}</span>
                  <span className="min-w-0 grow truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-faint">{r.sub}</span>
                </button>
              );
            })}
          </div>
        )}
        <textarea id="cp-msg" ref={box} rows={9} value={c.launch.message} placeholder="What should Claude do first? Pick a saved prompt above, or type rough words and have Claude write it." readOnly={Boolean(sp.writing)}
          onChange={(e) => updateComposer((x) => ({ ...x, msgTouched: true, launch: { ...x.launch, message: e.target.value } }))}
          className="field min-h-[200px] resize-none overflow-hidden rounded-none border-0 bg-transparent text-[14px] leading-relaxed focus:ring-0" spellCheck={false} />
        <div className="border-t border-line/60 px-4 py-2 text-[12.5px] text-faint">{note}</div>
      </div>
    </section>
  );
}

function HowBlock({ c, keyName, focused, onFocus, pinned, user }: { c: Composer; keyName: string; focused: boolean; onFocus: () => void; pinned: string | null; user: string | null }) {
  const sp = simpleOf(c);
  const workspaces = useStore((s) => s.workspaces);
  // A session the app runs (§93) never stops at Claude Code's trust prompt: only a terminal tab asks.
  const trust = useStore((s) => s.settings.trustWorktrees === true || !s.cardsInTerminal);
  const rows = howRows(c, workspaces, keyName, { pinned, user });
  const gi = Math.min(c.gi, rows.length - 1);
  const facts = howFacts(c, workspaces, keyName, { pinned, user });
  return (
    <section onMouseDown={onFocus} className={`flex flex-col rounded-xl border border-line bg-surface ${focused && !sp.more ? 'blk-focus' : ''}`}>
      <div className="flex items-center justify-between gap-4 px-5 pb-2 pt-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="eyebrow">Session settings</div>
          <div className="text-[13px] text-faint">{sp.more ? 'Pick an option on each row; Done closes.' : 'How Claude’s session is set up. Change opens the options.'}</div>
        </div>
        <button className="btn whitespace-nowrap py-1.5" onClick={() => updateComposer((x) => withSimple({ ...x, gi: 0 }, { block: 'how', more: !sp.more }))}>{sp.more ? 'Done' : 'Change'}</button>
      </div>
      {sp.more
        ? <div className="flex flex-col border-t border-line px-5 pb-3">
            {rows.map((r, i) => <OptionRow key={r.id} c={c} r={r} i={i} focused={focused && i === gi} keyName={keyName} trust={trust} />)}
          </div>
        : <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-line px-5 py-3 text-[13.5px]">
            {facts.map((f) => (
              <Fragment key={f.id}>
                <dt className="text-faint">{f.label}</dt>
                <dd className="m-0 min-w-0"><span className={f.id === 'branch' ? 'font-mono text-[13px]' : ''}>{f.value}</span>{f.note && <span className="text-faint"> · {f.note}</span>}</dd>
              </Fragment>
            ))}
          </dl>}
    </section>
  );
}

function OptionRow({ c, r, i, focused, keyName, trust }: { c: Composer; r: GoRow; i: number; focused: boolean; keyName: string; trust: boolean }) {
  const label = r.id === 'ws' ? 'Workspace' : r.id === 'home' ? 'Starts in' : r.id === 'branch' ? 'Branch' : r.id === 'mode' ? 'First step' : r.id === 'model' ? 'Model' : r.label;
  const why = r.id === 'branch' && c.kind === 'build'
    ? (c.launch.branch === 'worktree' ? `Each repo gets a folder of its own next to it on the card’s branch, so other cards in the same repos are never touched.${trust ? '' : ' Claude Code asks once in the tab whether to trust the new folder.'}`
      : c.launch.branch === 'new' ? 'Switches the repo’s usual folder to the new branch; another card in the same repo would then change the files under this one.'
      : 'Stays on whatever the repo’s folder is on, and changes it there.')
    : r.id === 'mode' ? (c.launch.mode === 'plan' ? 'Nothing changes until you approve the plan (y on the card).' : c.launch.mode === 'auto' ? 'Auto isn’t offered on every model.' : 'Claude asks before each edit.')
    : null;
  useEffect(() => { if (focused) document.getElementById(`how-${r.id}`)?.scrollIntoView({ block: 'nearest' }); }, [focused, r.id]);
  return (
    <div id={`how-${r.id}`} onMouseDown={(e) => { e.stopPropagation(); updateComposer((x) => withSimple({ ...x, gi: i }, { block: 'how' })); }}
      className={`grid grid-cols-[140px_minmax(0,1fr)] items-start gap-4 border-t border-line/60 py-3 first:border-t-0 ${focused ? 'rounded-lg bg-raise' : ''}`}>
      <div className="pt-1.5 text-[14px] font-medium">{label}</div>
      <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
              {r.opts.map((o, j) => {
                const off = Boolean(r.off?.includes(j));
                const on = j === r.at;
                return (
                  <button key={o + j} role="radio" aria-checked={on} disabled={off} title={off ? 'Not available for this card' : on ? 'Chosen' : 'Choose this'}
                    onClick={() => updateComposer((x) => ({ ...pickOption(x, r.id, j, get().workspaces, keyName, get().recipes), gi: i }))}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] ${on ? 'border-acc bg-acc font-semibold text-acc-ink' : off ? 'border-dashed border-line text-faint line-through' : 'border-line bg-surface text-ink hover:border-ring hover:bg-raise'} disabled:cursor-not-allowed`}>
                    {on && <Icon name="check" size={13} />}{o}
                  </button>
                );
              })}
            </div>
            {why && <div className="text-[12.5px] leading-snug text-faint">{why}</div>}
          </div>
    </div>
  );
}

const TABS: { id: SourceTab; name: string }[] = [{ id: 'repos', name: 'Repos' }, { id: 'folders', name: 'Folders' }, { id: 'tickets', name: 'Tickets' }];

/**
 * The picker: a popup over the column for context (Repos, Folders and Tickets tabs; what the card
 * has is marked and Enter takes it out again) or for another ticket in place of this one; embedded
 * under the ticket box of a card with no ticket, just the list.
 */
function Picker({ c, embedded = false }: { c: Composer; embedded?: boolean }) {
  const sp = simpleOf(c);
  const found = useStore((s) => s.found);
  useStore((s) => s.library.repos.length);
  useStore((s) => s.tickets.length);
  const list = pickerList(c);
  const ai = Math.min(sp.ai, list.length - 1);
  const context = sp.adding === 'context';
  const tab: SourceTab = context ? c.tab : 'tickets';
  const one = singlePick(c);
  const addTo = c.addTo;
  const title = addTo ? `Add context to ${addTo.key}` : context ? 'Add context' : sp.adding === 'replace' ? 'Change the ticket' : 'Tickets';
  useEffect(() => { if (ai >= 0) document.getElementById(`pick-${ai}`)?.scrollIntoView({ block: 'nearest' }); }, [ai]);
  const empty = c.q.trim() ? `Nothing matches “${c.q}”`
    : tab === 'repos' ? 'The repo library is empty: on the board, pick the folders it scans.'
    : tab === 'folders' ? 'No folders from disk yet. Type a path above, or browse for one.'
    : 'No tickets yet. Connect Jira or Trello from the board, or show the demo tickets.';
  return (
    <section className={`flex w-full max-w-[640px] flex-col gap-3 rounded-xl border bg-surface p-4 ${embedded ? 'border-line' : 'border-line shadow-[0_24px_60px_rgba(0,0,0,.25)]'}`} role="group" aria-label={title}>
      {!embedded && <>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col"><div className="text-[15px] font-bold">{title}</div>{one && <div className="text-[12.5px] text-faint">Pick one: it takes this card’s place, with its description and criteria.</div>}</div>
          {context && (
            <div className="inline-flex overflow-hidden rounded-lg border border-line text-[13px]" role="tablist">
              {TABS.map((t, i) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id}
                  onClick={() => updateComposer((x) => withSimple({ ...x, tab: t.id, q: '' }, { ai: 0 }))}
                  className={`px-3 py-1 ${i ? 'border-l border-line' : ''} ${tab === t.id ? 'bg-ink font-semibold text-bg' : 'text-sub hover:bg-raise'}`}>{t.name}</button>
              ))}
            </div>
          )}
          {!context && <button className="text-[13px] text-faint hover:text-ink" onClick={closePicker}>Close <Key k="Esc" size="sm" /></button>}
          {addTo && <CornerClose onClick={leaveComposer} />}
        </div>
        {tab === 'folders'
          ? <div className="flex items-center gap-2">
              <input id="cp-q" type="text" autoComplete="off" value={c.q} placeholder="Type or paste a folder path, like D:\specs\loans" spellCheck={false}
                onChange={(e) => typeInPicker(e.target.value)}
                className="field font-mono text-[13.5px]" />
              <button className="btn h-[38px] px-2.5" onClick={addTypedFolder} title="Add the folder typed (Enter)" aria-label="Add the folder typed"><Icon name="check" size={17} /></button>
              <button className="btn h-[38px] px-2.5" onClick={browseFolder} title="Browse for a folder in the Windows dialog (b)" aria-label="Browse for a folder"><Icon name="folder" size={17} /></button>
            </div>
          : <input id="cp-q" type="text" autoComplete="off" value={c.q} placeholder={tab === 'repos' ? 'Search the repos, or paste a folder of repos to list for this card' : 'A key like SHOP-160, or words from the title (Jira is searched too)'}
              onChange={(e) => typeInPicker(e.target.value)}
              className="field text-[14px]" />}
      </>}
      {/* What the last action came to, next to where it was tried (§68): a refusal in the warning colour, otherwise a plain word. */}
      {sp.note && <div role="status" className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${sp.note.bad ? 'bg-bad-bg text-bad' : 'bg-raise text-sub'}`}>{sp.note.text}</div>}
      {tab === 'tickets' && c.q.trim().length >= 2 && (found.looking || found.problem) && <div className={`text-[12.5px] ${found.problem ? 'text-attn' : 'text-faint'}`}>{found.problem ?? 'Searching Jira for anyone’s tickets…'}</div>}
      <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
        {list.length ? list.map((row, i) => (
          // A folder of repos added for this card (§65) heads its repos: its path, and × takes it off; the last row adds another.
          row.role === 'source'
            ? <div key={row.id} id={`pick-${i}`} role="heading" aria-level={3} onClick={() => updateComposer((x) => withSimple(x, { ai: i }))}
                className={`mt-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg border-t border-line/60 px-2.5 pb-1 pt-2 text-[12.5px] ${i === ai ? 'is-focus bg-raise' : ''}`}>
                <span className="min-w-0 grow truncate font-mono text-sub" title={row.label}>{row.label}</span>
                <span className="shrink-0 text-xs text-faint">{row.sub}</span>
                <button className="shrink-0 text-faint hover:text-ink" onClick={(e) => { e.stopPropagation(); pickAt(c, i, true); }} title="Take this folder off the list (x)" aria-label={`Take ${row.label} off the list`}>×</button>
              </div>
            : <button key={row.id} id={`pick-${i}`} onClick={() => pickAt(c, i)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] ${row.role === 'more' ? 'mt-1 border border-dashed border-line text-sub' : ''} ${i === ai ? 'is-focus bg-raise' : 'hover:bg-raise'}`}>
                {!one && !row.role && <span className="grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] border-line font-mono text-[11px] font-bold text-ok">{row.in ? '✓' : ''}</span>}
                {row.key && <TicketKey k={row.key} />}
                <span className="min-w-0 grow truncate">{row.label}</span>
                {row.sub && <span className="shrink-0 text-xs text-faint">{row.sub}</span>}
              </button>
        )) : <div className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[12.5px] text-faint">{empty}</div>}
      </div>
      {!embedded && context && addTo && (
        <>
          <label className="grid gap-1 text-[12.5px]">
            <span className="font-semibold text-sub">A note for Claude <span className="font-normal text-faint">optional</span></span>
            <textarea id="cp-note" rows={2} value={c.packet.note} onChange={(e) => updateComposer((x) => ({ ...x, packet: { ...x.packet, note: e.target.value } }))} placeholder="Anything Claude should know from here on…" spellCheck={false} className="field resize-none text-[13.5px]" />
          </label>
          {c.error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{c.error}</div>}
          <div className="flex items-end justify-between gap-4 border-t border-line pt-3">
            <div className="text-[12.5px] text-faint">What you tick and the note go to Claude at once between turns, or with your next message while it works; a repo gets a worktree on the card’s branch. <span className="text-sub">has it</span> marks what the card can already use.</div>
            <button className="btn btn-primary shrink-0 px-4 py-2" onClick={startWork} disabled={c.starting}>{c.starting ? 'Adding…' : `Add to ${addTo.key}`} <Key k="Ctrl Enter" size="sm" tone="ghost" /></button>
          </div>
        </>
      )}
      {!embedded && context && !addTo && (
        <div className="flex items-end justify-between gap-4 border-t border-line pt-3">
          <div className="text-[12.5px] text-faint">{tab === 'folders' ? 'Folders from disk (docs, a spec, a tool’s): Claude can read and edit what is inside. Type or paste a path, or browse for one; a folder listed can be left out, brought back or taken off the card.' : tab === 'repos' ? 'Picking a repo keeps the list open; picking it again takes it out. Another folder of repos lists its repos here for this card only, never the workspace.' : 'Picking a ticket keeps the list open; picking it again takes it out.'} Everything you add is on the card already.</div>
          <button className="btn btn-primary shrink-0 px-4 py-2" onClick={closePicker}>Done <Key k="Esc" size="sm" tone="ghost" /></button>
        </div>
      )}
    </section>
  );
}
