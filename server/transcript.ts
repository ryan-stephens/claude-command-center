import type { TranscriptItem } from '../shared/protocol.ts';

// Normalises SDK messages (live `SDKMessage` and stored `SessionMessage` share the
// `{ type, uuid, message: { content } }` shape) into flat transcript items.

type Block = { type: string; [k: string]: unknown };
type AnyMessage = { type: string; uuid?: string; subtype?: string; message?: unknown; [k: string]: unknown };

const MAX_RESULT_CHARS = 4000;

export function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return String(input ?? '');
  const i = input as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  if (typeof pick === 'string') return pick;
  void name;
  return JSON.stringify(input);
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: Block) => (b.type === 'text' ? String(b.text) : b.type === 'image' ? '[image]' : ''))
    .join('');
}

function truncate(s: string): string {
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n… (${s.length - MAX_RESULT_CHARS} more chars)` : s;
}

export function normalize(msg: AnyMessage): TranscriptItem[] {
  const uuid = msg.uuid ?? crypto.randomUUID();
  if (msg.type === 'result') {
    return [{
      kind: 'result',
      uuid,
      subtype: String(msg.subtype),
      durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : undefined,
      costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
    }];
  }
  if (msg.type !== 'user' && msg.type !== 'assistant') return [];
  // Sub-agent traffic is noise at this level.
  if (msg.parent_tool_use_id) return [];

  const content = (msg.message as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') {
    // Stored transcripts include CLI meta entries (command caveats, local command output).
    if (msg.type === 'user' && (msg.isMeta || /^<(local-command|command-name|system-reminder)/.test(content))) return [];
    return content.trim() ? [{ kind: msg.type, uuid, text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const items: TranscriptItem[] = [];
  content.forEach((b: Block, n: number) => {
    const id = `${uuid}:${n}`;
    if (b.type === 'text' && String(b.text).trim()) {
      if (msg.type === 'user' && msg.isMeta) return;
      items.push({ kind: msg.type as 'user' | 'assistant', uuid: id, text: String(b.text) });
    } else if (b.type === 'tool_use') {
      items.push({ kind: 'tool', uuid: id, toolUseId: String(b.id), name: String(b.name), input: summarizeToolInput(String(b.name), b.input) });
    } else if (b.type === 'tool_result') {
      items.push({ kind: 'tool_result', uuid: id, toolUseId: String(b.tool_use_id), text: truncate(blockText(b.content)), isError: Boolean(b.is_error) });
    }
  });
  return items;
}
