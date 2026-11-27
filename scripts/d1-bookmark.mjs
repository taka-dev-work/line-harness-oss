#!/usr/bin/env node
// Usage: node scripts/d1-bookmark.mjs --client <client.json>   (read-only)
// Prints bookmark=<value> and, under GitHub Actions, writes it to $GITHUB_OUTPUT.
// Exits 1 when no bookmark can be read: the deploy must not migrate without a restore point.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClientConfig } from './lib/client-config.mjs';
import { clientWranglerRunner } from './lib/client-runner.mjs';
import { appendOutput, parseBookmark } from './lib/d1-bookmark.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--client');
const clientPath = i > 0 ? process.argv[i + 1] : undefined;
if (!clientPath) {
  console.error('usage: d1-bookmark.mjs --client <client.json>');
  process.exit(1);
}
try {
  const config = JSON.parse(readFileSync(clientPath, 'utf8'));
  const checked = validateClientConfig(config);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  const runner = clientWranglerRunner(config, root);
  console.error(runner.banner);
  const bookmark = parseBookmark(runner.run(['d1', 'time-travel', 'info', config.d1DatabaseName, '--json']));
  console.log(`bookmark=${bookmark}`);
  if (process.env.GITHUB_OUTPUT) appendOutput(process.env.GITHUB_OUTPUT, 'bookmark', bookmark);
} catch (error) {
  console.error(`cannot read a time-travel bookmark: ${error.code ?? error.message}`);
  process.exit(1);
}
