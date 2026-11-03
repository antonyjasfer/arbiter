import Link from "next/link";
import { Suspense } from "react";
import { RoleSwitcher } from "@/components/role-switcher";
import { getActiveRole } from "@/server/active-role";

async function HeaderControls() {
  const role = await getActiveRole();
  return <RoleSwitcher active={role} />;
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
