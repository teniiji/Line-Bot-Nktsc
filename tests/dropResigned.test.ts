import { describe, expect, it, vi } from "vitest";

// coverageStore imports the Prisma client; dropResigned itself is pure.
vi.mock("../lib/prisma", () => ({ prisma: {} }));
const { dropResigned } = await import("../lib/coverageStore");

describe("dropResigned", () => {
  const rows = [{ memberNumber: "27112" }, { memberNumber: "27915" }, { memberNumber: "10177" }];

  it("leaves out the members the report says have left, and says who", () => {
    const { rows: kept, dropped } = dropResigned(rows, new Set(["27112", "10177", "99999"]));
    expect(kept.map((r) => r.memberNumber)).toEqual(["27915"]);
    expect(dropped.map((r) => r.memberNumber)).toEqual(["27112", "10177"]);
  });

  it("keeps everyone when there is no report or nobody has left", () => {
    expect(dropResigned(rows, null).rows).toHaveLength(3);
    expect(dropResigned(rows, new Set()).dropped).toEqual([]);
  });
});
