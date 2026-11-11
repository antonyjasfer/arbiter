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
          if (!window.confirm("Reset demo deletes the demo projects and creates fresh ones. Projects with a live PayPal payment are kept.")) return;
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
