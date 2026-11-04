"use client";

import { useActionState, useState } from "react";
import { ShieldAlert, Sparkles } from "lucide-react";
import { createProjectAction } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label, Textarea } from "@/components/ui/field";
import { errorText } from "@/lib/messages";

export function NewProjectForm({ sample }: { sample?: { title: string; brief: string; budget: string } }) {
  const [state, action, pending] = useActionState(createProjectAction, null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("");
  const error = state && !state.ok ? errorText(state.error) : null;
  const tooShort = brief.trim().length > 0 && brief.trim().length < 40;

  return (
    <form action={action} className="flex flex-col gap-6" aria-describedby={error ? "form-error" : undefined}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Project title</Label>
        <Input id="title" name="title" required maxLength={120} placeholder="TaskBoard" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-end justify-between gap-2">
          <Label htmlFor="brief">Brief</Label>
          <span className={`text-xs tabular-nums ${tooShort ? "text-status-fail" : "text-muted-foreground"}`} aria-live="polite">
            {brief.length} / 4,000
          </span>
        </div>
        <div id="gemini-notice" className="flex gap-2 rounded-lg border border-status-review/40 bg-status-review/10 p-3 text-sm">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            Your brief is sent to Google Gemini (free tier), which may use it to improve Google&apos;s products. Don&apos;t include personal or confidential details.
          </p>
        </div>
        <Textarea
          id="brief"
          name="brief"
          required
          minLength={40}
          maxLength={4000}
          className="min-h-56"
          aria-describedby="gemini-notice brief-hint"
          aria-invalid={tooShort || undefined}
          placeholder="Describe what you need built, in plain language: what people can do with it, anything it must show or reject, and how you want it delivered."
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <FieldHint id="brief-hint">40 to 4,000 characters. The AI turns it into milestones with checkable acceptance criteria, and asks about anything vague.</FieldHint>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-56">
        <Label htmlFor="budget">Budget (USD)</Label>
        <Input id="budget" name="budget" required inputMode="decimal" placeholder="300.00" className="font-mono tabular-nums" aria-describedby="budget-hint" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <FieldHint id="budget-hint">$50 to $5,000. Each milestone is at least $50.</FieldHint>
      </div>

      {error ? <FieldError id="form-error">{error}</FieldError> : null}

      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button type="submit" size="lg" disabled={pending}>
          <Sparkles aria-hidden /> {pending ? "Creating…" : "Create project and draft the agreement"}
        </Button>
        {sample ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTitle(sample.title);
              setBrief(sample.brief);
              setBudget(sample.budget);
            }}
          >
            Fill in a sample brief
          </Button>
        ) : null}
      </div>
    </form>
  );
}
