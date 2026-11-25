#!/usr/bin/env node
// Usage: node scripts/render-wrangler-config.mjs --client <client.json> --out <wrangler.toml> [--web-env-out <file>]
// Never prints config values: validation errors name fields only.
import { readFileSync, writeFileSync } from 'node:fs';
import { validateClientConfig } from './lib/client-config.mjs';
import { renderWranglerToml, renderWebBuildEnv } from './lib/render-wrangler.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const clientPath = args.get('--client');
const outPath = args.get('--out');
if (!clientPath || !outPath) {
  console.error('usage: render-wrangler-config.mjs --client <client.json> --out <wrangler.toml> [--web-env-out <file>]');
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(clientPath, 'utf8'));
} catch (error) {
  console.error(`cannot read client config: ${error.code ?? 'invalid JSON'}`);
  process.exit(1);
}

const result = validateClientConfig(raw);
if (!result.ok) {
  for (const message of result.errors) console.error(message);
  process.exit(1);
}

writeFileSync(outPath, renderWranglerToml(result.config));
const webEnvOut = args.get('--web-env-out');
if (webEnvOut) {
  const env = renderWebBuildEnv(result.config);
  writeFileSync(webEnvOut, Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(''));
}
console.error(`rendered wrangler config for ${result.config.slug}`);
