// Imports the built package through its public entry points, as a bank's code would.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vectors = JSON.parse(readFileSync(new URL('../tests/fixtures/vectors.json', import.meta.url), 'utf8'));
const entries = {
  '@gaskiyya/bank-sdk': ['Gaskiyya', 'contentDigest', 'receiptDigest', 'prepareMessage', 'CustomerTokenIssuer', 'ValidationError', 'ConflictError'],
  '@gaskiyya/bank-sdk/hashing': ['canonicalise', 'contentDigest', 'receiptDigest', 'messageFacts', 'UNICODE_VERSION'],
  '@gaskiyya/bank-sdk/customer-tokens': ['CustomerTokenIssuer'],
};

for (const [entry, names] of Object.entries(entries)) {
  const mod = await import(entry);
  for (const name of names) assert.ok(name in mod, `${entry} does not export ${name}`);
}

const { contentDigest, receiptDigest } = await import('@gaskiyya/bank-sdk/hashing');
for (const v of vectors.vectors) assert.equal(contentDigest(v.input), v.digest, v.id);
for (const r of vectors.receipts.filter((x) => !x.error)) assert.equal(receiptDigest(r.fields), r.digest, r.id);

console.log(`package ok: ${Object.keys(entries).length} entry points, ${vectors.vectors.length} message and ${vectors.receipts.filter((x) => !x.error).length} receipt vectors from dist/`);
