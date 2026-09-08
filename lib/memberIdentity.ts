// Merging identity a member gives one piece at a time.
//
// submit_member_info used to demand the name and the member number in the
// same call and error out otherwise, saving nothing. Members do not answer
// that way. From a real conversation:
//
//   10:56  member: "เลขที่สมาชิกสหกรณ์ 29252ค่ะ เลขที่บัญชี30-00030096"
//          → number only → rejected, nothing saved → bot asks for the name
//   10:57  member: "ฉันชื่อนางพิศวง พรหมจรรย์ค่ะ"
//          → name only → rejected, nothing saved → bot asks for the number
//   10:59  member: "สลิปก็ส่งให้แล้ว ไม่เข้าใจคือว่าไรคะ"
//
// She had given both. The system kept neither, because each message is
// processed with no memory of the last one and the database was the only
// place either piece could have survived — and nothing was written to it.
//
// So each piece is saved as it arrives and the bot asks only for what is
// genuinely still missing. The one rule that must not bend: a piece that was
// not given this time never overwrites one already saved. Blanking a name
// the member gave a minute ago would recreate the same loop from the other
// direction.

import { isPlaceholderText } from "./placeholderText";

export interface IdentityPieces {
  fullName: string | null;
  memberNumber: string | null;
}

export interface IdentityMerge extends IdentityPieces {
  // What still has to be asked for, if anything.
  missing: "fullName" | "memberNumber" | "both" | null;
}

// A value the member actually stated, or null. A placeholder counts as null:
// the point of the original guard was that "<UNKNOWN>" must never be stored
// as if it were a real name or number, and that still holds.
export function statedValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || isPlaceholderText(trimmed)) return null;
  return trimmed;
}

export function mergeIdentity(given: IdentityPieces, saved: IdentityPieces): IdentityMerge {
  // Given wins where given exists; saved fills the rest. Never the other way
  // round — a member correcting their name must not be ignored because a name
  // is already on file.
  const fullName = given.fullName ?? saved.fullName;
  const memberNumber = given.memberNumber ?? saved.memberNumber;

  const missing =
    !fullName && !memberNumber
      ? "both"
      : !fullName
        ? "fullName"
        : !memberNumber
          ? "memberNumber"
          : null;

  return { fullName, memberNumber, missing };
}

// What to tell the model when identity is still incomplete. It names only the
// missing piece and confirms the one already held, so the member is not asked
// again for something they have just said — being asked twice for the same
// thing is what made the conversation above break down.
export function askForMissingIdentity(merge: IdentityMerge): string {
  if (merge.missing === "both") {
    return "Error: no name and no member number were given. Ask the user, in Thai, for their ชื่อ-นามสกุล and เลขสมาชิก — do not call this tool again until they have stated at least one of them.";
  }
  if (merge.missing === "fullName") {
    return (
      `Saved: member number ${merge.memberNumber}. Still missing: the member's full name. ` +
      "Ask the user, in Thai, ONLY for their ชื่อ-นามสกุล — their member number is already on record, so do not ask for it again. " +
      "Call submit_member_info again with just the name when they give it."
    );
  }
  return (
    `Saved: the name "${merge.fullName}". Still missing: their เลขสมาชิก. ` +
    "Ask the user, in Thai, ONLY for their เลขสมาชิก — their name is already on record, so do not ask for it again. " +
    "Call submit_member_info again with just the member number when they give it."
  );
}

// Reasons a member number must not be stored, wherever it was typed. The bot
// learned each of these the hard way, and staff typing into the dashboard can
// make exactly the same mistakes — so both ask here rather than keeping two
// copies that drift.
//
// Returns null when the value is fine to store.
export function memberNumberProblem(memberNumber: string): string | null {
  // A message giving a name alongside a 13-digit all-numeric string is far
  // more likely to be a เลขประจำตัวประชาชน than a cooperative member number —
  // real member numbers here run a handful of digits, never 13. Seen in
  // production through the bot; a person reading an ID card copy can slip the
  // same way.
  if (/^\d{13}$/.test(memberNumber)) {
    return "เลข 13 หลักนี้น่าจะเป็นเลขประจำตัวประชาชน ไม่ใช่เลขสมาชิก — เลขสมาชิกของสหกรณ์สั้นกว่านี้มาก";
  }
  // Deliberately nothing about shape beyond that. Member numbers here look
  // numeric in every sample seen, but "looks numeric in the samples I saw" is
  // not the same as "the cooperative never issued another kind", and a rule
  // that rejects a real member's number is worse than one that accepts an odd
  // one a person can see and correct.
  return null;
}

// Said when a member number is already bound to somebody else's LINE account.
// Refused in both places for the same reason: it is the one check standing
// between a typo and one member's transactions being filed under another's.
export const MEMBER_NUMBER_TAKEN_ERROR =
  "เลขสมาชิกนี้ผูกกับบัญชี LINE อื่นอยู่แล้ว — ตรวจสอบให้แน่ใจก่อน " +
  "ถ้าสมาชิกเปลี่ยนบัญชี LINE ต้องล้างการผูกของบัญชีเดิมก่อน";
