import { describe, expect, test } from 'vitest';
import { verifySharedSecret } from './webhook-auth.js';

describe('verifySharedSecret', () => {
  test('accepts the correct shared secret', async () => {
    await expect(verifySharedSecret('expected-secret', 'expected-secret')).resolves.toBe(true);
  });

  test('rejects missing or wrong shared secrets', async () => {
    await expect(verifySharedSecret(undefined, 'expected-secret')).resolves.toBe(false);
    await expect(verifySharedSecret('wrong-secret', 'expected-secret')).resolves.toBe(false);
  });
});
