import { ValidationError } from '../errors.js';
import { contentDigest, DIGEST_PATTERN } from '../hashing/canonical.js';
import { messageFacts } from '../hashing/message-facts.js';
import type { Transport } from '../http/transport.js';
import { MESSAGE_CATEGORIES, MESSAGE_CHANNELS, type MessageCategory, type MessageChannel, type RegisteredMessage, type RequestOptions } from '../types.js';
import { domains, isoTime, oneOf, toE164 } from '../validation.js';
import { chunks, defaultIds, idempotencyKey, MAX_BATCH, type IdGenerator } from './shared.js';

export interface MessageInput {
  recipient: string;
  text: string;
  category: MessageCategory;
  channel?: MessageChannel;
  sentAt?: Date | string;
  linkDomains?: string[];
  asksCallback?: boolean;
}

export interface PreparedMessage {
  recipient: string;
  channel: MessageChannel;
  contentDigest: string;
  category: MessageCategory;
  hasLink: boolean;
  linkDomains: string[];
  asksCallback: boolean;
  sentAt: string;
}

export function prepareMessage(input: MessageInput): PreparedMessage {
  if (typeof input?.text !== 'string' || !input.text.trim()) throw new ValidationError('text must be the message exactly as sent', 'text');
  const facts = messageFacts(input.text);
  const linkDomains = domains(input.linkDomains ?? facts.linkDomains);
  return {
    recipient: toE164(input.recipient, 'recipient'),
    channel: oneOf(input.channel ?? 'sms', MESSAGE_CHANNELS, 'channel'),
    contentDigest: contentDigest(input.text),
    category: oneOf(input.category, MESSAGE_CATEGORIES, 'category'),
    hasLink: facts.hasLink || linkDomains.length > 0,
    linkDomains,
    asksCallback: input.asksCallback ?? facts.asksCallback,
    sentAt: isoTime(input.sentAt, 'sentAt'),
  };
}

function checkPrepared(m: PreparedMessage): PreparedMessage {
  if (typeof m.contentDigest !== 'string' || !DIGEST_PATTERN.test(m.contentDigest)) {
    throw new ValidationError('contentDigest must be 64 lowercase hex characters', 'contentDigest');
  }
  const linkDomains = domains(m.linkDomains ?? []);
  return {
    recipient: toE164(m.recipient, 'recipient'),
    channel: oneOf(m.channel, MESSAGE_CHANNELS, 'channel'),
    contentDigest: m.contentDigest,
    category: oneOf(m.category, MESSAGE_CATEGORIES, 'category'),
    hasLink: Boolean(m.hasLink) || linkDomains.length > 0,
    linkDomains,
    asksCallback: Boolean(m.asksCallback),
    sentAt: isoTime(m.sentAt, 'sentAt'),
  };
}

const toWire = (m: MessageInput | PreparedMessage): PreparedMessage => ('contentDigest' in m ? checkPrepared(m) : prepareMessage(m));

export class MessagesResource {
  constructor(
    private readonly transport: Transport,
    private readonly ids: IdGenerator = defaultIds,
  ) {}

  prepare(input: MessageInput): PreparedMessage {
    return prepareMessage(input);
  }

  async register(message: MessageInput | PreparedMessage, options: RequestOptions = {}): Promise<RegisteredMessage> {
    return this.transport.request<RegisteredMessage>({
      method: 'POST',
      path: '/v1/messages',
      body: toWire(message),
      idempotencyKey: idempotencyKey(options, this.ids),
      signal: options.signal,
    });
  }

  async registerMany(messages: readonly (MessageInput | PreparedMessage)[], options: RequestOptions = {}): Promise<RegisteredMessage[]> {
    const wire = messages.map(toWire);
    if (!wire.length) return [];
    const key = idempotencyKey(options, this.ids);
    const records: RegisteredMessage[] = [];
    for (const [i, batch] of chunks(wire, MAX_BATCH).entries()) {
      const r = await this.transport.request<{ records: RegisteredMessage[] }>({
        method: 'POST',
        path: '/v1/messages/batch',
        body: { messages: batch },
        idempotencyKey: `${key}:${i}`,
        signal: options.signal,
      });
      records.push(...r.records);
    }
    return records;
  }
}
