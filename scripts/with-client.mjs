#!/usr/bin/env node
// Run wrangler against exactly one client, rendering its config fresh every time.
// Usage:
//   node scripts/with-client.mjs --client path/to/client.json [--web-env-out <file>] [--render-only] -- <wrangler args>
// Examples:
//   node scripts/with-client.mjs --client clients/acme.json -- d1 migrations apply DB --remote
//   node scripts/with-client.mjs --client clients/acme.json -- secret put LINE_CHANNEL_SECRET
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientWranglerInvocation } from './lib/with-client.mjs';
import { renderWranglerToml, renderWebBuildEnv } from './lib/render-wrangler.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sep = process.argv.indexOf('--');
const own = sep === -1 ? process.argv.slice(2) : process.argv.slice(2, sep);
const wranglerArgs = sep === -1 ? [] : process.argv.slice(sep + 1);
const opt = (name) => {
  const i = own.indexOf(name);
  return i === -1 ? undefined : own[i + 1];
};

const clientPath = opt('--client');
const renderOnly = own.includes('--render-only');
if (!clientPath || clientPath.startsWith('--') || (!renderOnly && wranglerArgs.length === 0)) {
  console.error('usage: with-client.mjs --client <client.json> [--web-env-out <file>] [--render-only] -- <wrangler args>');
  process.exit(1);
}

let invocation;
let config;
try {
  config = JSON.parse(readFileSync(clientPath, 'utf8'));
  invocation = clientWranglerInvocation(config, wranglerArgs);
} catch (error) {
  console.error(error.code ? `cannot read client config: ${error.code}` : error.message);
  process.exit(1);
}

writeFileSync(join(root, invocation.configPath), renderWranglerToml(config));
const webEnvOut = opt('--web-env-out');
if (webEnvOut) {
  const env = renderWebBuildEnv(config);
  writeFileSync(webEnvOut, Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(''));
}
console.error(invocation.banner);
if (renderOnly) process.exit(0);

const run = spawnSync('pnpm', invocation.argv, { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
