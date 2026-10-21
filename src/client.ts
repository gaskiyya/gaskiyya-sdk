import { ClientCredentialsTokenProvider, type TokenProvider } from './auth/token-provider.js';
import { optionsFromEnv, resolveConfig, type GaskiyyaOptions } from './config.js';
import { HttpTransport, type HttpTransportOptions, type Transport } from './http/transport.js';
import { CallsResource } from './resources/calls.js';
import { CampaignsResource } from './resources/campaigns.js';
import { InsightsResource } from './resources/insights.js';
import { MessagesResource } from './resources/messages.js';
import { ReceiptsResource } from './resources/receipts.js';
import { SimSwapResource } from './resources/sim-swap.js';

export class Gaskiyya {
  readonly messages: MessagesResource;
  readonly receipts: ReceiptsResource;
  readonly calls: CallsResource;
  readonly simSwap: SimSwapResource;
  readonly campaigns: CampaignsResource;
  readonly insights: InsightsResource;
  readonly #tokens: TokenProvider;

  constructor(options: GaskiyyaOptions) {
    const config = resolveConfig(options);
    const http: HttpTransportOptions = {
      baseUrl: config.baseUrl,
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      userAgent: config.userAgent,
    };
    this.#tokens = new ClientCredentialsTokenProvider(new HttpTransport(http), { clientId: config.clientId, clientSecret: config.clientSecret });
    const api: Transport = new HttpTransport(http, this.#tokens);

    this.messages = new MessagesResource(api);
    this.receipts = new ReceiptsResource(api);
    this.calls = new CallsResource(api);
    this.simSwap = new SimSwapResource(api);
    this.campaigns = new CampaignsResource(api);
    this.insights = new InsightsResource(api);
  }

  static fromEnv(env: Record<string, string | undefined> = process.env, overrides: Partial<GaskiyyaOptions> = {}): Gaskiyya {
    return new Gaskiyya({ ...optionsFromEnv(env), ...overrides });
  }

  async verifyCredentials(): Promise<void> {
    this.#tokens.invalidate();
    await this.#tokens.getToken();
  }
}
