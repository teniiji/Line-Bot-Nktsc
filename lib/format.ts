export const formatAmount = (amount: number) =>
  amount.toLocaleString("th-TH", { style: "currency", currency: "THB" });
