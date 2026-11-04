// Auth.js v5: GitHub OAuth, JWT sessions, no adapter tables. Reads AUTH_SECRET, AUTH_GITHUB_ID and
// AUTH_GITHUB_SECRET by name. Roles are never stored here; they come from project_members.
import NextAuth from "next-auth";
import { getDb } from "@/server/db/client";
import { githubProfileSchema } from "@/server/auth/github-profile";
import { upsertGithubUser } from "@/server/auth/upsert-user";
import { buildProviders } from "@/server/demo/providers";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // DEMO_MODE is read directly (not via serverEnv) because this module is also loaded at build time,
  // where the rest of the server environment is absent. Only the exact string "true" enables it.
  providers: buildProviders(process.env.DEMO_MODE === "true"),
  session: { strategy: "jwt" },
  // Render terminates TLS in front of the app.
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "github" && profile) {
        const { id } = await upsertGithubUser(getDb(), githubProfileSchema.parse(profile));
        token.uid = id;
      }
      // The demo provider's authorize() already returned the seeded user's database id.
      if (account?.provider === "demo" && typeof user?.id === "string") token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
    authorized({ auth: session }) {
      return Boolean(session?.user?.id);
    },
  },
});
