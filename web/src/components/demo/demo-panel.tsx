"use client";

import { useTransition } from "react";
import { Briefcase, Code2 } from "lucide-react";
import { demoSignInAction } from "@/app/demo-actions";
import { Button } from "@/components/ui/button";

// Landing-page card: try both roles in two clicks. Shown only when DEMO_MODE is on.
export function DemoPanel() {
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="demo-title" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 id="demo-title" className="text-lg font-semibold">
          Try the demo
        </h2>
        <p className="text-sm text-muted-foreground">No sign-up. Open the same project as each party and approve it from both sides.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button size="lg" disabled={pending} onClick={() => start(() => demoSignInAction("client"))} className="h-auto flex-col items-start gap-1 py-3 text-left whitespace-normal">
          <span className="flex items-center gap-2 font-semibold">
            <Briefcase aria-hidden /> Continue as Demo Client
          </span>
          <span className="text-xs font-normal opacity-90">Write a brief, review the AI&apos;s milestones, edit and approve.</span>
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={() => start(() => demoSignInAction("freelancer"))}
          className="h-auto flex-col items-start gap-1 py-3 text-left whitespace-normal"
        >
          <span className="flex items-center gap-2 font-semibold">
            <Code2 aria-hidden /> Continue as Demo Freelancer
          </span>
          <span className="text-xs font-normal text-muted-foreground">Check the criteria you&apos;ll be paid against, then approve.</span>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The demo is shared: other visitors may be using it at the same time, and &ldquo;Reset demo&rdquo; restores it for everyone.
      </p>
    </section>
  );
}
