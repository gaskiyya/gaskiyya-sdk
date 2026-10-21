import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, CustomerTokenIssuer, ValidationError } from '../src/index.js';

// The checks the registry applies to customer tokens (packages/api/src/auth/auth.ts).
async function registryAccepts(token: string, jwks: Awaited<ReturnType<CustomerTokenIssuer['jwks']>>, organisationId: string) {
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    issuer: organisationId,
    audience: 'gaskiya',
    algorithms: ['ES256', 'RS256', 'EdDSA'],
    maxTokenAge: '15m',
  });
  return payload;
}

const keys = {
  ES256: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
  RS256: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
  EdDSA: generateKeyPairSync('ed25519').privateKey,
};

describe('customer tokens', () => {
  for (const [alg, privateKey] of Object.entries(keys)) {
    it(`issues ${alg} tokens the registry accepts, with a matching JWKS`, async () => {
      const issuer = new CustomerTokenIssuer({ organisationId: 'demobank', privateKey, keyId: 'app-2026-10' });
      const { token, expiresIn } = await issuer.issue({ phone: '0801 234 5678', accounts: ['0123456789', '0123456789'] });
      const jwks = await issuer.jwks();

      expect(expiresIn).toBe(300);
      expect(decodeProtectedHeader(token)).toMatchObject({ alg, kid: 'app-2026-10' });
      expect(await registryAccepts(token, jwks, 'demobank')).toMatchObject({ iss: 'demobank', sub: '+2348012345678', aud: 'gaskiya', accts: ['0123456789'] });
      expect(jwks.keys[0]).toMatchObject({ kid: 'app-2026-10', alg, use: 'sig' });
      expect(JSON.stringify(jwks)).not.toMatch(/"d"|"p"|"q"/);
    });
  }

  it('accepts a PEM private key', async () => {
    const pem = keys.ES256.export({ type: 'pkcs8', format: 'pem' }).toString();
    const issuer = new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: pem, keyId: 'k1', ttlSeconds: 600 });
    const { token } = await issuer.issue({ phone: '+2348012345678' });
    const payload = await registryAccepts(token, await issuer.jwks(), 'demobank');
    expect(payload.exp! - payload.iat!).toBe(600);
    expect(payload.accts).toBeUndefined();
  });

  it('rejects keys and settings the registry would refuse', () => {
    expect(() => new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey, keyId: 'k' })).toThrow(ConfigurationError);
    expect(() => new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: 'not a key', keyId: 'k' })).toThrow(ConfigurationError);
    expect(() => new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: keys.ES256, keyId: 'k', ttlSeconds: 3_600 })).toThrow(/ttlSeconds/);
  });

  it('rejects weak RSA keys, public keys and bad identifiers', () => {
    const make = (extra: Partial<ConstructorParameters<typeof CustomerTokenIssuer>[0]>) => () =>
      new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: keys.ES256, keyId: 'k', ...extra });
    expect(make({ privateKey: generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey })).toThrow(ConfigurationError);
    expect(make({ privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey })).toThrow(ConfigurationError);
    expect(make({ organisationId: ' ' })).toThrow(/organisationId/);
    expect(make({ keyId: '' })).toThrow(/keyId/);
    expect(make({ ttlSeconds: 29 })).toThrow(/ttlSeconds/);
    expect(make({ ttlSeconds: 30 })).not.toThrow();
    expect(make({ ttlSeconds: 900 })).not.toThrow();
  });

  it('expires tokens after five minutes by default', async () => {
    const issuer = new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: keys.EdDSA, keyId: 'k' });
    const payload = await registryAccepts((await issuer.issue({ phone: '+2348012345678' })).token, await issuer.jwks(), 'demobank');
    expect(payload.exp! - payload.iat!).toBe(300);
  });

  it('is refused by the registry for another organisation', async () => {
    const issuer = new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: keys.ES256, keyId: 'k' });
    const { token } = await issuer.issue({ phone: '+2348012345678' });
    await expect(registryAccepts(token, await issuer.jwks(), 'otherbank')).rejects.toThrow();
  });

  it('caps the account list at 20', async () => {
    const issuer = new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: keys.ES256, keyId: 'k' });
    const accounts = Array.from({ length: 21 }, (_, i) => String(1_000_000_000 + i));
    await expect(issuer.issue({ phone: '+2348012345678', accounts })).rejects.toThrow(/at most 20/);
    await expect(issuer.issue({ phone: '+2348012345678', accounts: accounts.slice(0, 20) })).resolves.toHaveProperty('token');
  });

  it('validates the customer before signing', async () => {
    const issuer = new CustomerTokenIssuer({ organisationId: 'demobank', privateKey: keys.ES256, keyId: 'k' });
    await expect(issuer.issue({ phone: '123' })).rejects.toBeInstanceOf(ValidationError);
    await expect(issuer.issue({ phone: '+2348012345678', accounts: ['12345'] })).rejects.toMatchObject({ field: 'accounts' });
  });
});
