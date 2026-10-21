import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { exportJWK, SignJWT, type JWK } from 'jose';
import { ConfigurationError, ValidationError } from '../errors.js';
import { text, toE164 } from '../validation.js';

const AUDIENCE = 'gaskiya';
const MAX_TTL_SECONDS = 900;
const MAX_ACCOUNTS = 20;

export type CustomerTokenAlgorithm = 'ES256' | 'RS256' | 'EdDSA';

export interface CustomerTokenIssuerOptions {
  organisationId: string;
  privateKey: string | KeyObject;
  keyId: string;
  ttlSeconds?: number;
}

export interface CustomerTokenClaims {
  phone: string;
  accounts?: string[];
}

export interface CustomerToken {
  token: string;
  expiresIn: number;
}

function algorithmFor(key: KeyObject): CustomerTokenAlgorithm {
  const type = key.asymmetricKeyType;
  if (type === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return 'ES256';
  if (type === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048) return 'RS256';
  if (type === 'ed25519') return 'EdDSA';
  throw new ConfigurationError('privateKey must be an EC P-256, RSA (2048 bits or more) or Ed25519 private key');
}

function loadKey(key: string | KeyObject): KeyObject {
  try {
    const k = typeof key === 'string' ? createPrivateKey(key) : key;
    if (k.type !== 'private') throw new Error('not a private key');
    return k;
  } catch {
    throw new ConfigurationError('privateKey must be a PEM-encoded private key or a private KeyObject');
  }
}

function accountList(accounts: readonly string[]): string[] {
  const out = [...new Set(accounts.map((a) => String(a).replace(/\s/g, '')))];
  if (out.length > MAX_ACCOUNTS) throw new ValidationError(`accounts can hold at most ${MAX_ACCOUNTS} account numbers`, 'accounts');
  const bad = out.find((a) => !/^[0-9]{10}$/.test(a));
  if (bad !== undefined) throw new ValidationError('accounts must be 10-digit account numbers', 'accounts');
  return out;
}

export class CustomerTokenIssuer {
  readonly organisationId: string;
  readonly keyId: string;
  readonly algorithm: CustomerTokenAlgorithm;
  readonly ttlSeconds: number;
  readonly #key: KeyObject;

  constructor(options: CustomerTokenIssuerOptions) {
    const ttl = options.ttlSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_TTL_SECONDS) throw new ConfigurationError(`ttlSeconds must be a whole number from 30 to ${MAX_TTL_SECONDS}`);
    this.#key = loadKey(options.privateKey);
    this.algorithm = algorithmFor(this.#key);
    this.organisationId = text(options.organisationId, 'organisationId', { max: 64 });
    this.keyId = text(options.keyId, 'keyId', { max: 128 });
    this.ttlSeconds = ttl;
  }

  async issue(claims: CustomerTokenClaims): Promise<CustomerToken> {
    const subject = toE164(claims.phone);
    const accounts = accountList(claims.accounts ?? []);
    const token = await new SignJWT(accounts.length ? { accts: accounts } : {})
      .setProtectedHeader({ alg: this.algorithm, kid: this.keyId, typ: 'JWT' })
      .setIssuer(this.organisationId)
      .setSubject(subject)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.#key);
    return { token, expiresIn: this.ttlSeconds };
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    const jwk = await exportJWK(createPublicKey(this.#key));
    return { keys: [{ ...jwk, kid: this.keyId, alg: this.algorithm, use: 'sig' }] };
  }
}
