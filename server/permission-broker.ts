import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionDecision, PermissionRequest, Question } from '../shared/protocol.ts';
import { summarizeToolInput, toolFields } from './transcript.ts';

interface Pending {
  request: PermissionRequest;
  toolInput: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
}

/** Holds `canUseTool` promises until the user answers Y / A / N in the UI. */
export class PermissionBroker {
  private pending = new Map<string, Pending>();
  private onRequest: (r: PermissionRequest, toolInput: Record<string, unknown>) => void;
  private onResolved: (reqId: string, sessionId: string) => void;

  /** `onRequest` also gets the tool's whole input (a card reads it the way it reads a hook's, §93). */
  constructor(onRequest: (r: PermissionRequest, toolInput: Record<string, unknown>) => void, onResolved: (reqId: string, sessionId: string) => void) {
    this.onRequest = onRequest;
    this.onResolved = onResolved;
  }

  ask(
    sessionId: string,
    tool: string,
    toolInput: Record<string, unknown>,
    suggestions: PermissionUpdate[] | undefined,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const reqId = crypto.randomUUID();
    const request: PermissionRequest = {
      reqId,
      sessionId,
      tool,
      input: summarizeToolInput(tool, toolInput),
      fields: toolFields(tool, toolInput),
      canAlways: Boolean(suggestions?.length),
      createdAt: Date.now(),
      ...(tool === 'AskUserQuestion' ? { questions: cleanQuestions(toolInput.questions) } : {}),
      ...(tool === 'ExitPlanMode' && typeof toolInput.plan === 'string' ? { plan: toolInput.plan } : {}),
    };
    return new Promise((resolve) => {
      this.pending.set(reqId, { request, toolInput, suggestions, resolve });
      // An interrupt aborts the tool call; drop the card.
      signal.addEventListener('abort', () => this.settle(reqId, { behavior: 'deny', message: 'Interrupted.' }), { once: true });
      this.onRequest(request, toolInput);
    });
  }

  /** `answers` go back to Claude with a question card (question text → chosen labels, comma-separated). */
  respond(reqId: string, decision: PermissionDecision, answers?: Record<string, string>): void {
    const p = this.pending.get(reqId);
    if (!p) return;
    const { questions, plan } = p.request;
    if (decision === 'deny') {
      const message = questions ? 'The user chose not to answer. Use your best judgement, or ask again in plain words.'
        : plan !== undefined ? 'The user wants to keep planning. Ask what to change, or revise the plan.'
        : 'The user denied this tool call.';
      this.settle(reqId, { behavior: 'deny', message });
    } else if (questions) {
      this.settle(reqId, { behavior: 'allow', updatedInput: { ...p.toolInput, answers: cleanAnswers(answers, questions) } });
    } else {
      this.settle(reqId, {
        behavior: 'allow',
        updatedInput: p.toolInput,
        updatedPermissions: decision === 'always' ? p.suggestions : undefined,
      });
    }
  }

  sessionOf(reqId: string): string | undefined {
    return this.pending.get(reqId)?.request.sessionId;
  }

  /** Deny everything outstanding for a session (used on stop). */
  cancelSession(sessionId: string): void {
    for (const [reqId, p] of this.pending) {
      if (p.request.sessionId === sessionId) this.settle(reqId, { behavior: 'deny', message: 'Session stopped.' });
    }
  }

  hasPending(sessionId: string): boolean {
    for (const p of this.pending.values()) if (p.request.sessionId === sessionId) return true;
    return false;
  }

  list(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  private settle(reqId: string, result: PermissionResult): void {
    const p = this.pending.get(reqId);
    if (!p) return;
    this.pending.delete(reqId);
    p.resolve(result);
    this.onResolved(reqId, p.request.sessionId);
  }
}

/** The AskUserQuestion input as the page needs it; anything malformed is dropped. */
export function cleanQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q): Question[] => {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options)) return [];
    const options = q.options
      .filter((o: unknown): o is { label: string; description?: unknown } => Boolean(o) && typeof (o as { label?: unknown }).label === 'string')
      .map((o: { label: string; description?: unknown }) => ({ label: o.label, description: typeof o.description === 'string' ? o.description : '' }));
    return [{ question: q.question, header: typeof q.header === 'string' ? q.header : '', multiSelect: q.multiSelect === true, options }];
  });
}

/** Answers from the page, kept only for questions that were asked. */
export function cleanAnswers(raw: Record<string, string> | undefined, questions: Question[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const a = raw?.[q.question];
    if (typeof a === 'string' && a.trim()) out[q.question] = a.trim().slice(0, 2000);
  }
  return out;
}
