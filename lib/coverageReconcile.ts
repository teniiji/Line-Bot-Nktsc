// Checking a new yearly coverage file against the register of applications.
//
// Everything recorded in the register between the previous file's date and
// this file's date should show in this file: an application as the cover
// being there, a cancellation as it being gone. Where it does not, either the
// insurer or the association missed it, or the register is wrong — staff
// need the list either way.
//
// With a previous file to compare to, the other direction can be checked
// too: cover the new file added or dropped with nothing in the register to
// say why (an application taken by another channel, a death not recorded).

export type Product = "life" | "sok" | "scs" | "sst" | "ssk" | "relative";
const PRODUCTS: Product[] = ["life", "sok", "scs", "sst", "ssk", "relative"];

export interface FileMember {
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  insuredSum: number;
  hasSok: boolean;
  hasScs: boolean;
  hasSst: boolean;
  hasSsk: boolean;
  relativeCount: number;
}

export interface RegisterEvent {
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  product: string;
  action: string;
  status: string;
  applicationDate: Date;
}

export type ReconcileKind =
  // In the register, not reflected in the file.
  | "missingFromFile"
  | "stillInFile"
  // In the file (against the previous one), not in the register.
  | "addedWithoutRecord"
  | "removedWithoutRecord";

export interface ReconcileItem {
  kind: ReconcileKind;
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  product: Product;
  // For relatives: how many more or fewer than the register accounts for.
  count?: number;
  // The register's last entry for it, when there is one.
  applicationDate?: string;
  status?: string;
}

// How many of a product a member holds: 1 or 0, or the number of relatives.
function holds(m: FileMember | undefined, p: Product): number {
  if (!m) return 0;
  switch (p) {
    case "life":
      return m.insuredSum > 0 ? 1 : 0;
    case "sok":
      return m.hasSok ? 1 : 0;
    case "scs":
      return m.hasScs ? 1 : 0;
    case "sst":
      return m.hasSst ? 1 : 0;
    case "ssk":
      return m.hasSsk ? 1 : 0;
    case "relative":
      return m.relativeCount;
  }
}

export function reconcileFile(
  file: FileMember[],
  previous: FileMember[] | null,
  events: RegisterEvent[],
  window: { from: Date | null; to: Date }
): ReconcileItem[] {
  const now = new Map(file.map((m) => [m.memberNumber, m]));
  const before = previous ? new Map(previous.map((m) => [m.memberNumber, m])) : null;

  // The register's net effect per member and product over the window: +1 an
  // application, −1 a cancellation; for anything but relatives only the last
  // one matters.
  const net = new Map<string, { change: number; last: RegisterEvent }>();
  const inWindow = events
    .filter(
      (e) =>
        e.status !== "rejected" &&
        (PRODUCTS as string[]).includes(e.product) &&
        (!window.from || e.applicationDate.getTime() > window.from.getTime()) &&
        e.applicationDate.getTime() <= window.to.getTime()
    )
    .sort((a, b) => a.applicationDate.getTime() - b.applicationDate.getTime());
  for (const e of inWindow) {
    const key = `${e.memberNumber}|${e.product}`;
    const step = e.action === "cancel" ? -1 : 1;
    const prev = net.get(key);
    const change = e.product === "relative" ? (prev?.change ?? 0) + step : step;
    net.set(key, { change, last: e });
  }

  const out: ReconcileItem[] = [];
  const who = (memberNumber: string, e?: RegisterEvent) => {
    const m = now.get(memberNumber) ?? before?.get(memberNumber);
    return {
      memberNumber,
      memberName: m?.memberName ?? e?.memberName ?? null,
      unitName: m?.unitName ?? e?.unitName ?? null,
    };
  };

  for (const [key, { change, last }] of net) {
    const [memberNumber, product] = key.split("|") as [string, Product];
    const has = holds(now.get(memberNumber), product);
    const meta = { applicationDate: last.applicationDate.toISOString(), status: last.status };
    if (product === "relative") {
      // Against the previous file the count should have moved by the net;
      // without one, an application at least means some relative is there.
      const moved = before ? has - holds(before.get(memberNumber), product) : null;
      if (moved != null) {
        if (change > 0 && moved < change) {
          out.push({ kind: "missingFromFile", ...who(memberNumber, last), product, count: change - moved, ...meta });
        }
        if (change < 0 && moved > change) {
          out.push({ kind: "stillInFile", ...who(memberNumber, last), product, count: moved - change, ...meta });
        }
      } else if (change > 0 && has === 0) {
        out.push({ kind: "missingFromFile", ...who(memberNumber, last), product, count: change, ...meta });
      }
      continue;
    }
    if (change > 0 && !has) out.push({ kind: "missingFromFile", ...who(memberNumber, last), product, ...meta });
    if (change < 0 && has) out.push({ kind: "stillInFile", ...who(memberNumber, last), product, ...meta });
  }

  if (before) {
    const members = new Set([...now.keys(), ...before.keys()]);
    for (const memberNumber of members) {
      for (const product of PRODUCTS) {
        const diff = holds(now.get(memberNumber), product) - holds(before.get(memberNumber), product);
        if (diff === 0) continue;
        const recorded = net.get(`${memberNumber}|${product}`)?.change ?? 0;
        if (product === "relative") {
          const extra = diff - recorded;
          if (diff > 0 && extra > 0) out.push({ kind: "addedWithoutRecord", ...who(memberNumber), product, count: extra });
          if (diff < 0 && extra < 0) out.push({ kind: "removedWithoutRecord", ...who(memberNumber), product, count: -extra });
          continue;
        }
        if (diff > 0 && recorded <= 0) out.push({ kind: "addedWithoutRecord", ...who(memberNumber), product });
        if (diff < 0 && recorded >= 0) out.push({ kind: "removedWithoutRecord", ...who(memberNumber), product });
      }
    }
  }

  const order: ReconcileKind[] = ["missingFromFile", "stillInFile", "addedWithoutRecord", "removedWithoutRecord"];
  return out.sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      PRODUCTS.indexOf(a.product) - PRODUCTS.indexOf(b.product) ||
      a.memberNumber.localeCompare(b.memberNumber, undefined, { numeric: true })
  );
}
