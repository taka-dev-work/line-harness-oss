import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminApiHeaders } from './lib/admin-api-headers.mjs';

test('sends bearer key and Access service token when configured', () => {
  assert.deepEqual(
    adminApiHeaders({ LINE_HARNESS_API_KEY: 'k', LINE_HARNESS_ACCESS_CLIENT_ID: 'id.access', LINE_HARNESS_ACCESS_CLIENT_SECRET: 's' }),
    { Authorization: 'Bearer k', 'Content-Type': 'application/json', 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 's' },
  );
});

test('omits Access headers unless both halves are set', () => {
  const headers = adminApiHeaders({ LINE_HARNESS_API_KEY: 'k', LINE_HARNESS_ACCESS_CLIENT_ID: 'id.access' });
  assert.equal(headers['CF-Access-Client-Id'], undefined);
  assert.equal(headers.Authorization, 'Bearer k');
});
