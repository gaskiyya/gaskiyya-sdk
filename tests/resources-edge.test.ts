import { describe, expect, it } from 'vitest';
import { ConflictError, contentDigest, extractLinkDomains, messageFacts, NotFoundError, prepareMessage, prepareReceipt, ValidationError } from '../src/index.js';
import { client } from './helpers.js';

const PHONE = '+2348012345678';
const SENT_AT = '2026-10-21T09:30:00.000Z';

describe('message facts in detail', () => {
  it.each([
    ['Visit https://demobank.ng', ['demobank.ng']],
    ['Visit http://pay.demobank.ng:8443/x?y=1#z', ['pay.demobank.ng']],
    ['Go to DEMOBANK.NG/help now', ['demobank.ng']],
    ['two: a.demobank.ng/x b.demobank.com/y', ['a.demobank.ng', 'b.demobank.com']],
    ['end of text demobank.ng', ['demobank.ng']],
    ['followed by a comma demobank.ng, then text', []],
    ['followed by a full stop demobank.ng.', []],
    ['an IP 192.168.1.20/login', []],
    ['an amount NGN12,450.10 and a time 10.30am', []],
    ['no links at all', []],
  ])('%s', (text, expected) => {
    expect(extractLinkDomains(text)).toEqual(expected);
  });

  it.each([
    ['Call 0700 123 4567 now', true],
    ['please dial +234 700 000 0000', true],
    ['WhatsApp us on 09012345678', true],
    ['Reach our desk: 0700-DEMO-BANK #### #', true],
    ['Your OTP is 123456', false],
    ['We will never call you to ask for your PIN.', false],
  ])('callback in %j: %s', (text, expected) => {
    expect(messageFacts(text).asksCallback).toBe(expected);
  });
});

describe('prepareMessage options', () => {
  const base = { recipient: PHONE, text: 'DemoBank: see https://demobank.ng/x', category: 'service_update' as const, sentAt: SENT_AT };

  it('lets the bank state link domains and the callback flag explicitly', () => {
    expect(prepareMessage({ ...base, linkDomains: ['DemoBank.com'], asksCallback: true })).toMatchObject({ hasLink: true, linkDomains: ['demobank.com'], asksCallback: true });
  });

  it('keeps hasLink when the text has a link but no domains are declared', () => {
    expect(prepareMessage({ ...base, linkDomains: [] })).toMatchObject({ hasLink: true, linkDomains: [] });
  });

  it('hashes the text exactly as sent, before any trimming', () => {
    expect(prepareMessage({ ...base, text: `  ${base.text}\n` }).contentDigest).toBe(contentDigest(base.text));
  });

  it('defaults the channel to sms and sentAt to now', () => {
    const before = Date.now();
    const m = prepareMessage({ recipient: PHONE, text: 'hello', category: 'otp' });
    expect(m.channel).toBe('sms');
    expect(Date.parse(m.sentAt)).toBeGreaterThanOrEqual(before - 1);
  });
});

