#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  args.set(arg.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
}

const envFile = args.get('env-file') || '.env.production';
const workerEnv = args.get('env') || 'production';
const config = args.get('config') || 'apps/worker/wrangler.toml';

const secretNames = [
  'API_KEY',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LOGIN_CHANNEL_SECRET',
  'LIFF_URL',
  'WORKER_URL',
  'STRIPE_WEBHOOK_SECRET',
  'MEET_CALLBACK_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'GOOGLE_CALENDAR_ID',
  'LINE_HARNESS_API_URL',
  'LINE_HARNESS_API_KEY',
];

function parseEnv(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value.replaceAll('\\n', '\n'));
  }
  return values;
}

const env = parseEnv(readFileSync(envFile, 'utf8'));
const applied = [];
const skipped = [];

for (const name of secretNames) {
  const value = env.get(name);
  if (!value || value.startsWith('your-') || value.startsWith('whsec_your-')) {
    skipped.push(name);
    continue;
  }

  const result = spawnSync(
    'pnpm',
    ['exec', 'wrangler', 'secret', 'put', name, '--config', config, '--env', workerEnv],
    { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  applied.push(name);
}

console.log(`Synced ${applied.length} Worker secrets from ${envFile}: ${applied.join(', ') || '(none)'}`);
console.log(`Skipped ${skipped.length} empty/example values: ${skipped.join(', ') || '(none)'}`);
