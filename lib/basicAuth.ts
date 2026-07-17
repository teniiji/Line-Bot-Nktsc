// Verify an incoming HTTP Basic Auth header against expected credentials.
//
// Decodes the "Basic <base64>" header and compares the credentials directly,
// rather than re-encoding the expected pair with btoa(). btoa() only accepts
// Latin1, so a non-ASCII password (e.g. a Thai one, which cooperative staff
// may well choose) makes btoa throw InvalidCharacterError and crashes the
// middleware on every request. atob + TextDecoder round-trips the base64
// through the raw bytes and decodes them as UTF-8, so any password the
// browser can send is compared correctly. All of atob, Uint8Array, and
// TextDecoder are available in the Edge runtime (Buffer is not), so this runs
// inside Next.js middleware.
//
// Kept in its own module (no next/server imports) so it can be unit-tested
// without the Edge-runtime request/response machinery.
export function checkBasicAuth(
  header: string,
  user: string,
  password: string
): boolean {
  if (!header.startsWith("Basic ")) return false;
  const encoded = header.slice("Basic ".length).trim();
  if (!encoded) return false;

  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }

  // Split on the first colon only — a password may itself contain colons.
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  return decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password;
}
