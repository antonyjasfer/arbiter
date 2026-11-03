# Database driver decision (Phase 2, 3 Nov 2026)

**Chosen: `pg` 8.23.1 Pool through `drizzle-orm/node-postgres`, on Neon's pooled host with `sslmode=verify-full`.**

Measured with `npx tsx scripts/db-bench.ts` from the developer machine in India to Neon us-east-1 (two runs, `SELECT 1`, pool size 1):

| Driver | First connect + query | Warm median (10) | Transaction |
|---|---|---|---|
| `pg` Pool (TCP) | 3765 / 2942 ms | 327 / 323 ms | 961 / 960 ms interactive |
| `@neondatabase/serverless` Pool (WebSocket) | 1932 / 1929 ms | 319 / 318 ms | 969 / 950 ms interactive |
| `@neondatabase/serverless` `neon()` (HTTP) | 1711 / 1621 ms | 327 / 328 ms | 318 / 370 ms batch only, no interactive transaction |

Why `pg`:
- Warm queries are the same speed (within 2%, far under the plan's 20% threshold); from India every number is dominated by the ~320 ms round trip.
- The serverless driver's advantage is the first connection (fewer round trips for the TLS/TCP setup). On Render the app is a long-lived Node process in Virginia next to Neon us-east-1, so the pool connects once per process start and the round trip is a few ms; the gap shrinks to almost nothing.
- Guarded state transitions with an audit append need interactive transactions. The HTTP driver only offers non-interactive batches; the WebSocket Pool works but adds a WebSocket dependency for no measured gain.
- `pg` is what Drizzle's node-postgres adapter and drizzle-kit use, and what Phase 1 already ran against this database.

Cost if wrong: switching to the Neon WebSocket Pool is a change to `src/server/db/client.ts` only.
