import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionDecision, PermissionRequest } from '../shared/protocol.ts';
import { summarizeToolInput } from './transcript.ts';

interface Pending {
  request: PermissionRequest;
  toolInput: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
}

/** Holds `canUseTool` promises until the user answers Y / A / N in the UI. */
export class PermissionBroker {
  private pending = new Map<string, Pending>();
  private onRequest: (r: PermissionRequest) => void;
  private onResolved: (reqId: string, sessionId: string) => void;

  constructor(onRequest: (r: PermissionRequest) => void, onResolved: (reqId: string, sessionId: string) => void) {
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
      canAlways: Boolean(suggestions?.length),
      createdAt: Date.now(),
    };
    return new Promise((resolve) => {
      this.pending.set(reqId, { request, toolInput, suggestions, resolve });
      // An interrupt aborts the tool call; drop the card.
      signal.addEventListener('abort', () => this.settle(reqId, { behavior: 'deny', message: 'Interrupted.' }), { once: true });
      this.onRequest(request);
    });
  }

  respond(reqId: string, decision: PermissionDecision): void {
    const p = this.pending.get(reqId);
    if (!p) return;
    if (decision === 'deny') {
      this.settle(reqId, { behavior: 'deny', message: 'The user denied this tool call.' });
    } else {
      this.settle(reqId, {
        behavior: 'allow',
        updatedInput: p.toolInput,
        updatedPermissions: decision === 'always' ? p.suggestions : undefined,
      });
    }
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
