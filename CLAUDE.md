# Arbiter

Arbiter is a payment workflow where freelance software work gets paid when evidence shows it was delivered. Client and freelancer agree on testable criteria; Arbiter runs real checks (tests in a Render Sandbox, browser checks) against the submitted work; money moves through PayPal only after a person approves the evidence. Entry for the PayPal AI Hackathon (Devpost). Built solo by Jasfer (student, India) with Claude Code.

> Provenance: drafted on 2026-10-29 from `Arbiter - Phase 0 Plan.pdf` (sections 0, 4, 5, 8, 10). The original CLAUDE.md was not present in the folder. Review and correct this file; it is the rule set for every session.

## Deadline
Submission closes **Thu 12 Nov 2026, 12:00 pm PST = 20:00 UTC = 01:30 IST on Fri 13 Nov**. Target submit date: **11 Nov**. Judging ends 15 Dec; the hosted app, sandbox accounts and AI key must keep working until then.

## Non-negotiable rules
1. **AI never moves money.** PayPal money-moving calls (create/authorize/capture/reauthorize/void/payout) are made only by deterministic server code, only after a human approves, and only within the agreed milestone amount and payee. No model gets a tool that changes state or touches payments.
2. **Evidence, not opinion.** Test exit codes and browser assertions decide verdicts. A model summary can never override a deterministic verdict. AI-judged verdicts are labelled; low confidence (<0.7), review-kind criteria, injection flags and every payment release need a person's click.
3. **Say what PayPal does.** An authorization is valid 29 days with a 3-day honor period; fund one milestone at a time and reauthorize. Do not call it "escrow" in the app or README. Disclose that live use needs PayPal platform approvals.
4. **Idempotent and race-safe.** Every PayPal write sends a stored `PayPal-Request-Id`. Every milestone transition is one SQL update guarded by `WHERE state = <expected> AND state_version = <n>`. Webhooks are signature-verified, stored once by event id, then reconciled by fetching the object from PayPal; they never move state on their own payload.
5. **Zod at every boundary**, including model output. Model reply is parsed with Zod, retried once with the validation error, then the run becomes `needs_review`.
6. **Untrusted input stays in data blocks.** Repo and site content is passed only inside delimited data blocks and the system prompt says it is untrusted. Scan for instruction-like text aimed at AI reviewers and record it as evidence.
7. **No secrets in code, chat, logs or workers.** Secrets live in `.env.local` (git-ignored) and Render's environment settings. Workers and sandboxes get no PayPal secrets. Logs store hashes and request ids, never tokens, card data, emails or payloads.
8. **Tests before "done".** Use TDD for logic, systematic debugging for failures, verification-before-completion before any claim of success. State machine, payment guard and webhook verification must have tests.
9. **Real, not faked.** No fake integrations, no mocked AI in the product, nothing we would have to hide from judges. Spikes are labelled throwaway.
10. **Phase gates.** Stop for approval at the end of each phase. P0 first; the cut line is in Phase 7 (drop the dispute assistant before the dashboard).

## Stack
TypeScript (strict) everywhere. Next.js App Router, Tailwind + shadcn/ui, Drizzle + Render Postgres, Auth.js (GitHub), Zod, PayPal REST (Orders v2, Payments v2, Payouts v1, Webhooks v1) + JS SDK v6 buttons, `@paypal/agent-toolkit` read-only in the dispute assistant, Anthropic SDK (`claude-sonnet-5-5`, `claude-haiku-5-5`), Render Workflows + Render Sandboxes, Playwright (KERNEL replays P1), AG Studio dashboard (P1), Vitest + Playwright Test. Hosting via `render.yaml` Blueprint.

## Scope
P0: GitHub sign-in and roles, Agreement Compiler, milestones, submission (repo + commit + deploy URL), verification (sandbox tests + browser checks), PayPal authorize/capture/void/reauthorize/payout, verified webhooks, payment guard + injection detection, hash-chained audit log, three seeded demo projects. P1: AG Studio dashboard, dispute assistant, KERNEL, invoices. Out: live payments, multi-currency, KYC, non-Node projects, design/Figma judgments.

## Model usage (Claude Code)
`opusplan`/`opus` for architecture, payment state machine, sandbox runner, security review. `sonnet` for UI and routine work. `fable` only after two failed debugging attempts. Independent review: fresh subagent on opus with `superpowers:requesting-code-review`.

## Plan documents
- `docs/arbiter-plan.md` is the source of truth (product, scope, architecture, data model, phases, risks).
- Implementation plans: `docs/superpowers/plans/`.
