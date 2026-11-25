// Verifies Cloudflare Access application tokens (Cf-Access-Jwt-Assertion), RS256 only.
// Keys come from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs, cached for
// 10 minutes; an unknown kid triggers one refetch (key rotation). Any failure returns
// null — this function never throws and never accepts an unverified token.

const CACHE_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_S = 60;

interface CachedKeys {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const cache = new Map<string, CachedKeys>();

/** Test hook: forget cached JWKS. */
export function resetAccessJwksCache(): void {
  cache.clear();
}

function decodeSegment(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function decodeJson(segment: string): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder().decode(decodeSegment(segment)));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
  return value as Record<string, unknown>;
}

async function fetchKeys(teamDomain: string, fetchImpl: typeof fetch): Promise<CachedKeys> {
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  const entry = { keys, fetchedAt: Date.now() };
  cache.set(teamDomain, entry);
  return entry;
}

async function keyFor(teamDomain: string, kid: string, fetchImpl: typeof fetch): Promise<CryptoKey | null> {
  let entry = cache.get(teamDomain);
  if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    entry = await fetchKeys(teamDomain, fetchImpl);
  }
  let key = entry.keys.get(kid) ?? null;
  if (!key) {
    // Unknown kid: Access may have rotated keys. Refetch once.
    entry = await fetchKeys(teamDomain, fetchImpl);
    key = entry.keys.get(kid) ?? null;
  }
  return key;
}

export interface AccessJwtOptions {
  teamDomain: string;
  aud: string;
  /** Seconds since epoch; defaults to now. */
  now?: number;
  fetchImpl?: typeof fetch;
}

export async function verifyAccessJwt(
  token: string,
  opts: AccessJwtOptions,
): Promise<{ email: string | null } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
    const [headerSeg, payloadSeg, signatureSeg] = parts;

    const header = decodeJson(headerSeg);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const key = await keyFor(opts.teamDomain, header.kid, opts.fetchImpl ?? fetch);
    if (!key) return null;

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeSegment(signatureSeg),
      new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
    );
    if (!valid) return null;

    const claims = decodeJson(payloadSeg);
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(opts.aud)) return null;
    if (claims.iss !== `https://${opts.teamDomain}`) return null;
    if (typeof claims.exp !== 'number' || now >= claims.exp + CLOCK_SKEW_S) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + CLOCK_SKEW_S) return null;
    if (typeof claims.iat === 'number' && claims.iat > now + CLOCK_SKEW_S) return null;

    return { email: typeof claims.email === 'string' ? claims.email : null };
  } catch {
    return null;
  }
}
