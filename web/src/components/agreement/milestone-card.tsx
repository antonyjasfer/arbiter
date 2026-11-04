import { CircleCheck, FlaskConical, FileText, Globe, UserRound } from "lucide-react";
import { formatCents, formatIstDate } from "@/lib/format";
import type { AgreementBody, CriterionKind } from "@/server/agreements/body";

export const KIND_LABEL: Record<CriterionKind, string> = { test: "Test", browser: "Browser", static: "Static", review: "Needs human review" };
const KIND_ICON = { test: FlaskConical, browser: Globe, static: FileText, review: UserRound };
const KIND_HELP: Record<CriterionKind, string> = {
  test: "Checked by running the repo's tests",
  browser: "Checked by a script on the deployed site",
  static: "Checked by reading files in the repo",
  review: "A person decides; no script can",
};

export function KindBadge({ kind }: { kind: CriterionKind }) {
  const Icon = KIND_ICON[kind];
  const review = kind === "review";
  return (
    <span
      title={KIND_HELP[kind]}
      className={
        review
          ? "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-status-review/40 bg-status-review/15 px-2 text-xs font-medium"
          : "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border bg-muted/50 px-2 text-xs font-medium text-muted-foreground"
      }
    >
      <Icon aria-hidden className="size-3.5" />
      {KIND_LABEL[kind]}
    </span>
  );
}

type Milestone = AgreementBody["milestones"][number];

export function MilestoneCard({ m, index, fee, lockedAt }: { m: Milestone; index: number; fee: { feeCents: number; payoutCents: number }; lockedAt: Date | null }) {
  const due = lockedAt ? `Due ${formatIstDate(new Date(lockedAt.getTime() + m.dueInDays * 86_400_000))}` : `Due ${m.dueInDays} days after both approve`;
  return (
    <article className="flex flex-col gap-4 rounded-xl border bg-card p-5" aria-labelledby={`${m.key}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Milestone {index + 1}</p>
          <h3 id={`${m.key}-title`} className="text-base font-semibold text-balance">
            {m.title}
          </h3>
          <p className="text-sm text-muted-foreground">{due}</p>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums">{formatCents(m.amountCents)}</p>
      </header>
      <ul className="flex flex-col gap-2.5">
        {m.criteria.map((c) => (
          <li key={c.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
            <KindBadge kind={c.kind} />
            <span className="text-sm leading-relaxed text-pretty">{c.text}</span>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-x-2 border-t pt-3 text-sm text-muted-foreground tabular-nums">
        <CircleCheck aria-hidden className="size-4 text-status-pass" />
        Arbiter fee {formatCents(fee.feeCents)} (5% + $1.00) · Freelancer receives <span className="font-medium text-foreground">{formatCents(fee.payoutCents)}</span>
      </p>
    </article>
  );
}
