// Renders a per-client wrangler config from a validated client.json.
import { validateClientConfig } from './client-config.mjs';

const DEFAULT_VARS = {
  OPENAI_MODEL: 'gpt-5-mini',
  ANTHROPIC_MODEL: 'claude-sonnet-5',
  GEMINI_MODEL: 'gemini-3.6-flash',
};

const str = (value) => JSON.stringify(String(value));

function assertValid(config) {
  const result = validateClientConfig(config);
  if (!result.ok) throw new Error(`invalid client config:\n${result.errors.join('\n')}`);
  return result.config;
}

/** @returns {string} wrangler.toml contents */
export function renderWranglerToml(input) {
  const config = assertValid(input);
  const vars = {
    ...DEFAULT_VARS,
    ...(config.vars ?? {}),
    ACCESS_TEAM_DOMAIN: config.access.teamDomain,
    ACCESS_AUD: config.access.aud,
  };
  const lines = [
    '# GENERATED from client.json — do not edit or commit',
    `name = ${str(config.workerName)}`,
    'main = "src/index.ts"',
    'compatibility_date = "2024-12-01"',
    'workers_dev = false',
    `account_id = ${str(config.cloudflareAccountId)}`,
    '',
    '[vars]',
    ...Object.entries(vars).map(([k, v]) => `${k} = ${str(v)}`),
    '',
    '[assets]',
    'directory = "../web/out"',
    'binding = "ASSETS"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = ${str(config.d1DatabaseName)}`,
    `database_id = ${str(config.d1DatabaseId)}`,
    'migrations_dir = "../../packages/db/d1-migrations"',
    '',
    '[triggers]',
    'crons = ["*/5 * * * *"]',
    '',
    '[[routes]]',
    `pattern = ${str(config.customDomain)}`,
    'custom_domain = true',
    '',
    '[[routes]]',
    `pattern = ${str(config.adminDomain)}`,
    'custom_domain = true',
    '',
  ];
  return lines.join('\n');
}

/** @returns {Record<string, string>} build-time env for the admin web build */
export function renderWebBuildEnv(input) {
  return { ...assertValid(input).build };
}
