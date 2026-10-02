// "Have Claude write it" (PLAN §62): the owner's rough text plus the card's context go to a cheap
// model for one turn with no tools, through the Agent SDK, and the result becomes the opening
// message. Nothing is persisted (no transcript under ~/.claude/projects), nothing is read from
// disk: the model only sees what is in the request.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { fillers, PLACEHOLDERS, type PromptContext } from '../shared/prompts.ts';
import { withoutSecrets } from './config.ts';

export const WRITE_MODEL = process.env.CC_CONTROL_WRITE_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'You turn a developer’s rough notes into the opening message for a Claude Code session: the first thing that session is told.',
  'Write the message itself, in the second person, as the developer would send it. No preamble, no heading, no sign-off, no code fences, nothing but the message.',
  'Keep every fact and instruction from the notes; make them clear and well ordered; add nothing the notes and the context don’t support, and never name a system, tool, file or tracker they don’t mention.',
  'Name the context the session was given (its ticket, repos, folders, branch) where it helps the session know what to look at first.',
  'The session already runs in the worktree this card made, so it must not create branches or worktrees itself; say so once if the notes don’t.',
  'Plain prose or a short numbered list; under 200 words unless the notes are longer.',
].join(' ');

/** The one user turn: the notes, then what the card gave the session. Pure, so it can be tested. */
export function writeInstructions(rough: string, ctx: PromptContext): string {
  const f = fillers(ctx);
  const facts = PLACEHOLDERS.filter((p) => p.name !== 'ticket' && f[p.name]).map((p) => `- ${p.name}: ${f[p.name]}`);
  return [
    'Rough notes from the developer:',
    '"""',
    rough.trim(),
    '"""',
    '',
    facts.length ? 'Context the session is given (the SessionStart hook hands it the full text of these):' : 'The session is given no ticket, repos or folders yet.',
    ...facts,
    '',
    'Write the opening message.',
  ].join('\n');
}

/** One turn of a cheap model with no tools; the text it answers, trimmed. */
export async function writePrompt(rough: string, ctx: PromptContext, cwd: string): Promise<string> {
  if (!rough.trim()) throw new Error('Write a few rough words first; then Claude writes the message from them.');
  const q = query({
    prompt: writeInstructions(rough, ctx),
    options: {
      // No settings and no CLAUDE.md from anywhere: the model sees the request and nothing of the machine.
      cwd, model: WRITE_MODEL, maxTurns: 1, tools: [], persistSession: false, systemPrompt: SYSTEM, settingSources: [],
      env: { ...withoutSecrets(process.env) } as Record<string, string>,
    },
  });
  try {
    for await (const m of q) {
      if (m.type === 'result') {
        if (m.subtype !== 'success' || m.is_error) throw new Error(`Claude couldn’t write it (${m.subtype}).`);
        const text = m.result.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
        if (!text) throw new Error('Claude answered with nothing.');
        return text;
      }
    }
    throw new Error('Claude didn’t answer.');
  } finally {
    q.close();
  }
}
