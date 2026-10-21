import { ValidationError } from '../errors.js';
import { DIGEST_PATTERN } from '../hashing/canonical.js';
import { receiptDigest } from '../hashing/index.js';
import { normaliseAccount, normaliseBankCode, ReceiptFieldError, type ReceiptFields } from '../hashing/receipt.js';
import type { Transport } from '../http/transport.js';
import type { RegisteredReceipt, RequestOptions } from '../types.js';
import { chunks, defaultIds, idempotencyKey, MAX_BATCH, type IdGenerator } from './shared.js';

export type ReceiptInput = ReceiptFields;

export interface PreparedReceipt {
  receiptDigest: string;
  beneficiaryAccount: string;
  beneficiaryBank: string;
}

function asValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ReceiptFieldError) throw new ValidationError(err.message, err.field);
    throw err;
  }
}

export function prepareReceipt(input: ReceiptInput): PreparedReceipt {
  return asValidation(() => ({
    receiptDigest: receiptDigest(input),
    beneficiaryAccount: normaliseAccount(input.beneficiaryAccount),
    beneficiaryBank: normaliseBankCode(input.beneficiaryBank),
  }));
}

function checkPrepared(r: PreparedReceipt): PreparedReceipt {
  if (typeof r.receiptDigest !== 'string' || !DIGEST_PATTERN.test(r.receiptDigest)) {
    throw new ValidationError('receiptDigest must be 64 lowercase hex characters', 'receiptDigest');
  }
  return asValidation(() => ({
    receiptDigest: r.receiptDigest,
    beneficiaryAccount: normaliseAccount(r.beneficiaryAccount),
    beneficiaryBank: normaliseBankCode(r.beneficiaryBank),
  }));
}

const toWire = (r: ReceiptInput | PreparedReceipt): PreparedReceipt => ('receiptDigest' in r ? checkPrepared(r) : prepareReceipt(r));

export class ReceiptsResource {
  constructor(
    private readonly transport: Transport,
    private readonly ids: IdGenerator = defaultIds,
  ) {}

  prepare(input: ReceiptInput): PreparedReceipt {
    return prepareReceipt(input);
  }

  async register(receipt: ReceiptInput | PreparedReceipt, options: RequestOptions = {}): Promise<RegisteredReceipt> {
    return this.transport.request<RegisteredReceipt>({
      method: 'POST',
      path: '/v1/receipts',
      body: toWire(receipt),
      idempotencyKey: idempotencyKey(options, this.ids),
      signal: options.signal,
    });
  }

  async registerMany(receipts: readonly (ReceiptInput | PreparedReceipt)[], options: RequestOptions = {}): Promise<RegisteredReceipt[]> {
    const wire = receipts.map(toWire);
    if (!wire.length) return [];
    const key = idempotencyKey(options, this.ids);
    const results: RegisteredReceipt[] = [];
    for (const [i, batch] of chunks(wire, MAX_BATCH).entries()) {
      const r = await this.transport.request<{ receipts: RegisteredReceipt[] }>({
        method: 'POST',
        path: '/v1/receipts/batch',
        body: { receipts: batch },
        idempotencyKey: `${key}:${i}`,
        signal: options.signal,
      });
      results.push(...r.receipts);
    }
    return results;
  }
}
