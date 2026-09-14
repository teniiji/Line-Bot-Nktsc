// Naming the bank a counter deposit came from.
//
// A deposit paid in over the counter reaches the statement as
// "014-8592630385": three digits, a dash, then an account. The three digits
// are the paying bank's code — the national one used for interbank transfers,
// not a Krungthai branch — so the line already says which bank the member
// used, in a form nobody reads at a glance.
//
// Staff chasing an unclaimed payment ring the member and ask which bank they
// paid from. The answer is on the screen; it just needs spelling out.
//
// A code that is not in this list shows nothing at all. Half the value of the
// label is that it can be trusted, and there is no version of "probably
// ธนาคารกรุงเทพ" worth printing next to somebody's money.

// The interbank codes as they appear on these statements. Short names, the
// way people say them, because the column is narrow and the full registered
// name of a bank is not what anybody is checking.
const BANK_NAMES: Record<string, string> = {
  "002": "กรุงเทพ",
  "004": "กสิกรไทย",
  "006": "กรุงไทย",
  "011": "ทหารไทยธนชาต",
  "014": "ไทยพาณิชย์",
  "017": "ซิตี้แบงก์",
  "020": "สแตนดาร์ดชาร์เตอร์ด",
  "022": "ซีไอเอ็มบี ไทย",
  "024": "ยูโอบี",
  "025": "กรุงศรีอยุธยา",
  "030": "ออมสิน",
  "031": "เอชเอสบีซี",
  "033": "อาคารสงเคราะห์",
  "034": "ธ.ก.ส.",
  "065": "ธนชาต",
  "066": "อิสลามแห่งประเทศไทย",
  "067": "ทิสโก้",
  "069": "เกียรตินาคินภัทร",
  "070": "ไอซีบีซี (ไทย)",
  "071": "ไทยเครดิต",
  "073": "แลนด์ แอนด์ เฮ้าส์",
  "098": "SME Bank",
};

export function bankNameFromCode(code: string): string | null {
  return BANK_NAMES[code.trim()] ?? null;
}

export interface StatementBank {
  code: string;
  name: string;
}

/**
 * The bank a statement line's description names, when it names one.
 *
 * Only a three-digit prefix counts. extractSenderAccount also accepts four to
 * six digits there, because some lines carry something longer that is not a
 * bank code — and a four-digit number is not one, so it gets no name rather
 * than a wrong one.
 */
export function bankFromDescription(description: string): StatementBank | null {
  const match = description.trim().match(/^(\d{3})-\d/);
  if (!match) return null;
  const name = bankNameFromCode(match[1]);
  return name ? { code: match[1], name } : null;
}
