import { createHash } from 'node:crypto';
import { ASSIGNED_RANGES, UNICODE_VERSION } from './unicode-assigned.js';

// Must match the registry and the Gaskiyya apps byte for byte.

export { UNICODE_VERSION };

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

// An explicit set, because \s differs between the platforms Gaskiyya hashes on.
const WHITESPACE_RUN =
  // eslint-disable-next-line no-control-regex
  /[\t\n\u000B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function isAssigned(cp: number): boolean {
  let lo = 0;
  let hi = ASSIGNED_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ASSIGNED_RANGES[mid * 2]!) hi = mid - 1;
    else if (cp > ASSIGNED_RANGES[mid * 2 + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

// NFKC as of UNICODE_VERSION: code points unassigned in that version pass through untouched,
// so a newer runtime cannot change a digest.
function nfkcPinned(text: string): string {
  let out = '';
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (!isAssigned(cp)) {
      out += text.slice(start, i).normalize('NFKC') + text.slice(i, i + width);
      start = i + width;
    }
    i += width;
  }
  return out + text.slice(start).normalize('NFKC');
}

export function canonicalise(text: string): string {
  return nfkcPinned(text.replace(ZERO_WIDTH, ''))
    .replace(WHITESPACE_RUN, ' ')
    .replace(/^ +| +$/g, '');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function contentDigest(text: string): string {
  return sha256Hex(canonicalise(text));
}
