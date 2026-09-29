import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageAttachment } from '../shared/protocol.ts';

/** Async-iterable prompt for `query()`. The session stays open while this is pending (proven in the Phase 0 spike). */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string, images: ImageAttachment[] = []): void {
    this.buffer.push({
      type: 'user',
      message: {
        role: 'user',
        content: images.length
          ? [...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.data } })), { type: 'text' as const, text }]
          : text,
      },
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
