import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInButton } from "@/components/sign-in-button";

const POINTS = [
  {
    title: "Evidence, not opinion",
    body: "Tests and browser checks decide each acceptance criterion. The AI writes checks and explains results; it does not decide them.",
  },
  {
    title: "Bounded payment authority",
    body: "The AI can never move money. Capture and payout happen only in server code, after the client approves.",
  },
  {
    title: "Resists manipulation",
    body: "A repo that tells the AI to mark everything as passed is flagged, and it still fails on its tests.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <section className="flex flex-col gap-4">
        <p className="font-mono text-sm text-muted-foreground">Arbiter</p>
        <h1 className="text-4xl font-semibold tracking-tight">Freelance work gets paid when the evidence says it was delivered.</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          The client funds a milestone with a PayPal authorization. The freelancer submits a repo and a deployed site. Arbiter runs the tests and
          browser checks, shows the evidence, and releases payment when the client approves.
        </p>
        <div>
          <SignInButton />
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {POINTS.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <CardTitle>{p.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{p.body}</CardContent>
          </Card>
        ))}
      </section>
      <footer className="text-sm text-muted-foreground">
        PayPal sandbox only; no real money moves. Arbiter is a hackathon demo, not a licensed escrow service.
      </footer>
    </main>
  );
}
