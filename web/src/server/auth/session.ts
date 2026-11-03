import "server-only";
import { auth } from "@/auth";
import type { Result } from "@/lib/result";

export async function requireUser(): Promise<Result<{ userId: string }, "unauthenticated">> {
  const session = await auth();
  const userId = session?.user?.id;
  return userId ? { ok: true, value: { userId } } : { ok: false, error: "unauthenticated" };
}
