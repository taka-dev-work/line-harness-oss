#!/usr/bin/env node
// Usage: node scripts/smoke-test.mjs --base-url https://line.example.com
import { runSmokeChecks } from './lib/smoke.mjs';

const i = process.argv.indexOf('--base-url');
const baseUrl = i > 0 ? process.argv[i + 1] : undefined;
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
  console.error('usage: smoke-test.mjs --base-url https://<worker host>');
  process.exit(1);
}

const results = await runSmokeChecks(baseUrl);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${r.status}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
