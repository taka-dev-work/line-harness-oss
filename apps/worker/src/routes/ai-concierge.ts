import { Hono } from 'hono';
import {
  createAiConciergeFaq,
  deleteAiConciergeFaq,
  getAiConciergeSettings,
  listAiConciergeFaqs,
  listAiConciergeLogs,
  updateAiConciergeFaq,
  upsertAiConciergeSettings,
} from '@line-crm/db';
import type {
  AiConciergeFaq,
  AiConciergeSettings,
  AiProviderName,
  CreateAiConciergeFaqInput,
  UpdateAiConciergeSettingsInput,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { classifyRelevance } from '../services/ai-concierge/relevance.js';

export const aiConcierge = new Hono<Env>();

const PROVIDERS = new Set<AiProviderName>(['openai', 'anthropic', 'gemini']);
const SETTINGS_FIELDS = new Set([
  'enabled',
  'serviceName',
  'serviceDescription',
  'pricing',
  'targetAudience',
  'relatedUrls',
  'relatedKeywords',
  'providerOrder',
  'offTopicMessage',
  'providerErrorMessage',
  'contextTtlMinutes',
  'maxHistoryMessages',
]);

function accountId(c: { req: { query(name: string): string | undefined } }): string | null {
  return c.req.query('lineAccountId')?.trim() || null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function serializeSettings(row: AiConciergeSettings) {
  return {
    enabled: Boolean(row.enabled),
    serviceName: row.service_name,
    serviceDescription: row.service_description,
    pricing: row.pricing,
    targetAudience: row.target_audience,
    relatedUrls: parseJson<string[]>(row.related_urls_json, []),
    relatedKeywords: parseJson<string[]>(row.related_keywords_json, []),
    providerOrder: parseJson<AiProviderName[]>(row.provider_order_json, ['openai', 'anthropic', 'gemini']),
    offTopicMessage: row.off_topic_message,
    providerErrorMessage: row.provider_error_message,
    contextTtlMinutes: row.context_ttl_minutes,
    maxHistoryMessages: row.max_history_messages,
  };
}

function serializeFaq(row: AiConciergeFaq) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    sortOrder: row.sort_order,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stringLimit(value: unknown, field: string, max: number, allowEmpty = true): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`${field} must be a string of at most ${max} characters`);
  }
  return value;
}

function validateSettings(body: unknown): UpdateAiConciergeSettingsInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('settings body is required');
  const source = body as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!SETTINGS_FIELDS.has(key)) throw new Error(`unsupported settings field: ${key}`);
  }
  const result: UpdateAiConciergeSettingsInput = {};
  if (source.enabled !== undefined) {
    if (typeof source.enabled !== 'boolean') throw new Error('enabled must be boolean');
    result.enabled = source.enabled;
  }
  const strings = [
    ['serviceName', 200],
    ['serviceDescription', 5_000],
    ['pricing', 3_000],
    ['targetAudience', 2_000],
    ['offTopicMessage', 500],
    ['providerErrorMessage', 500],
  ] as const;
  for (const [field, max] of strings) {
    const value = stringLimit(source[field], field, max);
    if (value !== null) Object.assign(result, { [field]: value });
  }
  if (source.relatedKeywords !== undefined) {
    if (!Array.isArray(source.relatedKeywords) || source.relatedKeywords.length > 100
      || source.relatedKeywords.some((item) => typeof item !== 'string' || !item.trim() || item.length > 100)) {
      throw new Error('relatedKeywords must contain at most 100 non-empty strings');
    }
    result.relatedKeywords = source.relatedKeywords as string[];
  }
  if (source.relatedUrls !== undefined) {
    if (!Array.isArray(source.relatedUrls) || source.relatedUrls.length > 20) {
      throw new Error('relatedUrls must contain at most 20 URLs');
    }
    for (const value of source.relatedUrls) {
      if (typeof value !== 'string' || value.length > 2_048) throw new Error('relatedUrls contains an invalid URL');
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error('relatedUrls contains an invalid URL');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('relatedUrls contains an invalid URL');
    }
    result.relatedUrls = source.relatedUrls as string[];
  }
  if (source.providerOrder !== undefined) {
    if (!Array.isArray(source.providerOrder) || source.providerOrder.length < 1 || source.providerOrder.length > 3
      || source.providerOrder.some((item) => typeof item !== 'string' || !PROVIDERS.has(item as AiProviderName))
      || new Set(source.providerOrder).size !== source.providerOrder.length) {
      throw new Error('providerOrder must contain unique openai, anthropic, or gemini values');
    }
    result.providerOrder = source.providerOrder as AiProviderName[];
  }
  if (source.contextTtlMinutes !== undefined) {
    if (!Number.isInteger(source.contextTtlMinutes) || Number(source.contextTtlMinutes) < 1 || Number(source.contextTtlMinutes) > 1_440) {
      throw new Error('contextTtlMinutes must be an integer from 1 to 1440');
    }
    result.contextTtlMinutes = Number(source.contextTtlMinutes);
  }
  if (source.maxHistoryMessages !== undefined) {
    if (!Number.isInteger(source.maxHistoryMessages) || Number(source.maxHistoryMessages) < 0 || Number(source.maxHistoryMessages) > 20) {
      throw new Error('maxHistoryMessages must be an integer from 0 to 20');
    }
    result.maxHistoryMessages = Number(source.maxHistoryMessages);
  }
  return result;
}

