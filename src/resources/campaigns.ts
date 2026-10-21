import type { Transport } from '../http/transport.js';
import type { Campaign } from '../types.js';
import { pathSegment, text } from '../validation.js';

type Signal = { signal?: AbortSignal };

export class CampaignsResource {
  constructor(private readonly transport: Transport) {}

  async list(options: Signal = {}): Promise<Campaign[]> {
    const r = await this.transport.request<{ campaigns: Campaign[] }>({ method: 'GET', path: '/v1/campaigns', signal: options.signal });
    return r.campaigns;
  }

  async approveAdvisory(campaignId: string, analyst: string, options: Signal = {}): Promise<Campaign> {
    return this.act(campaignId, 'approve', { analyst: text(analyst, 'analyst', { min: 2, max: 100 }) }, options.signal);
  }

  async withdrawAdvisory(campaignId: string, analyst: string, options: Signal = {}): Promise<Campaign> {
    return this.act(campaignId, 'withdraw', { analyst: text(analyst, 'analyst', { min: 2, max: 100 }) }, options.signal);
  }

  async dismiss(campaignId: string, options: Signal = {}): Promise<Campaign> {
    return this.act(campaignId, 'dismiss', {}, options.signal);
  }

  private async act(campaignId: string, action: 'approve' | 'withdraw' | 'dismiss', body: object, signal: AbortSignal | undefined): Promise<Campaign> {
    return this.transport.request<Campaign>({ method: 'POST', path: `/v1/campaigns/${pathSegment(campaignId, 'campaignId')}/${action}`, body, signal });
  }
}
