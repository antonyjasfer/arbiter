// Display helpers shared by server and client components. Money is integer cents everywhere.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Parses what a person types into an amount field ("300", "$1,250.50"); null if it is not a plain amount. */
export function dollarsToCents(input: string): number | null {
  const m = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

const ist = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const istDate = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export function formatIst(d: Date): string {
  return `${ist.format(d)} IST`;
}

export function formatIstDate(d: Date): string {
  return istDate.format(d);
}

export type Tone = "pass" | "fail" | "review" | "pending";

export function projectBadge(s: { hasVersion: boolean; locked: boolean; role: "client" | "freelancer"; mine: boolean; theirs: boolean }): { label: string; tone: Tone } {
  if (!s.hasVersion) return { label: "Draft", tone: "pending" };
  if (s.locked) return { label: "Locked", tone: "pass" };
  if (!s.mine) return { label: "Waiting for you", tone: "review" };
  return { label: s.role === "client" ? "Waiting for freelancer" : "Waiting for client", tone: "pending" };
}

/** Poll every 2 s at first, then back off by 1 s per poll to at most 5 s. */
export function pollDelay(attempt: number): number {
  return Math.min(2000 + attempt * 1000, 5000);
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
