import { describe, expect, test, vi } from 'vitest';
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

describe('Cloudflare Access enforcement', async () => {
  const { createTestD1 } = await import('@line-crm/db/testing');
  const { createStaffMember } = await import('@line-crm/db');
  const accessJwt = await import('./access-jwt.js');

  function appWith() {
    const app = new Hono<Env>();
    app.use('*', authMiddleware);
    app.get('/api/tags', (c) => c.json({ who: c.get('staff').id, email: c.get('accessEmail') ?? null }));
    app.get('/api/forms/:id', (c) => c.text('public form'));
    return app;
  }

  async function staffEnv(extra: Record<string, string> = {}) {
    const { db } = createTestD1();
    const { apiKey } = await createStaffMember(db, { name: 'Owner', role: 'owner' });
    return { apiKey, env: { DB: db, API_KEY: 'env-secret', ...extra } as unknown as Env['Bindings'] };
  }
  const ACCESS = { ACCESS_TEAM_DOMAIN: 'nibel-acme.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64) };

  test('403 without Cf-Access-Jwt-Assertion when Access configured', async () => {
    const { apiKey, env } = await staffEnv(ACCESS);
    const res = await appWith().request('/api/tags', { headers: { Authorization: `Bearer ${apiKey}` } }, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Access verification required' });
  });

  test('403 with an invalid assertion', async () => {
    const { apiKey, env } = await staffEnv(ACCESS);
    const spy = vi.spyOn(accessJwt, 'verifyAccessJwt').mockResolvedValue(null);
    const res = await appWith().request('/api/tags', {
      headers: { Authorization: `Bearer ${apiKey}`, 'Cf-Access-Jwt-Assertion': 'x.y.z' },
    }, env);
    expect(res.status).toBe(403);
    spy.mockRestore();
  });

  test('passes with a valid assertion and exposes the Access email', async () => {
    const { apiKey, env } = await staffEnv(ACCESS);
    const spy = vi.spyOn(accessJwt, 'verifyAccessJwt').mockResolvedValue({ email: 'staff@acme.example' });
    const res = await appWith().request('/api/tags', {
      headers: { Authorization: `Bearer ${apiKey}`, 'Cf-Access-Jwt-Assertion': 'x.y.z' },
    }, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { email: string }).email).toBe('staff@acme.example');
    expect(spy).toHaveBeenCalledWith('x.y.z', { teamDomain: ACCESS.ACCESS_TEAM_DOMAIN, aud: ACCESS.ACCESS_AUD });
    spy.mockRestore();
  });

  test('a valid assertion never replaces the API key', async () => {
    const { env } = await staffEnv(ACCESS);
    const spy = vi.spyOn(accessJwt, 'verifyAccessJwt').mockResolvedValue({ email: 'staff@acme.example' });
    const res = await appWith().request('/api/tags', { headers: { 'Cf-Access-Jwt-Assertion': 'x.y.z' } }, env);
    expect(res.status).toBe(401);
    spy.mockRestore();
  });

  test('public paths stay public when Access configured', async () => {
    const { env } = await staffEnv(ACCESS);
    const res = await appWith().request('/api/forms/f1', undefined, env);
    expect(res.status).toBe(200);
  });

  test.each([
    ['only ACCESS_AUD set', { ACCESS_AUD: 'a'.repeat(64) }],
    ['only ACCESS_TEAM_DOMAIN set', { ACCESS_TEAM_DOMAIN: 'nibel-acme.cloudflareaccess.com' }],
  ])('500 when %s', async (_name, extra) => {
    const { apiKey, env } = await staffEnv(extra);
    const res = await appWith().request('/api/tags', { headers: { Authorization: `Bearer ${apiKey}` } }, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Access misconfigured' });
  });

  test('unchanged when Access not configured', async () => {
    const { apiKey, env } = await staffEnv();
    const res = await appWith().request('/api/tags', { headers: { Authorization: `Bearer ${apiKey}` } }, env);
    expect(res.status).toBe(200);
  });
});
