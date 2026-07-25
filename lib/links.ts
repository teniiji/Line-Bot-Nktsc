// Hosts the bot is allowed to link to in a reply. TEMPORARILY EMPTY: a live
// test showed LINE's own client-side link-preview fetch of the literal
// https://www.nktscoop.com URL (the cooperative's own official homepage,
// not a URL the model chose) rendering a gambling-site preview card
// alongside the legitimate one — LINE unfurls any bare http(s) URL in a
// message client-side, independent of anything this backend does, so
// domain-allowlisting the cooperative's own site does not help while the
// site itself is suspected of serving different content to automated
// fetchers (a "cloaking" pattern that also explains why a manual Wordfence
// scan and Google `site:` search came back clean). Strip every link until
// nktscoop.com is confirmed not to do this. Re-add "nktscoop.com" /
// "www.nktscoop.com" here once that's verified.
export const ALLOWED_LINK_HOSTS = new Set<string>([]);

// extraAllowedHosts lets a caller allow specific hosts for just this one
// call — used for FormLink URLs (lib/formLinks.ts), which staff enter
// themselves through the dashboard so the bot can share a form's direct
// link. The FormLink API route (app/api/form-links) separately rejects
// nktscoop.com/www.nktscoop.com at write time so staff can't reintroduce
// the compromised domain here even by accident.
export function stripDisallowedLinks(
  text: string,
  extraAllowedHosts: Set<string> = new Set()
): string {
  return text.replace(/https?:\/\/[^\s<>()[\]{}"']+/gi, (url) => {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      hostname = "";
    }
    if (ALLOWED_LINK_HOSTS.has(hostname) || extraAllowedHosts.has(hostname)) {
      return url;
    }
    console.warn("[financeAgent] stripped disallowed link from reply:", url);
    return "[ลิงก์ถูกลบเพื่อความปลอดภัย]";
  });
}
