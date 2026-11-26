// Runs wrangler commands bound to one client's freshly rendered config and returns stdout.
// Used by the drift check and the adoption tool so both read D1 the same way.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientWranglerInvocation } from './with-client.mjs';
import { renderWranglerToml } from './render-wrangler.mjs';
import { parseWranglerJson } from './schema-drift.mjs';

/**
 * @param {object} config validated client config
 * @param {string} root repository root
 * @param {{ local?: boolean, persistTo?: string }} [target] default: remote
 * @returns {{ banner: string, run: (args: string[]) => string }}
 */
export function clientWranglerRunner(config, root, target = {}) {
  const probe = clientWranglerInvocation(config, ['d1', 'list']);
  writeFileSync(join(root, probe.configPath), renderWranglerToml(config));
  const retarget = (args) => {
    if (!target.local) return args;
    const local = ['--local', ...(target.persistTo ? ['--persist-to', target.persistTo] : [])];
    return args.flatMap((a) => (a === '--remote' ? local : [a]));
  };
  const run = (args) => {
    const { argv } = clientWranglerInvocation(config, retarget(args));
    try {
      return execFileSync('pnpm', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      throw new Error(wranglerFailureMessage(error));
    }
  };
  return { banner: probe.banner + (target.local ? '  [LOCAL]' : ''), run };
}

/**
 * Human-readable reason for a failed wrangler run: the Cloudflare JSON error on stdout
 * when present, otherwise every `[ERROR]` line on stderr (wrangler prints a log-file
 * hint after the error, so the last line alone hides the cause).
 * @param {{status?: number, stdout?: string, stderr?: string}} error
 */
export function wranglerFailureMessage(error) {
  const stdout = String(error.stdout ?? '').trim();
  if (stdout.startsWith('{')) {
    try {
      parseWranglerJson(stdout);
    } catch (parsed) {
      if (!(parsed instanceof SyntaxError)) return `wrangler exited ${error.status}: ${parsed.message}`;
    }
  }
  const lines = String(error.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => l.includes('[ERROR]'));
  return `wrangler exited ${error.status}: ${(errors.length ? errors : lines.slice(-1)).join(' | ')}`;
}
