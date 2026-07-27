import { jstNow } from './utils.js';

export type AiProviderName = 'openai' | 'anthropic' | 'gemini';
export type AiConciergeDecision = 'relevant' | 'off_topic' | 'disabled';
export type AiConciergeSessionStatus = 'active' | 'closed';

export interface AiConciergeSettings {
  id: string;
  line_account_id: string;
  enabled: number;
  service_name: string;
  service_description: string;
  pricing: string;
  target_audience: string;
  related_urls_json: string;
  related_keywords_json: string;
  provider_order_json: string;
  off_topic_message: string;
  provider_error_message: string;
  context_ttl_minutes: number;
  max_history_messages: number;
  created_at: string;
  updated_at: string;
}

export interface AiConciergeFaq {
  id: string;
  line_account_id: string;
  question: string;
  answer: string;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface AiConciergeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiConciergeSession {
  id: string;
  line_account_id: string;
  friend_id: string;
  status: AiConciergeSessionStatus;
  last_relevant_at: string;
  recent_messages_json: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface AiConciergeLog {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  decision: AiConciergeDecision;
  decision_reasons_json: string;
  provider: AiProviderName | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  fallback_count: number;
  status: string;
  error_code: string | null;
  created_at: string;
}

export interface UpdateAiConciergeSettingsInput {
  enabled?: boolean;
  serviceName?: string;
  serviceDescription?: string;
  pricing?: string;
  targetAudience?: string;
  relatedUrls?: string[];
  relatedKeywords?: string[];
  providerOrder?: AiProviderName[];
  offTopicMessage?: string;
  providerErrorMessage?: string;
  contextTtlMinutes?: number;
  maxHistoryMessages?: number;
}

export interface CreateAiConciergeFaqInput {
  question: string;
  answer: string;
  sortOrder?: number;
  active?: boolean;
}

export interface UpsertAiConciergeSessionInput {
  status: AiConciergeSessionStatus;
  lastRelevantAt: string;
  expiresAt: string;
  recentMessages: AiConciergeMessage[];
}

export interface CreateAiConciergeLogInput {
  friendId?: string | null;
  decision: AiConciergeDecision;
  decisionReasons?: string[];
  provider?: AiProviderName | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  fallbackCount?: number;
  status: string;
  errorCode?: string | null;
}

const DEFAULT_OFF_TOPIC_MESSAGE = 'このサービスに関するご質問のみお答えできます。';
const DEFAULT_PROVIDER_ERROR_MESSAGE = 'ただいま回答を生成できません。時間をおいて再度お試しください。';
const DEFAULT_PROVIDER_ORDER: AiProviderName[] = ['openai', 'anthropic', 'gemini'];
const MAX_RECENT_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2_000;
const SENSITIVE_LOG_KEYS = new Set(['apikey', 'api_key', 'prompt', 'fullprompt', 'full_prompt', 'systemprompt', 'system_prompt']);

function requireLineAccountId(lineAccountId: string): void {
  if (!lineAccountId.trim()) throw new Error('LINE account ID is required');
}

function defaultSettings(lineAccountId: string): AiConciergeSettings {
  return {
    id: '',
    line_account_id: lineAccountId,
    enabled: 0,
    service_name: '',
    service_description: '',
    pricing: '',
    target_audience: '',
    related_urls_json: '[]',
    related_keywords_json: '[]',
    provider_order_json: JSON.stringify(DEFAULT_PROVIDER_ORDER),
    off_topic_message: DEFAULT_OFF_TOPIC_MESSAGE,
    provider_error_message: DEFAULT_PROVIDER_ERROR_MESSAGE,
    context_ttl_minutes: 30,
    max_history_messages: 6,
    created_at: '',
    updated_at: '',
  };
}

export async function getAiConciergeSettings(db: D1Database, lineAccountId: string): Promise<AiConciergeSettings> {
  requireLineAccountId(lineAccountId);
  return (await db
    .prepare('SELECT * FROM ai_concierge_settings WHERE line_account_id = ?')
    .bind(lineAccountId)
    .first<AiConciergeSettings>()) ?? defaultSettings(lineAccountId);
}

export async function upsertAiConciergeSettings(
  db: D1Database,
  lineAccountId: string,
  input: UpdateAiConciergeSettingsInput,
): Promise<AiConciergeSettings> {
  requireLineAccountId(lineAccountId);
  const current = await getAiConciergeSettings(db, lineAccountId);
  const now = jstNow();
  const id = current.id || crypto.randomUUID();
  await db.prepare(
    `INSERT INTO ai_concierge_settings (
      id, line_account_id, enabled, service_name, service_description, pricing,
      target_audience, related_urls_json, related_keywords_json, provider_order_json,
      off_topic_message, provider_error_message, context_ttl_minutes,
      max_history_messages, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(line_account_id) DO UPDATE SET
      enabled = excluded.enabled,
      service_name = excluded.service_name,
      service_description = excluded.service_description,
      pricing = excluded.pricing,
      target_audience = excluded.target_audience,
      related_urls_json = excluded.related_urls_json,
      related_keywords_json = excluded.related_keywords_json,
      provider_order_json = excluded.provider_order_json,
      off_topic_message = excluded.off_topic_message,
      provider_error_message = excluded.provider_error_message,
      context_ttl_minutes = excluded.context_ttl_minutes,
      max_history_messages = excluded.max_history_messages,
      updated_at = excluded.updated_at`,
  ).bind(
    id,
    lineAccountId,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    input.serviceName ?? current.service_name,
    input.serviceDescription ?? current.service_description,
    input.pricing ?? current.pricing,
    input.targetAudience ?? current.target_audience,
    JSON.stringify(input.relatedUrls ?? JSON.parse(current.related_urls_json)),
    JSON.stringify(input.relatedKeywords ?? JSON.parse(current.related_keywords_json)),
    JSON.stringify(input.providerOrder ?? JSON.parse(current.provider_order_json)),
    input.offTopicMessage ?? current.off_topic_message,
    input.providerErrorMessage ?? current.provider_error_message,
    input.contextTtlMinutes ?? current.context_ttl_minutes,
    input.maxHistoryMessages ?? current.max_history_messages,
    current.created_at || now,
    now,
  ).run();
  return getAiConciergeSettings(db, lineAccountId);
}

export async function listAiConciergeFaqs(
  db: D1Database,
  lineAccountId: string,
  activeOnly = false,
): Promise<AiConciergeFaq[]> {
  requireLineAccountId(lineAccountId);
  const statement = activeOnly
    ? 'SELECT * FROM ai_concierge_faqs WHERE line_account_id = ? AND active = 1 ORDER BY sort_order, created_at'
    : 'SELECT * FROM ai_concierge_faqs WHERE line_account_id = ? ORDER BY sort_order, created_at';
  return (await db.prepare(statement).bind(lineAccountId).all<AiConciergeFaq>()).results;
}

export async function createAiConciergeFaq(
  db: D1Database,
  lineAccountId: string,
  input: CreateAiConciergeFaqInput,
): Promise<AiConciergeFaq> {
  requireLineAccountId(lineAccountId);
  const id = crypto.randomUUID();
  const now = jstNow();
  return (await db.prepare(
    `INSERT INTO ai_concierge_faqs
      (id, line_account_id, question, answer, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).bind(
    id,
    lineAccountId,
    input.question,
    input.answer,
    input.sortOrder ?? 0,
    input.active === false ? 0 : 1,
    now,
    now,
  ).first<AiConciergeFaq>())!;
}

export async function updateAiConciergeFaq(
  db: D1Database,
  lineAccountId: string,
  id: string,
  input: Partial<CreateAiConciergeFaqInput>,
): Promise<AiConciergeFaq | null> {
  requireLineAccountId(lineAccountId);
  return db.prepare(
    `UPDATE ai_concierge_faqs SET
      question = COALESCE(?, question),
      answer = COALESCE(?, answer),
      sort_order = COALESCE(?, sort_order),
      active = COALESCE(?, active),
      updated_at = ?
     WHERE id = ? AND line_account_id = ?
     RETURNING *`,
  ).bind(
    input.question ?? null,
    input.answer ?? null,
    input.sortOrder ?? null,
    input.active === undefined ? null : input.active ? 1 : 0,
    jstNow(),
    id,
    lineAccountId,
  ).first<AiConciergeFaq>();
}

export async function deleteAiConciergeFaq(db: D1Database, lineAccountId: string, id: string): Promise<boolean> {
  requireLineAccountId(lineAccountId);
  const result = await db
    .prepare('DELETE FROM ai_concierge_faqs WHERE id = ? AND line_account_id = ?')
    .bind(id, lineAccountId)
    .run();
  return result.meta.changes > 0;
}

function boundMessages(messages: AiConciergeMessage[]): AiConciergeMessage[] {
  return messages.slice(-MAX_RECENT_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_LENGTH),
  }));
}

export async function upsertAiConciergeSession(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  input: UpsertAiConciergeSessionInput,
): Promise<void> {
  requireLineAccountId(lineAccountId);
  if (!friendId.trim()) throw new Error('Friend ID is required');
  const now = jstNow();
  await db.prepare(
    `INSERT INTO ai_concierge_sessions (
      id, line_account_id, friend_id, status, last_relevant_at,
      recent_messages_json, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(line_account_id, friend_id) DO UPDATE SET
      status = excluded.status,
      last_relevant_at = excluded.last_relevant_at,
      recent_messages_json = excluded.recent_messages_json,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(),
    lineAccountId,
    friendId,
    input.status,
    input.lastRelevantAt,
    JSON.stringify(boundMessages(input.recentMessages)),
    input.expiresAt,
    now,
    now,
  ).run();
}

export async function getActiveAiConciergeSession(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  now = jstNow(),
): Promise<AiConciergeSession | null> {
  requireLineAccountId(lineAccountId);
  return db.prepare(
    `SELECT * FROM ai_concierge_sessions
     WHERE line_account_id = ? AND friend_id = ?
       AND status = 'active' AND expires_at > ?`,
  ).bind(lineAccountId, friendId, now).first<AiConciergeSession>();
}

function assertSafeLogInput(input: CreateAiConciergeLogInput): void {
  for (const key of Object.keys(input as object)) {
    if (SENSITIVE_LOG_KEYS.has(key.toLowerCase())) {
      throw new Error(`Refusing sensitive AI concierge log field: ${key}`);
    }
  }
}

export async function insertAiConciergeLog(
  db: D1Database,
  lineAccountId: string,
  input: CreateAiConciergeLogInput,
): Promise<AiConciergeLog> {
  requireLineAccountId(lineAccountId);
  assertSafeLogInput(input);
  return (await db.prepare(
    `INSERT INTO ai_concierge_logs (
      id, line_account_id, friend_id, decision, decision_reasons_json,
      provider, model, input_tokens, output_tokens, latency_ms,
      fallback_count, status, error_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).bind(
    crypto.randomUUID(),
    lineAccountId,
    input.friendId ?? null,
    input.decision,
    JSON.stringify(input.decisionReasons ?? []),
    input.provider ?? null,
    input.model ?? null,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.latencyMs ?? null,
    input.fallbackCount ?? 0,
    input.status,
    input.errorCode ?? null,
    jstNow(),
  ).first<AiConciergeLog>())!;
}

export async function listAiConciergeLogs(
  db: D1Database,
  lineAccountId: string,
  limit = 100,
): Promise<AiConciergeLog[]> {
  requireLineAccountId(lineAccountId);
  return (await db.prepare(
    'SELECT * FROM ai_concierge_logs WHERE line_account_id = ? ORDER BY created_at DESC LIMIT ?',
  ).bind(lineAccountId, Math.max(1, Math.min(limit, 500))).all<AiConciergeLog>()).results;
}

export async function deleteAiConciergeLogsBefore(
  db: D1Database,
  lineAccountId: string,
  cutoff: string,
): Promise<void> {
  requireLineAccountId(lineAccountId);
  await db.prepare(
    'DELETE FROM ai_concierge_logs WHERE line_account_id = ? AND created_at < ?',
  ).bind(lineAccountId, cutoff).run();
}
