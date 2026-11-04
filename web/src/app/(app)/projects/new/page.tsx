import Link from "next/link";
import { NewProjectForm } from "./new-project-form";

const SAMPLE = {
  title: "Recipe box",
  budget: "250.00",
  brief:
    'A small Node.js web app where I can save recipes. There is a form with a "Recipe name" box and an "Ingredients" box and a "Save" button; saved recipes appear in a list, newest first. A search box filters the list by name. An empty name must show "Name is required". GET /health returns {"status":"ok"}. Include tests that run with npm test and a short README. Deploy it on a public HTTPS URL.',
};

export default function NewProjectPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <nav aria-label="Breadcrumb">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Projects
        </Link>
      </nav>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="text-muted-foreground">You are the client. Paste the brief you would send a freelancer; Arbiter drafts an agreement you can edit before anyone approves it.</p>
      </div>
      <NewProjectForm sample={SAMPLE} />
    </div>
  );
}
