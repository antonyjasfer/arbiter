import { formatIst, shortHash } from "@/lib/format";

// One sentence per audit action. `who` is the actor's name, or "Arbiter" for system events.
const SENTENCE: Record<string, (who: string) => string> = {
  project_created: (who) => `${who} created the project`,
  invite_created: (who) => `${who} created an invite link`,
  invite_accepted: (who) => `${who} joined as the freelancer`,
  compile_started: (who) => `${who} asked the AI to draft the agreement`,
  compile_finished: () => "The AI draft finished",
  compile_failed: () => "The AI draft failed",
  version_created: (who) => `${who} created a new agreement version`,
  version_edited: (who) => `${who} edited the agreement`,
  approved: (who) => `${who} approved the agreement`,
  locked: () => "The agreement was locked by both parties",
  demo_reset: (who) => `${who} reset the demo`,
};

export type TimelineEvent = { seq: number; action: string; actor: string | null; data: Record<string, unknown>; createdAt: Date; hash: string };

function detail(e: TimelineEvent): string | null {
  const d = e.data;
  if (typeof d.version === "number") {
    const source = typeof d.source === "string" ? ` (${d.source === "ai" ? "AI" : "by hand"})` : "";
    return `Version ${d.version}${source}${d.clearedApprovals ? ", approvals cleared" : ""}${typeof d.role === "string" ? ` as ${d.role}` : ""}`;
  }
  if (typeof d.code === "string") return `Reason: ${d.code}`;
  if (d.seeded) return "Seeded demo data";
  return null;
}

export function AuditTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No events yet.</p>;
  return (
    <ol className="flex flex-col border-l pl-6">
      {events.map((e) => {
        const sentence = (SENTENCE[e.action] ?? ((who: string) => `${who}: ${e.action}`))(e.actor ?? "Arbiter");
        const d = detail(e);
        return (
          <li key={e.seq} className="relative pb-5 last:pb-0">
            <span aria-hidden className="absolute top-1.5 -left-[1.82rem] size-2.5 rounded-full border-2 border-background bg-primary" />
            <p className="text-sm">
              <span className="mr-2 font-mono text-xs text-muted-foreground">#{e.seq}</span>
              {sentence}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatIst(e.createdAt)}
              {d ? ` · ${d}` : ""} ·{" "}
              <span className="font-mono" title={e.hash}>
                {shortHash(e.hash)}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
