import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  deleteAiConciergeFaq,
  getActiveAiConciergeSession,
  getAiConciergeSettings,
  insertAiConciergeLog,
  updateAiConciergeFaq,
  upsertAiConciergeSession,
  upsertAiConciergeSettings,
} from './ai-concierge.js';

type Call = { sql: string; values: unknown[] };

class RecordingDb {
  calls: Call[] = [];
  firstResult: unknown = null;

  prepare(sql: string) {
    const call: Call = { sql, values: [] };
    this.calls.push(call);
    return {
      bind: (...values: unknown[]) => {
        call.values = values;
        return {
          first: async <T>() => this.firstResult as T | null,
          all: async <T>() => ({ results: [] as T[] }),
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
      },
      first: async <T>() => this.firstResult as T | null,
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
  }
}

let recording: RecordingDb;
let db: D1Database;

beforeEach(() => {
  recording = new RecordingDb();
  db = recording as unknown as D1Database;
});

describe('AI concierge settings', () => {
  test('returns disabled account-scoped defaults when settings do not exist', async () => {
    const settings = await getAiConciergeSettings(db, 'account-a');

    expect(settings.line_account_id).toBe('account-a');
    expect(settings.enabled).toBe(0);
    expect(recording.calls[0]?.values).toEqual(['account-a']);
  });

  test('requires a LINE account ID for settings reads and writes', async () => {
    await expect(getAiConciergeSettings(db, '')).rejects.toThrow('LINE account ID');
    await expect(upsertAiConciergeSettings(db, '', {})).rejects.toThrow('LINE account ID');
  });
});

describe('AI concierge account boundaries', () => {
  test('scopes FAQ updates and deletes by LINE account ID', async () => {
    await updateAiConciergeFaq(db, 'account-a', 'faq-1', { answer: 'Updated' });
    await deleteAiConciergeFaq(db, 'account-a', 'faq-1');

    expect(recording.calls[0]?.sql).toMatch(/WHERE id = \? AND line_account_id = \?/);
    expect(recording.calls[0]?.values.slice(-2)).toEqual(['faq-1', 'account-a']);
    expect(recording.calls[1]?.sql).toMatch(/WHERE id = \? AND line_account_id = \?/);
    expect(recording.calls[1]?.values).toEqual(['faq-1', 'account-a']);
  });
});

describe('AI concierge sessions and logs', () => {
  test('migration makes one session unique per LINE account and friend', () => {
    const migration = readFileSync(
      fileURLToPath(new URL('../migrations/031_ai_concierge.sql', import.meta.url)),
      'utf8',
    );

    expect(migration).toMatch(/UNIQUE\s*\(\s*line_account_id\s*,\s*friend_id\s*\)/i);
  });

  test('upserts sessions on the account and friend unique key and bounds history', async () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `${index}-${'x'.repeat(2_100)}`,
    }));

    await upsertAiConciergeSession(db, 'account-a', 'friend-a', {
      status: 'active',
      lastRelevantAt: '2026-07-27T00:00:00+09:00',
      expiresAt: '2026-07-27T00:30:00+09:00',
      recentMessages: messages,
    });

    const call = recording.calls[0]!;
    expect(call.sql).toMatch(/ON CONFLICT\s*\(\s*line_account_id\s*,\s*friend_id\s*\)/i);
    const saved = JSON.parse(String(call.values[5])) as Array<{ content: string }>;
    expect(saved).toHaveLength(20);
    expect(saved.every((message) => message.content.length <= 2_000)).toBe(true);
  });

  test('only returns active, unexpired sessions', async () => {
    await getActiveAiConciergeSession(db, 'account-a', 'friend-a', '2026-07-27T00:10:00+09:00');

    expect(recording.calls[0]?.sql).toMatch(/status = 'active'/);
    expect(recording.calls[0]?.sql).toMatch(/expires_at > \?/);
    expect(recording.calls[0]?.values).toEqual([
      'account-a',
      'friend-a',
      '2026-07-27T00:10:00+09:00',
    ]);
  });

  test('rejects API keys and full prompts from log input', async () => {
    await expect(insertAiConciergeLog(db, 'account-a', {
      decision: 'relevant',
      status: 'success',
      apiKey: 'secret',
    } as never)).rejects.toThrow('sensitive');
    await expect(insertAiConciergeLog(db, 'account-a', {
      decision: 'relevant',
      status: 'success',
      prompt: 'full prompt',
    } as never)).rejects.toThrow('sensitive');
  });
});
