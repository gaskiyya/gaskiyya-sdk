# Gaskiyya SDK for Node.js

This is the SDK banks use to connect their own systems to Gaskiyya.

When your bank sends a customer an SMS, places a call or settles a transfer, you tell Gaskiyya about it. The customer can then check in the Gaskiyya app (or in your app) that it really came from you. The SDK does the talking to Gaskiyya for you and works out the message fingerprint the same way our registry and apps do.

It is meant for your servers. It needs your client secret, so it will not start in a browser, and it should never go into a mobile app.

You need Node.js 20.19 or newer.

## Install

```sh
npm install @gaskiyya/bank-sdk
```

## Credentials

When your bank is onboarded, the Gaskiyya team creates an API client for you in the admin dashboard. You get three things:

- a client ID
- a client secret, which is shown once, so store it straight away in your secret manager
- the API address for your environment

Set them as environment variables:

```sh
GASKIYYA_API_URL=https://<address from Gaskiyya>
GASKIYYA_CLIENT_ID=<client id>
GASKIYYA_CLIENT_SECRET=<client secret>
```

Then create the client:

```ts
import { Gaskiyya } from '@gaskiyya/bank-sdk';

const gaskiyya = Gaskiyya.fromEnv();

// Optional, but useful at start-up to catch a wrong secret early.
await gaskiyya.verifyCredentials();
```

You can also pass the values in directly with `new Gaskiyya({ clientId, clientSecret, baseUrl })`. If a secret leaks or you want to rotate it, ask Gaskiyya for a new client and swap the values.

## Messages

Register a message at the point you hand it to your SMS or WhatsApp gateway. Pass the exact text the customer will receive.

```ts
await gaskiyya.messages.register({
  recipient: '+2348012345678',
  text: smsText,
  category: 'transaction_alert',
  channel: 'sms',
});
```

The text itself never leaves your servers. The SDK sends Gaskiyya a fingerprint of it, the domains of any links in it, and whether it asks the customer to call a number.

A few details:

- `recipient` can also be a local number like `0803 123 4567`.
- `category` is one of `otp`, `transaction_alert`, `security_notice`, `service_update`, `marketing` or `call_follow_up`.
- `channel` defaults to `sms`. The others are `whatsapp`, `email` and `push`.
- `sentAt` defaults to now. Pass your gateway's time if you register later.
- If you register an OTP and the result has `simSwapWarning: true`, the customer's SIM was changed recently. Hold the code.

For bulk sends there is `registerMany`. It checks every message first, so nothing is sent if one of them is invalid, and then sends them 500 at a time.

```ts
await gaskiyya.messages.registerMany(
  outbox.map((m) => ({ recipient: m.phone, text: m.body, category: 'marketing' })),
);
```

## Working out fingerprints yourself

Sometimes the text is built in one service and registered from another. In that case, prepare the message where the text is, and pass the result along. Preparing needs no network and no credentials.

```ts
import { prepareMessage } from '@gaskiyya/bank-sdk';

const prepared = prepareMessage({ recipient, text, category: 'otp' });
await gaskiyya.messages.register(prepared);
```

The hashing functions are also available on their own from `@gaskiyya/bank-sdk/hashing`:

```ts
import { contentDigest } from '@gaskiyya/bank-sdk/hashing';

contentDigest('DemoBank: Debit\nAmt: NGN5,000.00\nAcc: ***5678');
// '2c0c122ad56268258bb16e6ba85fb2f9c8bab9ce1d8ff20527060f8c3151729f'
```

The fingerprint is a SHA-256 of the text after four steps. Zero-width characters are removed, the text is normalised with Unicode NFKC as of Unicode 15.1, every run of whitespace becomes a single space, and spaces at both ends are trimmed. Our test suite checks this against the same test vectors the registry and the Gaskiyya apps use, so all three always agree.

## Payment receipts

When your bank pays money into someone's account, register the receipt. The person receiving it can then confirm the money arrived before they hand over goods.

```ts
await gaskiyya.receipts.register({
  beneficiaryAccount: '0123456789',
  beneficiaryBank: '999001', // NIBSS code of the receiving bank
  amountKobo: 2_500_000,
  reference: sessionId,
  valueDate: '2026-10-20',
});
```

If the result says `stored: false`, the receiving bank is not on Gaskiyya yet, so nobody could check it. `receipts.registerMany` works the same way as for messages.

## Calls

Before an agent calls a customer, open a call. The customer's app shows the same four-digit code your agent reads out, so they know the call is real.

```ts
const call = await gaskiyya.calls.open({
  recipient: '+2348098765432',
  purpose: 'fraud_check',
  agentRef: 'agent-017',
});

showToAgent(call.code);

await gaskiyya.calls.markAnswered(call.id);
await gaskiyya.calls.end(call.id);
```

## SIM swap checks

Check a number before sending a one-time code or approving something sensitive:

