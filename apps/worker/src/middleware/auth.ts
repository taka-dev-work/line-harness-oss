import type { Context, Next } from 'hono';
import { getStaffByApiKey, countActiveStaffByRole } from '@line-crm/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;

  if (!path.startsWith('/api/') && path !== '/webhook' && path !== '/openapi.json') {
    return next();
  }

  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    path.startsWith('/ai-crm/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    (c.req.method === 'POST' && path.match(/^\/api\/forms\/[^/]+\/submit$/)) ||
    (c.req.method === 'POST' && path.match(/^\/api\/forms\/[^/]+\/opened$/)) ||
    (c.req.method === 'POST' && path.match(/^\/api\/forms\/[^/]+\/partial$/)) ||
    (c.req.method === 'GET' && path.match(/^\/api\/forms\/[^/]+$/)) || // GET form definition (public for LIFF)
    path === '/api/booking/submit' ||
    path.match(/^\/api\/booking\/cancel\/[^/]+$/) ||
    path === '/api/diagnosis/submit' ||
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' // Public QR proxy — used by desktop landing pages
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check staff_members table first
  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    c.set('staff', { id: staff.id, name: staff.name, role: staff.role });
    return next();
  }

  // Env keys (API_KEY, LEGACY_API_KEY during rotation) are bootstrap-only: they act
  // as owner only while no active owner exists in staff_members. Once an owner is
  // created they stop working; deactivating every owner re-enables them (recovery).
  const envKeys = [c.env.API_KEY, c.env.LEGACY_API_KEY].filter(
    (key, index, all): key is string => Boolean(key) && all.indexOf(key) === index,
  );
  for (const envKey of envKeys) {
    if (await secureEquals(token, envKey)) {
      if ((await countActiveStaffByRole(c.env.DB, 'owner')) > 0) break;
      c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
      if (envKey !== c.env.API_KEY) console.log('[auth] accept_via=LEGACY_API_KEY');
      return next();
    }
  }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}

/**
 * Constant-time string comparison: hashes both values to fixed-length digests and
 * compares every byte, so timing does not reveal where the inputs differ.
 */
export async function secureEquals(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
