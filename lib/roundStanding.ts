// Whether a round member's stored figures already say what a recompute has
// just worked out — see recomputeRoundPayments, which writes only the members
// for whom they do not.

export interface Standing {
  amountPaid: number;
  paidAt: Date | null;
  paidBranch: string | null;
  status: string;
}

export function sameStanding(stored: Standing, next: Standing): boolean {
  return (
    Math.abs(stored.amountPaid - next.amountPaid) < 0.005 &&
    (stored.paidAt?.getTime() ?? null) === (next.paidAt?.getTime() ?? null) &&
    (stored.paidBranch ?? null) === (next.paidBranch ?? null) &&
    stored.status === next.status
  );
}
