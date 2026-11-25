import { jstNow } from './utils.js';

/** One authenticated change. Never include request bodies, query strings or headers. */
export interface AuditLogEntry {
  staffId: string;
  staffName: string;
  role: string;
  accessEmail: string | null;
  method: string;
  path: string;
  status: number;
  ip: string | null;
}

export async function insertAuditLog(db: D1Database, entry: AuditLogEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, staff_id, staff_name, role, access_email, method, path, status, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), entry.staffId, entry.staffName, entry.role, entry.accessEmail,
      entry.method, entry.path, entry.status, entry.ip, jstNow(),
    )
    .run();
}

/** Deletes audit rows created before the given JST timestamp. Returns rows deleted. */
export async function deleteAuditLogsBefore(db: D1Database, isoTimestamp: string): Promise<number> {
  const result = await db.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(isoTimestamp).run();
  return result.meta.changes;
}
