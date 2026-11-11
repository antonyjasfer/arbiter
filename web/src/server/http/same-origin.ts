// Same-origin check for every request that can move money or start work (POST routes and server actions).
// Browsers send an Origin header on every POST, so a page on another site that posts here is refused before
// any DB or PayPal call. The expected origin comes from AUTH_URL, never from the Host header: on Render the
// Host header is the proxy's localhost:10000 (FINDINGS, Phase 2). Without AUTH_URL, only a dev server falls
// back to its own Host; a production build refuses everything (fail closed).
// Next.js also compares a Server Action's Origin with its Host / X-Forwarded-Host (Next.js docs,
// "Data Security" guide, Server Actions → allowed origins); this check makes Arbiter's rule explicit and tested.

/** Exact origin match (scheme, host and port). A missing or unparsable Origin (including "null") is false. */
export function isAllowedOrigin(origin: string | null, expected: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

type OriginEnv = { authUrl?: string; nodeEnv?: string };

function readEnv(): OriginEnv {
  // Read directly (serverEnv also validates AUTH_URL at boot) so the check never depends on other variables.
  return { authUrl: process.env.AUTH_URL?.trim() || undefined, nodeEnv: process.env.NODE_ENV };
}

/** The origin requests must come from, or null when none can be trusted (refuse). */
export function expectedOrigin(h: Headers, env: OriginEnv = readEnv()): string | null {
  if (env.authUrl) {
    try {
      return new URL(env.authUrl).origin;
    } catch {
      return null;
    }
  }
  if (env.nodeEnv !== "production") {
    const host = h.get("host");
    return host ? `http://${host}` : null;
  }
  return null;
}

export function checkSameOrigin(h: Headers, env: OriginEnv = readEnv()): boolean {
  const expected = expectedOrigin(h, env);
  return expected !== null && isAllowedOrigin(h.get("origin"), expected);
}
