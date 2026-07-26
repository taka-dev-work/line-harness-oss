import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import type { Env } from '../index.js';

describe('form route authentication boundaries', () => {
  function setupApp() {
    const app = new Hono<Env>();
    app.use('*', authMiddleware);
    app.get('/api/forms/:id', (c) => c.text('public form'));
    app.post('/api/forms/:id/submit', (c) => c.text('public submit'));
    app.post('/api/forms/:id/partial', (c) => c.text('public partial'));
    app.post('/api/forms/:id/opened', (c) => c.text('public opened'));
    app.put('/api/forms/:id', (c) => c.text('protected update'));
    app.delete('/api/forms/:id', (c) => c.text('protected delete'));
    return app;
  }

  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
      }),
    },
    API_KEY: 'unused',
  } as unknown as Env['Bindings'];

  test('keeps form definition and submission actions public', async () => {
    const app = setupApp();

    const requests: Array<[string, RequestInit | undefined]> = [
      ['/api/forms/form-1', undefined],
      ['/api/forms/form-1/submit', { method: 'POST' }],
      ['/api/forms/form-1/partial', { method: 'POST' }],
      ['/api/forms/form-1/opened', { method: 'POST' }],
    ];

    for (const [path, init] of requests) {
      const response = await app.request(path, init, env);
      expect(response.status).toBe(200);
    }
  });

  test('requires authentication for form updates', async () => {
    const app = setupApp();

    const updateResponse = await app.request('/api/forms/form-1', { method: 'PUT' }, env);

    expect(updateResponse.status).toBe(401);
  });

  test('requires authentication for form deletes', async () => {
    const app = setupApp();

    const deleteResponse = await app.request('/api/forms/form-1', { method: 'DELETE' }, env);

    expect(deleteResponse.status).toBe(401);
  });
});
