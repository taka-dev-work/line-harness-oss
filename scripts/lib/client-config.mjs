// Validates a per-client deploy config (client.json).
// client.json holds only non-secret identifiers; any unknown key is rejected so
// that a secret pasted into it can never reach the rendered wrangler config.

const NAME = /^[a-z][a-z0-9-]{1,62}$/;
const PATTERNS = {
  slug: /^[a-z][a-z0-9-]{1,30}$/,
  cloudflareAccountId: /^[0-9a-f]{32}$/,
  workerName: NAME,
  d1DatabaseName: NAME,
  d1DatabaseId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
// Lowercase hostname with at least two labels; no scheme, path, port or trailing dot.
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const RELEASE = {
  tag: /^v\d+\.\d+\.\d+(-nibel\.\d+)?$/,
  commit: /^[0-9a-f]{40}$/,
};
const TOP_KEYS = ['slug', 'displayName', 'cloudflareAccountId', 'workerName', 'd1DatabaseName',
  'd1DatabaseId', 'customDomain', 'adminDomain', 'release', 'build', 'vars'];
const BUILD_KEYS = ['VITE_LIFF_ID', 'VITE_BOT_BASIC_ID', 'VITE_CALENDAR_CONNECTION_ID', 'NEXT_PUBLIC_API_URL'];
const VAR_KEYS = ['OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkStringMap(value, path, allowed, errors, valuePattern) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    if (!allowed.includes(key)) errors.push(`unknown key: ${path}.${key}`);
    else if (typeof v !== 'string') errors.push(`${path}.${key} must be a string`);
    else if (valuePattern && !valuePattern.test(v)) errors.push(`${path}.${key} contains whitespace or control characters`);
  }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, config: object } | { ok: false, errors: string[] }}
 */
export function validateClientConfig(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['client config must be a JSON object'] };

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) errors.push(`unknown key: ${key}`);
  }

  for (const [field, pattern] of Object.entries(PATTERNS)) {
    const v = raw[field];
    if (typeof v !== 'string' || !pattern.test(v)) errors.push(`${field} is missing or invalid`);
  }

  if (typeof raw.displayName !== 'string' || raw.displayName.trim() === '') {
    errors.push('displayName is missing or empty');
  }

  let domainsValid = true;
  for (const field of ['customDomain', 'adminDomain']) {
    const v = raw[field];
    if (typeof v !== 'string' || !HOSTNAME.test(v)) {
      errors.push(`${field} must be a lowercase hostname without scheme, path, port or trailing dot`);
      domainsValid = false;
    }
  }
  if (domainsValid && raw.customDomain === raw.adminDomain) {
    errors.push('adminDomain must differ from customDomain');
  }

  if (!isPlainObject(raw.release)) {
    errors.push('release must be an object with tag and commit');
  } else {
    for (const key of Object.keys(raw.release)) {
      if (!(key in RELEASE)) errors.push(`unknown key: release.${key}`);
    }
    for (const [field, pattern] of Object.entries(RELEASE)) {
      const v = raw.release[field];
      if (typeof v !== 'string' || !pattern.test(v)) errors.push(`release.${field} is missing or invalid`);
    }
  }

  checkStringMap(raw.build, 'build', BUILD_KEYS, errors, /^[^\s\u0000-\u001f]*$/);
  if (raw.vars !== undefined) checkStringMap(raw.vars, 'vars', VAR_KEYS, errors);

  return errors.length ? { ok: false, errors } : { ok: true, config: raw };
}
