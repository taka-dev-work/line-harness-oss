// Post-deploy smoke checks: public route is up, admin routes refuse anonymous
// access, unsigned Stripe webhooks are rejected. Redirects are never followed,
// so a login-page redirect cannot masquerade as success.

const CHECKS = [
  { name: 'openapi', method: 'GET', path: '/openapi.json', pass: (s) => s === 200 },
  { name: 'forms-put-requires-auth', method: 'PUT', path: '/api/forms/smoke-nonexistent-00000000', body: '{}', pass: (s) => s === 401 },
  { name: 'staff-list-requires-auth', method: 'GET', path: '/api/staff', pass: (s) => s === 401 },
  { name: 'stripe-webhook-rejects-unsigned', method: 'POST', path: '/api/integrations/stripe/webhook', body: '{}', pass: (s) => s === 400 || s === 503 },
];

/**
 * @param {string} baseUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ name: string, ok: boolean, status: number }[]>}
 */
export async function runSmokeChecks(baseUrl, fetchImpl = fetch) {
  const base = baseUrl.replace(/\/+$/, '');
  const results = [];
  for (const check of CHECKS) {
    let status = 0;
    try {
      const init = { method: check.method, redirect: 'manual' };
      if (check.body !== undefined) {
        init.body = check.body;
        init.headers = { 'Content-Type': 'application/json' };
      }
      ({ status } = await fetchImpl(`${base}${check.path}`, init));
    } catch {
      status = 0;
    }
    results.push({ name: check.name, ok: status !== 0 && check.pass(status), status });
  }
  return results;
}
