import { Gaskiyya, type GaskiyyaOptions } from '../src/index.js';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (req: RecordedRequest, nth: number) => FakeResponse | Promise<FakeResponse>;

export const BASE_URL = 'https://api.gaskiyya.test';
export const CREDENTIALS = { clientId: 'demobank-core', clientSecret: 'super-secret-value-0123456789abcdef' };

export function fakeApi(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const seen = new Map<string, number>();
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const req: RecordedRequest = {
      method: init.method ?? 'GET',
      path: url.pathname,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const key = `${req.method} ${req.path}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const handler: Handler = routes[key] ?? (() => ({ status: 404, body: { code: 'not_found', message: 'Not found' } }));
    const r = await handler(req, nth);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests, apiRequests: () => requests.filter((r) => r.path !== '/v1/oauth/token') };
}

export const tokenRoute: Handler = (_req, nth) => ({ body: { access_token: `token-${nth + 1}`, token_type: 'Bearer', expires_in: 600 } });

export function client(routes: Record<string, Handler>, options: Partial<GaskiyyaOptions> = {}) {
  const api = fakeApi({ 'POST /v1/oauth/token': tokenRoute, ...routes });
  const sdk = new Gaskiyya({ ...CREDENTIALS, baseUrl: BASE_URL, fetch: api.fetch, maxRetries: 0, ...options });
  return { sdk, ...api };
}
