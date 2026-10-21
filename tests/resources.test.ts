import { describe, expect, it } from 'vitest';
import { contentDigest, prepareMessage, receiptDigest, ValidationError } from '../src/index.js';
import { client } from './helpers.js';

const ALERT = 'DemoBank: Debit NGN5,000.00 on ***5678. Details at https://demobank.ng/tx/91';
const SENT_AT = '2026-10-21T09:30:00.000Z';

describe('messages', () => {
  it('registers the fingerprint and facts of a message, never its text', async () => {
    const { sdk, apiRequests } = client({ 'POST /v1/messages': () => ({ status: 202, body: { recordId: 'rec_1', expiresAt: '2026-11-20T09:30:00.000Z' } }) });
    const r = await sdk.messages.register({ recipient: '0801 234 5678', text: ALERT, category: 'transaction_alert', sentAt: SENT_AT }, { idempotencyKey: 'sms-42' });

    expect(r.recordId).toBe('rec_1');
    const [req] = apiRequests();
    expect(req!.headers['idempotency-key']).toBe('sms-42');
    expect(req!.body).toEqual({
      recipient: '+2348012345678',
      channel: 'sms',
      contentDigest: contentDigest(ALERT),
      category: 'transaction_alert',
      hasLink: true,
      linkDomains: ['demobank.ng'],
      asksCallback: false,
      sentAt: SENT_AT,
    });
    expect(JSON.stringify(req!.body)).not.toContain('5,000');
  });

  it('accepts a message prepared earlier, for example in another service', async () => {
    const { sdk, apiRequests } = client({ 'POST /v1/messages': () => ({ status: 202, body: { recordId: 'rec_2' } }) });
    const prepared = prepareMessage({ recipient: '+2348012345678', text: ALERT, category: 'otp', channel: 'whatsapp', sentAt: new Date(SENT_AT) });
    await sdk.messages.register(prepared);
    expect(apiRequests()[0]!.body).toEqual(prepared);
    expect(apiRequests()[0]!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('validates before anything is sent', async () => {
    const { sdk, requests } = client({});
    const cases = [
      { recipient: '12345', text: ALERT, category: 'otp' },
      { recipient: '+2348012345678', text: '   ', category: 'otp' },
      { recipient: '+2348012345678', text: ALERT, category: 'spam' },
      { recipient: '+2348012345678', text: ALERT, category: 'otp', sentAt: '21/10/2026' },
      { recipient: '+2348012345678', text: ALERT, category: 'otp', linkDomains: ['not a domain'] },
    ];
    for (const c of cases) await expect(sdk.messages.register(c as never), JSON.stringify(c)).rejects.toBeInstanceOf(ValidationError);
    await expect(sdk.messages.register({ recipient: '+2348012345678', category: 'otp', contentDigest: 'abc' } as never)).rejects.toMatchObject({ field: 'contentDigest' });
    expect(requests).toHaveLength(0);
  });

  it('splits large batches into requests of 500 with distinct idempotency keys', async () => {
    const { sdk, apiRequests } = client({
      'POST /v1/messages/batch': (req) => ({ status: 202, body: { records: req.body.messages.map((_: unknown, i: number) => ({ recordId: `rec_${i}` })) } }),
    });
    const many = Array.from({ length: 1_201 }, (_, i) => ({ recipient: '+2348012345678', text: `Your code is ${i}`, category: 'otp' as const, sentAt: SENT_AT }));
    const records = await sdk.messages.registerMany(many, { idempotencyKey: 'run-7' });

    expect(records).toHaveLength(1_201);
    expect(apiRequests().map((r) => [r.body.messages.length, r.headers['idempotency-key']])).toEqual([
      [500, 'run-7:0'],
      [500, 'run-7:1'],
      [201, 'run-7:2'],
    ]);
  });

  it('rejects the whole batch if any message is invalid', async () => {
    const { sdk, requests } = client({});
    const batch = [
      { recipient: '+2348012345678', text: 'ok', category: 'otp' as const },
      { recipient: 'bad', text: 'ok', category: 'otp' as const },
    ];
    await expect(sdk.messages.registerMany(batch)).rejects.toMatchObject({ field: 'recipient' });
    expect(requests).toHaveLength(0);
  });
});

describe('receipts', () => {
  const fields = { beneficiaryAccount: '0123 456 789', beneficiaryBank: '999001', amountKobo: 2_500_000, reference: '000013261020130211123456789012', valueDate: '2026-10-20' };

  it('registers the receipt digest with the normalised account and bank code', async () => {
    const { sdk, apiRequests } = client({ 'POST /v1/receipts': () => ({ status: 202, body: { receiptId: 'rcp_1', expiresAt: 'x', stored: true } }) });
    await expect(sdk.receipts.register(fields)).resolves.toMatchObject({ stored: true });
    expect(apiRequests()[0]!.body).toEqual({ receiptDigest: receiptDigest(fields), beneficiaryAccount: '0123456789', beneficiaryBank: '999001' });
  });

  it('names the bad field', async () => {
    const { sdk } = client({});
    await expect(sdk.receipts.register({ ...fields, valueDate: '2026-02-30' })).rejects.toMatchObject({ name: 'ValidationError', field: 'valueDate' });
  });
});

describe('calls', () => {
  it('opens a verified call and ends it', async () => {
    const { sdk, apiRequests } = client({
      'POST /v1/calls': () => ({ status: 201, body: { id: 'call_1', code: '0418', status: 'open', expiresAt: 'x' } }),
      'PATCH /v1/calls/call_1': (req) => ({ body: { id: 'call_1', code: '0418', status: req.body.status, expiresAt: 'x' } }),
    });
    const call = await sdk.calls.open({ recipient: '+2348098765432', purpose: 'fraud_check', agentRef: ' agent-017 ' });
    expect(call.code).toBe('0418');
    await expect(sdk.calls.markAnswered(call.id)).resolves.toMatchObject({ status: 'answered' });
    await expect(sdk.calls.end(call.id)).resolves.toMatchObject({ status: 'ended' });
    expect(apiRequests()[0]!.body).toEqual({ recipient: '+2348098765432', purpose: 'fraud_check', agentRef: 'agent-017' });
  });

  it('encodes ids into the path', async () => {
    const { sdk, apiRequests } = client({});
    await sdk.calls.end('a/../b').catch(() => undefined);
    expect(apiRequests()[0]!.path).toBe('/v1/calls/a%2F..%2Fb');
  });
});

describe('SIM swap, campaigns and insights', () => {
  it('checks a SIM before sending a one-time code', async () => {
    const { sdk, apiRequests } = client({ 'POST /v1/sim-swap/check': () => ({ body: { status: 'swapped', swapped: true, latestSimChange: null, maxAgeHours: 72, checkedAt: 'x' } }) });
    await expect(sdk.simSwap.check('08012345678', { maxAgeHours: 72 })).resolves.toMatchObject({ swapped: true });
    expect(apiRequests()[0]!.body).toEqual({ phone: '+2348012345678', maxAgeHours: 72 });
    await expect(sdk.simSwap.check('08012345678', { maxAgeHours: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('works the fraud desk', async () => {
    const campaign = { id: 'cmp_1', advisory: { status: 'approved' } };
    const { sdk, apiRequests } = client({
      'GET /v1/campaigns': () => ({ body: { campaigns: [campaign] } }),
      'POST /v1/campaigns/cmp_1/approve': () => ({ body: campaign }),
      'GET /v1/registration-alerts': () => ({ body: { alerts: [] } }),
    });
    await expect(sdk.campaigns.list()).resolves.toEqual([campaign]);
    await sdk.campaigns.approveAdvisory('cmp_1', 'Ada Eze');
    await expect(sdk.insights.registrationAlerts()).resolves.toEqual([]);
    expect(apiRequests()[1]!.body).toEqual({ analyst: 'Ada Eze' });
    await expect(sdk.campaigns.approveAdvisory('cmp_1', 'A')).rejects.toMatchObject({ field: 'analyst' });
  });
});
