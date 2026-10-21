import { describe, expect, it } from 'vitest';
import {
  canonicalise,
  contentDigest,
  extractLinkDomains,
  lagosDate,
  messageFacts,
  parseAmountToKobo,
  prepareReceipt,
  receiptDigest,
  canonicalReceipt,
  UNICODE_VERSION,
  ValidationError,
} from '../src/index.js';
import vectors from './fixtures/vectors.json' with { type: 'json' };

const messages = new Map(vectors.vectors.map((v) => [v.id, v]));
const receipts = new Map(vectors.receipts.map((r) => [r.id, r]));

describe('message hashing matches the registry', () => {
  it('pins the same Unicode version', () => {
    expect(UNICODE_VERSION).toBe('15.1');
  });

  it('gives the canonical text and digest of every shared vector', () => {
    for (const v of vectors.vectors) {
      expect(canonicalise(v.input), v.id).toBe(v.canonical);
      expect(contentDigest(v.input), v.id).toBe(v.digest);
    }
  });

  it('ignores whitespace, zero-width and compatibility differences', () => {
    for (const group of vectors.sameDigestGroups) {
      expect(new Set(group.map((id) => contentDigest(messages.get(id)!.input))).size, group.join(',')).toBe(1);
    }
  });

  it('changes the digest when one meaningful character changes', () => {
    for (const [a, b] of vectors.differentDigestPairs) {
      expect(contentDigest(messages.get(a!)!.input), `${a} vs ${b}`).not.toBe(contentDigest(messages.get(b!)!.input));
    }
  });
});

describe('receipt hashing matches the registry', () => {
  it('gives the canonical form and digest of every valid receipt, and rejects the same fields', () => {
    for (const r of vectors.receipts) {
      if (r.error) {
        expect(() => prepareReceipt(r.fields), r.id).toThrow(ValidationError);
        try {
          prepareReceipt(r.fields);
        } catch (err) {
          expect((err as ValidationError).field, r.id).toBe(r.error);
        }
        continue;
      }
      expect(canonicalReceipt(r.fields), r.id).toBe(r.canonical);
      expect(receiptDigest(r.fields), r.id).toBe(r.digest);
      expect(prepareReceipt(r.fields).receiptDigest, r.id).toBe(r.digest);
    }
  });

  it('treats equivalent receipts alike and different receipts apart', () => {
    for (const group of vectors.receiptSameGroups) {
      expect(new Set(group.map((id) => receiptDigest(receipts.get(id)!.fields))).size, group.join(',')).toBe(1);
    }
    for (const [a, b] of vectors.receiptDifferentPairs) {
      expect(receiptDigest(receipts.get(a!)!.fields), `${a} vs ${b}`).not.toBe(receiptDigest(receipts.get(b!)!.fields));
    }
  });

  it('parses amounts and Lagos dates the same way', () => {
    for (const a of vectors.amounts) expect(parseAmountToKobo(a.input), a.input).toBe(a.kobo);
    for (const d of vectors.lagosDates) expect(lagosDate(new Date(d.instant)), d.instant).toBe(d.date);
  });
});

describe('message facts', () => {
  it('finds link domains with or without a scheme, lower-cased and de-duplicated', () => {
    const text = 'Log in at https://DemoBank.ng/login or demobank.ng/help, and see www.demobank.com for rates. Ref 10.0.0.1, NGN5,000.00';
    expect(extractLinkDomains(text)).toEqual(['demobank.ng', 'www.demobank.com']);
  });

  it('ignores amounts, dates and IP addresses', () => {
    expect(extractLinkDomains('Debit NGN5,000.00 at 10.20.30.40 on 21-Oct-2026')).toEqual([]);
  });

  it('flags messages that ask the customer to call a number', () => {
    expect(messageFacts('Call 0700 123 4567 to confirm this transfer').asksCallback).toBe(true);
    expect(messageFacts('Your debit card has been dispatched').asksCallback).toBe(false);
  });
});
