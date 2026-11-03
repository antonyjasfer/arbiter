// The agreement body stored on agreement_versions.body_json. Amounts are integer cents so the canonical
// JSON (and so the version hash) has exactly one form.
import { z } from "zod";

export const CRITERION_KINDS = ["test", "browser", "static", "review"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export const MAX_MILESTONES = 6;
export const MAX_CRITERIA = 8;
export const MIN_MILESTONE_CENTS = 5_000;

export const agreementBodySchema = z.object({
  milestones: z.array(
    z.object({
      key: z.string().regex(/^m\d{1,2}$/),
      title: z.string().trim().min(1).max(120),
      amountCents: z.number().int().min(0).max(500_000),
      dueInDays: z.number().int().min(1).max(90),
      criteria: z.array(
        z.object({
          key: z.string().regex(/^m\d{1,2}c\d{1,2}$/),
          kind: z.enum(CRITERION_KINDS),
          text: z.string().trim().min(1).max(500),
          needsHumanJudgment: z.boolean(),
        }),
      ),
    }),
  ),
  questions: z.array(z.object({ key: z.string().regex(/^q\d{1,2}$/), question: z.string().min(1).max(300), why: z.string().max(300) })).max(5),
});

export type AgreementBody = z.infer<typeof agreementBodySchema>;
