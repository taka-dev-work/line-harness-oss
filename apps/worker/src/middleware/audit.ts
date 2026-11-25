import type { Context, MiddlewareHandler } from 'hono';
import { insertAuditLog, toJstString } from '@line-crm/db';
import type { AuditLogEntry } from '@line-crm/db';
import type { Env } from '../index.js';

/** Audit rows older than this are deleted by the scheduled job. */
export const AUDIT_RETENTION_DAYS = 365;

export function auditRetentionCutoff(now: Date): string {
  return toJstString(new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60_000));
}

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AuditDeps {
  insert?: (entry: AuditLogEntry, c: Context<Env>) => Promise<void>;
}

/**
 * Records authenticated changes after the handler runs. Only who / when / method /
 * path (no query string) / status / IP / Access email are kept: never bodies,
 * query strings or headers. A failed insert is logged and never alters the response.
 */
export function auditMiddleware(deps: AuditDeps = {}): MiddlewareHandler<Env> {
  const insert = deps.insert ?? ((entry, c) => insertAuditLog(c.env.DB, entry));
  return async (c, next) => {
    await next();
    const staff = c.get('staff');
    if (!staff || !AUDITED_METHODS.has(c.req.method)) return;

    const entry: AuditLogEntry = {
      staffId: staff.id,
      staffName: staff.name,
      role: staff.role,
      accessEmail: c.get('accessEmail') ?? null,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      ip: c.req.header('CF-Connecting-IP') ?? null,
    };
    const task = insert(entry, c).catch(() => {
      console.error('[audit] insert failed');
    });
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      await task; // no execution context (tests, local tooling)
    }
  };
}
