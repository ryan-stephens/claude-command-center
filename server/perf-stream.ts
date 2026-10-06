// walk-perf's stand-in for Claude (PLAN §95, test servers only): turns that stream into phantom
// sessions at a model's pace, through the same path a real CLI's messages take (SessionManager.feed),
// with the card hook events a real turn fires (PreToolUse, PostToolUse, Stop). It measures the app,
// so the numbers don't depend on the API.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { HookInput } from './card-events.ts';

export interface FakeTurnOpts {
  ids: string[];
  /** How long each session streams. */
  seconds: number;
  /** One text delta per this many ms per session (Haiku's deltas come every ~20 to 40 ms). */
  deltaMs?: number;
  feed(id: string, msg: SDKMessage): void;
  hook(id: string, event: string, input: HookInput): void;
}

const WORDS = 'the cart keeps its lines when a guest signs in and gift cards stay attached through the merge so nothing is lost'.split(' ');

/** Streams until `seconds` pass, then ends each turn; returns a stop function. */
export function fakeTurns(o: FakeTurnOpts): () => void {
  const deltaMs = o.deltaMs ?? 25;
  const timers: NodeJS.Timeout[] = [];
  const msg = (m: Record<string, unknown>) => ({ uuid: crypto.randomUUID(), session_id: '', parent_tool_use_id: null, ...m }) as unknown as SDKMessage;
  for (const id of o.ids) {
    let text = '';
    let n = 0;
    let tool = 0;
    o.feed(id, msg({ type: 'system', subtype: 'session_state_changed', state: 'running' }));
    o.hook(id, 'UserPromptSubmit', { session_id: id, prompt: 'go' });
    o.feed(id, msg({ type: 'stream_event', event: { type: 'message_start' } }));
    const t = setInterval(() => {
      n += 1;
      const word = `${WORDS[n % WORDS.length]} `;
      text += n % 40 === 0 ? `${word}\n\n` : word;
      o.feed(id, msg({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } }));
      // Every ~3 s a tool's hooks save the card; every ~10 s the message lands with its tool call and the next starts.
      if (n % 120 === 0) {
        tool += 1;
        const input = { file_path: `src/cart/part-${tool}.ts` };
        o.hook(id, 'PreToolUse', { session_id: id, tool_name: 'Read', tool_input: input, tool_use_id: `perf-${id.slice(0, 8)}-${tool}` });
        o.hook(id, 'PostToolUse', { session_id: id, tool_name: 'Read', tool_input: input, tool_use_id: `perf-${id.slice(0, 8)}-${tool}`, tool_response: 'ok' });
      }
      if (n % 400 === 0) {
        const toolUseId = `perf-${id.slice(0, 8)}-m${n}`;
        o.feed(id, msg({ type: 'assistant', message: { content: [{ type: 'text', text }, { type: 'tool_use', id: toolUseId, name: 'Read', input: { file_path: 'src/cart/store.ts' } }] } }));
        o.feed(id, msg({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] } }));
        o.feed(id, msg({ type: 'stream_event', event: { type: 'message_start' } }));
        text = '';
      }
    }, deltaMs);
    timers.push(t);
    timers.push(setTimeout(() => {
      clearInterval(t);
      if (text) o.feed(id, msg({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
      o.feed(id, msg({ type: 'result', subtype: 'success', duration_ms: o.seconds * 1000 }));
      o.hook(id, 'Stop', { session_id: id, last_assistant_message: text.slice(0, 200) });
      o.feed(id, msg({ type: 'system', subtype: 'session_state_changed', state: 'idle' }));
    }, o.seconds * 1000));
  }
  return () => { for (const t of timers) { clearInterval(t); clearTimeout(t); } };
}
