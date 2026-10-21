import type { Transport } from '../http/transport.js';
import { CALL_PURPOSES, type CallPurpose, type CallSession, type RequestOptions } from '../types.js';
import { oneOf, pathSegment, text, toE164 } from '../validation.js';
import { defaultIds, idempotencyKey, type IdGenerator } from './shared.js';

export interface OpenCallInput {
  recipient: string;
  purpose: CallPurpose;
  agentRef: string;
}

export class CallsResource {
  constructor(
    private readonly transport: Transport,
    private readonly ids: IdGenerator = defaultIds,
  ) {}

  async open(input: OpenCallInput, options: RequestOptions = {}): Promise<CallSession> {
    return this.transport.request<CallSession>({
      method: 'POST',
      path: '/v1/calls',
      body: {
        recipient: toE164(input.recipient, 'recipient'),
        purpose: oneOf(input.purpose, CALL_PURPOSES, 'purpose'),
        agentRef: text(input.agentRef, 'agentRef', { max: 64 }),
      },
      idempotencyKey: idempotencyKey(options, this.ids),
      signal: options.signal,
    });
  }

  async markAnswered(callId: string, options: Pick<RequestOptions, 'signal'> = {}): Promise<CallSession> {
    return this.update(callId, 'answered', options.signal);
  }

  async end(callId: string, options: Pick<RequestOptions, 'signal'> = {}): Promise<CallSession> {
    return this.update(callId, 'ended', options.signal);
  }

  private async update(callId: string, status: 'answered' | 'ended', signal: AbortSignal | undefined): Promise<CallSession> {
    return this.transport.request<CallSession>({ method: 'PATCH', path: `/v1/calls/${pathSegment(callId, 'callId')}`, body: { status }, signal });
  }
}