describe('request behaviour', () => {
  it('refuses idempotency keys longer than 100 characters, before sending', async () => {
    const { sdk, requests } = client({});
    await expect(sdk.messages.register({ recipient: PHONE, text: 'x', category: 'otp' }, { idempotencyKey: 'k'.repeat(101) })).rejects.toMatchObject({ field: 'idempotencyKey' });
    expect(requests).toHaveLength(0);
  });

  it('stops a batch at the first failed chunk, and a retry with the same key resends identical keys', async () => {
    let fail = true;
    const { sdk, apiRequests } = client({
      'POST /v1/messages/batch': (req, n) => (n === 1 && fail ? { status: 400, body: { code: 'sent_at_in_future', message: 'sentAt is ahead' } } : { status: 202, body: { records: req.body.messages.map(() => ({ recordId: 'r' })) } }),
    });
    const many = Array.from({ length: 1_000 }, (_, i) => ({ recipient: PHONE, text: `code ${i}`, category: 'otp' as const, sentAt: SENT_AT }));
    const err = await sdk.messages.registerMany(many, { idempotencyKey: 'job-1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe('sent_at_in_future');
    fail = false;
    await expect(sdk.messages.registerMany(many, { idempotencyKey: 'job-1' })).resolves.toHaveLength(1_000);
    expect(apiRequests().map((r) => r.headers['idempotency-key'])).toEqual(['job-1:0', 'job-1:1', 'job-1:0', 'job-1:1']);
  });

  it('returns an empty list for an empty batch without calling Gaskiyya', async () => {
    const { sdk, requests } = client({});
    await expect(sdk.messages.registerMany([])).resolves.toEqual([]);
    await expect(sdk.receipts.registerMany([])).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('sends receipts in batches of 500 too', async () => {
    const { sdk, apiRequests } = client({
      'POST /v1/receipts/batch': (req) => ({ status: 202, body: { receipts: req.body.receipts.map(() => ({ receiptId: 'rcp', expiresAt: 'x', stored: true })) } }),
    });
    const fields = Array.from({ length: 501 }, (_, i) => ({ beneficiaryAccount: '0123456789', beneficiaryBank: '999001', amountKobo: i + 1, reference: `REF${100000 + i}`, valueDate: '2026-10-20' }));
    await expect(sdk.receipts.registerMany(fields)).resolves.toHaveLength(501);
    expect(apiRequests().map((r) => r.body.receipts.length)).toEqual([500, 1]);
  });

  it('accepts a prepared receipt, and rejects one with a bad digest', async () => {
    const { sdk, apiRequests } = client({ 'POST /v1/receipts': () => ({ status: 202, body: { receiptId: 'rcp', expiresAt: 'x', stored: true } }) });
    const prepared = prepareReceipt({ beneficiaryAccount: '0123456789', beneficiaryBank: '999001', amountKobo: 100, reference: 'REF123456', valueDate: '2026-10-20' });
    await sdk.receipts.register(prepared);
    expect(apiRequests()[0]!.body).toEqual(prepared);
    await expect(sdk.receipts.register({ ...prepared, receiptDigest: 'ABC' })).rejects.toMatchObject({ field: 'receiptDigest' });
  });

  it('reports an unknown receipt bank as not stored rather than failing', async () => {
    const { sdk } = client({ 'POST /v1/receipts': () => ({ status: 200, body: { receiptId: null, expiresAt: null, stored: false, reason: 'unknown_bank' } }) });
    await expect(sdk.receipts.register({ beneficiaryAccount: '0123456789', beneficiaryBank: '123456', amountKobo: 1, reference: 'REF123456', valueDate: '2026-10-20' })).resolves.toEqual({
      receiptId: null,
      expiresAt: null,
      stored: false,
      reason: 'unknown_bank',
    });
  });
});

describe('calls, SIM swap and campaigns in detail', () => {
  it('validates call input', async () => {
    const { sdk, requests } = client({});
    await expect(sdk.calls.open({ recipient: PHONE, purpose: 'sales' as never, agentRef: 'a' })).rejects.toMatchObject({ field: 'purpose' });
    await expect(sdk.calls.open({ recipient: PHONE, purpose: 'fraud_check', agentRef: 'a'.repeat(65) })).rejects.toMatchObject({ field: 'agentRef' });
    await expect(sdk.calls.end('')).rejects.toMatchObject({ field: 'callId' });
    expect(requests).toHaveLength(0);
  });

  it('reports an unknown call as NotFoundError', async () => {
    const { sdk } = client({ 'PATCH /v1/calls/call_x': () => ({ status: 404, body: { code: 'not_found', message: 'No such call session' } }) });
    await expect(sdk.calls.end('call_x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('asks about the last 240 hours by default', async () => {
    const { sdk, apiRequests } = client({ 'POST /v1/sim-swap/check': () => ({ body: { status: 'unknown', reason: 'not_configured', maxAgeHours: 240, checkedAt: 'x' } }) });
    await expect(sdk.simSwap.check(PHONE)).resolves.toMatchObject({ status: 'unknown' });
    expect(apiRequests()[0]!.body.maxAgeHours).toBe(240);
  });

  it('withdraws and dismisses campaigns, and reports a withdrawal of an unapproved advisory as a conflict', async () => {
    const { sdk, apiRequests } = client({
      'POST /v1/campaigns/cmp_1/withdraw': () => ({ status: 409, body: { code: 'not_approved', message: 'Only an approved advisory can be withdrawn' } }),
      'POST /v1/campaigns/cmp_1/dismiss': () => ({ body: { id: 'cmp_1', status: 'dismissed' } }),
      'GET /v1/metrics': () => ({ body: { messagesRegistered: 3 } }),
    });
    await expect(sdk.campaigns.withdrawAdvisory('cmp_1', 'Ada Eze')).rejects.toBeInstanceOf(ConflictError);
    await expect(sdk.campaigns.dismiss('cmp_1')).resolves.toMatchObject({ status: 'dismissed' });
    await expect(sdk.insights.metrics()).resolves.toEqual({ messagesRegistered: 3 });
    expect(apiRequests().map((r) => [r.method, r.path, r.body])).toEqual([
      ['POST', '/v1/campaigns/cmp_1/withdraw', { analyst: 'Ada Eze' }],
      ['POST', '/v1/campaigns/cmp_1/dismiss', {}],
      ['GET', '/v1/metrics', undefined],
    ]);
  });
});
