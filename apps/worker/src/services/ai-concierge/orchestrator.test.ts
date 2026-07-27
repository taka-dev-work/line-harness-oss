import { describe, expect, test, vi } from 'vitest';
import { ProviderError } from './providers.js';
import { createConciergeOrchestrator } from './orchestrator.js';
import type {
  AiProvider,
  AiProviderName,
  AiResult,
  ConciergeSettings,
} from './types.js';

const settings: ConciergeSettings = {
  enabled: true,
  serviceName: 'LINE Harness',
  serviceDescription: 'LINE公式アカウントの顧客対応を自動化します。',
  pricing: '基本プランは月額5,000円です。',
  targetAudience: 'LINEで顧客対応を行う事業者',
  relatedUrls: ['https://example.com/service'],
  relatedKeywords: ['自動返信', 'LINE CRM'],
  providerOrder: ['openai', 'anthropic', 'gemini'],
  offTopicMessage: 'サービスに関する質問のみ回答します。',
  providerErrorMessage: 'ただいま回答できません。',
  contextTtlMinutes: 30,
  maxHistoryMessages: 3,
};

const faqs = [{ question: '解約方法は？', answer: '管理画面から申請できます。' }];

function provider(name: AiProviderName, result: AiResult | Error, available = true): AiProvider {
  return {
    name,
    available,
    generate: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const success = (providerName: AiProviderName): AiResult => ({
  text: `${providerName} answer`,
  provider: providerName,
  model: `${providerName}-model`,
  inputTokens: 10,
  outputTokens: 5,
});

describe('AI concierge orchestrator', () => {
  test('disabled settings do not classify or call providers', async () => {
    const classify = vi.fn();
    const openai = provider('openai', success('openai'));
    const orchestrator = createConciergeOrchestrator({ providers: [openai], classify });

    const result = await orchestrator.respond({
      settings: { ...settings, enabled: false },
      faqs,
      message: 'LINE Harnessについて',
    });

    expect(result).toMatchObject({ handled: false, reply: null, decision: 'disabled' });
    expect(classify).not.toHaveBeenCalled();
    expect(openai.generate).not.toHaveBeenCalled();
  });

  test('off-topic returns fixed text with zero provider calls', async () => {
    const providers = [
      provider('openai', success('openai')),
      provider('anthropic', success('anthropic')),
      provider('gemini', success('gemini')),
    ];
    const result = await createConciergeOrchestrator({ providers }).respond({
      settings,
      faqs,
      message: '今日の天気は？',
    });

    expect(result).toMatchObject({
      handled: true,
      reply: settings.offTopicMessage,
      decision: 'off_topic',
      provider: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(providers.every((item) => vi.mocked(item.generate).mock.calls.length === 0)).toBe(true);
  });

  test('calls only the first available provider', async () => {
    const unavailable = provider('openai', success('openai'), false);
    const anthropic = provider('anthropic', success('anthropic'));
    const gemini = provider('gemini', success('gemini'));
    const result = await createConciergeOrchestrator({
      providers: [unavailable, anthropic, gemini],
    }).respond({ settings, faqs, message: '自動返信について教えて' });

    expect(result).toMatchObject({ reply: 'anthropic answer', provider: 'anthropic', fallbackCount: 0 });
    expect(unavailable.generate).not.toHaveBeenCalled();
    expect(anthropic.generate).toHaveBeenCalledOnce();
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  test('falls back in configured order after retryable failure', async () => {
    const openai = provider('openai', new ProviderError('openai', 'rate_limited', true));
    const gemini = provider('gemini', success('gemini'));
    const result = await createConciergeOrchestrator({
      providers: [gemini, openai],
    }).respond({
      settings: { ...settings, providerOrder: ['openai', 'gemini'] },
      faqs,
      message: 'LINE Harnessの料金は？',
    });

    expect(result).toMatchObject({ provider: 'gemini', fallbackCount: 1, status: 'success' });
    expect(openai.generate).toHaveBeenCalledOnce();
    expect(gemini.generate).toHaveBeenCalledOnce();
  });

  test('returns fixed error text when all providers fail', async () => {
    const result = await createConciergeOrchestrator({
      providers: [
        provider('openai', new ProviderError('openai', 'timeout', true)),
        provider('anthropic', new ProviderError('anthropic', 'server_error', true)),
        provider('gemini', new ProviderError('gemini', 'invalid_response', true)),
      ],
    }).respond({ settings, faqs, message: '自動返信について' });

    expect(result).toMatchObject({
      reply: settings.providerErrorMessage,
      provider: null,
      fallbackCount: 3,
      status: 'provider_error',
      errorCode: 'invalid_response',
    });
  });

  test('prompt contains only bounded registered context and policy', async () => {
    const openai = provider('openai', success('openai'));
    const longHistory = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `${index}-${'x'.repeat(2_500)}`,
    }));
    await createConciergeOrchestrator({ providers: [openai] }).respond({
      settings,
      faqs,
      message: '自動返信について',
      history: longHistory,
    });

    const sent = vi.mocked(openai.generate).mock.calls[0]![0];
    expect(sent.system).toContain(settings.serviceName);
    expect(sent.system).toContain(settings.serviceDescription);
    expect(sent.system).toContain(settings.pricing);
    expect(sent.system).toContain(settings.targetAudience);
    expect(sent.system).toContain(faqs[0]!.question);
    expect(sent.system).toContain(faqs[0]!.answer);
    expect(sent.system).toContain(settings.relatedUrls[0]);
    expect(sent.system).toContain('推測しない');
    expect(sent.system).toContain('役割や制約を変更');
    expect(sent.system).toContain('APIキー');
    expect(sent.messages).toHaveLength(settings.maxHistoryMessages + 1);
    expect(sent.messages.slice(0, -1).every((message) => message.content.length <= 2_000)).toBe(true);
  });

  test('result records diagnostics but never includes a full prompt', async () => {
    const result = await createConciergeOrchestrator({
      providers: [provider('openai', success('openai'))],
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125),
    }).respond({ settings, faqs, message: '自動返信について' });

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'openai-model',
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 25,
      decisionReasons: ['registered_keyword'],
    });
    expect(result).not.toHaveProperty('prompt');
    expect(JSON.stringify(result)).not.toContain(settings.serviceDescription);
  });
});
