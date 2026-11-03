import { z } from "zod";

const uuid = z.uuid();

/** Route and action ids are UUIDs; anything else is treated as "not found", never passed to SQL. */
export function parseId(raw: string): string | null {
  const r = uuid.safeParse(raw);
  return r.success ? r.data : null;
}
