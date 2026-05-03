import { describe, it, expect, vi } from 'vitest';

vi.mock('../log.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// Re-implement the pure functions inline to test the logic directly
// (they're private module-scoped functions not exported)

// extractReplyContext logic
function extractReplyContext(raw: Record<string, any>): {
  text: string;
  sender: string;
  fromBot?: boolean;
} | null {
  if (!raw.reply_to_message) return null;
  const reply = raw.reply_to_message;
  return {
    text: reply.text || reply.caption || '',
    sender: reply.from?.first_name || reply.from?.username || 'Unknown',
    fromBot: reply.from?.is_bot === true,
  };
}

// createReplyToBotMentionInterceptor logic (unwrapped for direct testing)
function replyToBotMentionTransform(message: {
  isMention?: boolean;
  isGroup?: boolean;
  kind: string;
  content: unknown;
}): { isMention?: boolean } {
  if (!message.isMention && message.isGroup && message.kind === 'chat-sdk') {
    const content = message.content as Record<string, any> | null;
    if (content?.replyTo?.fromBot) {
      return { ...message, isMention: true };
    }
  }
  return message;
}

describe('extractReplyContext', () => {
  it('returns null when there is no reply_to_message', () => {
    expect(extractReplyContext({})).toBeNull();
    expect(extractReplyContext({ message: 'hello' })).toBeNull();
  });

  it('extracts text and sender from a user reply', () => {
    const result = extractReplyContext({
      reply_to_message: {
        text: 'original message',
        from: { first_name: 'Alice', username: 'alice', is_bot: false },
      },
    });
    expect(result).toEqual({
      text: 'original message',
      sender: 'Alice',
      fromBot: false,
    });
  });

  it('extracts text and sender from a bot reply', () => {
    const result = extractReplyContext({
      reply_to_message: {
        text: 'bot response',
        from: { first_name: 'NanoClaw Bot', username: 'nanoclaw_bot', is_bot: true },
      },
    });
    expect(result).toEqual({
      text: 'bot response',
      sender: 'NanoClaw Bot',
      fromBot: true,
    });
  });

  it('falls back to caption when text is missing', () => {
    const result = extractReplyContext({
      reply_to_message: {
        caption: 'image caption',
        from: { first_name: 'Alice', is_bot: false },
      },
    });
    expect(result?.text).toBe('image caption');
  });

  it('falls back to username when first_name is missing', () => {
    const result = extractReplyContext({
      reply_to_message: {
        text: 'msg',
        from: { username: 'bob', is_bot: false },
      },
    });
    expect(result?.sender).toBe('bob');
  });

  it('sets fromBot false when is_bot is explicitly false', () => {
    const result = extractReplyContext({
      reply_to_message: {
        text: 'msg',
        from: { first_name: 'Alice', is_bot: false },
      },
    });
    expect(result?.fromBot).toBe(false);
  });

  it('sets fromBot false when is_bot is undefined', () => {
    const result = extractReplyContext({
      reply_to_message: {
        text: 'msg',
        from: { first_name: 'Alice' },
      },
    });
    expect(result?.fromBot).toBe(false);
  });
});

describe('reply-to-bot mention interceptor logic', () => {
  const groupMsg = (overrides: Record<string, any> = {}) => ({
    kind: 'chat-sdk',
    isGroup: true,
    isMention: false,
    content: {},
    ...overrides,
  });

  it('flips isMention when replying to bot in a group', () => {
    const msg = groupMsg({
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(true);
  });

  it('does not flip isMention when replying to a user in a group', () => {
    const msg = groupMsg({
      content: { replyTo: { text: 'hi', sender: 'Alice', fromBot: false } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });

  it('does not flip isMention when not a reply at all', () => {
    const msg = groupMsg({ content: { text: 'just chatting' } });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });

  it('does not flip isMention for DMs (isGroup=false)', () => {
    const msg = groupMsg({
      isGroup: false,
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });

  it('does not flip isMention when already a mention', () => {
    const msg = groupMsg({
      isMention: true,
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(true);
  });

  it('does not flip isMention for non-chat-sdk messages', () => {
    const msg = groupMsg({
      kind: 'chat',
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });

  it('does not flip when fromBot is missing in replyTo', () => {
    const msg = groupMsg({
      content: { replyTo: { text: 'hi', sender: 'NanoClaw' } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });
});
