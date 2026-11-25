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

describe('env API key is bootstrap-only', async () => {
  const { createTestD1 } = await import('@line-crm/db/testing');
  const { createStaffMember } = await import('@line-crm/db');
  const { secureEquals } = await import('./auth.js');

  function protectedApp() {
    const app = new Hono<Env>();
    app.use('*', authMiddleware);
    app.get('/api/tags', (c) => c.json({ who: c.get('staff').id }));
    return app;
  }
  const bearer = (key: string) => ({ headers: { Authorization: `Bearer ${key}` } });

  test('env API_KEY works when no active owner exists', async () => {
    const { db } = createTestD1();
    const res = await protectedApp().request('/api/tags', bearer('env-secret'), { DB: db, API_KEY: 'env-secret' } as unknown as Env['Bindings']);
    expect(res.status).toBe(200);
  });

  test('env API_KEY is rejected once an active owner exists', async () => {
    const { db } = createTestD1();
    await createStaffMember(db, { name: 'Owner', role: 'owner' });
    const res = await protectedApp().request('/api/tags', bearer('env-secret'), { DB: db, API_KEY: 'env-secret' } as unknown as Env['Bindings']);
    expect(res.status).toBe(401);
  });

  test('env API_KEY works again after every owner is deactivated', async () => {
    const { db, raw } = createTestD1();
    const { member } = await createStaffMember(db, { name: 'Owner', role: 'owner' });
    raw.prepare('UPDATE staff_members SET is_active = 0 WHERE id = ?').run(member.id);
    const res = await protectedApp().request('/api/tags', bearer('env-secret'), { DB: db, API_KEY: 'env-secret' } as unknown as Env['Bindings']);
    expect(res.status).toBe(200);
  });

  test('LEGACY_API_KEY follows the same rule', async () => {
    const { db } = createTestD1();
    const env = { DB: db, API_KEY: 'env-secret', LEGACY_API_KEY: 'old-secret' } as unknown as Env['Bindings'];
    expect((await protectedApp().request('/api/tags', bearer('old-secret'), env)).status).toBe(200);
    await createStaffMember(db, { name: 'Owner', role: 'owner' });
    expect((await protectedApp().request('/api/tags', bearer('old-secret'), env)).status).toBe(401);
  });

  test('staff keys keep working when an owner exists', async () => {
    const { db } = createTestD1();
    const { member, apiKey } = await createStaffMember(db, { name: 'Owner', role: 'owner' });
    const res = await protectedApp().request('/api/tags', bearer(apiKey), { DB: db, API_KEY: 'env-secret' } as unknown as Env['Bindings']);
    expect(await res.json()).toEqual({ who: member.id });
  });

  test('secureEquals compares exactly', async () => {
    expect(await secureEquals('abc', 'abc')).toBe(true);
    expect(await secureEquals('abc', 'abd')).toBe(false);
    expect(await secureEquals('abc', 'abcd')).toBe(false);
    expect(await secureEquals('', 'x')).toBe(false);
  });
});