function validateFaq(body: unknown, partial = false): Partial<CreateAiConciergeFaqInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('FAQ body is required');
  const source = body as Record<string, unknown>;
  const result: Partial<CreateAiConciergeFaqInput> = {};
  if (!partial || source.question !== undefined) result.question = stringLimit(source.question, 'question', 500, false)!;
  if (!partial || source.answer !== undefined) result.answer = stringLimit(source.answer, 'answer', 3_000, false)!;
  if (source.sortOrder !== undefined) {
    if (!Number.isInteger(source.sortOrder) || Math.abs(Number(source.sortOrder)) > 100_000) throw new Error('sortOrder must be an integer');
    result.sortOrder = Number(source.sortOrder);
  }
  if (source.active !== undefined) {
    if (typeof source.active !== 'boolean') throw new Error('active must be boolean');
    result.active = source.active;
  }
  return result;
}

aiConcierge.get('/api/ai-concierge/settings', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  return c.json({ success: true, data: serializeSettings(await getAiConciergeSettings(c.env.DB, selected)) });
});

aiConcierge.put('/api/ai-concierge/settings', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  try {
    const input = validateSettings(await c.req.json());
    return c.json({ success: true, data: serializeSettings(await upsertAiConciergeSettings(c.env.DB, selected, input)) });
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'invalid settings' }, 400);
  }
});

aiConcierge.get('/api/ai-concierge/faqs', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  const rows = await listAiConciergeFaqs(c.env.DB, selected);
  return c.json({ success: true, data: rows.map(serializeFaq) });
});

aiConcierge.post('/api/ai-concierge/faqs', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  try {
    if ((await listAiConciergeFaqs(c.env.DB, selected)).length >= 100) throw new Error('FAQ count must not exceed 100');
    const input = validateFaq(await c.req.json()) as CreateAiConciergeFaqInput;
    return c.json({ success: true, data: serializeFaq(await createAiConciergeFaq(c.env.DB, selected, input)) }, 201);
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'invalid FAQ' }, 400);
  }
});

aiConcierge.put('/api/ai-concierge/faqs/:id', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  try {
    const row = await updateAiConciergeFaq(c.env.DB, selected, c.req.param('id'), validateFaq(await c.req.json(), true));
    if (!row) return c.json({ success: false, error: 'FAQ not found' }, 404);
    return c.json({ success: true, data: serializeFaq(row) });
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'invalid FAQ' }, 400);
  }
});

aiConcierge.delete('/api/ai-concierge/faqs/:id', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  if (!await deleteAiConciergeFaq(c.env.DB, selected, c.req.param('id'))) {
    return c.json({ success: false, error: 'FAQ not found' }, 404);
  }
  return c.json({ success: true });
});

aiConcierge.post('/api/ai-concierge/relevance-test', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  try {
    const body = await c.req.json<{ message?: unknown }>();
    const message = stringLimit(body.message, 'message', 5_000, false)!;
    const [settingsRow, faqs] = await Promise.all([
      getAiConciergeSettings(c.env.DB, selected),
      listAiConciergeFaqs(c.env.DB, selected, true),
    ]);
    const settings = serializeSettings(settingsRow);
    const decision = classifyRelevance({
      message,
      serviceName: settings.serviceName,
      serviceDescription: settings.serviceDescription,
      pricing: settings.pricing,
      targetAudience: settings.targetAudience,
      relatedKeywords: settings.relatedKeywords,
      faqQuestions: faqs.map((faq) => faq.question),
    });
    return c.json({ success: true, data: decision });
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'invalid message' }, 400);
  }
});

aiConcierge.get('/api/ai-concierge/logs', async (c) => {
  const selected = accountId(c);
  if (!selected) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  const page = Math.max(1, Math.min(Number(c.req.query('page')) || 1, 9));
  const pageSize = Math.max(1, Math.min(Number(c.req.query('pageSize')) || 20, 50));
  const rows = await listAiConciergeLogs(c.env.DB, selected, page * pageSize + 1);
  return c.json({
    success: true,
    data: {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      hasMore: rows.length > page * pageSize,
    },
  });
});

aiConcierge.get('/api/ai-concierge/capabilities', (c) => {
  if (!accountId(c)) return c.json({ success: false, error: 'lineAccountId required' }, 400);
  return c.json({
    success: true,
    data: {
      openai: Boolean(c.env.OPENAI_API_KEY),
      anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
      gemini: Boolean(c.env.GEMINI_API_KEY),
    },
  });
});
