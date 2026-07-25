import { prisma } from "./prisma";

// Direct download links per form type, embedded into the agent's system
// prompt so it can answer with the exact URL instead of the "contact the
// office" fallback (lib/agent/prompts.ts). Starts empty — there's no safe
// default to fall back to (unlike lib/knowledge.ts's rates/welfare/contact
// info), only staff have the real URLs, so no links means no exception to
// the blanket link-printing ban in lib/links.ts (which also needs each
// link's hostname to actually let it through — see getFormLinksData).
export function formatFormLinks(entries: { label: string; url: string }[]): string {
  return entries.map((e) => `- ${e.label}: ${e.url}`).join("\n");
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export type FormLinksData = { text: string; hosts: Set<string> };

// Same short-TTL cache pattern as lib/knowledge.ts — a serverless instance
// can serve many webhook calls in a row, so avoid a DB round-trip on every
// single message while still picking up a dashboard edit within a minute.
// text and hosts are cached together (one query) since both are always
// needed on the same request — the prompt to know what to offer, the
// hostname set for lib/links.ts's stripDisallowedLinks to know what to let
// through.
let cached: { data: FormLinksData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function getFormLinksData(): Promise<FormLinksData> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  let data: FormLinksData;
  try {
    const entries = await prisma.formLink.findMany({
      orderBy: { label: "asc" },
      select: { label: true, url: true },
    });
    const hosts = new Set<string>();
    for (const e of entries) {
      const host = hostnameOf(e.url);
      if (host) hosts.add(host);
    }
    data = { text: formatFormLinks(entries), hosts };
  } catch (err) {
    console.error("[formLinks] read error, treating as no links configured:", err);
    data = { text: "", hosts: new Set() };
  }
  cached = { data, fetchedAt: Date.now() };
  return data;
}
