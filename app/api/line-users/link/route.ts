import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readAllSheetRows } from "@/lib/excelUpload";
import { buildNameIndex, suggestMemberByName } from "@/lib/lineUserNameMatch";
import {
  LineSheetError,
  parseLineIdSheet,
  planLinks,
  type LinkCandidate,
  type LinkState,
} from "@/lib/lineLinking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHUNK = 1000;
const SHOWN = 300;

async function inChunks<T, R>(values: T[], fetch: (slice: T[]) => Promise<R[]>): Promise<R[]> {
  const all: R[] = [];
  for (let i = 0; i < values.length; i += CHUNK) all.push(...(await fetch(values.slice(i, i + CHUNK))));
  return all;
}

// Every suggestion the สมาชิก LINE list would show, across all its pages.
async function suggestedCandidates(): Promise<LinkCandidate[]> {
  const users = await prisma.lineUser.findMany({
    where: { memberNumber: null, fullName: { not: null } },
    select: { id: true, fullName: true },
  });
  if (users.length === 0) return [];
  const index = buildNameIndex(
    await prisma.statementMember.findMany({ select: { memberNumber: true, name: true }, distinct: ["memberNumber"] })
  );
  return users.flatMap((u) => {
    const match = suggestMemberByName(u.fullName, index);
    return match ? [{ lineUserId: u.id, memberNumber: match.memberNumber }] : [];
  });
}

async function loadState(candidates: LinkCandidate[]): Promise<LinkState> {
  const ids = Array.from(new Set(candidates.map((c) => c.lineUserId)));
  const numbers = Array.from(new Set(candidates.map((c) => c.memberNumber.replace(/^0+(?=.)/, ""))));
  const [users, roster, holders] = await Promise.all([
    inChunks(ids, (slice) =>
      prisma.lineUser.findMany({
        where: { id: { in: slice } },
        select: { id: true, memberNumber: true, displayName: true, fullName: true },
      })
    ),
    inChunks(numbers, (slice) =>
      prisma.memberRoster.findMany({
        where: { memberNumber: { in: slice } },
        select: { memberNumber: true, memberName: true, lineUserId: true },
      })
    ),
    inChunks(numbers, (slice) =>
      prisma.lineUser.findMany({ where: { memberNumber: { in: slice } }, select: { id: true, memberNumber: true } })
    ),
  ]);
  const numberHolders = new Map<string, string[]>();
  for (const h of holders) {
    numberHolders.set(h.memberNumber!, [...(numberHolders.get(h.memberNumber!) ?? []), h.id]);
  }
  return {
    lineUsers: new Map(
      users.map((u) => [
        u.id,
        { memberNumber: u.memberNumber, label: [u.fullName, u.displayName && `LINE: ${u.displayName}`].filter(Boolean).join(" · ") || u.id },
      ])
    ),
    roster: new Map(roster.map((r) => [r.memberNumber, { memberName: r.memberName, lineUserId: r.lineUserId }])),
    numberHolders,
  };
}

// POST /api/line-users/link
//   JSON { source: "suggested", apply?: boolean }
//   multipart: file (สมาชิก_LINE_OA), apply ("1" to write)
// Without apply it only reports what would happen, for staff to read first.
export async function POST(request: NextRequest) {
  let candidates: LinkCandidate[];
  let apply = false;
  let badIds = 0;

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    apply = form.get("apply") === "1";
    const checked = checkUploadedFile(form.get("file"));
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    try {
      const parsed = parseLineIdSheet(await readAllSheetRows(checked.file));
      candidates = parsed.pairs;
      badIds = parsed.badIds;
    } catch (err) {
      const message = err instanceof LineSheetError ? err.message : describeReadError(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else {
    const body = await request.json().catch(() => ({}));
    if (body?.source !== "suggested") {
      return NextResponse.json({ error: "source must be suggested, or upload a file" }, { status: 400 });
    }
    apply = body.apply === true;
    candidates = await suggestedCandidates();
  }

  const outcomes = planLinks(candidates, await loadState(candidates));
  const toLink = outcomes.filter((o) => o.action === "link");

  let linked = 0;
  if (apply) {
    for (const o of toLink) {
      // Checked again inside the write, so a link made meanwhile is never
      // overwritten.
      const done = await prisma.$transaction(async (tx) => {
        const user = await tx.lineUser.updateMany({
          where: { id: o.lineUserId, OR: [{ memberNumber: null }, { memberNumber: o.memberNumber }] },
          data: { memberNumber: o.memberNumber },
        });
        if (user.count === 0) return false;
        await tx.memberRoster.updateMany({
          where: { memberNumber: o.memberNumber, lineUserId: null },
          data: { lineUserId: o.lineUserId },
        });
        return true;
      });
      if (done) linked++;
    }
  }

  const order = { link: 0, already: 1, skip: 2 } as const;
  const sorted = [...outcomes].sort((a, b) => order[a.action] - order[b.action]);
  return NextResponse.json({
    applied: apply,
    linked,
    counts: {
      link: toLink.length,
      already: outcomes.filter((o) => o.action === "already").length,
      skip: outcomes.filter((o) => o.action === "skip").length,
      badIds,
    },
    outcomes: sorted.slice(0, SHOWN),
    more: Math.max(0, sorted.length - SHOWN),
  });
}
