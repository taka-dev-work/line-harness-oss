import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmokeChecks } from './lib/smoke.mjs';

function stubFetch(responses, seen = []) {
  return async (url, init) => {
    const { pathname } = new URL(url);
    const key = `${init?.method ?? 'GET'} ${pathname}`;
    seen.push({ key, url, init });
    if (!(key in responses)) throw new Error(`unexpected request ${key}`);
    return { status: responses[key] };
  };
}

const HARDENED = {
  'GET /openapi.json': 200,
  'PUT /api/forms/smoke-nonexistent-00000000': 401,
  'GET /api/staff': 401,
  'POST /api/integrations/stripe/webhook': 503,
};

test('all pass on a hardened server', async () => {
  const results = await runSmokeChecks('https://line.acme.example', stubFetch(HARDENED));
  assert.deepEqual(results.map((r) => r.name), ['openapi', 'forms-put-requires-auth', 'staff-list-requires-auth', 'stripe-webhook-rejects-unsigned']);
  assert.ok(results.every((r) => r.ok));
});

test('accepts 400 from stripe webhook', async () => {
  const results = await runSmokeChecks('https://line.acme.example', stubFetch({ ...HARDENED, 'POST /api/integrations/stripe/webhook': 400 }));
  assert.ok(results.find((r) => r.name === 'stripe-webhook-rejects-unsigned').ok);
});

test('flags unauthenticated form update', async () => {
  const results = await runSmokeChecks('https://line.acme.example', stubFetch({ ...HARDENED, 'PUT /api/forms/smoke-nonexistent-00000000': 404 }));
  const check = results.find((r) => r.name === 'forms-put-requires-auth');
  assert.equal(check.ok, false);
  assert.equal(check.status, 404);
});

test('treats redirect as failure', async () => {
  const results = await runSmokeChecks('https://line.acme.example', stubFetch({ ...HARDENED, 'GET /openapi.json': 302 }));
  assert.equal(results.find((r) => r.name === 'openapi').ok, false);
});

test('normalizes trailing slash', async () => {
  const seen = [];
  await runSmokeChecks('https://line.acme.example/', stubFetch(HARDENED, seen));
  assert.ok(seen.every((s) => !s.url.includes('//openapi') && !s.url.includes('//api')), seen.map((s) => s.url).join('\n'));
});

test('sends redirect manual', async () => {
  const seen = [];
  await runSmokeChecks('https://line.acme.example', stubFetch(HARDENED, seen));
  assert.equal(seen.length, 4);
  assert.ok(seen.every((s) => s.init.redirect === 'manual'));
});

test('network error marks check failed instead of throwing', async () => {
  const failing = async () => { throw new Error('ECONNREFUSED'); };
  const results = await runSmokeChecks('https://line.acme.example', failing);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.ok === false && r.status === 0));
});
