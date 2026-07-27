import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  AnthropicProvider,
  GeminiProvider,
  OpenAiProvider,
  ProviderError,
} from './providers.js';
import type { AiProvider, ConciergePrompt } from './types.js';

const prompt: ConciergePrompt = {
  system: '登録情報だけで回答してください。',
  messages: [
    { role: 'user', content: '料金を教えて' },
    { role: 'assistant', content: 'どのプランですか？' },
    { role: 'user', content: '基本プランです' },
  ],
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
});

async function expectProviderError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'ProviderError', code });
}

describe('OpenAI provider', () => {
  test('uses Responses API and extracts text and usage', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: 'OpenAI回答' }] }],
      usage: { input_tokens: 12, output_tokens: 7 },
    })));
    const provider = new OpenAiProvider({ apiKey: 'openai-secret', model: 'gpt-test', fetch: fetchMock });

    await expect(provider.generate(prompt)).resolves.toEqual({
      text: 'OpenAI回答',
      provider: 'openai',
      model: 'gpt-test',
      inputTokens: 12,
      outputTokens: 7,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer openai-secret' }),
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      model: 'gpt-test',
      instructions: prompt.system,
      input: prompt.messages,
    });
  });
});

describe('Anthropic provider', () => {
  test('uses Messages API and extracts text and usage', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Claude回答' }],
      usage: { input_tokens: 11, output_tokens: 6 },
    })));
    const provider = new AnthropicProvider({ apiKey: 'claude-secret', model: 'claude-test', fetch: fetchMock });

    await expect(provider.generate(prompt)).resolves.toMatchObject({
      text: 'Claude回答',
      provider: 'anthropic',
      inputTokens: 11,
      outputTokens: 6,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({
        'x-api-key': 'claude-secret',
        'anthropic-version': '2023-06-01',
      }),
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      model: 'claude-test',
      system: prompt.system,
      messages: prompt.messages,
    });
  });
});

describe('Gemini provider', () => {
  test('uses generateContent and extracts text and usage', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Gemini' }, { text: '回答' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    })));
    const provider = new GeminiProvider({ apiKey: 'gemini-secret', model: 'gemini-test', fetch: fetchMock });

    await expect(provider.generate(prompt)).resolves.toMatchObject({
      text: 'Gemini回答',
      provider: 'gemini',
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(expect.objectContaining({
      'x-goog-api-key': 'gemini-secret',
    }));
  });
});

describe.each([
  ['openai', (key?: string) => new OpenAiProvider({ apiKey: key, fetch: fetchMock })],
  ['anthropic', (key?: string) => new AnthropicProvider({ apiKey: key, fetch: fetchMock })],
  ['gemini', (key?: string) => new GeminiProvider({ apiKey: key, fetch: fetchMock })],
] as const)('%s provider errors', (_name, create) => {
  test('missing key is unavailable without fetch', async () => {
    await expectProviderError(create().generate(prompt), 'unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    [429, 'rate_limited'],
    [503, 'server_error'],
  ])('maps HTTP %s to %s without exposing the key', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('provider failure', { status }));
    const provider = create('do-not-leak');

    try {
      await provider.generate(prompt);
      throw new Error('Expected provider error');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain('do-not-leak');
    }
  });
});

test('invalid JSON shape and empty text are typed errors', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{invalid'));
  await expectProviderError(
    new OpenAiProvider({ apiKey: 'key', fetch: fetchMock }).generate(prompt),
    'invalid_response',
  );

  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ content: [] })));
  await expectProviderError(
    new AnthropicProvider({ apiKey: 'key', fetch: fetchMock }).generate(prompt),
    'invalid_response',
  );
});

test('timeout becomes a typed retryable error', async () => {
  fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const provider: AiProvider = new GeminiProvider({ apiKey: 'key', fetch: fetchMock, timeoutMs: 5 });

  await expectProviderError(provider.generate(prompt), 'timeout');
});
