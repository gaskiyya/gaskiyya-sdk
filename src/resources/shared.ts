import { randomUUID } from 'node:crypto';
import { ValidationError } from '../errors.js';
import type { RequestOptions } from '../types.js';

export const MAX_BATCH = 500;
const MAX_IDEMPOTENCY_KEY = 100;

export type IdGenerator = () => string;
export const defaultIds: IdGenerator = () => randomUUID();

export function idempotencyKey(options: RequestOptions, ids: IdGenerator): string {
  const key = options.idempotencyKey ?? ids();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY) {
    throw new ValidationError(`idempotencyKey must be 1 to ${MAX_IDEMPOTENCY_KEY} characters`, 'idempotencyKey');
  }
  return key;
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
