import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { auditMiddleware, auditRetentionCutoff } from './audit.js';
import type { AuditLogEntry } from '@line-crm/db';
import type { Env } from '../index.js';

type Entry = AuditLogEntry;

function setup(opts: { authenticated?: boolean; insert?: (e: Entry) => Promise<void> } = {}) {
  const entries: Entry[] = [];
  const insert = opts.insert ?? (async (e: Entry) => { entries.push(e); });
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (opts.authenticated !== false) c.set('staff', { id: 's1', name: 'Alice', role: 'admin' });
    await next();
  });
  app.use('*', auditMiddleware({ insert }));
  app.all('/api/tags/:id', (c) => c.json({ ok: true }));
  return { app, entries };
}

const SECRET = 'Bearer lh_supersecretkey000000000000000';
const BODY = '{"name":"顧客の個人情報"}';

describe('audit middleware', () => {
  test('records authenticated PUT with path and status, no query string', async () => {
    const { app, entries } = setup();
    const res = await app.request('/api/tags/1?token=x', {
      method: 'PUT', body: BODY,
      headers: { Authorization: SECRET, 'CF-Connecting-IP': '203.0.113.9' },
    });
    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      staffId: 's1', staffName: 'Alice', role: 'admin', accessEmail: null,
      method: 'PUT', path: '/api/tags/1', status: 200, ip: '203.0.113.9',
    });
  });

  test('skips GET', async () => {
    const { app, entries } = setup();
    await app.request('/api/tags/1');
    expect(entries).toHaveLength(0);
  });

  test('skips unauthenticated requests', async () => {
    const { app, entries } = setup({ authenticated: false });
    await app.request('/api/tags/1', { method: 'POST' });
    expect(entries).toHaveLength(0);
  });

  test('insert failure does not change the response', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = setup({ insert: async () => { throw new Error('db down'); } });
    const res = await app.request('/api/tags/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(errors).toHaveBeenCalledWith('[audit] insert failed');
    errors.mockRestore();
  });

  test('never stores Authorization or body', async () => {
    const { app, entries } = setup();
    await app.request('/api/tags/1', { method: 'PATCH', body: BODY, headers: { Authorization: SECRET } });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('supersecretkey');
    expect(serialized).not.toContain('個人情報');
    expect(Object.keys(entries[0]).sort()).toEqual(
      ['accessEmail', 'ip', 'method', 'path', 'role', 'staffId', 'staffName', 'status'],
    );
  });
});

describe('audit retention', () => {
  test('cutoff is 365 days before now, in JST', () => {
    expect(auditRetentionCutoff(new Date('2026-11-26T00:00:00Z'))).toBe('2025-11-26T09:00:00.000+09:00');
  });
});
