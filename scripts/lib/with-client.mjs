// Builds a wrangler invocation bound to exactly one client: the config is
// rendered fresh from that client's client.json to a per-slug path, and callers
// cannot point wrangler at another config or env.
import { validateClientConfig } from './client-config.mjs';

const FORBIDDEN = ['--config', '-c', '--env', '-e'];

/**
 * @param {unknown} config raw client.json contents
 * @param {string[]} wranglerArgs e.g. ['d1', 'migrations', 'apply', 'DB', '--remote']
 * @returns {{ configPath: string, argv: string[], banner: string }}
 */
export function clientWranglerInvocation(config, wranglerArgs) {
  const result = validateClientConfig(config);
  if (!result.ok) throw new Error(`invalid client config:\n${result.errors.join('\n')}`);
  for (const arg of wranglerArgs) {
    const flag = arg.split('=')[0];
    if (FORBIDDEN.includes(flag)) throw new Error(`${flag} is set by with-client and cannot be passed through`);
  }
  const { slug, displayName, cloudflareAccountId } = result.config;
  const configPath = `apps/worker/wrangler.${slug}.toml`;
  return {
    configPath,
    argv: ['exec', 'wrangler', ...wranglerArgs, '--config', configPath],
    banner: `client: ${slug} (${displayName})  cloudflare account: ${cloudflareAccountId}`,
  };
}
