import { describe, expect, it } from 'vitest';
import { toE164, ValidationError } from '../src/index.js';
import { domains, integer, isoTime, MAX_LINK_DOMAINS, oneOf, pathSegment, text } from '../src/validation.js';

describe('toE164', () => {
  it.each([
    ['+2348012345678', '+2348012345678'],
    ['08012345678', '+2348012345678'],
    ['0801 234 5678', '+2348012345678'],
    ['0801-234-5678', '+2348012345678'],
    ['(0801) 234.5678', '+2348012345678'],
    ['2348012345678', '+2348012345678'],
    ['+234 801 234 5678', '+2348012345678'],
    ['+447700900123', '+447700900123'],
    ['+12025550123', '+12025550123'],
  ])('reads %s as %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(['', '12345', '0801234567', '080123456789', '+0123456789', '+2348O12345678', '+1234567890123456', 'phone'])('rejects %j', (input) => {
    expect(() => toE164(input, 'recipient')).toThrow(ValidationError);
    expect(() => toE164(input, 'recipient')).toThrow(/^recipient/);
  });

  it('rejects values that are not text', () => {
    expect(() => toE164(8012345678 as never)).toThrow(ValidationError);
    expect(() => toE164(undefined as never)).toThrow(ValidationError);
  });
});

describe('isoTime', () => {
  const now = () => new Date('2026-10-21T09:00:00.000Z');

  it('defaults to now, and writes any date or ISO string with a timezone in full UTC form', () => {
    expect(isoTime(undefined, 'sentAt', now)).toBe('2026-10-21T09:00:00.000Z');
    expect(isoTime(new Date('2026-10-21T10:00:00+01:00'), 'sentAt')).toBe('2026-10-21T09:00:00.000Z');
    expect(isoTime('2026-10-21T09:00:00Z', 'sentAt')).toBe('2026-10-21T09:00:00.000Z');
    expect(isoTime('2026-10-21T09:00Z', 'sentAt')).toBe('2026-10-21T09:00:00.000Z');
    expect(isoTime('2026-10-21T10:00:00.123+01:00', 'sentAt')).toBe('2026-10-21T09:00:00.123Z');
  });

  it.each(['2026-10-21T09:00:00', '2026-10-21', '21/10/2026 09:00', '2026-13-40T99:00:00Z', ''])('rejects %j', (input) => {
    expect(() => isoTime(input, 'sentAt')).toThrow(/sentAt/);
  });

  it('rejects an invalid Date', () => {
    expect(() => isoTime(new Date('nope'), 'sentAt')).toThrow(/not a valid date/);
  });
});

describe('domains', () => {
  it('lower-cases, trims and de-duplicates', () => {
    expect(domains([' DemoBank.ng ', 'demobank.ng', 'pay.demobank.com'])).toEqual(['demobank.ng', 'pay.demobank.com']);
  });

  it(`allows at most ${MAX_LINK_DOMAINS} distinct domains`, () => {
    const many = Array.from({ length: MAX_LINK_DOMAINS + 1 }, (_, i) => `d${i}.ng`);
    expect(domains(many.slice(0, MAX_LINK_DOMAINS))).toHaveLength(MAX_LINK_DOMAINS);
    expect(() => domains(many)).toThrow(/at most 10/);
  });

  it.each(['https://demobank.ng', 'demobank', 'demo bank.ng', 'demobank.n', '-.ng/x'])('rejects %j', (d) => {
    expect(() => domains([d])).toThrow(ValidationError);
  });
});

describe('small validators', () => {
  it('oneOf accepts only listed values', () => {
    expect(oneOf('sms', ['sms', 'push'] as const, 'channel')).toBe('sms');
    expect(() => oneOf('fax', ['sms', 'push'] as const, 'channel')).toThrow('channel must be one of: sms, push');
    expect(() => oneOf(undefined, ['sms'] as const, 'channel')).toThrow(ValidationError);
  });

  it('text trims and enforces length', () => {
    expect(text('  Ada  ', 'analyst', { min: 2, max: 5 })).toBe('Ada');
    expect(() => text(' A ', 'analyst', { min: 2, max: 5 })).toThrow(/2 to 5/);
    expect(() => text('abcdef', 'analyst', { max: 5 })).toThrow(ValidationError);
    expect(() => text(5, 'analyst', { max: 5 })).toThrow(/must be text/);
  });

  it('integer enforces whole numbers in range', () => {
    expect(integer(240, 'maxAgeHours', 1, 2400)).toBe(240);
    for (const v of [0, 2401, 1.5, Number.NaN, '24']) expect(() => integer(v, 'maxAgeHours', 1, 2400)).toThrow(ValidationError);
  });

  it('pathSegment encodes ids', () => {
    expect(pathSegment('call_1', 'callId')).toBe('call_1');
    expect(pathSegment('a b/c?d', 'callId')).toBe('a%20b%2Fc%3Fd');
    expect(() => pathSegment('', 'callId')).toThrow(ValidationError);
  });
});
