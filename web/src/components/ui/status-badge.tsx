import { cn } from "cn";
import type { Tone } from "@/lib/format";

// DESIGN.md: status is never colour alone; the label always carries the meaning.
const tones: Record<Tone, string> = {
  pass: "bg-status-pass/12 text-status-pass border-status-pass/30",
  fail: "bg-status-fail/12 text-status-fail border-status-fail/30",
  review: "bg-status-review/15 text-[color-mix(in_oklch,var(--status-review),var(--foreground)_35%)] border-status-review/40",
  pending: "bg-status-pending/12 text-[color-mix(in_oklch,var(--status-pending),var(--foreground)_30%)] border-status-pending/30",
};

export function StatusBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
