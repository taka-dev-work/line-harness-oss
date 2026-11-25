import { jstNow } from './utils.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  /** `sha256:<hex>` of the key (legacy rows may still hold plaintext until first use). */
  api_key: string;
  /** Last 4 characters of the key, for display only. */
  api_key_hint: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStaffInput {
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff';
}

export interface UpdateStaffInput {
  name?: string;
  email?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  is_active?: number;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `lh_${hex}`;
}

const HASH_PREFIX = 'sha256:';

/** SHA-256 of an API key as `sha256:<64 hex>`. Keys are 128-bit random, so no salt is needed. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${HASH_PREFIX}${hex}`;
}

/** Last four characters of a key, safe to display. */
export function apiKeyHint(key: string): string {
  return key.slice(-4);
}

async function storeHashedKey(db: D1Database, id: string, key: string): Promise<number> {
  const result = await db
    .prepare('UPDATE staff_members SET api_key = ?, api_key_hint = ?, updated_at = ? WHERE id = ?')
    .bind(await hashApiKey(key), apiKeyHint(key), jstNow(), id)
    .run();
  return result.meta.changes;
}

export async function getStaffByApiKey(
  db: D1Database,
  apiKey: string,
): Promise<StaffMember | null> {
  const hashed = await db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(await hashApiKey(apiKey))
    .first<StaffMember>();
  if (hashed) return hashed;

  // Legacy plaintext row (created before hashing): accept once, then store the hash.
  // A stored hash must never work as a key, so values with the hash prefix are skipped.
  if (apiKey.startsWith(HASH_PREFIX)) return null;
  const legacy = await db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey)
    .first<StaffMember>();
  if (!legacy) return null;
  await storeHashedKey(db, legacy.id, apiKey);
  return { ...legacy, api_key: await hashApiKey(apiKey), api_key_hint: apiKeyHint(apiKey) };
}

/** Rewrites every remaining plaintext key to its hash. Returns the number of rows rewritten. */
export async function rehashPlaintextStaffKeys(db: D1Database): Promise<number> {
  const rows = await db
    .prepare("SELECT id, api_key FROM staff_members WHERE api_key NOT LIKE 'sha256:%'")
    .all<{ id: string; api_key: string }>();
  let count = 0;
  for (const row of rows.results) count += await storeHashedKey(db, row.id, row.api_key);
  return count;
}

export async function getStaffMembers(db: D1Database): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at ASC')
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>();
}

export async function createStaffMember(
  db: D1Database,
  input: CreateStaffInput,
): Promise<{ member: StaffMember; apiKey: string }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();

  await db
    .prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, api_key_hint, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.name, input.email ?? null, input.role, await hashApiKey(apiKey), apiKeyHint(apiKey), now, now)
    .run();

  const member = (await db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>())!;
  return { member, apiKey };
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { sets.push('email = ?'); values.push(input.email ?? null); }
  if (input.role !== undefined) { sets.push('role = ?'); values.push(input.role); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function regenerateStaffApiKey(db: D1Database, id: string): Promise<string> {
  const newKey = generateApiKey();
  if ((await storeHashedKey(db, id, newKey)) === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return newKey;
}

export async function countStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ?')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countActiveStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ? AND is_active = 1')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}
