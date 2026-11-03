// Neon connection strings. The app uses the pooled host; migrations use the
// direct host (same endpoint without "-pooler"). sslmode is always explicit.
function withSsl(raw: string): URL {
  const u = new URL(raw);
  u.searchParams.set("sslmode", "verify-full");
  return u;
}

export function appDatabaseUrl(raw: string): string {
  return withSsl(raw).toString();
}

export function directDatabaseUrl(raw: string): string {
  const u = withSsl(raw);
  const [endpoint, ...rest] = u.hostname.split(".");
  u.hostname = [(endpoint ?? "").replace(/-pooler$/, ""), ...rest].join(".");
  return u.toString();
}
