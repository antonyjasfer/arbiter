"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveRole } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import type { ActiveRole } from "@/lib/active-role";

const ROLES: { value: ActiveRole; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "freelancer", label: "Freelancer" },
];

// Changes which view is shown. It grants no permissions.
export function RoleSwitcher({ active }: { active: ActiveRole }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="group" aria-label="View as" className="inline-flex rounded-lg border p-0.5">
      {ROLES.map((r) => (
        <Button
          key={r.value}
          size="sm"
          variant={r.value === active ? "default" : "ghost"}
          aria-pressed={r.value === active}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await setActiveRole(r.value);
              router.refresh();
            })
          }
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}
