import { ProviderError } from './providers.js';
import { buildConciergePrompt } from './prompt.js';
import { classifyRelevance } from './relevance.js';
import type {
  AiProvider,
  AiProviderName,
  ConciergeFaq,
  ConciergeMessage,
  ConciergeSettings,
  RelevanceContext,
  RelevanceDecision,
  RelevanceInput,
} from './types.js';

export interface ConciergeResponseInput {
  settings: ConciergeSettings;
  faqs: ConciergeFaq[];
  message: string;
  history?: ConciergeMessage[];
  activeContext?: RelevanceContext | null;
}

export interface ConciergeResponse {
  handled: boolean;
  reply: string | null;
  decision: 'disabled' | 'off_topic' | 'relevant';
  decisionReasons: string[];
  provider: AiProviderName | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  fallbackCount: number;
  status: 'disabled' | 'off_topic' | 'success' | 'provider_error';
  errorCode: string | null;
}

type Classifier = (input: RelevanceInput) => RelevanceDecision;

export function createConciergeOrchestrator(dependencies: {
  providers: AiProvider[];
  classify?: Classifier;
  now?: () => number;
}) {
  const providers = new Map(dependencies.providers.map((provider) => [provider.name, provider]));
  const classify = dependencies.classify ?? classifyRelevance;
  const now = dependencies.now ?? Date.now;

  return {
    async respond(input: ConciergeResponseInput): Promise<ConciergeResponse> {
      if (!input.settings.enabled) {
        return {
          handled: false,
          reply: null,
          decision: 'disabled',
          decisionReasons: [],
          provider: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          latencyMs: null,
          fallbackCount: 0,
          status: 'disabled',
          errorCode: null,
        };
      }

      const relevance = classify({
        message: input.message,
        serviceName: input.settings.serviceName,
        serviceDescription: input.settings.serviceDescription,
        pricing: input.settings.pricing,
        targetAudience: input.settings.targetAudience,
        relatedKeywords: input.settings.relatedKeywords,
        faqQuestions: input.faqs.map((faq) => faq.question),
        activeContext: input.activeContext,
      });
      if (!relevance.relevant) {
        return {
          handled: true,
          reply: input.settings.offTopicMessage,
          decision: 'off_topic',
          decisionReasons: relevance.reasonCodes,
          provider: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          latencyMs: null,
          fallbackCount: 0,
          status: 'off_topic',
          errorCode: null,
        };
      }

      const prompt = buildConciergePrompt(input);
      let fallbackCount = 0;
      let lastErrorCode: string | null = 'unavailable';
      for (const providerName of input.settings.providerOrder) {
        const provider = providers.get(providerName);
        if (!provider?.available) continue;
        const startedAt = now();
        try {
          const result = await provider.generate(prompt);
          return {
            handled: true,
            reply: result.text,
            decision: 'relevant',
            decisionReasons: relevance.reasonCodes,
            provider: result.provider,
            model: result.model,
            inputTokens: result.inputTokens ?? null,
            outputTokens: result.outputTokens ?? null,
            latencyMs: Math.max(0, now() - startedAt),
            fallbackCount,
            status: 'success',
            errorCode: null,
          };
        } catch (error) {
          fallbackCount += 1;
          if (error instanceof ProviderError) {
            lastErrorCode = error.code;
            if (!error.retryable) break;
          } else {
            lastErrorCode = 'request_failed';
          }
        }
      }

      return {
        handled: true,
        reply: input.settings.providerErrorMessage,
        decision: 'relevant',
        decisionReasons: relevance.reasonCodes,
        provider: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        fallbackCount,
        status: 'provider_error',
        errorCode: lastErrorCode,
      };
    },
  };
}
