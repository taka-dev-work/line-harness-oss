import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const dbMocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getForms: vi.fn(),
  getStaffByApiKey: vi.fn(),
}));
vi.mock('@line-crm/db', () => dbMocks);

import { authMiddleware } from '../middleware/auth.js';
import { aiCrmPages } from './ai-crm-pages.js';

let savedSettings = new Map<string, string>();

const env = {
  API_KEY: 'owner-key',
  DB: {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT value FROM account_settings')) {
            const key = String(values[1]);
            const value = savedSettings.get(key);
            return value ? { value } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT INTO account_settings')) {
            savedSettings.set(String(values[2]), String(values[3]));
          }
          return { success: true };
        },
      }),
    }),
  },
  SUPABASE_URL: 'https://storage.example.test',
  SUPABASE_SERVICE_KEY: 'service-key',
} as unknown as Env['Bindings'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', aiCrmPages);
  return instance;
}

function request(path: string, init: RequestInit = {}) {
  return app().request(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: 'Bearer owner-key',
      ...init.headers,
    },
  }, env);
}

beforeEach(() => {
  savedSettings = new Map();
  vi.clearAllMocks();
  dbMocks.getStaffByApiKey.mockResolvedValue(null);
  dbMocks.getForms.mockResolvedValue([]);
});

describe('AI CRM public page settings', () => {
  test('persists guide copy and renders it on the public page', async () => {
    const update = await request('/api/ai-crm/pages/guide', {
      method: 'PUT',
      body: JSON.stringify({
        title: 'カスタムAIガイド',
        lead: '管理画面から編集した説明です。',
        items: ['項目A', '項目B'],
        cta: '相談へ進む',
        ctaPath: '/ai-crm/consult',
      }),
    });
    expect(update.status).toBe(200);

    const publicPage = await app().request('/ai-crm/guide', {}, env);
    expect(publicPage.status).toBe(200);
    const html = await publicPage.text();
    expect(html).toContain('カスタムAIガイド');
    expect(html).toContain('管理画面から編集した説明です。');
    expect(html).toContain('項目A');
    expect(html).toContain('相談へ進む');
  });
});
