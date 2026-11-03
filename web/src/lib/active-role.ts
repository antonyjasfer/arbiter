// Which view the signed-in user is looking at. Display only: permission checks
// read project_members on the server and never this cookie.
export type ActiveRole = "client" | "freelancer";

export const ACTIVE_ROLE_COOKIE = "arbiter_role";

export function parseActiveRole(cookie: string | undefined): ActiveRole {
  return cookie === "freelancer" ? "freelancer" : "client";
}
