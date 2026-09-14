// The last thing that happens to a reply before LINE gets it.
//
// **The gambling advert.** The cooperative's real email address has "nktsc.org"
// as its local part — nothing to do with the old nktsc.org website, which
// expired and is now squatted with gambling content. LINE's client treats that
// substring as a link-preview target with no scheme in front of it, fetches
// the squatter's page, and renders its card inside the cooperative's own
// official channel, under a message about a member's identity.
//
// Two attempts have now failed to stop it, and both failed the same way — by
// trying to keep the address on screen.
//
// The first put a U+2060 WORD JOINER inside the address in the knowledge
// entry. That did not survive, because the model retypes the address rather
// than copying it, and an invisible character does not survive a rewrite.
//
// The second, here, inserted the same joiner into the finished reply, where
// nothing can retype it. It reached LINE intact and LINE unfurled the domain
// anyway: the joiner does not stop its matcher. The claim in lib/knowledge.ts
// that live testing had confirmed it does is not borne out — an advert
// appeared under a real member's conversation with the defence deployed.
//
// So the address cannot be shown. There is no arrangement of "nktsc.org" that
// is both readable as an address and invisible to a matcher looking for a
// domain, because it *is* a domain. The bot gives the office telephone
// numbers instead, and anything domain-shaped that reaches this function is
// removed rather than decorated. Losing the address from the bot's replies is
// a real cost; an advert for an online casino under the cooperative's name,
// beside a member's national ID number, is a larger one.
//
// This does not reach a person typing the same address by hand in
// chat.line.biz. Nothing here can. That one is for the cooperative to settle
// with the domain.
//
// **The asterisks.** LINE renders no markdown, so "**ติดต่อสำนักงาน
// สหกรณ์:**" reaches members with the asterisks in it. Nothing in the prompt
// forbade markdown, and telling the model not to use it is worth doing but is
// not a guarantee. This is.

import { stripDisallowedLinks } from "./links";

// Only endings that are really domains. Deliberately a list rather than "any
// letters after a dot": a filename (รายการหัก.xlsx), a decimal (1,234.56), a
// time (15.00) and a Thai abbreviation (น.ส., ส.ส.ค.) all contain a dot, and
// none of them should be touched.
const TLDS = [
  "com", "org", "net", "co", "th", "info", "biz", "io", "ai", "app", "dev",
  "me", "tv", "cc", "xyz", "online", "site", "shop", "club", "live", "store",
  "top", "asia", "email", "link",
];

const TLD_GROUP = TLDS.join("|");

// An email address, which is the only reason a domain legitimately appears in
// these replies at all. Matched before the bare-domain rule below so the whole
// address goes at once, rather than being left as "@" with its two halves
// removed around it.
const EMAIL = new RegExp(
  `[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9-]*\\.(?:${TLD_GROUP})\\b`,
  "gi"
);

// A label followed by a real domain ending. ASCII only on both sides, so Thai
// abbreviations written with dots are never candidates.
const BARE_DOMAIN = new RegExp(
  `[A-Za-z0-9][A-Za-z0-9-]*\\.(?:${TLD_GROUP})\\b`,
  "gi"
);

export const EMAIL_REMOVED = "(ติดต่อทางโทรศัพท์ได้ที่เบอร์ด้านบนค่ะ)";
export const DOMAIN_REMOVED = "[ลิงก์ถูกลบเพื่อความปลอดภัย]";

// Whole URLs, which have already been through the allowlist by the time this
// runs. Their hosts must keep working as links, so they are cut out and put
// back unchanged.
const URL = /https?:\/\/[^\s<>()[\]{}"']+/gi;

const scrub = (text: string): string =>
  text.replace(EMAIL, EMAIL_REMOVED).replace(BARE_DOMAIN, DOMAIN_REMOVED);

/**
 * Takes every domain out of the parts of the reply that are not an allowed
 * link, so nothing is left for the client to fetch a preview card for.
 */
export function stripBareDomains(text: string): string {
  const out: string[] = [];
  let last = 0;
  for (const match of text.matchAll(URL)) {
    const at = match.index ?? 0;
    out.push(scrub(text.slice(last, at)));
    out.push(match[0]);
    last = at + match[0].length;
  }
  out.push(scrub(text.slice(last)));
  return out.join("");
}

/**
 * Markdown as plain text, because LINE renders none of it.
 *
 * Single asterisks are left alone: a line beginning "* " is a bullet, and
 * members read that as a bullet. It is the paired emphasis that arrives as
 * litter.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // A link keeps both halves — the words and where they point — because
      // dropping either loses something the member needed. The URL then faces
      // the allowlist like any other.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1 $2")
      .replace(/```+([\s\S]*?)```+/g, "$1")
      .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
      .replace(/__([\s\S]+?)__/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      // Headings, at the start of a line only.
      .replace(/^#{1,6}[ \t]+/gm, "")
  );
}

/**
 * Everything a reply goes through on its way out. Ordered: markdown first, so
 * a link written as [text](url) is unwrapped before the allowlist judges the
 * url; then the allowlist; then every domain in whatever prose is left.
 */
export function sanitiseReplyText(
  text: string,
  extraAllowedHosts: Set<string> = new Set()
): string {
  return stripBareDomains(stripDisallowedLinks(stripMarkdown(text), extraAllowedHosts));
}
