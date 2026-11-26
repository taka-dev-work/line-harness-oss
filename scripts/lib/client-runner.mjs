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
      // wrangler prints its JSON error on stdout; surface the Cloudflare text when present
      if (error.stdout?.trim().startsWith('{')) parseWranglerJson(error.stdout);
      throw new Error(`wrangler exited ${error.status}: ${String(error.stderr ?? '').trim().split('\n').at(-1)}`);
    }
  };
  return { banner: probe.banner + (target.local ? '  [LOCAL]' : ''), run };
}
