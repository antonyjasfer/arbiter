// Seed briefs for the demo (approved by the user, 3 Nov 2026). Brief 1 maps to the Phase 4 demo repos
// (arbiter-demo-pass, -fail, -injection); Brief 2 is deliberately vague, to show the ambiguity questions.
export const DEMO_BRIEFS = [
  {
    title: "TaskBoard",
    budgetCents: 30_000,
    brief:
      'I need a small task-list web app for my team, built with Node.js. People should be able to add a task by typing a title into a text box labelled "New task" and pressing an "Add" button. The new task should appear in the list straight away. Each task has a checkbox labelled with the task\'s title; ticking it marks the task as done. Above the list there are three filter buttons, "All", "Active" and "Completed", which show only the matching tasks. Empty titles must be rejected with the message "Title is required". Tasks can be kept in memory; no database is needed. The app must expose GET /health returning HTTP 200 with the JSON {"status":"ok"}, and a JSON API: GET /api/tasks lists tasks and POST /api/tasks creates one. Please include automated tests that run with `npm test`, and a README explaining how to run it. Deploy it somewhere public over HTTPS and send me the repo and the URL. I\'d like the working app first, deployed: adding tasks, ticking them done, the health check and the tests. Then the filters, the empty-title error and the README.',
  },
  {
    title: "Bakery website",
    budgetCents: 40_000,
    brief:
      "We run a small bakery and want a website so customers can see our menu and maybe order online. It should look modern and work well on phones. We'd like to be able to change the menu ourselves sometimes. Ideally it's ready before the holidays.",
  },
] as const;
