import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  createAiConciergeFaq: vi.fn(),
  deleteAiConciergeFaq: vi.fn(),
  getAiConciergeSettings: vi.fn(),
  getStaffByApiKey: vi.fn(),
  // Bootstrap state: no active owner yet, so the env API_KEY is accepted.
  countActiveStaffByRole: vi.fn(async () => 0),
  listAiConciergeFaqs: vi.fn(),
  listAiConciergeLogs: vi.fn(),
  updateAiConciergeFaq: vi.fn(),
  upsertAiConciergeSettings: vi.fn(),
}));
vi.mock('@line-crm/db', () => dbMocks);

import { authMiddleware } from '../middleware/auth.js';
import { aiConcierge } from './ai-concierge.js';

const storedSettings = {
  id: 'settings-a',
  line_account_id: 'account-a',
  enabled: 1,
  service_name: 'LINE Harness',
  service_description: 'LINE顧客対応',
  pricing: '月額5,000円',
  target_audience: '事業者',
  related_urls_json: '["https://example.com"]',
  related_keywords_json: '["自動返信"]',
  provider_order_json: '["openai","anthropic","gemini"]',
  off_topic_message: '対象外です',
  provider_error_message: '障害中です',
  context_ttl_minutes: 30,
  max_history_messages: 6,
  created_at: '2026-07-27T00:00:00+09:00',
  updated_at: '2026-07-27T00:00:00+09:00',
};

const env = {
  DB: {},
  API_KEY: 'owner-key',
  OPENAI_API_KEY: 'openai-secret',
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: 'gemini-secret',
} as Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', aiConcierge);
  return instance;
}

function request(path: string, init: RequestInit = {}, authenticated = true) {
  return app().request(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(authenticated ? { Authorization: 'Bearer owner-key' } : {}),
      ...init.headers,
    },
  }, env);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getStaffByApiKey.mockResolvedValue(null);
  dbMocks.getAiConciergeSettings.mockResolvedValue(storedSettings);
  dbMocks.upsertAiConciergeSettings.mockResolvedValue(storedSettings);
  dbMocks.listAiConciergeFaqs.mockResolvedValue([
    { id: 'faq-a', line_account_id: 'account-a', question: '料金は？', answer: '月額です', active: 1 },
  ]);
  dbMocks.listAiConciergeLogs.mockResolvedValue([{ id: 'log-a' }]);
});

describe('AI concierge management API', () => {
  test('requires authentication', async () => {
    expect((await request('/api/ai-concierge/settings?lineAccountId=account-a', {}, false)).status).toBe(401);
    expect((await request('/api/ai-concierge/faqs?lineAccountId=account-a', {}, false)).status).toBe(401);
  });

  test('scopes settings and FAQ reads to selected account', async () => {
    expect((await request('/api/ai-concierge/settings?lineAccountId=account-a')).status).toBe(200);
    expect((await request('/api/ai-concierge/faqs?lineAccountId=account-a')).status).toBe(200);
    expect(dbMocks.getAiConciergeSettings).toHaveBeenCalledWith(env.DB, 'account-a');
    expect(dbMocks.listAiConciergeFaqs).toHaveBeenCalledWith(env.DB, 'account-a');
  });

  test('returns 404 for cross-account FAQ update and delete', async () => {
    dbMocks.updateAiConciergeFaq.mockResolvedValue(null);
    dbMocks.deleteAiConciergeFaq.mockResolvedValue(false);
    const update = await request('/api/ai-concierge/faqs/faq-b?lineAccountId=account-a', {
      method: 'PUT',
      body: JSON.stringify({ answer: 'changed' }),
    });
    const remove = await request('/api/ai-concierge/faqs/faq-b?lineAccountId=account-a', { method: 'DELETE' });

    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(dbMocks.updateAiConciergeFaq).toHaveBeenCalledWith(env.DB, 'account-a', 'faq-b', expect.anything());
    expect(dbMocks.deleteAiConciergeFaq).toHaveBeenCalledWith(env.DB, 'account-a', 'faq-b');
  });

  test.each([
    [{ providerOrder: ['openai', 'openai'] }, 'providerOrder'],
    [{ providerOrder: ['openai', 'unknown'] }, 'providerOrder'],
    [{ relatedKeywords: Array.from({ length: 101 }, (_, i) => `k${i}`) }, 'relatedKeywords'],
    [{ relatedUrls: ['javascript:alert(1)'] }, 'relatedUrls'],
    [{ contextTtlMinutes: 0 }, 'contextTtlMinutes'],
    [{ maxHistoryMessages: 21 }, 'maxHistoryMessages'],
    [{ serviceDescription: 'x'.repeat(5_001) }, 'serviceDescription'],
  ])('rejects bounded settings input: %s', async (body, field) => {
    const response = await request('/api/ai-concierge/settings?lineAccountId=account-a', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining(field) });
  });

  test('relevance test returns local diagnostics without provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await request('/api/ai-concierge/relevance-test?lineAccountId=account-a', {
      method: 'POST',
      body: JSON.stringify({ message: '自動返信について' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { relevant: true, reasonCodes: ['registered_keyword'] },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('paginates logs within the selected account', async () => {
    const response = await request('/api/ai-concierge/logs?lineAccountId=account-a&page=2&pageSize=10');
    expect(response.status).toBe(200);
    expect(dbMocks.listAiConciergeLogs).toHaveBeenCalledWith(env.DB, 'account-a', 21);
    await expect(response.json()).resolves.toMatchObject({
      data: { page: 2, pageSize: 10 },
    });
  });

  test('returns provider availability booleans without keys', async () => {
    const response = await request('/api/ai-concierge/capabilities?lineAccountId=account-a');
    const body = await response.json();

    expect(body).toEqual({
      success: true,
      data: { openai: true, anthropic: false, gemini: true },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
