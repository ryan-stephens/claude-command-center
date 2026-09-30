// A QA or review card's report (s on the card): what Claude found, to copy into Jira or the pull
// request by hand. Nothing is posted from here; d finishes the card (it goes to Done).

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { kindName } from '../../shared/cards.ts';
import { flash, useStore } from '../store.ts';
import { send } from '../ws.ts';
import { close, DialogKeys, DialogTitle, Overlay, useDialogKeys } from './Overlay.tsx';
import { Key } from './ui.tsx';

export function ReportSheet({ id }: { id: string }) {
  const card = useStore((s) => s.cards.find((c) => c.id === id));
  const [copied, setCopied] = useState(false);
  const report = card?.report?.text ?? card?.live?.lastMessage ?? '';
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
  useDialogKeys((e) => {
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === 'Enter' || e.key === 'y') { copy(); return true; }
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
      <div className="md max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-bg px-4 py-3 text-sm"><Markdown remarkPlugins={[remarkGfm]}>{report}</Markdown></div>
      <div className="mt-4 flex items-center gap-3">
        <span className="grow text-[13px] text-faint">{kindName(card.kind)} card. Nothing is posted from here: copy it into {card.kind === 'qa' ? 'the Jira ticket' : card.pr ? `PR #${card.pr.number}` : 'the pull request'} when you are ready.</span>
        {card.pr && <a className="btn" href={card.pr.url} target="_blank" rel="noreferrer">Open PR #{card.pr.number}<Key k="o" size="sm" /></a>}
        {card.stage !== 'done' && <button className="btn" onClick={finish}>Done with it<Key k="d" size="sm" /></button>}
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}<Key k="Enter" size="sm" tone="ghost" /></button>
      </div>
      <DialogKeys items={[['Enter', 'copy'], ...(card.pr ? [['o', 'open the PR'] as [string, string]] : []), ['d', 'done: move to Done'], ['Esc', 'close']]} />
    </Overlay>
  );
}
