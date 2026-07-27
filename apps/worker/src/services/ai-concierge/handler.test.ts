import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AiProvider, AiResult } from './types.js';

const dbMocks = vi.hoisted(() => ({
  getActiveAiConciergeSession: vi.fn(),
  getAiConciergeSettings: vi.fn(),
  insertAiConciergeLog: vi.fn(),
  listAiConciergeFaqs: vi.fn(),
  toJstString: vi.fn((date: Date) => date.toISOString().replace('Z', '+09:00')),
  upsertAiConciergeSession: vi.fn(),
}));
vi.mock('@line-crm/db', () => dbMocks);

import { handleConciergeMessage, splitLineText } from './handler.js';

const row = {
  id: 'settings-a',
  line_account_id: 'account-a',
  enabled: 1,
  service_name: 'LINE Harness',
  service_description: 'LINE顧客対応',
  pricing: '月額5,000円',
  target_audience: '事業者',
  related_urls_json: '[]',
  related_keywords_json: '["自動返信"]',
  provider_order_json: '["openai"]',
  off_topic_message: '対象外です',
  provider_error_message: '障害中です',
  context_ttl_minutes: 30,
  max_history_messages: 6,
  created_at: '',
  updated_at: '',
};

function provider(): AiProvider {
  return {
    name: 'openai',
    available: true,
    generate: vi.fn(async (): Promise<AiResult> => ({
      text: '登録情報に基づく回答です',
      provider: 'openai',
      model: 'gpt-test',
      inputTokens: 10,
      outputTokens: 5,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getAiConciergeSettings.mockResolvedValue(row);
  dbMocks.listAiConciergeFaqs.mockResolvedValue([]);
  dbMocks.getActiveAiConciergeSession.mockResolvedValue(null);
  dbMocks.insertAiConciergeLog.mockResolvedValue({});
});

describe('LINE concierge handler', () => {
  test('disabled settings preserve existing unmatched behavior', async () => {
    dbMocks.getAiConciergeSettings.mockResolvedValue({ ...row, enabled: 0 });
    const ai = provider();
    const result = await handleConciergeMessage({
      db: {} as D1Database,
      lineAccountId: 'account-a',
      friendId: 'friend-a',
      message: '自動返信について',
      providers: [ai],
    });

    expect(result.handled).toBe(false);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(dbMocks.listAiConciergeFaqs).not.toHaveBeenCalled();
  });

  test('off-topic closes the session and calls providers zero times', async () => {
    const ai = provider();
    const result = await handleConciergeMessage({
      db: {} as D1Database,
      lineAccountId: 'account-a',
      friendId: 'friend-a',
      message: '今日の天気は？',
      providers: [ai],
      now: () => new Date('2026-07-27T12:00:00+09:00'),
    });

    expect(result).toMatchObject({ handled: true, messages: ['対象外です'], decision: 'off_topic' });
    expect(ai.generate).not.toHaveBeenCalled();
    expect(dbMocks.upsertAiConciergeSession).toHaveBeenCalledWith(
      expect.anything(),
      'account-a',
      'friend-a',
      expect.objectContaining({ status: 'closed', recentMessages: [] }),
    );
  });

  test('relevant handling uses account data and persists bounded context and safe log', async () => {
    const ai = provider();
    const result = await handleConciergeMessage({
      db: {} as D1Database,
      lineAccountId: 'account-a',
      friendId: 'friend-a',
      message: '自動返信について',
      providers: [ai],
      now: () => new Date('2026-07-27T12:00:00+09:00'),
    });

    expect(result.messages).toEqual(['登録情報に基づく回答です']);
    expect(dbMocks.getAiConciergeSettings).toHaveBeenCalledWith(expect.anything(), 'account-a');
    expect(dbMocks.listAiConciergeFaqs).toHaveBeenCalledWith(expect.anything(), 'account-a', true);
    expect(dbMocks.upsertAiConciergeSession).toHaveBeenCalledWith(
      expect.anything(),
      'account-a',
      'friend-a',
      expect.objectContaining({
        status: 'active',
        recentMessages: [
          { role: 'user', content: '自動返信について' },
          { role: 'assistant', content: '登録情報に基づく回答です' },
        ],
      }),
    );
    expect(dbMocks.insertAiConciergeLog).toHaveBeenCalledWith(
      expect.anything(),
      'account-a',
      expect.not.objectContaining({ prompt: expect.anything(), apiKey: expect.anything() }),
    );
  });
});

test('splits long LINE responses within the text limit', () => {
  const chunks = splitLineText('あ'.repeat(10_500));
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => [...chunk].length <= 4_900)).toBe(true);
  expect(chunks.join('')).toBe('あ'.repeat(10_500));
});
