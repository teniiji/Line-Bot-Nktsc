// The last thing that happens to a reply before LINE gets it.
//
// Two things the model writes that LINE renders in ways nobody wanted.
//
// **The gambling advert.** The cooperative's real email address has "nktsc.org"
// as its local part — nothing to do with the old nktsc.org website, which
// expired and is now squatted with gambling content. LINE's client treats that
// substring as a link-preview target with no scheme in front of it, fetches
// the squatter's page, and renders its card inside the cooperative's own
// official channel, under a message about postponing a payment.
//
// There was already a defence: the knowledge entry writes the address with a
// U+2060 WORD JOINER between "nktsc" and ".org", which breaks the match while
// staying invisible and copy-pasteable. It did not survive, because the model
// does not copy that string — it retypes it. The reply that carried the
// advert had put the address in markdown bold, which is proof it was rewritten
// rather than quoted, and an invisible character does not survive a rewrite.
//
// So the defence belongs here instead: after the model has written whatever it
// wrote, before LINE sees any of it. Whatever the model types has to come
// through this function, which is the only thing that can be said of any point
// in the pipeline.
//
// **The asterisks.** LINE renders no markdown at all, so "**ติดต่อสำนักงาน
// สหกรณ์:**" reaches members with the asterisks in it. Nothing in the prompt
// forbade markdown, and telling the model not to use it is worth doing but is
// not a guarantee. This is.

import { stripDisallowedLinks } from "./links";

// U+2060 WORD JOINER: no width, no line-break opportunity, and not a space —
// so the address still reads and copies correctly, but the client's
// domain-matching sees "nktsc" and ".org" as separate runs.
const WORD_JOINER = "⁠";

// Only endings that are really domains. Deliberately a list rather than "any
// letters after a dot": a filename (รายการหัก.xlsx), a decimal (1,234.56), a
// time (15.00) and a Thai abbreviation (น.ส., ส.ส.ค.) all contain a dot, and
// none of them should be touched.
const TLDS = [
  "com", "org", "net", "co", "th", "info", "biz", "io", "ai", "app", "dev",
  "me", "tv", "cc", "xyz", "online", "site", "shop", "club", "live", "store",
  "top", "asia", "email", "link",
];

// A label followed by one of those endings. ASCII only on both sides, so Thai
// abbreviations written with dots are never candidates.
const BARE_DOMAIN = new RegExp(`([A-Za-z0-9][A-Za-z0-9-]*)\\.(${TLDS.join("|")})\\b`, "gi");

// Whole URLs, which have already been through the allowlist by the time this
// runs. Their hosts must keep working as links, so they are cut out and put
// back unchanged.
const URL = /https?:\/\/[^\s<>()[\]{}"']+/gi;

/**
 * Breaks the client's domain matching on anything that is not an allowed
 * link, so a bare domain in ordinary text cannot pull a preview card in.
 */
export function defuseBareDomains(text: string): string {
  const out: string[] = [];
  let last = 0;
  for (const match of text.matchAll(URL)) {
    const at = match.index ?? 0;
    out.push(text.slice(last, at).replace(BARE_DOMAIN, `$1${WORD_JOINER}.$2`));
    out.push(match[0]);
    last = at + match[0].length;
  }
  out.push(text.slice(last).replace(BARE_DOMAIN, `$1${WORD_JOINER}.$2`));
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
 * url; then the allowlist; then bare domains in whatever prose is left.
 */
export function sanitiseReplyText(
  text: string,
  extraAllowedHosts: Set<string> = new Set()
): string {
  return defuseBareDomains(stripDisallowedLinks(stripMarkdown(text), extraAllowedHosts));
}
