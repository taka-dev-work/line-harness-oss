import { describe, expect, test } from 'vitest';
import { createTestD1 } from './test-d1.js';
import { deleteAuditLogsBefore, insertAuditLog } from './audit-logs.js';

const entry = {
  staffId: 's1', staffName: 'A', role: 'owner', accessEmail: 'a@example.com',
  method: 'PUT', path: '/api/tags/1', status: 200, ip: '203.0.113.1',
};

describe('audit logs', () => {
  test('insertAuditLog stores every field', async () => {
    const { db, raw } = createTestD1();
    await insertAuditLog(db, entry);
    const row = raw.prepare('SELECT * FROM audit_logs').get() as Record<string, unknown>;
    expect(row).toMatchObject({
      staff_id: 's1', staff_name: 'A', role: 'owner', access_email: 'a@example.com',
      method: 'PUT', path: '/api/tags/1', status: 200, ip: '203.0.113.1',
    });
    expect(row.id).toBeTruthy();
    expect(row.created_at).toBeTruthy();
  });

  test('deleteAuditLogsBefore removes only older rows', async () => {
    const { db, raw } = createTestD1();
    raw.prepare(`INSERT INTO audit_logs (id, staff_id, staff_name, role, method, path, status, created_at)
      VALUES ('old', 's', 'n', 'owner', 'PUT', '/x', 200, '2025-01-01T00:00:00.000'),
             ('new', 's', 'n', 'owner', 'PUT', '/x', 200, '2026-11-01T00:00:00.000')`).run();
    expect(await deleteAuditLogsBefore(db, '2026-01-01T00:00:00.000')).toBe(1);
    expect((raw.prepare('SELECT id FROM audit_logs').all() as { id: string }[]).map((r) => r.id)).toEqual(['new']);
  });
});
