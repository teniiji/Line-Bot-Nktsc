// Tool handlers for who the member is, rather than what they're trying to do.
//
// submit_member_info sits here because it serves both in-progress flows: it
// can be the last piece a transaction needs, or the last piece a service
// request needs, so it belongs with identity rather than inside either one.
// set_nickname and submit_lookup_info are identity-shaped for the same
// reason — neither one advances a transaction or a service request.
import { prisma } from "../prisma";
import { isPlaceholderText } from "../placeholderText";
import { matchesIdentity } from "../memberLookup";
import { isFeatureEnabled, MEMBER_LOOKUP_ENABLED } from "../featureFlags";
import {
  loadPending,
  loadPendingServiceRequest,
  computeNextRequirement,
  computeServiceRequirement,
  computeLookupMissingFields,
  loadDisabledRequirements,
} from "./state";
import { forwardServiceRequest } from "./forwarding";
import { finalizeTransaction, requirementMessage } from "./transactionHandlers";
import type { LineUserInfo, ToolContext } from "./types";
export type SubmitMemberInfoInput = {
  fullName?: unknown;
  memberNumber?: unknown;
};


export async function submitMemberInfo(
  input: SubmitMemberInfoInput,
  ctx: ToolContext
): Promise<string> {
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const memberNumber =
    typeof input.memberNumber === "string" ? input.memberNumber.trim() : "";
  if (isPlaceholderText(fullName) || isPlaceholderText(memberNumber)) {
    return "Error: fullName and memberNumber must be the member's actual name and number — never a placeholder like 'unknown' or '-'. If the user hasn't actually stated their real name and member number yet, ask them again, in Thai, instead of calling this tool.";
  }
  // A message giving a name alongside a 13-digit all-numeric string is far
  // more likely to be a เลขประจำตัวประชาชน (national ID) than a cooperative
  // member number — real member numbers here run a handful of digits, never
  // 13. Seen in production: a member answering the member-number-lookup
  // flow's identity questions (name + national ID + phone) got misfiled
  // through this tool instead, because that flow left no state behind for
  // the model to recognize the reply as belonging to it (see
  // submit_lookup_info's description). Reject deterministically rather than
  // trust the model to keep telling the two flows apart.
  if (/^\d{13}$/.test(memberNumber)) {
    return "Error: this looks like a 13-digit เลขประจำตัวประชาชน (national ID number), not a เลขสมาชิก (member number) — cooperative member numbers are much shorter. If the member was actually trying to look up their own member number, use submit_lookup_info instead (it needs their name, national ID, and phone). If they really do have a member number, ask them to confirm it — don't save this value as-is.";
  }

  // Verify the claimed member number against the imported roster.
  const roster = await prisma.memberRoster.findUnique({ where: { memberNumber } });

  // Block impersonation: this member number is already bound to a
  // different LINE account in the roster. Do not save or proceed.
  if (roster?.lineUserId && roster.lineUserId !== ctx.lineUserId) {
    return "Error: this member number is already linked to a different LINE account. Do not proceed. Tell the user, in Thai, that this member number is registered to another LINE account, and ask them to contact the cooperative office if they believe this is a mistake.";
  }

  const verified = roster !== null;

  // Link this LINE account to the roster row the first time a known member
  // identifies, so their future messages auto-identify without asking.
  if (roster && !roster.lineUserId) {
    await prisma.memberRoster
      .update({ where: { memberNumber }, data: { lineUserId: ctx.lineUserId } })
      .catch(() => {});
  }

  const savedUser = await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, fullName, memberNumber },
    update: { fullName, memberNumber },
  });

  // Use the roster's canonical name when verified, so a small typo in what
  // the user typed doesn't end up on the logged record. phone carries over
  // from any earlier submit_contact_phone call — this tool never touches it.
  const identity: LineUserInfo = {
    fullName: roster?.memberName ?? fullName,
    memberNumber,
    verified,
    phone: savedUser.phone,
  };
  const unverifiedNote = verified
    ? ""
    : " (Note to you: this member number is NOT in the cooperative roster, so it could not be verified — proceed, but mention gently in Thai that staff will verify their membership.)";

  const pending = await loadPending(ctx.lineUserId);
  if (pending) {
    const disabled = await loadDisabledRequirements();
    const next = computeNextRequirement(identity, pending, disabled);
    if (next === null) {
      const result = await finalizeTransaction(ctx.lineUserId, pending, identity);
      return result + unverifiedNote;
    }
    return requirementMessage(next) + unverifiedNote;
  }

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (pendingService) {
    const next = computeServiceRequirement(identity, pendingService);
    if (next === null) {
      const result = await forwardServiceRequest(ctx.lineUserId, pendingService, identity);
      return result + unverifiedNote;
    }
    if (next === "purpose") {
      return (
        "Still missing: what request/service the supporting document is for. Ask the user next, in Thai." +
        unverifiedNote
      );
    }
    // next === "phone" — purpose and member info are both known now.
    return (
      "Still missing: a callback phone number for this request, needed to forward it. Ask the user next, in Thai." +
      unverifiedNote
    );
  }

  return `Member info saved (${fullName}, ${memberNumber}). No transaction is currently in progress — just confirm to the user that their info was saved.${unverifiedNote}`;
}

