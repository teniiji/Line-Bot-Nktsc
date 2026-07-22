import { DEPARTMENTS } from "./departments";

// If the user's own purpose text names one of the departments directly
// (e.g. "ส่งสารสนเทศ", "ติดต่อฝ่ายบัญชี"), that should always win over
// whatever department the model picked — a literal substring match is far
// more reliable than trusting the model to consistently follow the
// "prefer an explicitly named department" instruction in its system
// prompt. "อื่นๆ" is excluded: it's the catch-all fallback, never
// something worth force-matching on.
export function detectNamedDepartment(purposeText: string): string | null {
  for (const department of DEPARTMENTS) {
    if (department === "อื่นๆ") continue;
    if (purposeText.includes(department)) return department;
  }
  return null;
}
