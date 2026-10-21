import type { Transport } from '../http/transport.js';
import type { Metrics, RegistrationAlert } from '../types.js';

type Signal = { signal?: AbortSignal };

export class InsightsResource {
  constructor(private readonly transport: Transport) {}

  async metrics(options: Signal = {}): Promise<Metrics> {
    return this.transport.request<Metrics>({ method: 'GET', path: '/v1/metrics', signal: options.signal });
  }

  async registrationAlerts(options: Signal = {}): Promise<RegistrationAlert[]> {
    const r = await this.transport.request<{ alerts: RegistrationAlert[] }>({ method: 'GET', path: '/v1/registration-alerts', signal: options.signal });
    return r.alerts;
  }
}
