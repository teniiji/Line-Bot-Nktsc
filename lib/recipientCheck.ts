// Deterministic backstop for the prompt's ขั้นที่ 1.5 rule (only slips
// transferring to the cooperative's own account may be logged). The rule
// alone proved unreliable in production: the model read a slip paying a
// private individual and still claimed the money went to the cooperative.
// The model is only trusted to *transcribe* the slip's "ไปยัง" (recipient)
// field — which it does reliably, as senderName showed — and this module
// makes the accept/reject judgment in code.
//
// Three-way classification, deliberately conservative about rejecting so a
// bank's own display quirks (masking, romanization, truncation) can never
// block a genuine cooperative transfer:
// - "cooperative": clearly this cooperative → accept
// - "person": carries a personal-name title (นาย/นาง/ด.ญ./Mr ฯลฯ) →
//   clearly an individual, never the cooperative's account → reject
// - "unknown": anything else (shops, unfamiliar spellings, English names)
//   → left to the model's prompt-rule judgment, as before

const PERSON_TITLE_PREFIXES = [
  "นางสาว",
  "นาง",
  "นาย",
  "น.ส.",
  "ด.ช.",
  "ด.ญ.",
  "เด็กชาย",
  "เด็กหญิง",
  "mr.",
  "mrs.",
  "ms.",
  "miss",
  "mr ",
  "mrs ",
  "ms ",
];

// Substrings that clearly identify the cooperative, checked space-insensitively.
// "สหกรณ" (no ์) also covers masked/truncated renderings like "สหกรณ์ออมทรัพย์ครูหนองค***".
const COOPERATIVE_MARKERS = ["สหกรณ", "สอ.ครู", "สอครู"];

export type RecipientKind = "cooperative" | "person" | "unknown";

export function classifyRecipient(recipientName: string): RecipientKind {
  const normalized = recipientName.trim().toLowerCase();
  const spaceless = normalized.replace(/\s+/g, "");
  if (!spaceless) return "unknown";

  if (COOPERATIVE_MARKERS.some((marker) => spaceless.includes(marker))) {
    return "cooperative";
  }
  if (PERSON_TITLE_PREFIXES.some((title) => normalized.startsWith(title))) {
    return "person";
  }
  return "unknown";
}
