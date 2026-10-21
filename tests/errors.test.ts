import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ConfigurationError,
  ConflictError,
  ConnectionError,
  GaskiyyaError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../src/index.js';
import { errorFromResponse, parseRetryAfter } from '../src/errors.js';

describe('errorFromResponse', () => {
  const cases: [number, string, new (...args: never[]) => GaskiyyaError, boolean][] = [
    [400, 'invalid_request', ValidationError, false],
    [400, 'sent_at_in_future', ValidationError, false],
    [413, 'too_large', ValidationError, false],
    [422, 'unsafe_advisory', ValidationError, false],
    [401, 'invalid_client', AuthenticationError, false],
    [403, 'feature_disabled', PermissionError, false],
    [403, 'org_suspended', PermissionError, false],
    [404, 'not_found', NotFoundError, false],
    [409, 'not_approved', ConflictError, false],
    [429, 'rate_limited', RateLimitError, true],
    [500, 'error', ServerError, true],
    [502, 'bad_gateway', ServerError, true],
    [503, 'unavailable', ServerError, true],
    [504, 'timeout', ServerError, true],
    [501, 'not_implemented', ServerError, false],
  ];

  it.each(cases)('maps HTTP %i %s to the right class, keeping Gaskiyya\'s code', (status, code, type, retryable) => {
    const err = errorFromResponse(status, { code, message: `message for ${code}` }, null);
    expect(err).toBeInstanceOf(type);
    expect(err).toBeInstanceOf(GaskiyyaError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ status, code, retryable, message: `message for ${code}`, name: type.name });
  });

  it('copes with an empty or non-JSON body', () => {
    expect(errorFromResponse(502, undefined, null)).toMatchObject({ code: 'http_502', message: 'Gaskiyya answered HTTP 502' });
    expect(errorFromResponse(400, 'oops', null)).toMatchObject({ code: 'http_400', status: 400 });
  });

  it('carries Retry-After on rate limits', () => {
    expect((errorFromResponse(429, {}, '3') as RateLimitError).retryAfterMs).toBe(3_000);
    expect((errorFromResponse(429, {}, null) as RateLimitError).retryAfterMs).toBeNull();
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');

  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter('2.5', now)).toBe(2_500);
    expect(parseRetryAfter('Wed, 21 Oct 2026 12:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Wed, 21 Oct 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('ignores missing or unreadable values', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-5', now)).toBeNull();
  });
});

describe('error classes', () => {
  it('keep the cause of a connection failure', () => {
    const cause = new TypeError('fetch failed');
    const err = new ConnectionError('Could not reach Gaskiyya', false, cause);
    expect(err.cause).toBe(cause);
    expect(err).toMatchObject({ code: 'connection_failed', retryable: true, timedOut: false, status: null });
    expect(new ConnectionError('slow', true)).toMatchObject({ code: 'timeout', timedOut: true });
  });

  it('name the field of a local validation failure', () => {
    expect(new ValidationError('bad', 'recipient')).toMatchObject({ field: 'recipient', code: 'invalid_request', status: null, retryable: false });
  });

  it('mark configuration problems as never retryable', () => {
    expect(new ConfigurationError('x')).toMatchObject({ code: 'configuration', retryable: false, name: 'ConfigurationError' });
  });
});
