import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveRole } from "@/server/active-role";

async function Projects() {
  const role = await getActiveRole();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your projects</CardTitle>
        <CardDescription>
          {role === "client" ? "Projects you are paying for." : "Projects you are delivering."} None yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button disabled title="Arrives in Phase 3">
          New project
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Suspense fallback={<Card className="h-32" />}>
        <Projects />
      </Suspense>
    </>
  );
}
