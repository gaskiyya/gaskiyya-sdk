export const RECEIPT_VERSION = 'GR1';

export interface ReceiptFields {
  beneficiaryAccount: string;
  beneficiaryBank: string;
  amountKobo: number | string;
  reference: string;
  valueDate: string;
}

export type ReceiptField = keyof ReceiptFields;

export class ReceiptFieldError extends Error {
  constructor(
    readonly field: ReceiptField,
    message: string,
  ) {
    super(message);
    this.name = 'ReceiptFieldError';
  }
}

const SEPARATORS = /[ \t\n\r\u00A0-]/g;
const MAX_AMOUNT_DIGITS = 15;

export function normaliseAccount(value: string): string {
  const v = String(value).replace(SEPARATORS, '');
  if (!/^[0-9]{10}$/.test(v)) throw new ReceiptFieldError('beneficiaryAccount', 'beneficiaryAccount must be a 10-digit account number');
  return v;
}

export function normaliseBankCode(value: string): string {
  const v = String(value).replace(SEPARATORS, '');
  if (!/^[0-9]{6}$/.test(v)) throw new ReceiptFieldError('beneficiaryBank', 'beneficiaryBank must be a 6-digit NIBSS institution code');
  return v;
}

export function normaliseAmountKobo(value: number | string): string {
  let v: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new ReceiptFieldError('amountKobo', 'amountKobo must be a whole number of kobo');
    v = String(value);
  } else {
    v = String(value);
  }
  if (!/^[1-9][0-9]*$/.test(v) || v.length > MAX_AMOUNT_DIGITS) {
    throw new ReceiptFieldError('amountKobo', `amountKobo must be a whole number of kobo from 1 to ${MAX_AMOUNT_DIGITS} digits`);
  }
  return v;
}

export function normaliseReference(value: string): string {
  const v = String(value)
    .replace(SEPARATORS, '')
    .replace(/[a-z]/g, (c) => c.toUpperCase());
  if (!/^[A-Z0-9]{6,64}$/.test(v)) throw new ReceiptFieldError('reference', 'reference must be 6 to 64 letters and digits');
  return v;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function normaliseValueDate(value: string): string {
  const v = String(value);
  const m = /^(20[0-9]{2})-([0-9]{2})-([0-9]{2})$/.exec(v);
  const bad = () => new ReceiptFieldError('valueDate', 'valueDate must be a calendar date written YYYY-MM-DD');
  if (!m) throw bad();
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw bad();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const max = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]!;
  if (day < 1 || day > max) throw bad();
  return v;
}

export function canonicalReceipt(f: ReceiptFields): string {
  return [
    RECEIPT_VERSION,
    normaliseAccount(f.beneficiaryAccount),
    normaliseBankCode(f.beneficiaryBank),
    normaliseAmountKobo(f.amountKobo),
    normaliseReference(f.reference),
    normaliseValueDate(f.valueDate),
  ].join('|');
}

export function parseAmountToKobo(text: string): number | null {
  let v = String(text).replace(/[ \u00A0]/g, '');
  v = v.replace(/^(?:NGN|N|\u20A6)/i, '');
  const m = /^([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]{1,2}))?$/.exec(v);
  if (!m) return null;
  const naira = m[1]!.replace(/,/g, '').replace(/^0+(?=[0-9])/, '');
  const kobo = (m[2] ?? '').padEnd(2, '0');
  const digits = `${naira}${kobo}`.replace(/^0+/, '');
  if (digits.length === 0 || digits.length > MAX_AMOUNT_DIGITS) return null;
  return Number(digits);
}

export function lagosDate(instant: Date): string {
  return new Date(instant.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}
