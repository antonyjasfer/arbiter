// Called from the Auth.js jwt callback on sign-in. Idempotent on the GitHub user id.
import type { Db } from "../db/types";
import { users } from "../db/schema";

export type GithubProfile = {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export async function upsertGithubUser(db: Db, profile: GithubProfile): Promise<{ id: string }> {
  const values = {
    githubId: String(profile.id),
    login: profile.login,
    name: profile.name ?? null,
    email: profile.email ?? null,
    avatarUrl: profile.avatar_url ?? null,
  };
  const [row] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.githubId,
      set: { login: values.login, name: values.name, email: values.email, avatarUrl: values.avatarUrl },
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user upsert returned no row");
  return row;
}
