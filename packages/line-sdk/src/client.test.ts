import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineClient } from './client.js';

const RETRY_KEY = '01234567-89ab-cdef-0123-456789abcdef';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LineClient retry keys', () => {
  it('sends a hexadecimal UUID retry key on the first push attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new LineClient('token');
    await client.pushMessage('U-account-a', [{ type: 'text', text: 'hello' }], RETRY_KEY);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-Line-Retry-Key')).toBe(RETRY_KEY);
  });

  it('sends the retry key with multicast requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new LineClient('token');
    await client.multicast(
      ['U-account-a'],
      [{ type: 'text', text: 'hello' }],
      ['broadcast-unit'],
      RETRY_KEY,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-Line-Retry-Key')).toBe(RETRY_KEY);
  });

  it('rejects a non-UUID retry key before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new LineClient('token');
    await expect(
      client.pushMessage('U-account-a', [{ type: 'text', text: 'hello' }], 'not-a-uuid'),
    ).rejects.toThrow('hexadecimal UUID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a 409 retry response as accepted when the retry key was sent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'The retry key has already been accepted' }),
        {
          status: 409,
          headers: {
            'content-type': 'application/json',
            'x-line-accepted-request-id': 'accepted-request-id',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new LineClient('token');
    await expect(
      client.pushMessage('U-account-a', [{ type: 'text', text: 'hello' }], RETRY_KEY),
    ).resolves.toEqual({
      acceptedRequestId: 'accepted-request-id',
      retryAccepted: true,
    });
  });

  it('throws an unrelated retry-key 409 without an accepted request id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'conflict-secret' }), {
          status: 409,
          statusText: 'Conflict',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const client = new LineClient('token');
    const error = await client
      .pushMessage('U-account-a', [{ type: 'text', text: 'hello' }], RETRY_KEY)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 409, retryable: false });
    expect(String(error)).not.toContain('conflict-secret');
  });

  it.each([
    { status: 400, retryable: false },
    { status: 429, retryable: true },
    { status: 503, retryable: true },
  ])(
    'classifies LINE $status without leaking the response body',
    async ({ status, retryable }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('channel-access-token=secret', {
            status,
            statusText: 'Request failed',
          }),
        ),
      );

      const client = new LineClient('token');
      const error = await client
        .pushMessage('U-account-a', [{ type: 'text', text: 'hello' }], RETRY_KEY)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ status, retryable });
      expect(String(error)).not.toContain('channel-access-token');
      expect(String(error)).not.toContain('secret');
    },
  );
});
