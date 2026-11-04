"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Lock, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { approveAction, createManualVersionAction, saveEditAction, startCompileAction, type ActionResult } from "@/app/(app)/projects/actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { dollarsToCents, formatCents, formatIst, shortHash } from "@/lib/format";
import { errorText, JOB_ERROR_TEXT, PROBLEM_TEXT } from "@/lib/messages";
import type { AgreementBody, CriterionKind } from "@/server/agreements/body";
import { feeFor } from "@/server/agreements/fees";
import type { Workspace } from "@/server/projects/workspace";
import { CompileStatus } from "./compile-status";
import { KIND_LABEL, MilestoneCard } from "./milestone-card";

type Props = { ws: Workspace; failedDraft: AgreementBody | null; startError: string | null };

function Problems({ result }: { result: ActionResult<unknown> | null }) {
  if (!result || result.ok) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-lg border border-status-fail/30 bg-status-fail/8 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-status-fail">
        <CircleAlert aria-hidden className="size-4" />
        {result.error === "invalid_body" ? "The agreement doesn't pass the checks yet:" : errorText(result.error)}
      </p>
      {result.problems?.length ? (
        <ul className="ml-6 list-disc text-muted-foreground">
          {[...new Set(result.problems.map((p) => p.code))].map((c) => (
            <li key={c}>{PROBLEM_TEXT[c] ?? c}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AgreementWorkspace({ ws, failedDraft, startError }: Props) {
  const isClient = ws.role === "client";
  const job = ws.job;
  if (job && (job.status === "queued" || job.status === "running")) return <CompileStatus jobId={job.id} isClient={isClient} />;
  if (ws.version) return <AgreementView ws={ws} />;
  return <NoAgreement ws={ws} failedDraft={failedDraft} startError={startError} />;
}

function RecompileButton({ projectId, answers, label = "Recompile with AI", variant = "outline" as const }: { projectId: string; answers?: { question: string; answer: string }[]; label?: string; variant?: "outline" | "default" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={variant}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await startCompileAction(projectId, answers ?? []);
              setResult(r);
              if (r.ok) router.refresh();
            })
          }
        >
          <Sparkles aria-hidden /> {pending ? "Starting…" : label}
        </Button>
      </div>
      <Problems result={result} />
    </div>
  );
}

function NoAgreement({ ws, failedDraft, startError }: Props) {
  const [editing, setEditing] = useState<AgreementBody | null>(null);
  const isClient = ws.role === "client";
  const job = ws.job;
  if (!isClient) {
    return (
      <EmptyState title="No agreement yet" body={`Waiting for ${ws.parties.client} to draft the milestones. You'll review and approve them here.`} />
    );
  }
  if (editing) return <Editor ws={ws} initial={editing} onCancel={() => setEditing(null)} mode="new" />;
  const blank: AgreementBody = {
    milestones: [{ key: "m1", title: "", amountCents: ws.project.budgetCents, dueInDays: 14, criteria: [{ key: "m1c1", kind: "test", text: "", needsHumanJudgment: false }] }],
    questions: [],
  };
  const failed = job?.status === "failed";
  const problems: { code: string }[] = failed && job.errorCode === "checks_failed" && job.errorDetail ? (JSON.parse(job.errorDetail) as { code: string }[]) : [];
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-6">
      {failed ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-semibold text-status-fail">
            <CircleAlert aria-hidden className="size-5" /> Couldn&apos;t produce a valid agreement
          </p>
          <p className="text-sm text-muted-foreground">{JOB_ERROR_TEXT[job.errorCode ?? "error"] ?? JOB_ERROR_TEXT.error}</p>
          {problems.length ? (
            <ul className="ml-6 list-disc text-sm text-muted-foreground">
              {[...new Set(problems.map((p) => p.code))].map((c) => (
                <li key={c}>{PROBLEM_TEXT[c] ?? c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">No agreement yet</p>
          <p className="text-sm text-muted-foreground">{startError ? errorText(startError) : "Let the AI draft milestones from the brief, or write them yourself."}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {startError === "daily_cap" || startError === "demo_cap" ? null : <RecompileButton projectId={ws.project.id} label={failed ? "Recompile with AI" : "Draft with AI"} variant={failed ? "outline" : "default"} />}
        {failedDraft ? (
          <div>
            <Button variant="outline" onClick={() => setEditing(failedDraft)}>
              <Pencil aria-hidden /> Fix the AI draft by hand
            </Button>
          </div>
        ) : null}
        <div>
          <Button variant="ghost" onClick={() => setEditing(blank)}>
            <Pencil aria-hidden /> Write it by hand
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-dashed p-6">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function AgreementView({ ws }: { ws: Workspace }) {
  const v = ws.version!;
  const [editing, setEditing] = useState(false);
  const isClient = ws.role === "client";
  if (editing) return <Editor ws={ws} initial={v.body} onCancel={() => setEditing(false)} mode="edit" />;
  const total = v.body.milestones.reduce((s, m) => s + m.amountCents, 0);
  const reviewCount = v.body.milestones.flatMap((m) => m.criteria).filter((c) => c.kind === "review").length;
  const lastJobFailed = ws.job?.status === "failed";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Agreement</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            Version {v.version} · {v.source === "ai" ? "drafted by AI" : "edited by hand"} · {v.body.milestones.length} milestone{v.body.milestones.length === 1 ? "" : "s"} · {formatCents(total)}
          </p>
        </div>
        {isClient && !v.locked ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit
          </Button>
        ) : null}
      </div>

      {v.locked ? (
        <div className="flex flex-col gap-2 rounded-xl border border-status-pass/30 bg-status-pass/8 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Lock aria-hidden className="size-4 text-status-pass" /> Locked by both parties
          </p>
          <p className="text-sm text-muted-foreground">
            Version {v.version} was approved by both parties on {formatIst(v.lockedAt!)}. Its milestones are now AGREED; funding them with PayPal comes next.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border bg-background px-2 py-1 font-mono text-xs" title={v.hash}>
              SHA-256 {shortHash(v.hash)}…
            </code>
            <CopyButton value={v.hash} label="Copy full hash" />
          </div>
        </div>
      ) : null}

      {lastJobFailed && !v.locked ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-status-fail">
          <CircleAlert aria-hidden className="size-4" /> The last AI redraft failed ({JOB_ERROR_TEXT[ws.job!.errorCode ?? "error"] ?? JOB_ERROR_TEXT.error}). This is still version {v.version}.
        </p>
      ) : null}

      {reviewCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {reviewCount} criterion{reviewCount === 1 ? " needs" : "s need"} human judgment. Arbiter will mark {reviewCount === 1 ? "it" : "them"} NEEDS HUMAN REVIEW instead of
          deciding.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {v.body.milestones.map((m, i) => (
          <MilestoneCard key={m.key} m={m} index={i} fee={v.fees[i] ?? feeFor(m.amountCents)} lockedAt={v.lockedAt} />
        ))}
      </div>

      {!v.locked && v.body.questions.length > 0 ? <Questions ws={ws} /> : null}
      <ApprovalBar ws={ws} />
    </div>
  );
}

function Questions({ ws }: { ws: Workspace }) {
  const v = ws.version!;
  const isClient = ws.role === "client";
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <section aria-labelledby="questions-title" className="flex flex-col gap-4 rounded-xl border border-status-review/40 bg-status-review/8 p-5">
      <div className="flex flex-col gap-1">
        <h3 id="questions-title" className="font-semibold">
          The AI has {v.body.questions.length} question{v.body.questions.length === 1 ? "" : "s"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {isClient ? "Answer what you can and recompile, or edit the milestones by hand." : "The client can answer these and recompile."}
        </p>
      </div>
      <ol className="flex flex-col gap-4">
        {v.body.questions.map((q, i) => (
          <li key={q.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`ans-${q.key}`}>
              {i + 1}. {q.question}
            </Label>
            {q.why ? <FieldHint id={`why-${q.key}`}>{q.why}</FieldHint> : null}
            {isClient ? (
              <Textarea
                id={`ans-${q.key}`}
                aria-describedby={q.why ? `why-${q.key}` : undefined}
                className="min-h-16 bg-background"
                maxLength={1000}
                value={answers[q.key] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              />
            ) : null}
          </li>
        ))}
      </ol>
      {isClient ? (
        <RecompileButton
          projectId={ws.project.id}
          label="Recompile with answers"
          variant="default"
          answers={v.body.questions.map((q) => ({ question: q.question, answer: (answers[q.key] ?? "").trim() }))}
        />
      ) : null}
    </section>
  );
}

function ApprovalBar({ ws }: { ws: Workspace }) {
  const v = ws.version!;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const mine = ws.role === "client" ? v.clientApprovedAt : v.freelancerApprovedAt;
  const rows = [
    { who: `${ws.parties.client} (client)`, at: v.clientApprovedAt, joined: true },
    { who: ws.parties.freelancer ? `${ws.parties.freelancer} (freelancer)` : "Freelancer", at: v.freelancerApprovedAt, joined: Boolean(ws.parties.freelancer) },
  ];
  return (
    <section aria-labelledby="approvals-title" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <h3 id="approvals-title" className="font-semibold">
        Approvals for version {v.version}
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.who} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{r.who}</span>
            {r.at ? (
              <StatusBadge tone="pass">Approved {formatIst(r.at)}</StatusBadge>
            ) : r.joined ? (
              <StatusBadge tone="pending">Not yet</StatusBadge>
            ) : (
              <StatusBadge tone="review">Hasn&apos;t joined</StatusBadge>
            )}
          </li>
        ))}
      </ul>
      {!v.locked && !mine ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Approving records your agreement to exactly this version (SHA-256 {shortHash(v.hash)}…). Any later edit creates a new version and clears both approvals.
          </p>
          <div>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await approveAction(ws.project.id, v.hash);
                  setResult(r);
                  router.refresh();
                })
              }
            >
              <CircleCheck aria-hidden /> {pending ? "Approving…" : `Approve version ${v.version}`}
            </Button>
          </div>
          <Problems result={result} />
        </div>
      ) : null}
      {!v.locked && mine ? <p className="text-sm text-muted-foreground">You approved this version. It locks when the other party approves it too.</p> : null}
    </section>
  );
}

type DraftMilestone = { title: string; amount: string; dueInDays: string; criteria: { kind: CriterionKind; text: string }[] };

function toDraft(body: AgreementBody): DraftMilestone[] {
  return body.milestones.map((m) => ({
    title: m.title,
    amount: (m.amountCents / 100).toFixed(2),
    dueInDays: String(m.dueInDays),
    criteria: m.criteria.map((c) => ({ kind: c.kind, text: c.text })),
  }));
}

function fromDraft(draft: DraftMilestone[], questions: AgreementBody["questions"]): AgreementBody | null {
  const milestones: AgreementBody["milestones"] = [];
  for (const [i, m] of draft.entries()) {
    const amountCents = dollarsToCents(m.amount);
    const dueInDays = Number.parseInt(m.dueInDays, 10);
    if (amountCents === null || !Number.isFinite(dueInDays)) return null;
    milestones.push({
      key: `m${i + 1}`,
      title: m.title.trim(),
      amountCents,
      dueInDays,
      criteria: m.criteria.map((c, j) => ({ key: `m${i + 1}c${j + 1}`, kind: c.kind, text: c.text.trim(), needsHumanJudgment: c.kind === "review" })),
    });
  }
  return { milestones, questions };
}

function Editor({ ws, initial, onCancel, mode }: { ws: Workspace; initial: AgreementBody; onCancel: () => void; mode: "edit" | "new" }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftMilestone[]>(() => toDraft(initial));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const budget = ws.project.budgetCents;
  const allocated = useMemo(() => draft.reduce((s, m) => s + (dollarsToCents(m.amount) ?? 0), 0), [draft]);
  const left = budget - allocated;
  const v = ws.version;
  const willClear = mode === "edit" && Boolean(v?.clientApprovedAt || v?.freelancerApprovedAt);
  // Mirrors saveEdit: only an unapproved hand-written version is edited in place.
  const inPlace = mode === "edit" && v?.source === "manual" && !willClear;
  const nextVersion = inPlace ? v!.version : (v?.version ?? 0) + 1;
  // The criterion just added gets the cursor, so adding one is: click, type, pick the kind.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const update = (i: number, patch: Partial<DraftMilestone>) => setDraft(draft.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const updateCriterion = (i: number, k: number, patch: Partial<DraftMilestone["criteria"][number]>) =>
    update(i, { criteria: draft[i]!.criteria.map((c, j) => (j === k ? { ...c, ...patch } : c)) });

  function save() {
    const body = fromDraft(draft, initial.questions);
    if (!body) {
      setResult({ ok: false, error: "invalid_body", problems: [{ code: "invalid_shape" }] });
      return;
    }
    start(async () => {
      const r = mode === "edit" ? await saveEditAction(ws.project.id, ws.version!.hash, body) : await createManualVersionAction(ws.project.id, body);
      setResult(r);
      if (r.ok) {
        onCancel();
        router.refresh();
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      aria-labelledby="editor-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="editor-title" className="text-lg font-semibold">
          {mode === "edit" ? `Editing version ${ws.version!.version}` : "Write the agreement"}
        </h2>
        <p aria-live="polite" className={`text-sm font-medium tabular-nums ${left === 0 ? "text-status-pass" : "text-status-fail"}`}>
          {left === 0 ? `${formatCents(allocated)} of ${formatCents(budget)} allocated` : left > 0 ? `${formatCents(left)} left to allocate` : `${formatCents(-left)} over the budget`}
        </p>
      </div>
      {willClear ? (
        <p className="rounded-lg border border-status-review/40 bg-status-review/10 p-3 text-sm">Saving creates version {nextVersion} and clears the approvals on version {v!.version}.</p>
      ) : mode === "edit" && v?.source === "ai" ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">Saving creates version {nextVersion}. Version {v.version}, the AI&apos;s draft, stays in the history unchanged.</p>
      ) : null}

      {draft.map((m, i) => (
        <fieldset key={i} className="flex flex-col gap-4 rounded-xl border p-5">
          <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Milestone {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_7rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`t-${i}`}>Title</Label>
              <Input id={`t-${i}`} value={m.title} maxLength={120} required onChange={(e) => update(i, { title: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`a-${i}`}>Amount (USD)</Label>
              <Input id={`a-${i}`} inputMode="decimal" className="font-mono tabular-nums" value={m.amount} onChange={(e) => update(i, { amount: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`d-${i}`}>Due in days</Label>
              <Input id={`d-${i}`} type="number" min={1} max={90} value={m.dueInDays} onChange={(e) => update(i, { dueInDays: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Acceptance criteria</p>
            {m.criteria.map((c, k) => (
              <div key={k} className="grid gap-2 sm:grid-cols-[11rem_1fr_auto]">
                <Select aria-label={`Criterion ${k + 1} kind`} value={c.kind} onChange={(e) => updateCriterion(i, k, { kind: e.target.value as CriterionKind })}>
                  {(Object.keys(KIND_LABEL) as CriterionKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </Select>
                <Input aria-label={`Criterion ${k + 1}`} autoFocus={focusKey === `${i}-${k}`} value={c.text} maxLength={500} required placeholder="One observable, checkable statement" onChange={(e) => updateCriterion(i, k, { text: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove criterion ${k + 1}`} disabled={m.criteria.length === 1} onClick={() => update(i, { criteria: m.criteria.filter((_, j) => j !== k) })}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={m.criteria.length >= 8}
                onClick={() => {
                  setFocusKey(`${i}-${m.criteria.length}`);
                  update(i, { criteria: [...m.criteria, { kind: "test", text: "" }] });
                }}
              >
                <Plus aria-hidden /> Add criterion
              </Button>
              {draft.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden /> Remove milestone
                </Button>
              ) : null}
            </div>
          </div>
        </fieldset>
      ))}

      <div>
        <Button type="button" variant="outline" disabled={draft.length >= 6} onClick={() => setDraft([...draft, { title: "", amount: "50.00", dueInDays: "14", criteria: [{ kind: "test", text: "" }] }])}>
          <Plus aria-hidden /> Add milestone
        </Button>
      </div>
      <FieldHint>Each milestone is at least $50.00, and the amounts must add up to the budget of {formatCents(budget)}.</FieldHint>
      <Problems result={result} />
      {result && !result.ok && result.error === "stale" ? <FieldError>Reload the page to see the latest version before editing.</FieldError> : null}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : inPlace ? "Save changes" : `Save as version ${nextVersion}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          <RotateCcw aria-hidden /> Cancel
        </Button>
      </div>
    </form>
  );
}
