import { describe, expect, it } from 'vitest';
import { AuthenticationError, ClientCredentialsTokenProvider, ConnectionError, ServerError, type Transport } from '../src/index.js';
import { CREDENTIALS } from './helpers.js';

function scripted(answers: (() => unknown)[]) {
  const calls: unknown[] = [];
  const transport: Transport = {
    request: async <T>(req: unknown) => {
      calls.push(req);
      const next = answers[calls.length - 1];
      if (!next) throw new Error('unexpected token request');
      return (await next()) as T;
    },
  };
  return { transport, calls };
}

const token = (value: string, expiresIn = 600) => () => ({ access_token: value, token_type: 'Bearer', expires_in: expiresIn });

describe('ClientCredentialsTokenProvider', () => {
  it('posts the client credentials grant without bearer authentication', async () => {
    const { transport, calls } = scripted([token('t1')]);
    await new ClientCredentialsTokenProvider(transport, CREDENTIALS).getToken();
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/v1/oauth/token',
      body: { grant_type: 'client_credentials', client_id: CREDENTIALS.clientId, client_secret: CREDENTIALS.clientSecret },
      authenticated: false,
    });
  });

  it('shares one request between concurrent callers, including when it fails', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { transport, calls } = scripted([
      async () => {
        await gate;
        throw new ConnectionError('down', false);
      },
      token('t2'),
    ]);
    const tokens = new ClientCredentialsTokenProvider(transport, CREDENTIALS);
    const waiting = [tokens.getToken(), tokens.getToken(), tokens.getToken()];
    release();
    for (const w of waiting) await expect(w).rejects.toBeInstanceOf(ConnectionError);
    expect(calls).toHaveLength(1);

    await expect(tokens.getToken()).resolves.toBe('t2');
    expect(calls).toHaveLength(2);
  });

  it('passes authentication failures straight through', async () => {
    const { transport } = scripted([
      () => {
        throw new AuthenticationError('Unknown client or wrong secret', { status: 401, code: 'invalid_client' });
      },
    ]);
    await expect(new ClientCredentialsTokenProvider(transport, CREDENTIALS).getToken()).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it.each([
    ['no token', { expires_in: 600 }],
    ['empty token', { access_token: '', expires_in: 600 }],
    ['no lifetime', { access_token: 'x' }],
    ['zero lifetime', { access_token: 'x', expires_in: 0 }],
    ['text lifetime', { access_token: 'x', expires_in: '600' }],
    ['empty body', undefined],
  ])('rejects a malformed token response: %s', async (_name, body) => {
    const { transport } = scripted([() => body]);
    await expect(new ClientCredentialsTokenProvider(transport, CREDENTIALS).getToken()).rejects.toMatchObject({ name: 'ServerError', code: 'malformed_token' });
    await expect(new ClientCredentialsTokenProvider(scripted([() => body]).transport, CREDENTIALS).getToken()).rejects.toBeInstanceOf(ServerError);
  });

  it('refreshes short-lived tokens with a proportional margin', async () => {
    let now = 0;
    const { transport } = scripted([token('t1', 100), token('t2', 100)]);
    const tokens = new ClientCredentialsTokenProvider(transport, CREDENTIALS, () => now);
    await tokens.getToken();
    now = 79_000;
    await expect(tokens.getToken()).resolves.toBe('t1');
    now = 80_000;
    await expect(tokens.getToken()).resolves.toBe('t2');
  });

  it('fetches a new token after invalidate', async () => {
    const { transport } = scripted([token('t1'), token('t2')]);
    const tokens = new ClientCredentialsTokenProvider(transport, CREDENTIALS);
    await tokens.getToken();
    tokens.invalidate();
    await expect(tokens.getToken()).resolves.toBe('t2');
  });
});
