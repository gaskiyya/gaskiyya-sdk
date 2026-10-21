import { ValidationError } from './errors.js';

const E164 = /^\+[1-9]\d{6,14}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const SEPARATORS = /[\s().-]/g;

export const MAX_LINK_DOMAINS = 10;

export function toE164(value: string, field = 'phone'): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a phone number`, field);
  let v = value.replace(SEPARATORS, '');
  if (/^0\d{10}$/.test(v)) v = `+234${v.slice(1)}`;
  else if (/^234\d{10}$/.test(v)) v = `+${v}`;
  if (!E164.test(v)) throw new ValidationError(`${field} must be an E.164 number such as +2348012345678`, field);
  return v;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`, field);
}

export function isoTime(value: Date | string | undefined, field: string, now: () => Date = () => new Date()): string {
  if (value === undefined) return now().toISOString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ValidationError(`${field} is not a valid date`, field);
    return value.toISOString();
  }
  if (typeof value !== 'string' || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} must be an ISO 8601 time with a timezone`, field);
  }
  return new Date(value).toISOString();
}

export function domains(values: readonly string[], field = 'linkDomains'): string[] {
  const out = [...new Set(values.map((d) => String(d).trim().toLowerCase()))];
  const bad = out.find((d) => !DOMAIN.test(d));
  if (bad !== undefined) throw new ValidationError(`${field} has an invalid domain: ${bad}`, field);
  if (out.length > MAX_LINK_DOMAINS) throw new ValidationError(`${field} can hold at most ${MAX_LINK_DOMAINS} domains`, field);
  return out;
}

export function text(value: unknown, field: string, { min = 1, max }: { min?: number; max: number }): string {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`, field);
  const v = value.trim();
  if (v.length < min || v.length > max) throw new ValidationError(`${field} must be ${min} to ${max} characters`, field);
  return v;
}

export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be a whole number from ${min} to ${max}`, field);
  }
  return value;
}

export function pathSegment(value: unknown, field: string): string {
  return encodeURIComponent(text(value, field, { max: 128 }));
}
