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
// The final comparison is constant-time (constantTimeEqual below), not
// `===`. A plain `===` on strings short-circuits at the first mismatched
// character, so a wrong guess that happens to share a longer correct
// prefix takes measurably longer to reject than one that's wrong from
// character 1 — enough of a timing side channel, over enough attempts,
// to let an attacker recover the password one character at a time.
// crypto.timingSafeEqual is Node's normal fix for this, but it isn't
// available here — this file has to run in the Edge runtime (see the
// atob/Buffer note above), which has no Node crypto module.
// constantTimeEqual reimplements the same guarantee — always inspects
// every byte of the longer input, never returns early on a mismatch —
// using only Uint8Array/TextEncoder, which the Edge runtime does have.
//
// Kept in its own module (no next/server imports) so it can be unit-tested
// without the Edge-runtime request/response machinery.

// Compares two byte strings without ever branching on *where* they first
// differ. The XOR-and-accumulate pattern means every call touches exactly
// max(a.length, b.length) bytes regardless of how much of a/b matches —
// there is no early return, and no code path whose timing depends on the
// comparison's outcome partway through.
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  // XOR the lengths in too, so two different-length inputs can never
  // compare equal — this still doesn't leak *where* they differ, only
  // that they do, same as a normal failed comparison would.
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const x = i < a.length ? a[i] : 0;
    const y = i < b.length ? b[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

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
  const suppliedUser = decoded.slice(0, sep);
  const suppliedPassword = decoded.slice(sep + 1);

  // Both comparisons always run in full before the result is combined —
  // `&&` here branches on two already-fully-computed booleans, not on
  // secret byte content, so it doesn't reopen the timing hole the
  // constant-time comparisons above just closed.
  const encoder = new TextEncoder();
  const userOk = constantTimeEqual(encoder.encode(suppliedUser), encoder.encode(user));
  const passwordOk = constantTimeEqual(
    encoder.encode(suppliedPassword),
    encoder.encode(password)
  );
  return userOk && passwordOk;
}
