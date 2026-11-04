import { describe, expect, it } from "vitest";
import type { Provider } from "next-auth/providers";
import { buildProviders } from "./providers";

// Auth.js resolves a provider's id from options.id when given (as it does when it parses providers).
function ids(providers: Provider[]): string[] {
  return providers.map((p) => {
    const c = (typeof p === "function" ? p() : p) as { id: string; options?: { id?: string } };
    return c.options?.id ?? c.id;
  });
}

describe("buildProviders", () => {
  it("offers only GitHub when demo mode is off", () => {
    expect(ids(buildProviders(false))).toEqual(["github"]);
  });

  it("adds the demo provider when demo mode is on", () => {
    expect(ids(buildProviders(true))).toEqual(["github", "demo"]);
  });
});
