// The same rules the registry applies to message text, so registered facts match what customers check.

const DOMAIN = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,63})(?=[/\s:?#]|$)/gi;
const CALLBACK = /\b(call|dial|contact|whatsapp|reach)\b[^.]{0,40}(\+?\d[\d\s#-]{6,}|#{4,})/i;

export function extractLinkDomains(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(DOMAIN)) {
    const domain = m[1]!.toLowerCase();
    if (!/^\d+(\.\d+)+$/.test(domain)) found.add(domain);
  }
  return [...found];
}

export function asksForCallback(text: string): boolean {
  return CALLBACK.test(text);
}

export interface MessageFacts {
  hasLink: boolean;
  linkDomains: string[];
  asksCallback: boolean;
}

export function messageFacts(text: string): MessageFacts {
  const linkDomains = extractLinkDomains(text);
  return { hasLink: linkDomains.length > 0, linkDomains, asksCallback: asksForCallback(text) };
}
