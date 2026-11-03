// Decides how to point the PayPal webhook at a URL without ever creating a duplicate.
export type ExistingWebhook = { id: string; url: string; eventTypes: string[] };
export type PatchOp = { op: "replace"; path: "/url" | "/event_types"; value: unknown };
export type RegistrationPlan = { action: "reuse"; id: string } | { action: "patch"; id: string; patch: PatchOp[] } | { action: "create" };

export function planRegistration(args: { existing: ExistingWebhook[]; storedId?: string; targetUrl: string; wanted: string[] }): RegistrationPlan {
  const hasAll = (w: ExistingWebhook) => args.wanted.every((name) => w.eventTypes.includes(name));
  const atTarget = args.existing.find((w) => w.url === args.targetUrl && hasAll(w));
  if (atTarget) return { action: "reuse", id: atTarget.id };
  const stored = args.storedId ? args.existing.find((w) => w.id === args.storedId) : undefined;
  if (!stored) return { action: "create" };
  const patch: PatchOp[] = [];
  if (stored.url !== args.targetUrl) patch.push({ op: "replace", path: "/url", value: args.targetUrl });
  if (!hasAll(stored)) patch.push({ op: "replace", path: "/event_types", value: args.wanted.map((name) => ({ name })) });
  return patch.length ? { action: "patch", id: stored.id, patch } : { action: "reuse", id: stored.id };
}
