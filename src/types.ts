export const MESSAGE_CATEGORIES = ['otp', 'transaction_alert', 'security_notice', 'service_update', 'marketing', 'call_follow_up'] as const;
export const MESSAGE_CHANNELS = ['sms', 'whatsapp', 'email', 'push'] as const;
export const CALL_PURPOSES = ['card_activation', 'fraud_check', 'loan_follow_up', 'account_update', 'service_follow_up'] as const;

export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type CallPurpose = (typeof CALL_PURPOSES)[number];
export type CallStatus = 'open' | 'answered' | 'ended' | 'expired';
export type SimSwapStatus = 'swapped' | 'not_swapped' | 'unknown';

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface RegisteredMessage {
  recordId: string;
  expiresAt: string;
  simSwapWarning?: boolean;
  simSwapStatus?: SimSwapStatus;
}

export type RegisteredReceipt =
  | { receiptId: string; expiresAt: string; stored: true }
  | { receiptId: null; expiresAt: null; stored: false; reason: string };

export interface CallSession {
  id: string;
  code: string;
  status: CallStatus;
  expiresAt: string;
}

export type SimSwapResult =
  | { status: 'swapped' | 'not_swapped'; swapped: boolean; latestSimChange: string | null; maxAgeHours: number; checkedAt: string }
  | { status: 'unknown'; reason: 'provider_unavailable' | 'not_configured'; maxAgeHours: number; checkedAt: string };

export interface Advisory {
  text: string;
  status: 'draft' | 'approved' | 'withdrawn';
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt?: string | null;
  withdrawnBy?: string | null;
  withdrawnAt?: string | null;
}

export interface Campaign {
  id: string;
  summary: string;
  indicators: string[];
  linkDomains: string[];
  callbackKeyCount: number;
  firstSeen: string;
  lastSeen: string;
  reportCount: number;
  status: 'new' | 'confirmed' | 'dismissed';
  advisory: Advisory;
}

export interface RegistrationAlert {
  id: string;
  kind: 'unknown_link_domain' | 'volume_spike';
  domain: string | null;
  category: MessageCategory | null;
  channel: MessageChannel | null;
  clientId: string | null;
  count: number;
  expected: number | null;
  windowMinutes: number | null;
  firstSeen: string;
  lastSeen: string;
}

export type Metrics = Record<string, unknown>;
