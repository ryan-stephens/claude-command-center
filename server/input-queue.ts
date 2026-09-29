import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Async-iterable prompt for `query()`. The session stays open while this is pending (proven in the Phase 0 spike). */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string): void {
    this.buffer.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      while (this.buffer.length) yield this.buffer.shift()!;
      if (this.closed) return;
      await new Promise<void>((r) => { this.wake = r; });
      this.wake = null;
    }
  }
}
