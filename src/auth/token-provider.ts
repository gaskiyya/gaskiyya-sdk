import { ServerError } from '../errors.js';
import type { Transport } from '../http/transport.js';

export interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(): void;
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

const REFRESH_MARGIN_MS = 60_000;

export class ClientCredentialsTokenProvider implements TokenProvider {
  readonly #clientId: string;
  readonly #clientSecret: string;
  #cached: { value: string; refreshAt: number } | null = null;
  #pending: Promise<string> | null = null;

  constructor(
    private readonly transport: Transport,
    credentials: ClientCredentials,
    private readonly clock: () => number = Date.now,
  ) {
    this.#clientId = credentials.clientId;
    this.#clientSecret = credentials.clientSecret;
  }

  getToken(): Promise<string> {
    if (this.#cached && this.clock() < this.#cached.refreshAt) return Promise.resolve(this.#cached.value);
    this.#pending ??= this.#fetchToken().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  invalidate(): void {
    this.#cached = null;
  }

  async #fetchToken(): Promise<string> {
    const requestedAt = this.clock();
    const response = await this.transport.request<TokenResponse>({
      method: 'POST',
      path: '/v1/oauth/token',
      body: { grant_type: 'client_credentials', client_id: this.#clientId, client_secret: this.#clientSecret },
      authenticated: false,
    });
    const { access_token: value, expires_in: expiresIn } = response ?? {};
    if (typeof value !== 'string' || !value || typeof expiresIn !== 'number' || !(expiresIn > 0)) {
      throw new ServerError('Gaskiyya returned a malformed access token', { code: 'malformed_token' });
    }
    const lifetimeMs = expiresIn * 1000;
    this.#cached = { value, refreshAt: requestedAt + lifetimeMs - Math.min(REFRESH_MARGIN_MS, lifetimeMs / 5) };
    return value;
  }
}
