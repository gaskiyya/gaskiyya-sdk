import type { Transport } from '../http/transport.js';
import type { SimSwapResult } from '../types.js';
import { integer, toE164 } from '../validation.js';

export interface SimSwapCheckOptions {
  maxAgeHours?: number;
  signal?: AbortSignal;
}

export class SimSwapResource {
  constructor(private readonly transport: Transport) {}

  async check(phone: string, options: SimSwapCheckOptions = {}): Promise<SimSwapResult> {
    return this.transport.request<SimSwapResult>({
      method: 'POST',
      path: '/v1/sim-swap/check',
      body: { phone: toE164(phone), maxAgeHours: integer(options.maxAgeHours ?? 240, 'maxAgeHours', 1, 2400) },
      signal: options.signal,
    });
  }
}
