// Route-level id checks for the proxy: a page whose id can't be valid gets a real HTTP 404 before any
// rendering. (A page that calls notFound() after its shell has streamed can only show a 404 page with
// status 200.) Ids that are well-formed but unknown are still answered by the page itself.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isMalformedRoute(pathname: string): boolean {
  const [, first, second] = pathname.split("/");
  if (first === "projects" && second !== undefined && second !== "new") return !UUID.test(second);
  if (first === "invite" && second !== undefined) return !INVITE_TOKEN.test(second);
  return false;
}

/** Pages that need a session. Invite links stay public: the invite page asks the visitor to sign in. */
export function requiresSignIn(pathname: string): boolean {
  return /^\/(dashboard|projects|settings)(\/|$)/.test(pathname);
}
