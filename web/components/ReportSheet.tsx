// A QA or review card's report (s on the card): what Claude found. Enter copies it; j posts it as a
// comment on the ticket in Jira and m moves the ticket, each after you say so on this sheet (nothing
// is written on its own); d finishes the card (it goes to Done).

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { kindName } from '../../shared/cards.ts';
import type { TicketTransition } from '../../shared/tickets.ts';
import { flash, useStore } from '../store.ts';
import { commentTicket, moveTicket, send, ticketTransitions } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

type Mode = { kind: 'view' } | { kind: 'post' } | { kind: 'move'; transitions: TicketTransition[] | null; at: number };

export function ReportSheet({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const [copied, setCopied] = useState(false);
  const [posted, setPosted] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = card?.report?.text ?? card?.live?.lastMessage ?? '';
  const ticket = card?.ticket;
  // Only Jira takes writes for now (a demo ticket counts, and keeps them on this server).
  const jira = ticket?.source === 'jira' ? ticket : undefined;

  const copy = () => {
    navigator.clipboard.writeText(report).then(
      () => { setCopied(true); flash('Copied: paste it into Jira or the pull request'); },
      () => flash('The browser didn’t allow copying: select the text instead'),
    );
  };
  const finish = () => {
    if (!card) return;
    send({ type: 'card.done', id });
    close();
    flash(`${card.key} is done`);
  };
  const askPost = () => {
    if (!jira) { flash(ticket ? `${ticket.key} is a ${ticket.source === 'trello' ? 'Trello' : ''} ticket: only Jira takes comments from here for now` : 'This card has no ticket to post to'); return; }
    setError(null);
    setMode({ kind: 'post' });
  };
  const post = () => {
    if (!jira || busy) return;
    setBusy(true); setError(null);
    commentTicket(jira.key, report).then(
      () => { setBusy(false); setPosted(true); setMode({ kind: 'view' }); flash(`Posted to ${jira.key} in Jira`); },
      (e: Error) => { setBusy(false); setError(e.message); },
    );
  };
  const askMove = () => {
    if (!jira) { flash(ticket ? 'Only Jira tickets can be moved from here for now' : 'This card has no ticket to move'); return; }
    setError(null);
    setMode({ kind: 'move', transitions: null, at: 0 });
    ticketTransitions(jira.key).then(
      (transitions) => setMode((m) => (m.kind === 'move' ? { ...m, transitions } : m)),
      (e: Error) => { setError(e.message); setMode({ kind: 'view' }); },
    );
  };
  const move = (t: TicketTransition) => {
    if (!jira || busy) return;
    setBusy(true); setError(null);
    moveTicket(jira.key, t.id).then(
      () => { setBusy(false); setMode({ kind: 'view' }); flash(`${jira.key} moved to ${t.to}`); },
      (e: Error) => { setBusy(false); setError(e.message); },
    );
  };

  useDialogKeys((e) => {
    if (busy) return e.key === 'Escape';
    if (mode.kind === 'post') {
      if (e.key === 'Escape') setMode({ kind: 'view' });
      else if (e.key === 'Enter' || e.key === 'y') post();
      else return false;
      return true;
    }
    if (mode.kind === 'move') {
      const list = mode.transitions ?? [];
      if (e.key === 'Escape') setMode({ kind: 'view' });
      else if (e.key === 'ArrowDown') setMode({ ...mode, at: Math.min(list.length - 1, mode.at + 1) });
      else if (e.key === 'ArrowUp') setMode({ ...mode, at: Math.max(0, mode.at - 1) });
      else if (e.key === 'Enter' && list[mode.at]) move(list[mode.at]);
      else return false;
      return true;
    }
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === 'Enter' || e.key === 'y') { copy(); return true; }
    if (e.key === 'j') { askPost(); return true; }
    if (e.key === 'm') { askMove(); return true; }
    if (e.key === 'd') { finish(); return true; }
    if (e.key === 'o' && card?.pr) { window.open(card.pr.url, '_blank', 'noopener'); return true; }
    return false;
  });

  if (!card) return null;
  const what = card.kind === 'qa' ? 'QA report' : 'Review findings';
  return (
    <Overlay label={what} wide>
      <DialogTitle>{what} · {card.key}{card.report?.result ? ` · ${card.report.result}` : ''}</DialogTitle>
      {!card.report && <div className="mb-3 rounded-lg bg-attn-bg px-3 py-2 text-[13px] text-attn">Claude hasn’t written its {card.kind === 'qa' ? 'QA report' : 'findings'} yet. This is its last message; ask for the report in the tab {card.key}.</div>}
      <div className="md max-h-[50vh] overflow-y-auto rounded-xl border border-line bg-bg px-4 py-3 text-sm"><Markdown remarkPlugins={[remarkGfm]}>{report}</Markdown></div>
      {mode.kind === 'post' && jira && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-attn/45 bg-attn-bg px-3.5 py-2.5 text-sm" role="alertdialog" aria-label="Post to Jira">
          <span className="grow font-semibold text-attn">Post this as a comment on {jira.key} in Jira{jira.demo ? ' (a demo ticket: it stays on this server)' : ''}?</span>
          <button className="btn py-1" onClick={() => setMode({ kind: 'view' })}>No<Key k="Esc" size="sm" /></button>
          <button className="btn btn-primary py-1" disabled={busy} onClick={post}>{busy ? 'Posting…' : 'Post it'}<Key k="Enter" size="sm" tone="ghost" /></button>
        </div>
      )}
      {mode.kind === 'move' && jira && (
        <div className="mt-3 rounded-xl border border-line bg-raise/40 px-3.5 py-2.5 text-sm" role="group" aria-label="Move the ticket">
          <div className="mb-1.5 font-semibold">Move {jira.key} from <span className="text-sub">{ticket?.status}</span> to…</div>
          {!mode.transitions ? <p className="flex items-center gap-2 text-faint"><span className="spinner" />Asking Jira…</p>
            : !mode.transitions.length ? <p className="text-faint">Jira offers no move from here.</p>
            : <ul role="listbox" aria-label="Statuses" className="grid gap-0.5">
              {mode.transitions.map((t, i) => (
                <li key={t.id} role="option" aria-selected={i === mode.at} onClick={() => move(t)} onMouseEnter={() => setMode({ ...mode, at: i })}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ${i === mode.at ? 'is-focus bg-raise' : 'hover:bg-raise/60'}`}>
                  <span className="grow">{t.to}</span>{t.name !== t.to && <span className="text-xs text-faint">via {t.name}</span>}
                </li>
              ))}
            </ul>}
        </div>
      )}
      {error && <div className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad" role="alert">{error}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="grow text-[13px] text-faint">{kindName(card.kind)} card. {jira ? `Nothing is written to Jira until you press j or m here.${posted ? ' Posted.' : ''}` : `Copy it into ${ticket ? ticket.key : card.pr ? `PR #${card.pr.number}` : 'the ticket or the pull request'} when you are ready.`}</span>
        {jira && <button className="btn" onClick={askPost}>Post to Jira<Key k="j" size="sm" /></button>}
        {jira && <button className="btn" onClick={askMove}>Move ticket<Key k="m" size="sm" /></button>}
        {card.pr && <a className="btn" href={card.pr.url} target="_blank" rel="noreferrer">Open PR #{card.pr.number}<Key k="o" size="sm" /></a>}
        {card.stage !== 'done' && <button className="btn" onClick={finish}>Done with it<Key k="d" size="sm" /></button>}
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}<Key k="Enter" size="sm" tone="ghost" /></button>
      </div>
      <DialogKeys items={[['Enter', 'copy'], ...(jira ? [['j', 'post it on the ticket'] as [string, string], ['m', 'move the ticket'] as [string, string]] : []), ...(card.pr ? [['o', 'open the PR'] as [string, string]] : []), ['d', 'done: move to Done'], ['Esc', 'close']]} />
    </Overlay>
  );
}
