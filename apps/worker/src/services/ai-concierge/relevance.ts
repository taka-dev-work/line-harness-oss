import type {
  RelevanceDecision,
  RelevanceInput,
  RelevanceReasonCode,
} from './types.js';

const MIN_TERM_LENGTH = 2;
const RELEVANCE_THRESHOLD = 60;
const MAX_FOLLOWUP_LENGTH = 30;

const DEFAULT_STOP_WORDS = [
  'ai',
  'line',
  'サービス',
  'システム',
  'サポート',
  'について',
  'ください',
  '教えて',
];

const GENERAL_INQUIRY_TERMS = [
  '料金',
  '価格',
  '費用',
  'いくら',
  '申込',
  '申し込み',
  '契約',
  '解約',
  '対象',
  '使い方',
  '利用方法',
  '期間',
  'いつ',
];

const FOLLOWUP_TERMS = [
  'それ',
  'その',
  'これ',
  'こちら',
  ...GENERAL_INQUIRY_TERMS,
];

const TERM_SEPARATORS =
  /(?:について|どのくらい|教えてください|教えて|できますか|でしょうか|ですか|しますか|したい|とは|から|まで|より|ので|の|は|を|に|で|が|へ|と)/gu;

export function normalizeForRelevance(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactLength(value: string): number {
  return value.replaceAll(' ', '').length;
}

function normalizedStopWords(configured: string[] = []): Set<string> {
  return new Set([...DEFAULT_STOP_WORDS, ...configured].map(normalizeForRelevance));
}

function isUsefulTerm(term: string, stopWords: Set<string>): boolean {
  return compactLength(term) >= MIN_TERM_LENGTH
    && !stopWords.has(term)
    && !GENERAL_INQUIRY_TERMS.includes(term);
}

function uniqueTerms(values: string[], stopWords: Set<string>): string[] {
  return [...new Set(values
    .map(normalizeForRelevance)
    .filter((term) => isUsefulTerm(term, stopWords)))];
}

function phraseTerms(value: string, stopWords: Set<string>): string[] {
  const normalized = normalizeForRelevance(value);
  const separated = normalized.replace(TERM_SEPARATORS, ' ');
  return uniqueTerms([
    ...normalized.split(' '),
    ...separated.split(' '),
  ], stopWords);
}

function contains(message: string, term: string): boolean {
  return message.includes(term);
}

function activeFollowup(input: RelevanceInput, message: string): boolean {
  const context = input.activeContext;
  if (!context || context.status !== 'active') return false;
  const now = new Date(input.now ?? Date.now()).getTime();
  const expiresAt = new Date(context.expiresAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  if (compactLength(message) > MAX_FOLLOWUP_LENGTH) return false;
  return FOLLOWUP_TERMS.some((term) => message.includes(normalizeForRelevance(term)));
}

export function classifyRelevance(input: RelevanceInput): RelevanceDecision {
  const normalizedMessage = normalizeForRelevance(input.message);
  const stopWords = normalizedStopWords(input.stopWords);
  const reasons: RelevanceReasonCode[] = [];
  const matchedTerms: string[] = [];
  let score = 0;

  const addSignal = (reason: RelevanceReasonCode, term: string, signalScore: number) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    if (!matchedTerms.includes(term)) matchedTerms.push(term);
    score = Math.max(score, signalScore);
  };

  const serviceName = normalizeForRelevance(input.serviceName);
  if (isUsefulTerm(serviceName, stopWords) && contains(normalizedMessage, serviceName)) {
    addSignal('service_name_exact', serviceName, 100);
  } else {
    for (const term of phraseTerms(input.serviceName, stopWords)) {
      if (contains(normalizedMessage, term)) {
        addSignal('service_name_partial', term, 80);
        break;
      }
    }
  }

  for (const keyword of uniqueTerms(input.relatedKeywords ?? [], stopWords)) {
    if (contains(normalizedMessage, keyword)) {
      addSignal('registered_keyword', keyword, 90);
    }
  }

  const faqTerms = uniqueTerms(
    (input.faqQuestions ?? []).flatMap((question) => phraseTerms(question, stopWords)),
    stopWords,
  );
  for (const term of faqTerms) {
    if (contains(normalizedMessage, term)) {
      addSignal('faq_term', term, 70);
      break;
    }
  }

  const profileTerms = uniqueTerms(
    [input.serviceDescription ?? '', input.pricing ?? '', input.targetAudience ?? '']
      .flatMap((value) => phraseTerms(value, stopWords)),
    stopWords,
  );
  for (const term of profileTerms) {
    if (contains(normalizedMessage, term)) {
      addSignal('service_profile_term', term, 65);
      break;
    }
  }

  if (score < RELEVANCE_THRESHOLD && activeFollowup(input, normalizedMessage)) {
    addSignal('active_context_followup', 'active_context', 60);
  }

  const relevant = score >= RELEVANCE_THRESHOLD;
  if (!relevant) reasons.push('no_service_signal');

  return {
    relevant,
    score,
    reasonCodes: reasons,
    matchedTerms,
    normalizedMessage,
  };
}
