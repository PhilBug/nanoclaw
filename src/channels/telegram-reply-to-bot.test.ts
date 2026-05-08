import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telegramRef = vi.hoisted(() => ({
  registration: null as { factory: () => Promise<any> | any } | null,
  interceptedSetup: null as Record<string, any> | null,
}));

vi.mock('@chat-adapter/telegram', () => ({
  createTelegramAdapter: vi.fn(() => ({
    name: 'telegram',
    channelIdFromThreadId: (threadId: string) => threadId,
  })),
}));

vi.mock('./chat-sdk-bridge.js', () => ({
  createChatSdkBridge: vi.fn(() => ({
    name: 'telegram',
    channelType: 'telegram',
    supportsThreads: false,
    setup: vi.fn(async (config) => {
      telegramRef.interceptedSetup = config as Record<string, any>;
    }),
    teardown: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    deliver: vi.fn(async () => undefined),
  })),
}));

vi.mock('./channel-registry.js', () => ({
  registerChannelAdapter: vi.fn((_name, registration) => {
    telegramRef.registration = registration;
  }),
}));

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({ TELEGRAM_BOT_TOKEN: 'test-token' })),
}));

vi.mock('./telegram-pairing.js', () => ({
  tryConsume: vi.fn(async () => null),
}));

vi.mock('../log.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// Re-implement the pure functions inline to test the logic directly
// (they're private module-scoped functions not exported)

// extractReplyContext logic
function extractReplyContext(raw: Record<string, any>): {
  text: string;
  sender: string;
  fromBot?: boolean;
  senderUsername?: string;
} | null {
  if (!raw.reply_to_message) return null;
  const reply = raw.reply_to_message;
  return {
    text: reply.text || reply.caption || '',
    sender: reply.from?.first_name || reply.from?.username || 'Unknown',
    fromBot: reply.from?.is_bot === true,
    senderUsername: reply.from?.username,
  };
}

// createReplyToBotMentionInterceptor logic (unwrapped for direct testing)
function replyToBotMentionTransform(
  message: {
    isMention?: boolean;
    isGroup?: boolean;
    kind: string;
    content: unknown;
  },
  botUsername = 'nanoclaw_bot',
): { isMention?: boolean } {
  if (!message.isMention && message.isGroup && message.kind === 'chat-sdk') {
    const content = message.content as Record<string, any> | null;
    if (content?.replyTo?.fromBot && content?.replyTo?.senderUsername === botUsername) {
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
      senderUsername: 'alice',
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
      senderUsername: 'nanoclaw_bot',
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
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true, senderUsername: 'nanoclaw_bot' } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(true);
  });

  it('does not flip isMention when replying to a different bot in a group', () => {
    const msg = groupMsg({
      content: { replyTo: { text: 'hi', sender: 'Other Bot', fromBot: true, senderUsername: 'other_bot' } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
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
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true, senderUsername: 'nanoclaw_bot' } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });

  it('does not flip isMention when already a mention', () => {
    const msg = groupMsg({
      isMention: true,
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true, senderUsername: 'nanoclaw_bot' } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(true);
  });

  it('does not flip isMention for non-chat-sdk messages', () => {
    const msg = groupMsg({
      kind: 'chat',
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true, senderUsername: 'nanoclaw_bot' } },
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

  it('does not flip when bot username is missing from replyTo', () => {
    const msg = groupMsg({
      content: { replyTo: { text: 'hi', sender: 'NanoClaw', fromBot: true } },
    });
    const result = replyToBotMentionTransform(msg);
    expect(result.isMention).toBe(false);
  });
});

describe('telegram adapter reply-to-bot integration', () => {
  beforeEach(() => {
    telegramRef.registration = null;
    telegramRef.interceptedSetup = null;
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ ok: true, result: { id: 111, username: 'nanoclaw_bot' } }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not treat replies to another bot as mentions in group chats', async () => {
    await import('./telegram.js');
    const adapter = await telegramRef.registration?.factory();

    const onInbound = vi.fn();
    await adapter.setup({
      onInbound,
      onInboundEvent: vi.fn(),
      onMetadata: vi.fn(),
      onAction: vi.fn(),
    });

    expect(telegramRef.interceptedSetup).not.toBeNull();

    await telegramRef.interceptedSetup!.onInbound('telegram:-100123', null, {
      id: 'msg-1',
      kind: 'chat-sdk',
      timestamp: new Date().toISOString(),
      isGroup: true,
      isMention: false,
      content: {
        text: 'replying to the other bot',
        author: { userId: 'telegram:user-1' },
        replyTo: {
          text: 'other bot said hello',
          sender: 'Other Bot',
          fromBot: true,
          senderUsername: 'other_bot',
          senderUserId: '222',
        },
      },
    });

    expect(onInbound).toHaveBeenCalledTimes(1);
    expect(onInbound.mock.calls[0]?.[2]?.isMention).toBe(false);
  });
});
