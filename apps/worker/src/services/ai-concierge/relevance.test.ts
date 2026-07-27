import { describe, expect, test } from 'vitest';
import { classifyRelevance, normalizeForRelevance } from './relevance.js';
import type { RelevanceInput } from './types.js';

const base: Omit<RelevanceInput, 'message'> = {
  serviceName: 'LINE Harness',
  serviceDescription: 'LINE公式アカウント向けのAI顧客対応・予約管理サービス',
  pricing: '月額プラン',
  targetAudience: 'LINEで顧客対応を行う事業者',
  relatedKeywords: ['自動返信', 'LINE CRM', '導入相談', 'AI'],
  faqQuestions: ['導入支援の期間はどのくらいですか', '解約方法を教えてください'],
  stopWords: ['サービス', 'AI'],
  now: '2026-07-27T12:00:00+09:00',
};

function classify(message: string, overrides: Partial<RelevanceInput> = {}) {
  return classifyRelevance({ ...base, message, ...overrides });
}

describe('normalizeForRelevance', () => {
  test('normalizes NFKC, Latin case, punctuation, and whitespace', () => {
    expect(normalizeForRelevance('  ＬＩＮＥ－ＣＲＭ!!\n料金  '))
      .toBe('line crm 料金');
  });
});

describe('zero-token relevance gate', () => {
  test.each([
    ['LINE Harnessについて教えて', 'service_name_exact'],
    ['Harnessの料金を知りたい', 'service_name_partial'],
    ['自動返信はできますか', 'registered_keyword'],
    ['LINE-CRM の使い方', 'registered_keyword'],
    ['導入支援の期間を知りたい', 'faq_term'],
  ])('accepts service-specific message: %s', (message, reason) => {
    const result = classify(message);

    expect(result.relevant).toBe(true);
    expect(result.reasonCodes).toContain(reason);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  test.each([
    '料金はいくら？',
    'こんにちは',
    '今日の天気は？',
    '次の選挙について教えて',
    '大学の宿題を解いて',
    'iPhoneのおすすめは？',
  ])('rejects generic or unrelated message: %s', (message) => {
    const result = classify(message);

    expect(result.relevant).toBe(false);
    expect(result.reasonCodes).toContain('no_service_signal');
  });

  test('accepts a short follow-up only with non-expired relevant context', () => {
    const activeContext = {
      status: 'active' as const,
      lastRelevantAt: '2026-07-27T11:55:00+09:00',
      expiresAt: '2026-07-27T12:25:00+09:00',
    };

    expect(classify('それはいくら？', { activeContext }).reasonCodes)
      .toContain('active_context_followup');
    expect(classify('それはいくら？', { activeContext }).relevant).toBe(true);
    expect(classify('それはいくら？', {
      activeContext: { ...activeContext, expiresAt: '2026-07-27T11:59:59+09:00' },
    }).relevant).toBe(false);
  });

  test('does not use one-character terms or configured stop words as signals', () => {
    expect(classify('AIについて教えて').relevant).toBe(false);
    expect(classify('Lについて教えて', {
      serviceName: 'L Platform',
      relatedKeywords: ['X'],
    }).relevant).toBe(false);
  });

  test('returns stable management-screen diagnostics', () => {
    expect(classify('自動返信の料金は？')).toMatchObject({
      relevant: true,
      score: 90,
      reasonCodes: ['registered_keyword'],
      matchedTerms: ['自動返信'],
      normalizedMessage: '自動返信の料金は',
    });
  });
});
