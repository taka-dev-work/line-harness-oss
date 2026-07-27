import {
  getActiveAiConciergeSession,
  getAiConciergeSettings,
  insertAiConciergeLog,
  listAiConciergeFaqs,
  toJstString,
  upsertAiConciergeSession,
} from '@line-crm/db';
import type { AiConciergeMessage, AiProviderName as DbAiProviderName } from '@line-crm/db';
import { createConciergeOrchestrator } from './orchestrator.js';
import { AnthropicProvider, GeminiProvider, OpenAiProvider } from './providers.js';
import type {
  AiProvider,
  AiProviderName,
  ConciergeFaq,
  ConciergeSettings,
} from './types.js';

interface ProviderEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

export interface HandleConciergeMessageInput {
  db: D1Database;
  lineAccountId: string;
  friendId: string;
  message: string;
  providers?: AiProvider[];
  env?: ProviderEnvironment;
  now?: () => Date;
}

export interface HandleConciergeMessageResult {
  handled: boolean;
  messages: string[];
  decision: 'disabled' | 'off_topic' | 'relevant';
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function providersFromEnvironment(env: ProviderEnvironment = {}): AiProvider[] {
  return [
    new OpenAiProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }),
    new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }),
    new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
  ];
}

export function splitLineText(text: string, maxChars = 4_900): string[] {
  const chars = [...text];
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    chunks.push(chars.slice(index, index + maxChars).join(''));
  }
  return chunks.length ? chunks : [''];
}

export async function handleConciergeMessage(
  input: HandleConciergeMessageInput,
): Promise<HandleConciergeMessageResult> {
  const settingsRow = await getAiConciergeSettings(input.db, input.lineAccountId);
  if (!settingsRow.enabled) return { handled: false, messages: [], decision: 'disabled' };

  const [faqRows, session] = await Promise.all([
    listAiConciergeFaqs(input.db, input.lineAccountId, true),
    getActiveAiConciergeSession(input.db, input.lineAccountId, input.friendId),
  ]);
  const settings: ConciergeSettings = {
    enabled: true,
    serviceName: settingsRow.service_name,
    serviceDescription: settingsRow.service_description,
    pricing: settingsRow.pricing,
    targetAudience: settingsRow.target_audience,
    relatedUrls: parseJson(settingsRow.related_urls_json, []),
    relatedKeywords: parseJson(settingsRow.related_keywords_json, []),
    providerOrder: parseJson<DbAiProviderName[]>(settingsRow.provider_order_json, ['openai', 'anthropic', 'gemini']) as AiProviderName[],
    offTopicMessage: settingsRow.off_topic_message,
    providerErrorMessage: settingsRow.provider_error_message,
    contextTtlMinutes: settingsRow.context_ttl_minutes,
    maxHistoryMessages: settingsRow.max_history_messages,
  };
  const faqs: ConciergeFaq[] = faqRows.map((faq) => ({ question: faq.question, answer: faq.answer }));
  const history = session
    ? parseJson<AiConciergeMessage[]>(session.recent_messages_json, [])
    : [];
  const activeContext = session
    ? {
        status: session.status,
        lastRelevantAt: session.last_relevant_at,
        expiresAt: session.expires_at,
      }
    : null;
  const clock = input.now ?? (() => new Date());
  const response = await createConciergeOrchestrator({
    providers: input.providers ?? providersFromEnvironment(input.env),
    now: () => clock().getTime(),
  }).respond({
    settings,
    faqs,
    message: input.message,
    history,
    activeContext,
  });
  if (!response.handled || !response.reply) {
    return { handled: false, messages: [], decision: response.decision };
  }

  const now = clock();
  const nowText = toJstString(now);
  if (response.decision === 'off_topic') {
    await upsertAiConciergeSession(input.db, input.lineAccountId, input.friendId, {
      status: 'closed',
      lastRelevantAt: session?.last_relevant_at ?? nowText,
      expiresAt: nowText,
      recentMessages: [],
    });
  } else {
    const expiresAt = new Date(now.getTime() + settings.contextTtlMinutes * 60_000);
    const nextMessages = [
      ...history,
      { role: 'user' as const, content: input.message },
      { role: 'assistant' as const, content: response.reply },
    ];
    const recentMessages = settings.maxHistoryMessages === 0
      ? []
      : nextMessages.slice(-settings.maxHistoryMessages);
    await upsertAiConciergeSession(input.db, input.lineAccountId, input.friendId, {
      status: 'active',
      lastRelevantAt: nowText,
      expiresAt: toJstString(expiresAt),
      recentMessages,
    });
  }

  try {
    await insertAiConciergeLog(input.db, input.lineAccountId, {
      friendId: input.friendId,
      decision: response.decision,
      decisionReasons: response.decisionReasons,
      provider: response.provider,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      latencyMs: response.latencyMs,
      fallbackCount: response.fallbackCount,
      status: response.status,
      errorCode: response.errorCode,
    });
  } catch (error) {
    console.error('AI concierge log insertion failed:', error);
  }

  return {
    handled: true,
    messages: splitLineText(response.reply),
    decision: response.decision,
  };
}
