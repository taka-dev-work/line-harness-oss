#!/usr/bin/env node
// Usage: node scripts/verify-release.mjs --client <client.json> [--repo <dir>]
// Exits 1 unless release.tag resolves to release.commit and HEAD is release.commit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClientConfig } from './lib/client-config.mjs';
import { checkRelease } from './lib/release.mjs';

const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const clientPath = value('--client');
const repo = value('--repo') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
if (!clientPath) {
  console.error('usage: verify-release.mjs --client <client.json> [--repo <dir>]');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(clientPath, 'utf8'));
} catch (error) {
  console.error(`cannot read client config: ${error.code ?? error.message}`);
  process.exit(1);
}
const checked = validateClientConfig(config);
if (!checked.ok) {
  console.error(checked.errors.join('\n'));
  process.exit(1);
}

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const { tag } = config.release;
const result = checkRelease({
  release: config.release,
  tagCommit: git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`),
  headCommit: git('rev-parse', 'HEAD'),
});
if (!result.ok) {
  for (const e of result.errors) console.error(e);
  process.exit(1);
}
console.log(`release ${tag} = ${config.release.commit} (verified)`);
