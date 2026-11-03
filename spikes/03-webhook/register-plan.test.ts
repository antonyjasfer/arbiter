import { describe, expect, it } from "vitest";
import { planRegistration } from "./register-plan.js";

const OLD = "https://arbiter-q41f.onrender.com/webhook";
const NEW = "https://arbiter-q41f.onrender.com/api/webhooks/paypal";
const WANTED = ["A", "B"];

describe("planRegistration", () => {
  it("reuses a webhook already at the target url with every wanted event", () => {
    expect(planRegistration({ existing: [{ id: "W1", url: NEW, eventTypes: ["B", "A", "C"] }], storedId: "W1", targetUrl: NEW, wanted: WANTED })).toEqual({ action: "reuse", id: "W1" });
  });

  it("patches only the url when the stored webhook points elsewhere", () => {
    expect(planRegistration({ existing: [{ id: "W1", url: OLD, eventTypes: ["A", "B"] }], storedId: "W1", targetUrl: NEW, wanted: WANTED })).toEqual({
      action: "patch",
      id: "W1",
      patch: [{ op: "replace", path: "/url", value: NEW }],
    });
  });

  it("patches url and event types when both differ", () => {
    expect(planRegistration({ existing: [{ id: "W1", url: OLD, eventTypes: ["A"] }], storedId: "W1", targetUrl: NEW, wanted: WANTED })).toEqual({
      action: "patch",
      id: "W1",
      patch: [
        { op: "replace", path: "/url", value: NEW },
        { op: "replace", path: "/event_types", value: [{ name: "A" }, { name: "B" }] },
      ],
    });
  });

  it("creates when there is no stored id or it no longer exists", () => {
    expect(planRegistration({ existing: [], targetUrl: NEW, wanted: WANTED })).toEqual({ action: "create" });
    expect(planRegistration({ existing: [{ id: "OTHER", url: "https://x/y", eventTypes: [] }], storedId: "GONE", targetUrl: NEW, wanted: WANTED })).toEqual({ action: "create" });
  });

  it("never creates while the stored webhook exists", () => {
    const r = planRegistration({ existing: [{ id: "W1", url: OLD, eventTypes: [] }], storedId: "W1", targetUrl: NEW, wanted: WANTED });
    expect(r.action).not.toBe("create");
  });
});
