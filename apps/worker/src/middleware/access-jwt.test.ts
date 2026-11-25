import { beforeEach, describe, expect, test } from 'vitest';
import { resetAccessJwksCache, verifyAccessJwt } from './access-jwt.js';

const TEAM = 'nibel-acme.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const NOW = 1_800_000_000;

const b64url = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer)).toString('base64url');

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

async function sign(key: { kid: string; privateKey: CryptoKey }, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

const claims = (over: Record<string, unknown> = {}) => ({
  aud: [AUD], iss: `https://${TEAM}`, email: 'staff@acme.example', exp: NOW + 300, iat: NOW - 10, nbf: NOW - 10, ...over,
});

function jwksFetch(...responses: Array<{ keys: unknown[] } | Error>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => resetAccessJwksCache());

describe('verifyAccessJwt', () => {
  test('accepts a valid token and returns email', async () => {
    const key = await keyPair('k1');
    const { impl, calls } = jwksFetch({ keys: [key.jwk] });
    const result = await verifyAccessJwt(await sign(key, claims()), { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl });
    expect(result).toEqual({ email: 'staff@acme.example' });
    expect(calls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });

  test('accepts aud given as a string', async () => {
    const key = await keyPair('k1');
    const { impl } = jwksFetch({ keys: [key.jwk] });
    expect(await verifyAccessJwt(await sign(key, claims({ aud: AUD })), { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl })).not.toBeNull();
  });

  test.each([
    ['wrong aud', { aud: ['b'.repeat(64)] }],
    ['wrong iss', { iss: 'https://evil.cloudflareaccess.com' }],
    ['expired', { exp: NOW - 61 }],
    ['not yet valid', { nbf: NOW + 120 }],
    ['issued in the future', { iat: NOW + 120 }],
  ])('rejects %s', async (_name, over) => {
    const key = await keyPair('k1');
    const { impl } = jwksFetch({ keys: [key.jwk] });
    expect(await verifyAccessJwt(await sign(key, claims(over)), { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl })).toBeNull();
  });

  test('rejects alg none and HS256', async () => {
    const key = await keyPair('k1');
    const { impl } = jwksFetch({ keys: [key.jwk] });
    const opts = { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl };
    const none = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(JSON.stringify(claims()))}.`;
    expect(await verifyAccessJwt(none, opts)).toBeNull();
    expect(await verifyAccessJwt(await sign(key, claims(), { alg: 'HS256' }), opts)).toBeNull();
  });

  test('rejects a token signed by a different key with the same kid', async () => {
    const real = await keyPair('k1');
    const forged = await keyPair('k1');
    const { impl } = jwksFetch({ keys: [real.jwk] });
    expect(await verifyAccessJwt(await sign(forged, claims()), { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl })).toBeNull();
  });

  test('rejects malformed tokens', async () => {
    const { impl } = jwksFetch({ keys: [] });
    for (const token of ['', 'abc', 'a.b', 'a.b.c.d', '!!!.###.$$$']) {
      expect(await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl })).toBeNull();
    }
  });

  test('refetches JWKS once on unknown kid then accepts', async () => {
    const old = await keyPair('old');
    const rotated = await keyPair('new');
    const { impl, calls } = jwksFetch({ keys: [old.jwk] }, { keys: [old.jwk, rotated.jwk] });
    const opts = { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl };
    expect(await verifyAccessJwt(await sign(old, claims()), opts)).not.toBeNull();
    expect(await verifyAccessJwt(await sign(rotated, claims()), opts)).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('rejects when kid still unknown after refetch', async () => {
    const known = await keyPair('k1');
    const stranger = await keyPair('zz');
    const { impl, calls } = jwksFetch({ keys: [known.jwk] });
    expect(await verifyAccessJwt(await sign(stranger, claims()), { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl })).toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('returns null when JWKS fetch throws', async () => {
    const key = await keyPair('k1');
    const { impl } = jwksFetch(new Error('network down'));
    expect(await verifyAccessJwt(await sign(key, claims()), { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: impl })).toBeNull();
  });
});
