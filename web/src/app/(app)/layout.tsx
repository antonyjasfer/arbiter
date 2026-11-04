import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { auth } from "@/auth";
import { UserMenu } from "@/components/user-menu";

// Phase 3: roles come from project membership (shown on each project), so the Phase 2 view switcher
// is no longer in the header; it granted nothing and would now only confuse.
async function HeaderControls() {
  // Request-time only: auth() uses crypto, which Cache Components refuses during prerender.
  await connection();
  const session = await auth();
  return <div className="flex items-center gap-4">{session?.user ? <UserMenu name={session.user.name ?? "Signed in"} image={session.user.image} /> : null}</div>;
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link href="/dashboard" className="font-semibold">
            Arbiter
          </Link>
          <Suspense fallback={<div className="h-8 w-44" />}>
            <HeaderControls />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">{children}</main>
    </div>
  );
}
