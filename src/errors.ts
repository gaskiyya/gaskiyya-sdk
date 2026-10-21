export interface GaskiyyaErrorDetails {
  status?: number | null;
  code: string;
  retryable?: boolean;
  cause?: unknown;
}

export class GaskiyyaError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, details: GaskiyyaErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = new.target.name;
    this.status = details.status ?? null;
    this.code = details.code;
    this.retryable = details.retryable ?? false;
  }
}

export class ConfigurationError extends GaskiyyaError {
  constructor(message: string) {
    super(message, { code: 'configuration' });
  }
}

export class ValidationError extends GaskiyyaError {
  readonly field: string | null;

  constructor(message: string, field: string | null = null, status: number | null = null, code = 'invalid_request') {
    super(message, { status, code });
    this.field = field;
  }
}

export class AuthenticationError extends GaskiyyaError {}

export class PermissionError extends GaskiyyaError {}

export class NotFoundError extends GaskiyyaError {}

export class ConflictError extends GaskiyyaError {}

export class RateLimitError extends GaskiyyaError {
  readonly retryAfterMs: number | null;

  constructor(message: string, code: string, retryAfterMs: number | null) {
    super(message, { status: 429, code, retryable: true });
    this.retryAfterMs = retryAfterMs;
  }
}

export class ServerError extends GaskiyyaError {}

export class ConnectionError extends GaskiyyaError {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean, cause?: unknown) {
    super(message, { code: timedOut ? 'timeout' : 'connection_failed', retryable: true, cause });
    this.timedOut = timedOut;
  }
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const at = /[a-z]/i.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function errorFromResponse(status: number, body: unknown, retryAfter: string | null): GaskiyyaError {
  const { code = `http_${status}`, message = `Gaskiyya answered HTTP ${status}` } =
    body && typeof body === 'object' ? (body as { code?: string; message?: string }) : {};
  switch (true) {
    case status === 400 || status === 413 || status === 422:
      return new ValidationError(message, null, status, code);
    case status === 401:
      return new AuthenticationError(message, { status, code });
    case status === 403:
      return new PermissionError(message, { status, code });
    case status === 404:
      return new NotFoundError(message, { status, code });
    case status === 409:
      return new ConflictError(message, { status, code });
    case status === 429:
      return new RateLimitError(message, code, parseRetryAfter(retryAfter));
    default:
      return new ServerError(message, { status, code, retryable: RETRYABLE_STATUS.has(status) });
  }
}
