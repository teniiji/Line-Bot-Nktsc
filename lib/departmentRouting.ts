import { lineTargetKind } from "./lineGroups";

// Precedence for non-loan department routing, kept pure/unit-testable the
// same way lib/loanRouting.ts is: a department with officers assigned in
// DepartmentContact gets all of them (broadcast, so no request is missed
// regardless of who's on duty); an empty department falls back to the
// single LINE_FORWARD_GENERAL_ID so a not-yet-staffed department still
// reaches someone instead of silently dropping the request.
//
// A department can instead be pointed at a group chat — the same table with
// a group id in it. Then the group is where requests go and the named
// officers become the fallback; see planDepartmentForward.
export function pickDepartmentForwardTargets(input: {
  contactLineUserIds: string[];
  envFallback: string | null;
}): string[] {
  if (input.contactLineUserIds.length > 0) {
    return input.contactLineUserIds;
  }
  return input.envFallback ? [input.envFallback] : [];
}

export interface DepartmentForwardPlan {
  // Where the request goes first.
  primary: string[];
  // Tried only when every primary push failed. Empty when there is nothing
  // to fall back to.
  fallback: string[];
  // True when the primary is a group chat. Worth recording rather than
  // inferring from the id later, because it is exactly the case where the
  // forwarding log can no longer say who actually received the request.
  viaGroup: boolean;
}

// Splits a department's assigned contacts into where a request goes and what
// happens if that fails.
//
// Pointing a department at a group turns its named officers into a fallback
// rather than replacing them, and that is the point of doing it this way. A
// group is the more resilient target day to day — nobody's leave or job
// change takes the notifications with them — but it fails in a way a person
// does not: anyone in the chat can remove the bot, and nothing reports it
// until a push is attempted. Keeping the officers behind it means the worst
// case is a request arriving in the old place rather than never arriving.
export function planDepartmentForward(input: {
  contactLineUserIds: string[];
  envFallback: string | null;
}): DepartmentForwardPlan {
  const isGroup = (id: string) => {
    const kind = lineTargetKind(id);
    return kind === "group" || kind === "room";
  };

  const groups = input.contactLineUserIds.filter(isGroup);
  const people = input.contactLineUserIds.filter((id) => !isGroup(id));
  const envFallback = input.envFallback ? [input.envFallback] : [];

  if (groups.length > 0) {
    return {
      primary: groups,
      // The department's own officers first; the catch-all only for a
      // department that has none of its own.
      fallback: people.length > 0 ? people : envFallback,
      viaGroup: true,
    };
  }

  return {
    primary: pickDepartmentForwardTargets(input),
    // Nothing to fall back to here: the primary is already every officer the
    // department has, and dropping through to the catch-all because one
    // officer's push failed would send a member's request to somebody who is
    // not handling it.
    fallback: [],
    viaGroup: false,
  };
}
