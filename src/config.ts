import { ConfigurationError } from './errors.js';
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from './http/retry.js';
import { SDK_VERSION } from './version.js';

export interface GaskiyyaOptions {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  appInfo?: string;
}

export interface ResolvedConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  timeoutMs: number;
  retry: RetryPolicy;
  fetch: typeof fetch;
  userAgent: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const ENV = {
  clientId: 'GASKIYYA_CLIENT_ID',
  clientSecret: 'GASKIYYA_CLIENT_SECRET',
  baseUrl: 'GASKIYYA_API_URL',
} as const;

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ConfigurationError(`${name} is required`);
  return value.trim();
}

function baseUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(required(value, 'baseUrl'));
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    throw new ConfigurationError('baseUrl must be an absolute URL, such as the API address Gaskiyya gave you');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigurationError('baseUrl must use https (plain http is allowed only for localhost)');
  }
  if (url.search || url.hash) throw new ConfigurationError('baseUrl must not have a query or fragment');
  return url.toString().replace(/\/+$/, '');
}

function runningInBrowser(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window === 'object' && typeof g.document === 'object';
}

export function resolveConfig(options: GaskiyyaOptions): ResolvedConfig {
  if (runningInBrowser()) {
    throw new ConfigurationError('The Gaskiyya bank SDK holds your client secret, so it must run on your servers, never in a browser or mobile app');
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new ConfigurationError('timeoutMs must be a whole number from 1000 to 120000');
  const maxRetries = options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new ConfigurationError('maxRetries must be a whole number from 0 to 5');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new ConfigurationError('No fetch implementation found: use Node.js 20.19 or later, or pass options.fetch');
  const appInfo = options.appInfo?.trim();

  return {
    clientId: required(options.clientId, 'clientId'),
    clientSecret: required(options.clientSecret, 'clientSecret'),
    baseUrl: baseUrl(options.baseUrl),
    timeoutMs,
    retry: { ...DEFAULT_RETRY_POLICY, maxRetries },
    fetch: fetchImpl,
    userAgent: `gaskiyya-bank-sdk-node/${SDK_VERSION} node/${process.versions.node}${appInfo ? ` ${appInfo}` : ''}`,
  };
}

export function optionsFromEnv(env: Record<string, string | undefined>): Pick<GaskiyyaOptions, 'clientId' | 'clientSecret' | 'baseUrl'> {
  const missing = Object.values(ENV).filter((name) => !env[name]?.trim());
  if (missing.length) throw new ConfigurationError(`Missing environment variables: ${missing.join(', ')}`);
  return { clientId: env[ENV.clientId]!, clientSecret: env[ENV.clientSecret]!, baseUrl: env[ENV.baseUrl]! };
}
