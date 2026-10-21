import type { TokenProvider } from '../auth/token-provider.js';
import { AuthenticationError, ConfigurationError, ConnectionError, errorFromResponse, GaskiyyaError, RateLimitError } from '../errors.js';
import { backoffDelay, sleep, type RetryPolicy } from './retry.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  authenticated?: boolean;
  signal?: AbortSignal;
}

export interface Transport {
  request<T>(request: ApiRequest): Promise<T>;
}

export interface HttpTransportOptions {
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  retry: RetryPolicy;
  userAgent: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class HttpTransport implements Transport {
  constructor(
    private readonly options: HttpTransportOptions,
    private readonly tokens: TokenProvider | null = null,
  ) {}

  async request<T>(request: ApiRequest): Promise<T> {
    const authenticated = request.authenticated ?? true;
    if (authenticated && !this.tokens) throw new ConfigurationError('This transport has no credentials for authenticated calls');
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      const token = authenticated ? await this.tokens!.getToken() : null;
      try {
        return await this.send<T>(request, token);
      } catch (err) {
        if (err instanceof AuthenticationError && authenticated && !refreshed) {
          this.tokens!.invalidate();
          refreshed = true;
          continue;
        }
        const wait = this.retryDelay(err, attempt, request.signal);
        if (wait === null) throw err;
        attempt += 1;
        await (this.options.sleep ?? sleep)(wait);
      }
    }
  }

  private retryDelay(err: unknown, attempt: number, signal: AbortSignal | undefined): number | null {
    const { retry, random } = this.options;
    if (!(err instanceof GaskiyyaError) || !err.retryable || attempt >= retry.maxRetries || signal?.aborted) return null;
    if (err instanceof RateLimitError && err.retryAfterMs !== null) return err.retryAfterMs <= retry.maxDelayMs ? err.retryAfterMs : null;
    return backoffDelay(attempt, retry, random);
  }

  private async send<T>(request: ApiRequest, token: string | null): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': this.options.userAgent };
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (request.idempotencyKey) headers['idempotency-key'] = request.idempotencyKey;
    if (token) headers.authorization = `Bearer ${token}`;

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    let text: string;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal,
      });
      text = await response.text();
    } catch (err) {
      if (request.signal?.aborted) throw err;
      throw timeout.aborted
        ? new ConnectionError(`Gaskiyya did not answer within ${this.options.timeoutMs} ms`, true, err)
        : new ConnectionError('Could not reach Gaskiyya', false, err);
    }

    const data = parseJson(text);
    if (!response.ok) throw errorFromResponse(response.status, data, response.headers.get('retry-after'));
    return data as T;
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
