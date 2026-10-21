import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ClientCredentialsTokenProvider,
  ConfigurationError,
  ConnectionError,
  Gaskiyya,
  HttpTransport,
  PermissionError,
  prepareMessage,
  prepareReceipt,
  RateLimitError,
  ServerError,
  ValidationError,
  type HttpTransportOptions,
} from '../src/index.js';
import { BASE_URL, client, CREDENTIALS, fakeApi, tokenRoute, type Handler } from './helpers.js';

const ok: Handler = () => ({ body: { campaigns: [] } });

function transport(routes: Record<string, Handler>, extra: Partial<HttpTransportOptions> = {}) {
  const api = fakeApi({ 'POST /v1/oauth/token': tokenRoute, ...routes });
  const sleeps: number[] = [];
  const options: HttpTransportOptions = {
    baseUrl: BASE_URL,
    fetch: api.fetch,
    timeoutMs: 2_000,
    retry: { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1_000 },
    userAgent: 'test',
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
    ...extra,
  };
  const tokens = new ClientCredentialsTokenProvider(new HttpTransport(options), CREDENTIALS);
  return { http: new HttpTransport(options, tokens), sleeps, ...api };
}

describe('authentication', () => {
  it('exchanges the client credentials once and reuses the token', async () => {
    const { sdk, requests } = client({ 'GET /v1/campaigns': ok });
    await Promise.all([sdk.campaigns.list(), sdk.campaigns.list(), sdk.campaigns.list()]);
    const tokenCalls = requests.filter((r) => r.path === '/v1/oauth/token');
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.body).toEqual({ grant_type: 'client_credentials', client_id: CREDENTIALS.clientId, client_secret: CREDENTIALS.clientSecret });
    expect(requests.filter((r) => r.path === '/v1/campaigns').every((r) => r.headers.authorization === 'Bearer token-1')).toBe(true);
  });

  it('refreshes the token before it expires', async () => {
    let now = 0;
    const api = fakeApi({ 'POST /v1/oauth/token': tokenRoute });
    const tokens = new ClientCredentialsTokenProvider(
      new HttpTransport({ baseUrl: BASE_URL, fetch: api.fetch, timeoutMs: 1_000, retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 }, userAgent: 'test' }),
      CREDENTIALS,
      () => now,
    );
    expect(await tokens.getToken()).toBe('token-1');
    now = 530_000;
    expect(await tokens.getToken()).toBe('token-1');
    now = 541_000;
    expect(await tokens.getToken()).toBe('token-2');
  });

  it('gets a new token and retries once when a token is rejected', async () => {
    const { sdk, requests } = client({
      'GET /v1/campaigns': (req) => (req.headers.authorization === 'Bearer token-1' ? { status: 401, body: { code: 'unauthorized', message: 'Valid bank credentials required' } } : ok(req, 0)),
    });
    await expect(sdk.campaigns.list()).resolves.toEqual([]);
    expect(requests.map((r) => `${r.path} ${r.headers.authorization ?? ''}`)).toEqual([
      '/v1/oauth/token ',
      '/v1/campaigns Bearer token-1',
      '/v1/oauth/token ',
      '/v1/campaigns Bearer token-2',
    ]);
  });

  it('reports wrong credentials as an AuthenticationError without leaking the secret', async () => {
    const { sdk } = client({ 'POST /v1/oauth/token': () => ({ status: 401, body: { code: 'invalid_client', message: 'Unknown client or wrong secret' } }) });
    const err = await sdk.verifyCredentials().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).code).toBe('invalid_client');
    expect(JSON.stringify(err) + String(err) + inspect(err) + inspect(sdk, { depth: 5 })).not.toContain(CREDENTIALS.clientSecret);
  });

  it('surfaces a suspended organisation as a PermissionError', async () => {
    const { sdk } = client({ 'POST /v1/oauth/token': () => ({ status: 403, body: { code: 'org_suspended', message: 'suspended' } }) });
    await expect(sdk.verifyCredentials()).rejects.toMatchObject({ name: 'PermissionError', code: 'org_suspended' });
    await expect(sdk.verifyCredentials()).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('retries', () => {
  it('retries server errors with backoff and keeps the idempotency key', async () => {
    const { http, sleeps, apiRequests } = transport({ 'POST /v1/messages': (_r, n) => (n < 2 ? { status: 503, body: { code: 'unavailable' } } : { status: 202, body: { recordId: 'rec_1' } }) });
    await expect(http.request({ method: 'POST', path: '/v1/messages', body: {}, idempotencyKey: 'k-1' })).resolves.toEqual({ recordId: 'rec_1' });
    expect(apiRequests().map((r) => r.headers['idempotency-key'])).toEqual(['k-1', 'k-1', 'k-1']);
    expect(sleeps).toEqual([100, 200]);
  });

  it('waits for Retry-After on 429, and gives up when it is longer than the policy allows', async () => {
    const { http, sleeps } = transport({ 'GET /v1/metrics': (_r, n) => (n === 0 ? { status: 429, headers: { 'retry-after': '1' }, body: { code: 'rate_limited' } } : { body: {} }) });
    await http.request({ method: 'GET', path: '/v1/metrics' });
    expect(sleeps).toEqual([1_000]);

    const slow = transport({ 'GET /v1/metrics': () => ({ status: 429, headers: { 'retry-after': '60' }, body: { code: 'rate_limited' } }) });
    const err = await slow.http.request({ method: 'GET', path: '/v1/metrics' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(60_000);
    expect(slow.sleeps).toEqual([]);
  });

  it('does not retry requests the server rejected as invalid', async () => {
    const { http, apiRequests } = transport({ 'POST /v1/messages': () => ({ status: 400, body: { code: 'invalid_request', message: 'Invalid fields: recipient' } }) });
    await expect(http.request({ method: 'POST', path: '/v1/messages', body: {} })).rejects.toBeInstanceOf(ValidationError);
    expect(apiRequests()).toHaveLength(1);
  });

  it('turns network failures and timeouts into retryable ConnectionErrors', async () => {
    const down = transport({}, { fetch: async () => Promise.reject(new TypeError('fetch failed')) });
    const err = await down.http.request({ method: 'GET', path: '/v1/metrics', authenticated: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err).toMatchObject({ retryable: true, timedOut: false });
    expect(down.sleeps).toHaveLength(2);

    const hang = transport({}, {
      timeoutMs: 50,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      fetch: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    });
    await expect(hang.http.request({ method: 'GET', path: '/v1/metrics', authenticated: false })).rejects.toMatchObject({ name: 'ConnectionError', timedOut: true });
  });

  it('stops at once when the caller aborts', async () => {
    const controller = new AbortController();
    const { http } = transport({}, { fetch: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))) });
    const pending = http.request({ method: 'GET', path: '/v1/metrics', authenticated: false, signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('reports a 500 as a retryable ServerError', async () => {
    const { http } = transport({ 'GET /v1/metrics': () => ({ status: 500, body: { code: 'error', message: 'Internal error' } }) }, { retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } });
    await expect(http.request({ method: 'GET', path: '/v1/metrics' })).rejects.toMatchObject({ name: 'ServerError', status: 500, retryable: true });
    await expect(http.request({ method: 'GET', path: '/v1/metrics' })).rejects.toBeInstanceOf(ServerError);
  });
});

describe('configuration', () => {
  const base = { ...CREDENTIALS, baseUrl: BASE_URL };

  it('requires credentials and an https address', () => {
    expect(() => new Gaskiyya({ ...base, clientSecret: ' ' })).toThrow(ConfigurationError);
    expect(() => new Gaskiyya({ ...base, baseUrl: 'http://api.gaskiyya.test' })).toThrow(/https/);
    expect(() => new Gaskiyya({ ...base, baseUrl: 'not a url' })).toThrow(ConfigurationError);
    expect(() => new Gaskiyya({ ...base, baseUrl: 'http://localhost:8080' })).not.toThrow();
  });

  it('checks timeouts, retry counts, the fetch implementation and the address shape', () => {
    for (const timeoutMs of [999, 120_001, 1.5]) expect(() => new Gaskiyya({ ...base, timeoutMs })).toThrow(/timeoutMs/);
    for (const maxRetries of [-1, 6, 0.5]) expect(() => new Gaskiyya({ ...base, maxRetries })).toThrow(/maxRetries/);
    expect(() => new Gaskiyya({ ...base, baseUrl: `${BASE_URL}/?env=prod` })).toThrow(/query or fragment/);
    expect(() => new Gaskiyya({ ...base, baseUrl: 'ftp://api.gaskiyya.test' })).toThrow(/https/);
    const realFetch = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      expect(() => new Gaskiyya(base)).toThrow(/No fetch implementation/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('keeps a path prefix in the address and drops trailing slashes', async () => {
    const { sdk, requests } = client({}, { baseUrl: `${BASE_URL}/gateway/` });
    await sdk.verifyCredentials().catch(() => undefined);
    expect(requests).toHaveLength(1);
    const api = fakeApi({ 'POST /gateway/v1/oauth/token': tokenRoute });
    await new Gaskiyya({ ...base, baseUrl: `${BASE_URL}/gateway/`, fetch: api.fetch }).verifyCredentials();
    expect(api.requests[0]!.path).toBe('/gateway/v1/oauth/token');
  });

  it('reports an error page that is not JSON with the HTTP status', async () => {
    const { http } = transport({}, {
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      fetch: async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    });
    await expect(http.request({ method: 'GET', path: '/v1/metrics', authenticated: false })).rejects.toMatchObject({ name: 'ServerError', status: 502, code: 'http_502' });
  });

  it('exposes prepare on the client, giving the same result as the standalone functions', () => {
    const { sdk } = client({});
    const message = { recipient: '+2348012345678', text: 'hello', category: 'otp' as const, sentAt: '2026-10-21T09:00:00.000Z' };
    const receipt = { beneficiaryAccount: '0123456789', beneficiaryBank: '999001', amountKobo: 1, reference: 'REF123456', valueDate: '2026-10-20' };
    expect(sdk.messages.prepare(message)).toEqual(prepareMessage(message));
    expect(sdk.receipts.prepare(receipt)).toEqual(prepareReceipt(receipt));
  });

  it('reads credentials from the environment', () => {
    expect(() => Gaskiyya.fromEnv({})).toThrow('GASKIYYA_CLIENT_ID, GASKIYYA_CLIENT_SECRET, GASKIYYA_API_URL');
    expect(Gaskiyya.fromEnv({ GASKIYYA_CLIENT_ID: 'a', GASKIYYA_CLIENT_SECRET: 'b', GASKIYYA_API_URL: BASE_URL })).toBeInstanceOf(Gaskiyya);
  });

  it('refuses to run in a browser, where the secret would be exposed', () => {
    const g = globalThis as Record<string, unknown>;
    g.window = {};
    g.document = {};
    try {
      expect(() => new Gaskiyya(base)).toThrow(/never in a browser or mobile app/);
    } finally {
      delete g.window;
      delete g.document;
    }
  });

  it('sends a descriptive user agent', async () => {
    const { sdk, requests } = client({ 'GET /v1/campaigns': ok }, { appInfo: 'core-banking/7.2' });
    await sdk.campaigns.list();
    expect(requests[1]!.headers['user-agent']).toMatch(/^gaskiyya-bank-sdk-node\/0\.1\.0 node\/\S+ core-banking\/7\.2$/);
  });
});
