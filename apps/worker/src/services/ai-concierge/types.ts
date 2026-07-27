export type RelevanceReasonCode =
  | 'service_name_exact'
  | 'service_name_partial'
  | 'registered_keyword'
  | 'faq_term'
  | 'service_profile_term'
  | 'active_context_followup'
  | 'no_service_signal';

export interface RelevanceContext {
  status: 'active' | 'closed';
  lastRelevantAt: string;
  expiresAt: string;
}

export interface RelevanceInput {
  message: string;
  serviceName: string;
  serviceDescription?: string;
  pricing?: string;
  targetAudience?: string;
  relatedKeywords?: string[];
  faqQuestions?: string[];
  stopWords?: string[];
  activeContext?: RelevanceContext | null;
  now?: string;
}

export interface RelevanceDecision {
  relevant: boolean;
  score: number;
  reasonCodes: RelevanceReasonCode[];
  matchedTerms: string[];
  normalizedMessage: string;
}
