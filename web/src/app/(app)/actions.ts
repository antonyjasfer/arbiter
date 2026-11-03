"use server";

import { cookies } from "next/headers";
import { ACTIVE_ROLE_COOKIE, parseActiveRole } from "@/lib/active-role";

export async function setActiveRole(role: string): Promise<void> {
  (await cookies()).set(ACTIVE_ROLE_COOKIE, parseActiveRole(role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
