import { DEPARTMENTS } from "./departments";

// What a group chat is used to receive, managed from the group's own row
// (components/LineGroupsPanel.tsx) instead of from each place that can send
// to it. A department's requests go to it through a DepartmentContact row;
// a unit's รายการหัก through the unit's lineUserId. Before this, a group's
// row could only say "— ยังไม่ได้ใช้ —" and staff had to know which two other
// tabs to visit to change that.

// สินเชื่อ never goes to a group — see ASSIGNABLE_DEPARTMENTS in
// app/api/department-contacts/route.ts.
export const GROUP_DEPARTMENTS: readonly string[] = DEPARTMENTS.filter((d) => d !== "สินเชื่อ");

export interface GroupUsage {
  departments: string[];
  units: string[];
}

export interface GroupUsagePlan {
  addDepartments: string[];
  removeDepartments: string[];
  // Units to point at this group — replacing whatever LINE target they had.
  assignUnits: string[];
  // Units pointed at this group that no longer should be: left with no LINE.
  releaseUnits: string[];
}

const uniqueStrings = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return null;
  return [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
};

// The wanted state from a request body, or why it cannot be used.
export function parseGroupUsage(body: unknown): GroupUsage | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const departments = uniqueStrings(b.departments);
  const units = uniqueStrings(b.units);
  if (!departments || !units) return { error: "ต้องระบุแผนกและหน่วยงานเป็นรายการ" };
  const unknown = departments.filter((d) => !GROUP_DEPARTMENTS.includes(d));
  if (unknown.length) return { error: `แผนกนี้ใช้กลุ่มไม่ได้: ${unknown.join(", ")}` };
  return { departments, units };
}

export function planGroupUsage(current: GroupUsage, wanted: GroupUsage): GroupUsagePlan {
  const has = (list: string[]) => new Set(list);
  const cur = { departments: has(current.departments), units: has(current.units) };
  const want = { departments: has(wanted.departments), units: has(wanted.units) };
  return {
    addDepartments: wanted.departments.filter((d) => !cur.departments.has(d)),
    removeDepartments: current.departments.filter((d) => !want.departments.has(d)),
    assignUnits: wanted.units.filter((u) => !cur.units.has(u)),
    releaseUnits: current.units.filter((u) => !want.units.has(u)),
  };
}

// A group the bot has left takes nothing new: whatever it is given would go
// nowhere. Taking things off it is still allowed — that is how it is emptied.
export function usageRefusal(plan: GroupUsagePlan, botLeft: boolean): string | null {
  if (botLeft && (plan.addDepartments.length || plan.assignUnits.length)) {
    return "บอทไม่อยู่ในกลุ่มนี้แล้ว — เพิ่มการใช้งานไม่ได้ เอาออกได้อย่างเดียว";
  }
  return null;
}
