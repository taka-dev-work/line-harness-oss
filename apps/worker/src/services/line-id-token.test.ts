import { describe, expect, test, vi } from 'vitest';
import { verifyLineIdToken } from './line-id-token.js';

describe('verifyLineIdToken', () => {
  test('verifies the token with LINE using the configured Login channel ID', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sub: 'U-verified' }), { status: 200 }));

    await expect(verifyLineIdToken('id-token', 'login-channel-id', fetchMock)).resolves.toBe('U-verified');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/oauth2/v2.1/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: 'id-token', client_id: 'login-channel-id' }),
      }),
    );
  });

  test('returns null when LINE rejects the token or does not return a subject', async () => {
    const rejectedFetch = vi.fn(async () => new Response('', { status: 401 }));
    const missingSubjectFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));

    await expect(verifyLineIdToken('bad-token', 'login-channel-id', rejectedFetch)).resolves.toBeNull();
    await expect(verifyLineIdToken('id-token', 'login-channel-id', missingSubjectFetch)).resolves.toBeNull();
  });
});
