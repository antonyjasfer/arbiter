import { describe, expect, it, vi } from "vitest";
import { guardedPost } from "./guarded-post";

const ok = (v: unknown) => ({ ok: true as const, value: v });

describe("guardedPost (POST routes that can move money or start work)", () => {
  it("a missing or foreign Origin is 403 before the session or any work is touched", async () => {
    const userId = vi.fn(async () => "u1");
    const run = vi.fn(async () => ok({}));
    const r = await guardedPost({ sameOrigin: false, userId, run });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden_origin" });
    expect(userId).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("unauthenticated is 401 and does no work", async () => {
    const run = vi.fn(async () => ok({}));
    const r = await guardedPost({ sameOrigin: true, userId: async () => null, run });
    expect(r.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("a non-member (the work reports not_found) is 404", async () => {
    const r = await guardedPost({ sameOrigin: true, userId: async () => "u1", run: async () => ({ ok: false as const, error: "not_found" as const }) });
    expect(r.status).toBe(404);
  });

  it("a same-origin member POST runs the work and returns its body, uncached", async () => {
    const run = vi.fn(async (uid: string) => ok({ state: "PAID", by: uid }));
    const r = await guardedPost({ sameOrigin: true, userId: async () => "u1", run });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ state: "PAID", by: "u1" });
    expect(run).toHaveBeenCalledWith("u1");
  });
});
