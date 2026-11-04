"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { resetDemoAction } from "@/app/demo-actions";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/messages";

export function ResetDemoButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {message}
      </span>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Reset the demo for everyone? Demo projects go back to their starting state.")) return;
          start(async () => {
            const r = await resetDemoAction();
            setMessage(r.ok ? "Demo reset." : errorText(r.error ?? "error"));
            router.refresh();
          });
        }}
      >
        <RotateCcw aria-hidden /> {pending ? "Resetting…" : "Reset demo"}
      </Button>
    </div>
  );
}
