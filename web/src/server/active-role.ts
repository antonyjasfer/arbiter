import { cookies } from "next/headers";
import { ACTIVE_ROLE_COOKIE, parseActiveRole, type ActiveRole } from "@/lib/active-role";

export async function getActiveRole(): Promise<ActiveRole> {
  return parseActiveRole((await cookies()).get(ACTIVE_ROLE_COOKIE)?.value);
}
