import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { createStaffMember, hashApiKey } from '@line-crm/db';
import { createTestD1 } from '@line-crm/db/testing';
import { staff } from './staff.js';
import type { Env } from '../index.js';

function appAs(role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'tester', name: 'Tester', role });
    await next();
  });
  app.route('/', staff);
  return app;
}

describe('staff routes with hashed keys', () => {
  test('list never exposes stored key', async () => {
    const { db } = createTestD1();
    const { apiKey } = await createStaffMember(db, { name: 'A', role: 'admin' });
    const res = await appAs('owner').request('/api/staff', undefined, { DB: db } as unknown as Env['Bindings']);
    const body = await res.json() as { data: { apiKey: string }[] };
    expect(res.status).toBe(200);
    expect(body.data[0].apiKey).toBe(`lh_****${apiKey.slice(-4)}`);
    const text = JSON.stringify(body);
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain('sha256:');
  });

  test('create returns plaintext key once', async () => {
    const { db, raw } = createTestD1();
    const res = await appAs('owner').request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New', role: 'staff' }),
    }, { DB: db } as unknown as Env['Bindings']);
    const body = await res.json() as { data: { id: string; apiKey: string } };
    expect(res.status).toBe(201);
    expect(body.data.apiKey).toMatch(/^lh_[0-9a-f]{32}$/);
    const row = raw.prepare('SELECT api_key FROM staff_members WHERE id = ?').get(body.data.id) as { api_key: string };
    expect(row.api_key).toBe(await hashApiKey(body.data.apiKey));
  });

  test('rehash-keys is owner only and rewrites plaintext rows', async () => {
    const { db, raw } = createTestD1();
    raw.prepare("INSERT INTO staff_members (id, name, role, api_key) VALUES ('p1', 'P1', 'staff', 'lh_plain1')").run();
    const env = { DB: db } as unknown as Env['Bindings'];
    expect((await appAs('admin').request('/api/staff/rehash-keys', { method: 'POST' }, env)).status).toBe(403);
    const res = await appAs('owner').request('/api/staff/rehash-keys', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { rehashed: 1 } });
  });
});
