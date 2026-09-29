import type { ToolFields, TranscriptItem } from '../shared/protocol.ts';

// Normalises SDK messages (live `SDKMessage` and stored `SessionMessage` share the
// `{ type, uuid, message: { content } }` shape) into flat transcript items.

type Block = { type: string; [k: string]: unknown };
type AnyMessage = { type: string; uuid?: string; subtype?: string; message?: unknown; [k: string]: unknown };

const MAX_RESULT_CHARS = 4000;
const MAX_EDIT_CHARS = 1500;

export function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return String(input ?? '');
  const i = input as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  if (typeof pick === 'string') return pick;
  void name;
  return JSON.stringify(input);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const clip = (s: string): string => (s.length > MAX_EDIT_CHARS ? `${s.slice(0, MAX_EDIT_CHARS)}\n…` : s);
const SEP = '\n…\n';

/** The fields the UI turns into plain language: a Bash call's own description, the file, an edit's before/after. */
export function toolFields(name: string, input: unknown): ToolFields | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  const f: ToolFields = {
    command: str(i.command),
    description: str(i.description),
    filePath: str(i.file_path) ?? str(i.notebook_path) ?? str(i.path),
    pattern: str(i.pattern),
    url: str(i.url),
  };
  if (name === 'Edit' && typeof i.old_string === 'string' && typeof i.new_string === 'string') {
    f.edit = { before: clip(i.old_string), after: clip(i.new_string) };
  } else if (name === 'Write' && typeof i.content === 'string') {
    f.edit = { before: '', after: clip(i.content) };
  } else if (name === 'MultiEdit' && Array.isArray(i.edits)) {
    const edits = i.edits as { old_string?: string; new_string?: string }[];
    f.edit = { before: clip(edits.map((e) => e.old_string ?? '').join(SEP)), after: clip(edits.map((e) => e.new_string ?? '').join(SEP)) };
  }
  for (const k of Object.keys(f) as (keyof ToolFields)[]) if (f[k] === undefined) delete f[k];
  return Object.keys(f).length ? f : undefined;
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
      const name = String(b.name);
      items.push({ kind: 'tool', uuid: id, toolUseId: String(b.id), name, input: summarizeToolInput(name, b.input), fields: toolFields(name, b.input) });
    } else if (b.type === 'tool_result') {
      items.push({ kind: 'tool_result', uuid: id, toolUseId: String(b.tool_use_id), text: truncate(blockText(b.content)), isError: Boolean(b.is_error) });
    }
  });
  return items;
}
