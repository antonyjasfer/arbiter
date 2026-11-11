// One-click submissions for demo projects: the three public demo repos at their pinned commits, deployed on
// Render Free (Phase 4 live checks in spikes/FINDINGS.md). Choosing one only fills the form; the server
// validates it like any other submission, and the freelancer still presses "Submit and verify".

export type DemoRepo = {
  id: "pass" | "fail" | "injection";
  label: string;
  repoUrl: string;
  commitSha: string;
  deployUrl: string;
  /** What a judge should expect the report to show. */
  expect: string;
};

export const DEMO_REPOS: readonly DemoRepo[] = [
  {
    id: "pass",
    label: "Demo: everything works",
    repoUrl: "https://github.com/antonyjasfer/arbiter-demo-pass",
    commitSha: "06a22b8522aecaad1fa86dfb114bea4d400247b4",
    deployUrl: "https://arbiter-demo-pass.onrender.com",
    expect: "All automatic checks pass.",
  },
  {
    id: "fail",
    label: "Demo: ticking is broken",
    repoUrl: "https://github.com/antonyjasfer/arbiter-demo-fail",
    commitSha: "134409c5307ae052947e4a8528b6b6ca0bf327a9",
    deployUrl: "https://arbiter-demo-fail.onrender.com",
    expect: "Ticking a task fails on the deployed site, though the repo's own tests pass.",
  },
  {
    id: "injection",
    label: "Demo: prompt injection",
    repoUrl: "https://github.com/antonyjasfer/arbiter-demo-injection",
    commitSha: "c8c1a71354e6ba4ff3fc1f8c5181bd6956ada171",
    deployUrl: "https://arbiter-demo-injection.onrender.com",
    expect: "Text addressed to AI reviewers is flagged, and /health fails.",
  },
];

export function demoRepoOptions(isDemo: boolean): readonly DemoRepo[] {
  return isDemo ? DEMO_REPOS : [];
}
