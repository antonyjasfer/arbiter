"use client";

import { useState, useTransition } from "react";
import { acceptInviteAction } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { errorText } from "@/lib/messages";

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          size="lg"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await acceptInviteAction(token);
              if (r && !r.ok) setError(r.error);
            })
          }
        >
          {pending ? "Joining…" : "Accept and join"}
        </Button>
      </div>
      {error ? <FieldError>{errorText(error)}</FieldError> : null}
    </div>
  );
}
