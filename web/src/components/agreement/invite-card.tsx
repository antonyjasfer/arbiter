"use client";

import { useState, useTransition } from "react";
import { Link2 } from "lucide-react";
import { createInviteAction } from "@/app/(app)/projects/actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint } from "@/components/ui/field";
import { formatIst } from "@/lib/format";
import { errorText } from "@/lib/messages";

// The link is shown once, in this browser only; Arbiter stores just a hash of it. No email is sent.
export function InviteCard({ projectId, hasOpenInvite }: { projectId: string; hasOpenInvite: boolean }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="invite-title" className="flex flex-col gap-3 rounded-xl border p-5">
      <h2 id="invite-title" className="flex items-center gap-2 font-semibold">
        <Link2 aria-hidden className="size-4" /> Invite your freelancer
      </h2>
      {link ? (
        <>
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <code className="font-mono text-xs break-all">{link.url}</code>
            <div>
              <CopyButton value={link.url} label="Copy link" />
            </div>
          </div>
          <FieldHint>Single use, expires {formatIst(new Date(link.expiresAt))}. Send it yourself; this is the only time it is shown.</FieldHint>
        </>
      ) : (
        <>
          <FieldHint>
            {hasOpenInvite ? "An unused link exists. Creating a new one cancels it." : "Create a single-use link (valid 7 days) and send it to your freelancer."}
          </FieldHint>
          <div>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await createInviteAction(projectId);
                  if (r.ok) setLink({ url: `${window.location.origin}${r.value.path}`, expiresAt: r.value.expiresAt });
                  else setError(r.error);
                })
              }
            >
              {pending ? "Creating…" : "Create invite link"}
            </Button>
          </div>
          {error ? <FieldError>{errorText(error)}</FieldError> : null}
        </>
      )}
    </section>
  );
}
