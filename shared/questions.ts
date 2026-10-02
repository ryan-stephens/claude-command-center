// Claude's questions (the AskUserQuestion tool), answered from the card (PLAN §91). The hooks hand
// the server the tool's input: one or more questions, each with a short header, 2 to 4 options
// and whether several may be picked. Claude Code draws them as a form in the tab: a tab per
// question and a Submit tab, the options numbered, "Type something" after them, "Chat about
// this" last. The page draws the same form; the answers go back as the keys that form takes,
// pressed by the launcher in the tab (worked out against the real thing, 2.1.287):
//   a digit picks a single-choice option and the form moves to the next tab on its own;
//   digits toggle the boxes of a multi-choice question, then Tab moves on;
//   "Type something" is the digit after the options, then the text, then Enter;
//   on the Submit tab, Enter chooses "Submit answers".
// Pure here, tested; the server builds the keys, the page checks the answers are complete.

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');

export interface AskOption { label: string; description?: string }
export interface AskQuestion {
  question: string;
  /** A chip of a few words: the tab's name. */
  header: string;
  options: AskOption[];
  multiSelect?: boolean;
}
/** One question's answer from the page: the options picked (0-based) and / or something typed. */
export interface QuestionAnswer { picks: number[]; other?: string }

/** The tool's input as the hooks hand it over, checked and bounded; undefined when it isn't a question form. */
export function readQuestions(raw: unknown): AskQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AskQuestion[] = [];
  for (const q of raw.slice(0, 8)) {
    const r = (q ?? {}) as Record<string, unknown>;
    const options = Array.isArray(r.options) ? r.options.slice(0, 9).map((o) => {
      const x = (o ?? {}) as Record<string, unknown>;
      return { label: str(x.label, 200), ...(typeof x.description === 'string' && x.description ? { description: x.description.slice(0, 1000) } : {}) };
    }).filter((o) => o.label) : [];
    if (!str(r.question, 2000)) continue;
    out.push({ question: str(r.question, 2000), header: str(r.header, 40) || `Q${out.length + 1}`, options, ...(r.multiSelect === true ? { multiSelect: true } : {}) });
  }
  return out.length ? out : undefined;
}

/** Answers from the page, checked against the questions: indices in range, text bounded and on one line. */
export function readAnswers(raw: unknown, questions: AskQuestion[]): QuestionAnswer[] {
  const list = Array.isArray(raw) ? raw : [];
  return questions.map((q, i) => {
    const a = (list[i] ?? {}) as Record<string, unknown>;
    const picks = [...new Set((Array.isArray(a.picks) ? a.picks : []).filter((p): p is number => Number.isInteger(p) && p >= 0 && p < q.options.length))].sort((x, y) => x - y);
    // Typed text only on a single choice: in a multi choice the form's "Type something" box loses what is typed into it (2.1.287).
    const other = !q.multiSelect && typeof a.other === 'string' ? a.other.replace(/\s*\r?\n\s*/g, ' ').trim().slice(0, 2000) : '';
    return { picks: q.multiSelect ? picks : picks.slice(0, 1), ...(other ? { other } : {}) };
  });
}

/** Every question has an answer: a pick, or something typed. */
export function answersComplete(questions: AskQuestion[], answers: QuestionAnswer[]): boolean {
  return questions.every((_q, i) => { const a = answers[i]; return Boolean(a && (a.picks.length || a.other)); });
}

/** The answer in words, as the form's review shows it: the picked labels, then what was typed. */
export function answerText(q: AskQuestion, a: QuestionAnswer | undefined): string {
  if (!a) return '';
  return [...a.picks.map((p) => q.options[p]?.label ?? ''), ...(a.other ? [a.other] : [])].filter(Boolean).join(', ');
}

/**
 * The keys the form takes for these answers, in order, as the launcher presses them: digits and
 * named keys (Tab, Enter), and `type:` followed by text to type as it is. Ends on the Submit tab
 * with Enter. A single-choice question with only typed text uses "Type something"; a multi-choice
 * one toggles its boxes, types if asked, then Tab.
 */
export function questionKeys(questions: AskQuestion[], answers: QuestionAnswer[]): string[] {
  const keys: string[] = [];
  questions.forEach((q, i) => {
    const a = answers[i] ?? { picks: [] };
    const otherDigit = String(q.options.length + 1);
    if (q.multiSelect) {
      for (const p of a.picks) keys.push(String(p + 1));
      keys.push('Tab');
    } else if (a.other) {
      keys.push(otherDigit, `type:${a.other}`, 'Enter');
    } else if (a.picks.length) {
      keys.push(String(a.picks[0] + 1));
    } else {
      keys.push('Tab');
    }
  });
  keys.push('Enter');
  return keys;
}