```ts
const sim = await gaskiyya.simSwap.check('+2348012345678', { maxAgeHours: 72 });

if (sim.status === 'swapped') {
  holdTheCode();
}
```

## Fraud desk

```ts
const campaigns = await gaskiyya.campaigns.list();

await gaskiyya.campaigns.approveAdvisory(campaign.id, 'Ada Eze');
await gaskiyya.campaigns.withdrawAdvisory(campaign.id, 'Ada Eze');

const alerts = await gaskiyya.insights.registrationAlerts();
```

Approving an advisory sends the warning to your customers' phones. Registration alerts tell you about link domains Gaskiyya has not seen from you before, and sudden spikes in volume.

## Using Gaskiyya inside your own app

Your mobile app can run Gaskiyya checks for a customer who is signed in. For that, your backend signs a short-lived token for the customer with a key of your own. This is not the Gaskiyya client secret. You also publish the public half of that key so Gaskiyya can check the tokens.

```ts
import { CustomerTokenIssuer } from '@gaskiyya/bank-sdk/customer-tokens';

const issuer = new CustomerTokenIssuer({
  organisationId: 'yourbank',
  privateKey: process.env.GASKIYYA_CUSTOMER_KEY_PEM,
  keyId: 'app-2026-10',
});

app.get('/.well-known/gaskiyya-jwks.json', () => issuer.jwks());

app.post('/gaskiyya/customer-token', (req) =>
  issuer.issue({ phone: req.customer.phone, accounts: req.customer.accounts }),
);
```

The key can be EC P-256, RSA (2048 bits or more) or Ed25519, as a PKCS#8 PEM. Tokens last five minutes unless you set `ttlSeconds`, up to fifteen. The `accounts` list is optional. It lets the customer check payment receipts into those accounts. Send Gaskiyya the address of both endpoints during onboarding.

## When things go wrong

Every error the SDK throws is a `GaskiyyaError` with a `status`, a `code` and a `retryable` flag. The `code` is the one Gaskiyya sent, for example `sent_at_in_future`, so you can act on it.

| Error | What happened |
| --- | --- |
| `ValidationError` | The input was wrong. If the SDK caught it before sending, `field` tells you which one. |
| `AuthenticationError` | The client ID or secret was rejected, or the client was revoked. |
| `PermissionError` | The feature is not switched on for your bank, or your organisation is suspended. |
| `NotFoundError` | There is no such call or campaign. |
| `ConflictError` | The action does not fit the current state, like withdrawing an advisory that was never approved. |
| `RateLimitError` | Too many requests. `retryAfterMs` says how long to wait when Gaskiyya tells us. |
| `ServerError` | Something failed on our side. |
| `ConnectionError` | Gaskiyya could not be reached or took too long. `timedOut` tells you which. |
| `ConfigurationError` | A setting is missing or unsafe. |

```ts
import { ValidationError } from '@gaskiyya/bank-sdk';

try {
  await gaskiyya.messages.register(message);
} catch (err) {
  if (err instanceof ValidationError) {
    log.warn(`Message not registered: ${err.field ?? err.code}`);
  } else {
    throw err;
  }
}
```

## Retries

If Gaskiyya cannot be reached, times out, asks you to slow down, or has a server error, the SDK tries again up to two more times, waiting a little longer each time. Each registration carries an idempotency key that stays the same across those retries, so nothing is ever registered twice.

You can pass your own key, such as your gateway's message ID. That makes your own retries safe as well:

```ts
await gaskiyya.messages.register(message, { idempotencyKey: `sms-${gatewayId}` });
```

Every method also accepts `{ signal }` if you want to cancel a request.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `clientId`, `clientSecret` | required | From Gaskiyya |
| `baseUrl` | required | Must be https. Plain http is only allowed for localhost. |
| `timeoutMs` | 15000 | Per attempt, between 1000 and 120000 |
| `maxRetries` | 2 | Between 0 and 5 |
| `appInfo` | | Added to the User-Agent, for example `core-banking/7.2` |
| `fetch` | Node's fetch | Useful for proxies or tests |

## Working on the SDK

```sh
npm ci
npm run typecheck
npm run test:coverage
npm run check:package
```

`test:coverage` runs the unit tests and the hashing vectors, and fails if coverage drops below 95% of lines or 90% of branches. `check:package` builds the package and imports it the way a bank's code would.

There is also a live test that runs against a real Gaskiyya sandbox. It is skipped unless you set the three environment variables:

```sh
GASKIYYA_API_URL=http://localhost:8080 \
GASKIYYA_CLIENT_ID=... \
GASKIYYA_CLIENT_SECRET=... \
npm run test:live
```

GitHub Actions runs all of this on Node 20.19, 22 and 24 for every push and pull request. The live test only runs on main, using credentials kept in the `sandbox` environment.

If the registry ever changes how fingerprints are worked out, copy its `packages/test-vectors/vectors.json` into `tests/fixtures/` and its hashing files into `src/hashing/`, then run the tests until they pass.