export type SetNicknameInput = {
  nickname?: unknown;
};


export async function setNickname(
  input: SetNicknameInput,
  ctx: ToolContext
): Promise<string> {
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
  if (!nickname) {
    return "Error: nickname must be a non-empty string.";
  }

  await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, nickname },
    update: { nickname },
  });

  return `Nickname set to "${nickname}".`;
}


export type SubmitLookupInfoInput = {
  fullName?: unknown;
  nationalId?: unknown;
  phone?: unknown;
};


export async function submitLookupInfo(
  input: SubmitLookupInfoInput,
  ctx: ToolContext
): Promise<string> {
  // Staff-toggleable (dashboard > ตั้งค่าระบบ) — checked before creating any
  // pending state so this never half-collects identity info while paused.
  if (!(await isFeatureEnabled(MEMBER_LOOKUP_ENABLED))) {
    return "Error: member-number lookup is temporarily paused by staff. Apologize to the user, in Thai, and tell them to try again later or contact the cooperative office directly — do not ask for or store any identity info for this.";
  }

  const fullName =
    typeof input.fullName === "string" && input.fullName.trim() && !isPlaceholderText(input.fullName)
      ? input.fullName.trim()
      : null;
  const nationalId =
    typeof input.nationalId === "string" &&
    input.nationalId.trim() &&
    !isPlaceholderText(input.nationalId)
      ? input.nationalId.trim()
      : null;
  const phone =
    typeof input.phone === "string" && input.phone.trim() && !isPlaceholderText(input.phone)
      ? input.phone.trim()
      : null;

  const pending = await prisma.pendingMemberLookup.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: { lineUserId: ctx.lineUserId, fullName, nationalId, phone },
    update: {
      ...(fullName ? { fullName } : {}),
      ...(nationalId ? { nationalId } : {}),
      ...(phone ? { phone } : {}),
    },
  });

  const missing = computeLookupMissingFields(pending);
  if (missing.length > 0) {
    const labels: Record<string, string> = {
      full_name: "the member's full name",
      national_id: "the member's 13-digit national ID number (เลขประจำตัวประชาชน)",
      phone: "the member's registered phone number",
    };
    const missingList = missing.map((f) => labels[f as string]).join("; ");
    return `Still missing: ${missingList} — needed to verify identity before revealing a member number. Ask for all of the still-missing item(s) together in ONE message, in Thai (do not ask one at a time across multiple messages if more than one is missing). Do not reveal anything yet.`;
  }

  // All three collected — check against the roster in application code
  // rather than a DB-level exact match, since a member's own typed
  // national ID/phone formatting (dashes, spaces) won't necessarily match
  // however the source spreadsheet happened to store it. The roster is
  // small (~1,200 rows), so pulling it in full for an in-memory check is
  // simpler and more robust than trying to normalize inside SQL.
  const candidates = await prisma.memberRoster.findMany({
    select: { memberNumber: true, memberName: true, nationalId: true, phone: true },
  });
  const match = candidates.find((roster) =>
    matchesIdentity(roster, {
      fullName: pending.fullName!,
      nationalId: pending.nationalId!,
      phone: pending.phone!,
    })
  );

  await prisma.pendingMemberLookup.delete({ where: { lineUserId: ctx.lineUserId } }).catch(() => {});

  if (!match) {
    return "No roster record matched the identity info provided. Apologize to the user, in Thai, and tell them to contact the cooperative office directly to verify their identity and get their member number. Do not reveal which specific field (name/ID/phone) didn't match, and never guess or make up a member number.";
  }

  return `Verified: this member's เลขสมาชิก is ${match.memberNumber}. Tell them clearly, in Thai.`;
}
