import { sha256Hex } from './canonical.js';
import { canonicalReceipt, type ReceiptFields } from './receipt.js';

export { canonicalise, contentDigest, DIGEST_PATTERN, UNICODE_VERSION } from './canonical.js';
export { asksForCallback, extractLinkDomains, messageFacts, type MessageFacts } from './message-facts.js';
export {
  canonicalReceipt,
  lagosDate,
  normaliseAccount,
  normaliseAmountKobo,
  normaliseBankCode,
  normaliseReference,
  normaliseValueDate,
  parseAmountToKobo,
  RECEIPT_VERSION,
  ReceiptFieldError,
  type ReceiptField,
  type ReceiptFields,
} from './receipt.js';

export function receiptDigest(fields: ReceiptFields): string {
  return sha256Hex(canonicalReceipt(fields));
}
