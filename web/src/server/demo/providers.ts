// Auth.js providers. The demo provider exists only when DEMO_MODE is exactly "true"; it signs in one of
// the two seeded demo users (seeding them first if needed). It accepts no password because the demo
// users can reach only demo data (see requireProjectRole).
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "../env";
import type { DemoCache } from "./seed";

const roleSchema = z.enum(["client", "freelancer"]);

export function buildProviders(demoMode: boolean): Provider[] {
  if (!demoMode) return [GitHub];
  return [
    GitHub,
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: { role: {} },
      async authorize(credentials) {
        const role = roleSchema.safeParse(credentials?.role);
        if (!role.success) return null;
        // Loaded here, not at module scope, so this file stays importable outside the server runtime.
        const [{ getDb }, seed, cache] = await Promise.all([import("../db/client"), import("./seed"), import("./compiled-cache.json")]);
        const db = getDb();
        await seed.seedDemo(db, { model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, cache: cache.default as DemoCache, freelancerPaypalEmail: process.env.PAYPAL_FREELANCER_EMAIL || undefined });
        const id = await seed.demoUserId(db, role.data);
        return id ? { id, name: seed.DEMO_USERS[role.data].name } : null;
      },
    }),
  ];
}
