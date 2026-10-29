import { describe, expect, it } from "vitest";
import { buildVerifyBody } from "./verify.js";

const headers = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
  "paypal-transmission-id": "tx-123",
  "paypal-transmission-sig": "c2lnbmF0dXJl",
  "paypal-transmission-time": "2026-10-29T12:00:00Z",
};

describe("buildVerifyBody", () => {
  it("embeds the raw webhook body byte-for-byte (double spaces, unicode, key order)", () => {
    const raw = '{"id":"WH-1","note":"héllo  ☃","a":1,"z":{"b":2,  "a":1}}';
    const body = buildVerifyBody(headers, raw, "WEBHOOK-ID");
    expect(body).toContain(`"webhook_event":${raw}`);
    // and it is still valid JSON that carries the same event
    const parsed = JSON.parse(body) as { webhook_event: { note: string }; webhook_id: string; transmission_id: string };
    expect(parsed.webhook_event.note).toBe("héllo  ☃");
    expect(parsed.webhook_id).toBe("WEBHOOK-ID");
    expect(parsed.transmission_id).toBe("tx-123");
  });

  it("is not equal to a parsed-and-restringified body when the raw body has odd whitespace", () => {
    const raw = '{"id":"WH-1",   "a":1}';
    const body = buildVerifyBody(headers, raw, "W");
    expect(body).not.toContain(JSON.stringify(JSON.parse(raw)));
  });

  it("reads headers case-insensitively", () => {
    const upper = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]));
    expect(() => buildVerifyBody(upper, "{}", "W")).not.toThrow();
  });

  it("throws when a required header is missing, naming the header but not its value", () => {
    const { "paypal-transmission-sig": _omit, ...rest } = headers;
    expect(() => buildVerifyBody(rest, "{}", "W")).toThrow(/paypal-transmission-sig/);
  });

  it("throws on an empty body", () => {
    expect(() => buildVerifyBody(headers, "", "W")).toThrow();
  });
});
