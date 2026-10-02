// Claude's question form on the open card (PLAN §91): the same form the tab shows, drawn here. A
// tab per question and a Submit tab; the options numbered (a digit picks; a single choice moves
// on to the next question, a multi choice toggles its boxes); "Type something" after the options
// of a single choice; Submit lists the answers and sends them (y). The answers go to the server,
// which has the tab's launcher press the form's keys (shared/questions.ts says which).
import { useEffect, useRef, useState } from 'react';
import { answerText, answersComplete, type AskQuestion, type QuestionAnswer } from '../../shared/questions.ts';
import { questionHooks } from '../line-keys.ts';
import { flash } from '../store.ts';
import { answerQuestionCard } from '../ws.ts';
import { Key } from './ui.tsx';

export function QuestionForm({ cardId, questions, canAnswer }: { cardId: string; questions: AskQuestion[]; canAnswer: boolean }) {
  const n = questions.length;
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => questions.map(() => ({ picks: [] })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Another form (a new question): start again. The message box gives up the keys when it is empty (the message that led here
  // was just sent from it), so the digits reach the form; Enter puts the cursor back in the box for an answer in words.
  useEffect(() => {
    setAt(0); setAnswers(questions.map(() => ({ picks: [] }))); setError(null); setSent(false);
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (el?.id === 'card-say' && !el.value) el.blur();
  }, [questions]);
  const complete = answersComplete(questions, answers);
  const latest = useRef({ at, answers, complete, busy, sent });
  latest.current = { at, answers, complete, busy, sent };

  const pick = (qi: number, oi: number) => {
    const q = questions[qi];
    setAnswers((prev) => prev.map((a, i) => (i !== qi ? a : q.multiSelect ? { picks: a.picks.includes(oi) ? a.picks.filter((p) => p !== oi) : [...a.picks, oi].sort((x, y) => x - y) } : { picks: [oi] })));
    setError(null);
    if (!q.multiSelect) setAt(qi + 1);
  };
  const typeOther = (qi: number, text: string) => { setAnswers((prev) => prev.map((a, i) => (i === qi ? { picks: [], ...(text ? { other: text } : {}) } : a))); setError(null); };
  const submit = async () => {
    const { answers: as, complete: ok, busy: b, sent: s } = latest.current;
    if (b || s) return;
    if (!ok) { const first = questions.findIndex((_q, i) => !(as[i]?.picks.length || as[i]?.other)); setAt(first); setError('Answer every question first.'); return; }
    setBusy(true);
    try { await answerQuestionCard(cardId, as); setSent(true); flash('Answers sent to its tab'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  // The keys (line-keys): digits, Tab, y, and Enter in the Type something box.
  useEffect(() => {
    questionHooks.on = true;
    questionHooks.digit = (d) => {
      const { at: qi } = latest.current;
      if (qi >= n) return;
      const q = questions[qi];
      if (d <= q.options.length) pick(qi, d - 1);
      else if (d === q.options.length + 1 && !q.multiSelect) document.getElementById(`q-other-${qi}`)?.focus();
    };
    questionHooks.next = () => setAt((a) => Math.min(n, a + 1));
    questionHooks.prev = () => setAt((a) => Math.max(0, a - 1));
    questionHooks.submit = () => { void submit(); };
    questionHooks.otherDone = () => setAt((a) => Math.min(n, a + 1));
    return () => { questionHooks.on = false; questionHooks.digit = () => {}; questionHooks.next = () => {}; questionHooks.prev = () => {}; questionHooks.submit = () => {}; questionHooks.otherDone = () => {}; };
  }, [questions]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = at < n ? questions[at] : undefined;
  const a = answers[at];
  return (
    <div className="grid gap-2" role="group" aria-label="Claude’s question">
      {/* The tabs: one per question, then Submit; Tab moves along them. */}
      <div className="flex flex-wrap items-center gap-1" role="tablist">
        {questions.map((x, i) => (
          <button key={i} role="tab" aria-selected={at === i} onClick={() => setAt(i)} title={x.question}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${at === i ? 'border-attn bg-attn text-white' : answers[i]?.picks.length || answers[i]?.other ? 'border-attn/50 bg-surface text-attn' : 'border-line bg-surface text-sub'}`}>
            {answers[i]?.picks.length || answers[i]?.other ? '✓ ' : ''}{x.header}
          </button>
        ))}
        <button role="tab" aria-selected={at === n} onClick={() => setAt(n)} className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${at === n ? 'border-attn bg-attn text-white' : 'border-line bg-surface text-sub'}`}>Submit</button>
        <span className="grow" />
        <span className="flex items-center gap-1 text-[11.5px] text-faint"><Key k="Tab" size="sm" />next</span>
      </div>
      {q && (
        <div className="grid gap-1.5">
          <p className="text-[13.5px] font-semibold">{q.question}</p>
          <ul className="grid gap-0.5">
            {q.options.map((o, i) => {
              const on = Boolean(a?.picks.includes(i));
              return (
                <li key={i}>
                  <button role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => pick(at, i)} disabled={!canAnswer || sent}
                    className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1 text-left text-[13px] ${on ? 'border-attn/60 bg-surface' : 'border-transparent hover:bg-surface/70'}`}>
                    <Key k={String(i + 1)} size="sm" />
                    <span className={`mt-0.5 w-4 shrink-0 text-center text-[13px] ${on ? 'text-attn' : 'text-faint'}`} aria-hidden>{q.multiSelect ? (on ? '☑' : '☐') : on ? '◉' : '○'}</span>
                    <span className="min-w-0 grow">
                      <span className="font-medium">{o.label}</span>
                      {o.description && <span className="block text-[12.5px] text-sub">{o.description}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {!q.multiSelect && (
              <li className="flex items-center gap-2 px-2 py-1 text-[13px]">
                <Key k={String(q.options.length + 1)} size="sm" />
                <span className={`w-4 shrink-0 text-center ${a?.other ? 'text-attn' : 'text-faint'}`} aria-hidden>{a?.other ? '◉' : '○'}</span>
                <input id={`q-other-${at}`} className="field grow py-0.5 text-[13px]" placeholder="Type something…" value={a?.other ?? ''} disabled={!canAnswer || sent} spellCheck={false}
                  onChange={(e) => typeOther(at, e.target.value)} aria-label="Your own answer" />
              </li>
            )}
          </ul>
        </div>
      )}
      {!q && (
        <div className="grid gap-1.5">
          <p className="text-[13.5px] font-semibold">Review your answers</p>
          <ul className="grid gap-0.5 text-[13px]">
            {questions.map((x, i) => (
              <li key={i} className="flex gap-2 px-2">
                <span className="min-w-0 shrink-0 text-sub">{x.question}</span>
                <span className={`min-w-0 truncate ${answerText(x, answers[i]) ? 'font-medium' : 'text-attn'}`}>{answerText(x, answers[i]) || 'not answered'}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary py-0.5" onClick={() => void submit()} disabled={!canAnswer || busy || sent}><Key k="y" size="sm" tone="ghost" />{sent ? 'Answers sent' : busy ? 'Sending…' : 'Submit answers'}</button>
            {!canAnswer && <span className="text-[12.5px] text-faint">Its tab can’t be reached from here: answer in its tab (g).</span>}
            {error && <span className="text-[12.5px] text-bad" role="alert">{error}</span>}
          </div>
        </div>
      )}
      {q && error && <p className="text-[12.5px] text-bad" role="alert">{error}</p>}
    </div>
  );
}
