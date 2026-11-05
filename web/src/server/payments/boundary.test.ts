// CLAUDE.md rule 1: only server/payments may reach a money-moving PayPal call. The write-capable
// transport (paypalHttp) and the API wrappers may be imported only from server/payments; AI code may not
// import server/payments at all.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const all = files(SRC).map((p) => ({ rel: relative(SRC, p).split(sep).join("/"), text: readFileSync(p, "utf8") }));
const inPayments = (rel: string) => rel.startsWith("server/payments/");

describe("payment authority boundary", () => {
  it("only server/payments imports the write-capable PayPal transport", () => {
    const offenders = all.filter((f) => !inPayments(f.rel) && f.rel !== "server/paypal/client.ts" && /\bpaypalHttp\b/.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("only server/payments imports the PayPal API wrappers (type-only imports compile away and are allowed)", () => {
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+["'][^"']*payments\/paypal-api["']/m;
    const offenders = all.filter((f) => !inPayments(f.rel) && valueImport.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("no AI code imports server/payments", () => {
    const offenders = all.filter((f) => f.rel.startsWith("server/ai/") && /server\/payments|\.\.\/payments/.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("the transport is pinned to the sandbox host", () => {
    const client = all.find((f) => f.rel === "server/paypal/client.ts")!;
    expect(client.text).toContain('const SANDBOX = "https://api-m.sandbox.paypal.com"');
    expect(client.text).not.toMatch(/api-m\.paypal\.com/);
    expect(client.text).toMatch(/export const paypalHttp/);
  });
});
