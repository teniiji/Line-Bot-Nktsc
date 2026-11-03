// The name of whoever sent a payment nobody can place yet.
//
// A ฿9,000 transfer from 4083576391 says nothing about whose it is; staff
// look the account up at the bank and get a name, but no member number. That
// name had nowhere to go — the line went on reading "ไม่รู้ว่าใคร" while the
// person who found out moved on, and the next one to open the day started
// from nothing. So the name is kept: against the paying account when the
// line has one (every line from that account then reads the same), else
// against the line itself. And it is checked against the register, because
// the sender is very often a member under the same name.

// Titles the bank and the register write differently or not at all.
const TITLES = [
  "นางสาว",
  "น.ส.",
  "นส.",
  "นาง",
  "นาย",
  "ด.ช.",
  "ด.ญ.",
  "ว่าที่ร้อยตรี",
  "ว่าที่ร.ต.",
  "mrs.",
  "mrs",
  "miss",
  "ms.",
  "mr.",
  "mr",
];

// A name reduced to what two spellings of it share: no title, no spacing,
// no case.
export function nameKey(name: string | null | undefined): string {
  let s = String(name ?? "").trim().toLowerCase();
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of TITLES) {
      if (s.startsWith(t)) {
        s = s.slice(t.length).trim();
        changed = true;
      }
    }
  }
  return s.replace(/[\s.]+/g, "");
}

// The first name, for narrowing the register before comparing whole names.
export function firstName(name: string | null | undefined): string | null {
  let s = String(name ?? "").trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of TITLES) {
      if (s.toLowerCase().startsWith(t)) {
        s = s.slice(t.length).trim();
        changed = true;
      }
    }
  }
  const first = s.split(/\s+/)[0];
  return first && first.length >= 2 ? first : null;
}

// Members whose registered name is the sender's name.
export function sameName<T extends { memberName: string }>(sender: string, roster: T[]): T[] {
  const key = nameKey(sender);
  if (key.length < 4) return [];
  return roster.filter((r) => nameKey(r.memberName) === key);
}

export function cleanSenderName(value: unknown): string | null {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 120) : null;
}
