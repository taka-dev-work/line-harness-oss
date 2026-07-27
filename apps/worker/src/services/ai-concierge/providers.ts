import type {
  AiProvider,
  AiProviderName,
  AiResult,
  ConciergePrompt,
} from './types.js';

export type ProviderErrorCode =
  | 'unavailable'
  | 'timeout'
  | 'authentication'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_response'
  | 'request_failed';

export class ProviderError extends Error {
  readonly name = 'ProviderError';

  constructor(
    readonly provider: AiProviderName,
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
  ) {
    super(`${provider} provider failed: ${code}`);
  }
}

interface ProviderConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface ProviderRuntime {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fetch: typeof fetch;
}

function runtime(config: ProviderConfig, defaultModel: string): ProviderRuntime {
  return {
    apiKey: config.apiKey?.trim() || undefined,
    model: config.model?.trim() || defaultModel,
    timeoutMs: Math.max(1, config.timeoutMs ?? 15_000),
    fetch: config.fetch ?? fetch,
  };
}

function errorForStatus(provider: AiProviderName, status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError(provider, 'authentication', true);
  if (status === 429) return new ProviderError(provider, 'rate_limited', true);
  if (status >= 500) return new ProviderError(provider, 'server_error', true);
  return new ProviderError(provider, 'request_failed', false);
}

async function requestJson(
  provider: AiProviderName,
  config: ProviderRuntime,
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  if (!config.apiKey) throw new ProviderError(provider, 'unavailable', true);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await config.fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw errorForStatus(provider, response.status);
    try {
      return await response.json();
    } catch {
      throw new ProviderError(provider, 'invalid_response', true);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (timedOut) throw new ProviderError(provider, 'timeout', true);
    throw new ProviderError(provider, 'request_failed', true);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abort);
  }
}

function requiredText(provider: AiProviderName, text: string | undefined): string {
  const normalized = text?.trim();
  if (!normalized) throw new ProviderError(provider, 'invalid_response', true);
  return normalized;
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly config: ProviderRuntime;

  constructor(config: ProviderConfig = {}) {
    this.config = runtime(config, 'gpt-5-mini');
  }

  get available(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generate(prompt: ConciergePrompt, signal?: AbortSignal): Promise<AiResult> {
    // Responses API text is returned in output[].content[] blocks; usage uses input_tokens/output_tokens.
    const json = await requestJson(this.name, this.config, 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        instructions: prompt.system,
        input: prompt.messages,
      }),
    }, signal) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = json.output_text ?? json.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text ?? '')
      .join('');
    return {
      text: requiredText(this.name, text),
      provider: this.name,
      model: this.config.model,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    };
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly config: ProviderRuntime;

  constructor(config: ProviderConfig = {}) {
    this.config = runtime(config, 'claude-sonnet-5');
  }

  get available(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generate(prompt: ConciergePrompt, signal?: AbortSignal): Promise<AiResult> {
    // Messages API uses top-level system text and content[] text blocks.
    const json = await requestJson(this.name, this.config, 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 800,
        system: prompt.system,
        messages: prompt.messages,
      }),
    }, signal) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = json.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('');
    return {
      text: requiredText(this.name, text),
      provider: this.name,
      model: this.config.model,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    };
  }
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly config: ProviderRuntime;

  constructor(config: ProviderConfig = {}) {
    this.config = runtime(config, 'gemini-3.6-flash');
  }

  get available(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generate(prompt: ConciergePrompt, signal?: AbortSignal): Promise<AiResult> {
    // generateContent returns candidates[].content.parts[] and usageMetadata token counts.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`;
    const json = await requestJson(this.name, this.config, url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey ?? '',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: prompt.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: { maxOutputTokens: 800 },
      }),
    }, signal) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('');
    return {
      text: requiredText(this.name, text),
      provider: this.name,
      model: this.config.model,
      inputTokens: json.usageMetadata?.promptTokenCount,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
    };
  }
}
