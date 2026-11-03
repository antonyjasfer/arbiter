// Auth.js v5: GitHub OAuth, JWT sessions, no adapter tables. Reads AUTH_SECRET, AUTH_GITHUB_ID and
// AUTH_GITHUB_SECRET by name. Roles are never stored here; they come from project_members.
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { getDb } from "@/server/db/client";
import { githubProfileSchema } from "@/server/auth/github-profile";
import { upsertGithubUser } from "@/server/auth/upsert-user";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  // Render terminates TLS in front of the app.
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) {
        const { id } = await upsertGithubUser(getDb(), githubProfileSchema.parse(profile));
        token.uid = id;
      }
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
