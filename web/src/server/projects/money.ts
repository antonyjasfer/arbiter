// numeric(12,2) strings in the database, integer cents everywhere else.
export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("centsToMoney: expected non-negative integer cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function moneyToCents(money: string): number {
  const m = /^(\d+)\.(\d{2})$/.exec(money);
  if (!m) throw new RangeError("moneyToCents: expected a numeric(12,2) string");
  return Number(m[1]) * 100 + Number(m[2]);
}
