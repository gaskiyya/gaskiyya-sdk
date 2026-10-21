// Runs against a Gaskiyya sandbox with demo sign-in on. Skipped unless GASKIYYA_API_URL,
// GASKIYYA_CLIENT_ID and GASKIYYA_CLIENT_SECRET are set. See "Working on the SDK" in the README.
import { describe, expect, it } from 'vitest';
import { contentDigest, Gaskiyya, receiptDigest } from '../src/index.js';

const env = process.env;
const live = Boolean(env.GASKIYYA_API_URL && env.GASKIYYA_CLIENT_ID && env.GASKIYYA_CLIENT_SECRET);
const PHONE = env.GASKIYYA_TEST_PHONE ?? '+2348012345678';

async function asCustomer(method: 'GET' | 'POST', path: string, body?: unknown) {
  const base = env.GASKIYYA_API_URL!.replace(/\/+$/, '');
  const signIn = await fetch(`${base}/sim/customer-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) });
  expect(signIn.status, 'demo sign-in must be on (SIM_DEMO_LOGIN=true)').toBe(200);
  const { token } = (await signIn.json()) as { token: string };
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as Record<string, any>;
}

describe.skipIf(!live)('live registry', () => {
  const sdk = live ? Gaskiyya.fromEnv(env) : (undefined as never);

  it('accepts the credentials', async () => {
    await expect(sdk.verifyCredentials()).resolves.toBeUndefined();
  });

  it('confirms a message the SDK registered, and not a copy with one character changed', async () => {
    const text = `DemoBank: Debit NGN${Date.now() % 100_000}.00 on ***5678. Review at https://demobank.ng/tx. Not you? Call 0700 000 0000`;
    const registered = await sdk.messages.register({ recipient: PHONE, text, category: 'transaction_alert' });
    expect(registered.recordId).toMatch(/^rec_/);

    const genuine = await asCustomer('POST', '/v1/verify/message', { contentDigest: contentDigest(`  ${text.replace(/ /g, '  ')}\n`) });
    expect(genuine.verdict).toBe('confirmed');
    const tampered = await asCustomer('POST', '/v1/verify/message', { contentDigest: contentDigest(text.replace('demobank.ng', 'demo-bank.ng')) });
    expect(tampered.verdict).toBe('not_confirmed');
  });

  it('registers a batch the customer can check', async () => {
    const texts = [1, 2, 3].map((i) => `DemoBank: your one-time code is ${Date.now() % 1_000_000}${i}`);
    const records = await sdk.messages.registerMany(texts.map((text) => ({ recipient: PHONE, text, category: 'otp' as const })));
    expect(records).toHaveLength(3);
    for (const text of texts) expect((await asCustomer('POST', '/v1/verify/message', { contentDigest: contentDigest(text) })).verdict).toBe('confirmed');
  });

  it('shows the call code to the customer, then clears it when the call ends', async () => {
    const call = await sdk.calls.open({ recipient: PHONE, purpose: 'card_activation', agentRef: 'sdk-live-test' });
    const open = await asCustomer('GET', '/v1/calls/open');
    expect(open.calling).toBe(true);
    expect(open.calls.map((c: { code: string }) => c.code)).toContain(call.code);
    await expect(sdk.calls.end(call.id)).resolves.toMatchObject({ status: 'ended' });
    const after = await asCustomer('GET', '/v1/calls/open');
    expect((after.calls ?? []).map((c: { id: string }) => c.id)).not.toContain(call.id);
  });

  it('stores a receipt the beneficiary can confirm', async () => {
    const fields = { beneficiaryAccount: PHONE.slice(-10), beneficiaryBank: env.GASKIYYA_TEST_BANK_CODE ?? '999001', amountKobo: 2_500_000, reference: `SDK${Date.now()}`, valueDate: new Date().toISOString().slice(0, 10) };
    const stored = await sdk.receipts.register(fields);
    expect(stored.stored).toBe(true);
    const check = await asCustomer('POST', '/v1/verify/receipt', { receiptDigest: receiptDigest(fields), beneficiaryAccount: fields.beneficiaryAccount });
    expect(check.verdict).toBe('received');
  });

  it('answers a SIM swap check', async () => {
    const r = await sdk.simSwap.check(PHONE);
    expect(['swapped', 'not_swapped', 'unknown']).toContain(r.status);
  });

  it('refuses a wrong secret with an AuthenticationError', async () => {
    const wrong = Gaskiyya.fromEnv(env, { clientSecret: `${env.GASKIYYA_CLIENT_SECRET}-wrong` });
    await expect(wrong.verifyCredentials()).rejects.toMatchObject({ name: 'AuthenticationError', status: 401, code: 'invalid_client' });
  });

  it('returns the original record when the same idempotency key is sent again', async () => {
    const message = { recipient: PHONE, text: `DemoBank: your statement is ready ${Date.now()}`, category: 'service_update' as const };
    const key = `live-${Date.now()}`;
    const first = await sdk.messages.register(message, { idempotencyKey: key });
    const again = await sdk.messages.register(message, { idempotencyKey: key });
    expect(again.recordId).toBe(first.recordId);
  });

  it('passes on the registry\'s reason when it refuses a registration', async () => {
    const future = new Date(Date.now() + 3_600_000);
    await expect(sdk.messages.register({ recipient: PHONE, text: 'from the future', category: 'otp', sentAt: future })).rejects.toMatchObject({
      name: 'ValidationError',
      status: 400,
      code: 'sent_at_in_future',
    });
  });

  it('lists campaigns, alerts and metrics', async () => {
    expect(Array.isArray(await sdk.campaigns.list())).toBe(true);
    expect(Array.isArray(await sdk.insights.registrationAlerts())).toBe(true);
    expect(typeof (await sdk.insights.metrics())).toBe('object');
  });

  it('reports an unknown call as NotFoundError', async () => {
    await expect(sdk.calls.end('call_does_not_exist')).rejects.toMatchObject({ name: 'NotFoundError', status: 404 });
  });
});
