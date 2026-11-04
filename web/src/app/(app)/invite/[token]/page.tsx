import { Suspense } from "react";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/messages";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { peekInvite } from "@/server/projects/invitations";
import { AcceptInviteButton } from "./accept-button";

async function Invite({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await requireUser();
  if (!user.ok) {
    return (
      <div className="flex max-w-lg flex-col gap-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">You&apos;ve been invited to a project</h1>
        <p className="text-muted-foreground">Sign in with GitHub to see the project and join it as the freelancer.</p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: `/invite/${encodeURIComponent(token)}` });
          }}
        >
          <Button size="lg" type="submit">
            Sign in with GitHub
          </Button>
        </form>
      </div>
    );
  }
  const peek = await peekInvite(getDb(), { userId: user.value.userId, token });
  if (!peek.ok) {
    return (
      <div role="alert" className="flex max-w-lg flex-col gap-2 rounded-xl border border-status-fail/30 p-6">
        <h1 className="text-xl font-semibold">Invite not valid</h1>
        <p className="text-muted-foreground">{errorText("invalid")}</p>
      </div>
    );
  }
  return (
    <div className="flex max-w-lg flex-col gap-4 rounded-xl border p-6">
      <h1 className="text-xl font-semibold text-balance">You&apos;ve been invited to &ldquo;{peek.value.title}&rdquo; as the freelancer</h1>
      <p className="text-muted-foreground">Joining lets you review the agreement, approve it, and later submit your work for verification. The link works once.</p>
      <AcceptInviteButton token={token} />
    </div>
  );
}

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<div className="h-40 max-w-lg animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-label="Loading invite" />}>
      <Invite {...props} />
    </Suspense>
  );
}
