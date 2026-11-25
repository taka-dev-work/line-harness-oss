import { describe, expect, test } from 'vitest';
import { createTestD1 } from './test-d1.js';
import {
  apiKeyHint,
  createStaffMember,
  getStaffByApiKey,
  hashApiKey,
  regenerateStaffApiKey,
  rehashPlaintextStaffKeys,
} from './staff.js';

type Row = { api_key: string; api_key_hint: string | null };

describe('staff api key hashing', () => {
  test('hashApiKey is sha256 hex with prefix', async () => {
    const a = await hashApiKey('lh_abc');
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await hashApiKey('lh_abc')).toBe(a);
    expect(await hashApiKey('lh_abd')).not.toBe(a);
  });

  test('apiKeyHint is the last four characters', () => {
    expect(apiKeyHint('lh_0123456789abcdef')).toBe('cdef');
  });

  test('createStaffMember stores hash and hint, returns plaintext once', async () => {
    const { db, raw } = createTestD1();
    const { member, apiKey } = await createStaffMember(db, { name: 'A', role: 'owner' });
    expect(apiKey).toMatch(/^lh_[0-9a-f]{32}$/);
    const row = raw.prepare('SELECT api_key, api_key_hint FROM staff_members WHERE id = ?').get(member.id) as Row;
    expect(row.api_key).toBe(await hashApiKey(apiKey));
    expect(row.api_key_hint).toBe(apiKey.slice(-4));
    expect(JSON.stringify(member)).not.toContain(apiKey);
  });

  test('getStaffByApiKey finds by hash', async () => {
    const { db } = createTestD1();
    const { member, apiKey } = await createStaffMember(db, { name: 'A', role: 'staff' });
    expect((await getStaffByApiKey(db, apiKey))?.id).toBe(member.id);
    expect(await getStaffByApiKey(db, 'lh_wrong')).toBeNull();
  });

  test('getStaffByApiKey ignores inactive staff', async () => {
    const { db, raw } = createTestD1();
    const { member, apiKey } = await createStaffMember(db, { name: 'A', role: 'staff' });
    raw.prepare('UPDATE staff_members SET is_active = 0 WHERE id = ?').run(member.id);
    expect(await getStaffByApiKey(db, apiKey)).toBeNull();
  });

  test('getStaffByApiKey upgrades legacy plaintext row', async () => {
    const { db, raw } = createTestD1();
    raw.prepare("INSERT INTO staff_members (id, name, role, api_key) VALUES ('s1', 'Legacy', 'admin', 'lh_legacyplain0000000000000000001')").run();
    const found = await getStaffByApiKey(db, 'lh_legacyplain0000000000000000001');
    expect(found?.id).toBe('s1');
    const row = raw.prepare("SELECT api_key, api_key_hint FROM staff_members WHERE id = 's1'").get() as Row;
    expect(row.api_key).toBe(await hashApiKey('lh_legacyplain0000000000000000001'));
    expect(row.api_key_hint).toBe('0001');
    expect((await getStaffByApiKey(db, 'lh_legacyplain0000000000000000001'))?.id).toBe('s1');
  });

  test('a stored hash cannot be used as a key', async () => {
    const { db, raw } = createTestD1();
    const { member } = await createStaffMember(db, { name: 'A', role: 'owner' });
    const stored = (raw.prepare('SELECT api_key FROM staff_members WHERE id = ?').get(member.id) as Row).api_key;
    expect(await getStaffByApiKey(db, stored)).toBeNull();
  });

  test('regenerateStaffApiKey stores hash and invalidates old key', async () => {
    const { db, raw } = createTestD1();
    const { member, apiKey } = await createStaffMember(db, { name: 'A', role: 'owner' });
    const next = await regenerateStaffApiKey(db, member.id);
    const row = raw.prepare('SELECT api_key, api_key_hint FROM staff_members WHERE id = ?').get(member.id) as Row;
    expect(row.api_key).toBe(await hashApiKey(next));
    expect(row.api_key_hint).toBe(next.slice(-4));
    expect(await getStaffByApiKey(db, apiKey)).toBeNull();
  });

  test('rehashPlaintextStaffKeys rewrites only plaintext rows', async () => {
    const { db, raw } = createTestD1();
    await createStaffMember(db, { name: 'Hashed', role: 'owner' });
    raw.prepare("INSERT INTO staff_members (id, name, role, api_key) VALUES ('p1', 'P1', 'staff', 'lh_plain1'), ('p2', 'P2', 'staff', 'lh_plain2')").run();
    expect(await rehashPlaintextStaffKeys(db)).toBe(2);
    const rows = raw.prepare('SELECT api_key FROM staff_members').all() as Row[];
    expect(rows.every((r) => r.api_key.startsWith('sha256:'))).toBe(true);
    expect(await rehashPlaintextStaffKeys(db)).toBe(0);
    expect((await getStaffByApiKey(db, 'lh_plain2'))?.id).toBe('p2');
  });
});
